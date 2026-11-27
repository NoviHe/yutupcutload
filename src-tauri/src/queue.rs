use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, Emitter};
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::{Mutex, Semaphore};

use crate::config;
use crate::models::{
    AppSettings, ClipInput, ClipLogEvent, ClipProgressEvent, ClipStatusEvent, ClipStatusKind,
};
use crate::process::{configure_background_command, ProcessGuard};
use crate::splitter::{
    parse_progress_line, render_output_stem, resolve_non_colliding_path, validate_range,
    ParsedProgress,
};
use crate::ytdlp;

struct ActiveJobControl {
    cancelled: AtomicBool,
    guard: Mutex<Option<Arc<ProcessGuard>>>,
    output_dir: PathBuf,
    output_stem: String,
    expected_ext: String,
}

pub struct QueueManager {
    jobs: Mutex<HashMap<String, Arc<ActiveJobControl>>>,
    specs: Mutex<HashMap<String, (ClipInput, AppSettings)>>,
    semaphore_state: Mutex<(usize, Arc<Semaphore>)>,
}

impl QueueManager {
    pub fn new(initial_concurrency: usize) -> Self {
        let clamped = initial_concurrency.clamp(1, 4);
        Self {
            jobs: Mutex::new(HashMap::new()),
            specs: Mutex::new(HashMap::new()),
            semaphore_state: Mutex::new((clamped, Arc::new(Semaphore::new(clamped)))),
        }
    }

    async fn get_semaphore(&self, concurrency: usize) -> Arc<Semaphore> {
        let target = concurrency.clamp(1, 4);
        let mut guard = self.semaphore_state.lock().await;
        if guard.0 != target {
            guard.0 = target;
            guard.1 = Arc::new(Semaphore::new(target));
        }
        guard.1.clone()
    }

    pub async fn enqueue(
        self: &Arc<Self>,
        app: AppHandle,
        clips: Vec<ClipInput>,
        settings: AppSettings,
    ) -> Result<(), String> {
        if clips.is_empty() {
            return Err("Daftar klip kosong".to_string());
        }

        let env = config::check_environment(&settings);
        let ytdlp_path = env
            .yt_dlp_path
            .as_deref()
            .map(PathBuf::from)
            .ok_or_else(|| "yt-dlp.exe tidak ditemukan. Periksa folder bin/ atau Settings.".to_string())?;
        if !env.ffmpeg_found {
            return Err("ffmpeg.exe tidak ditemukan. Periksa folder bin/ atau Settings.".to_string());
        }
        let ffmpeg_dir = env
            .ffmpeg_path
            .as_deref()
            .and_then(|p| Path::new(p).parent())
            .map(|p| p.to_path_buf());

        let out_dir = PathBuf::from(settings.output_dir.trim());
        if settings.output_dir.trim().is_empty() {
            return Err("Folder output belum dipilih".to_string());
        }
        std::fs::create_dir_all(&out_dir)
            .map_err(|e| format!("Gagal membuat folder output '{}': {e}", out_dir.display()))?;

        for clip in &clips {
            validate_range(clip.start_secs, clip.end_secs, clip.video_duration)?;
        }

        let semaphore = self.get_semaphore(settings.max_concurrent).await;
        let use_node = env.node_found;

        for clip in clips {
            {
                let mut specs = self.specs.lock().await;
                specs.insert(clip.id.clone(), (clip.clone(), settings.clone()));
            }
            self.spawn_single_job(
                app.clone(),
                clip,
                settings.clone(),
                ytdlp_path.clone(),
                ffmpeg_dir.clone(),
                use_node,
                semaphore.clone(),
            )
            .await;
        }

        Ok(())
    }

    pub async fn retry_job(self: &Arc<Self>, app: AppHandle, job_id: &str) -> Result<(), String> {
        let spec = {
            let specs = self.specs.lock().await;
            specs.get(job_id).cloned()
        }
        .ok_or_else(|| "Data klip tidak ditemukan untuk diulang".to_string())?;

        self.enqueue(app, vec![spec.0], spec.1).await
    }

    pub async fn cancel_job(&self, job_id: &str) {
        let ctrl = {
            let jobs = self.jobs.lock().await;
            jobs.get(job_id).cloned()
        };
        if let Some(ctrl) = ctrl {
            ctrl.cancelled.store(true, Ordering::SeqCst);
            let guard = ctrl.guard.lock().await;
            if let Some(g) = guard.as_ref() {
                g.terminate();
            }
        }
    }

    pub async fn cancel_all(&self) {
        let all_ctrls: Vec<Arc<ActiveJobControl>> = {
            let jobs = self.jobs.lock().await;
            jobs.values().cloned().collect()
        };
        for ctrl in all_ctrls {
            ctrl.cancelled.store(true, Ordering::SeqCst);
            let guard = ctrl.guard.lock().await;
            if let Some(g) = guard.as_ref() {
                g.terminate();
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn spawn_single_job(
        self: &Arc<Self>,
        app: AppHandle,
        clip: ClipInput,
        settings: AppSettings,
        ytdlp_path: PathBuf,
        ffmpeg_dir: Option<PathBuf>,
        use_node: bool,
        semaphore: Arc<Semaphore>,
    ) {
        let out_dir = PathBuf::from(settings.output_dir.trim());
        let stem = render_output_stem(
            &settings.filename_template,
            &clip.video_title,
            clip.index,
            clip.start_secs,
            clip.end_secs,
            &clip.label,
        );
        let ext = ytdlp::output_extension(&settings).to_string();
        let reserved_target = resolve_non_colliding_path(&out_dir, &stem, &ext);
        let final_stem = reserved_target
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(&stem)
            .to_string();

        let ctrl = Arc::new(ActiveJobControl {
            cancelled: AtomicBool::new(false),
            guard: Mutex::new(None),
            output_dir: out_dir.clone(),
            output_stem: final_stem.clone(),
            expected_ext: ext.clone(),
        });

        {
            let mut jobs = self.jobs.lock().await;
            if let Some(prev) = jobs.insert(clip.id.clone(), ctrl.clone()) {
                prev.cancelled.store(true, Ordering::SeqCst);
                let g = prev.guard.lock().await;
                if let Some(proc_guard) = g.as_ref() {
                    proc_guard.terminate();
                }
            }
        }

        emit_status(&app, &clip.id, ClipStatusKind::Pending, None, None);

        let manager = self.clone();
        tokio::spawn(async move {
            let permit = match semaphore.acquire_owned().await {
                Ok(p) => p,
                Err(_) => {
                    emit_status(
                        &app,
                        &clip.id,
                        ClipStatusKind::Error,
                        None,
                        Some("Antrean dihentikan".to_string()),
                    );
                    return;
                }
            };

            if ctrl.cancelled.load(Ordering::SeqCst) {
                emit_status(&app, &clip.id, ClipStatusKind::Cancelled, None, None);
                manager.remove_job(&clip.id).await;
                drop(permit);
                return;
            }

            let output_template = out_dir.join(format!("{final_stem}.%(ext)s"));
            let args = ytdlp::build_clip_args(
                &clip,
                &settings,
                &output_template,
                ffmpeg_dir.as_deref(),
                use_node,
            );

            emit_log(
                &app,
                &clip.id,
                format!("Menjalankan: {} {}", ytdlp_path.display(), args.join(" ")),
            );
            emit_status(&app, &clip.id, ClipStatusKind::Downloading, None, None);

            let mut cmd = Command::new(&ytdlp_path);
            cmd.args(&args)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            configure_background_command(&mut cmd);

            let mut child = match cmd.spawn() {
                Ok(c) => c,
                Err(e) => {
                    emit_status(
                        &app,
                        &clip.id,
                        ClipStatusKind::Error,
                        None,
                        Some(format!("Gagal menjalankan yt-dlp: {e}")),
                    );
                    manager.remove_job(&clip.id).await;
                    drop(permit);
                    return;
                }
            };

            let proc_guard = Arc::new(ProcessGuard::attach(&child));
            {
                let mut g = ctrl.guard.lock().await;
                *g = Some(proc_guard.clone());
            }

            if ctrl.cancelled.load(Ordering::SeqCst) {
                proc_guard.terminate();
            }

            let clip_dur = (clip.end_secs - clip.start_secs).max(0.5);
            let stdout = child.stdout.take();
            let stderr = child.stderr.take();
            let last_error_lines = Arc::new(Mutex::new(Vec::<String>::new()));

            let out_task = stdout.map(|pipe| {
                let app_c = app.clone();
                let id_c = clip.id.clone();
                let err_buf = last_error_lines.clone();
                tokio::spawn(async move {
                    stream_output(pipe, app_c, id_c, clip_dur, false, err_buf).await;
                })
            });

            let err_task = stderr.map(|pipe| {
                let app_c = app.clone();
                let id_c = clip.id.clone();
                let err_buf = last_error_lines.clone();
                tokio::spawn(async move {
                    stream_output(pipe, app_c, id_c, clip_dur, true, err_buf).await;
                })
            });

            let wait_result = child.wait().await;
            if let Some(t) = out_task {
                let _ = t.await;
            }
            if let Some(t) = err_task {
                let _ = t.await;
            }

            {
                let mut g = ctrl.guard.lock().await;
                *g = None;
            }
            drop(proc_guard);

            if ctrl.cancelled.load(Ordering::SeqCst) {
                cleanup_partial_files(&ctrl.output_dir, &ctrl.output_stem);
                emit_status(&app, &clip.id, ClipStatusKind::Cancelled, None, None);
                manager.remove_job(&clip.id).await;
                drop(permit);
                return;
            }

            match wait_result {
                Ok(status) if status.success() => {
                    if let Some(final_file) =
                        find_produced_output(&ctrl.output_dir, &ctrl.output_stem, &ctrl.expected_ext)
                    {
                        let _ = app.emit(
                            "clip://progress",
                            ClipProgressEvent {
                                job_id: clip.id.clone(),
                                percent: 100.0,
                                speed: None,
                                eta: None,
                                downloaded_bytes: std::fs::metadata(&final_file).ok().map(|m| m.len()),
                                stage: "Selesai".to_string(),
                            },
                        );
                        emit_status(
                            &app,
                            &clip.id,
                            ClipStatusKind::Done,
                            Some(final_file.to_string_lossy().to_string()),
                            None,
                        );
                    } else {
                        emit_status(
                            &app,
                            &clip.id,
                            ClipStatusKind::Error,
                            None,
                            Some("yt-dlp selesai tetapi file output tidak ditemukan atau kosong".to_string()),
                        );
                    }
                }
                Ok(status) => {
                    cleanup_partial_files(&ctrl.output_dir, &ctrl.output_stem);
                    let errs = last_error_lines.lock().await;
                    let summary = if errs.is_empty() {
                        format!("yt-dlp gagal dengan exit code {:?}", status.code())
                    } else {
                        errs.join(" | ")
                    };
                    emit_status(&app, &clip.id, ClipStatusKind::Error, None, Some(summary));
                }
                Err(e) => {
                    cleanup_partial_files(&ctrl.output_dir, &ctrl.output_stem);
                    emit_status(
                        &app,
                        &clip.id,
                        ClipStatusKind::Error,
                        None,
                        Some(format!("Gagal menunggu proses yt-dlp: {e}")),
                    );
                }
            }

            manager.remove_job(&clip.id).await;
            drop(permit);
        });
    }

    async fn remove_job(&self, job_id: &str) {
        let mut jobs = self.jobs.lock().await;
        jobs.remove(job_id);
    }
}

async fn stream_output<R: tokio::io::AsyncRead + Unpin>(
    mut reader: R,
    app: AppHandle,
    job_id: String,
    clip_dur: f64,
    is_stderr: bool,
    err_buf: Arc<Mutex<Vec<String>>>,
) {
    let mut buf = [0u8; 4096];
    let mut line_acc: Vec<u8> = Vec::with_capacity(512);

    loop {
        let n = match reader.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => n,
            Err(_) => break,
        };

        for &b in &buf[..n] {
            if b == b'\n' || b == b'\r' {
                if !line_acc.is_empty() {
                    let line = String::from_utf8_lossy(&line_acc).trim().to_string();
                    line_acc.clear();
                    handle_stream_line(&app, &job_id, &line, clip_dur, is_stderr, &err_buf).await;
                }
            } else if line_acc.len() < 8192 {
                line_acc.push(b);
            }
        }
    }

    if !line_acc.is_empty() {
        let line = String::from_utf8_lossy(&line_acc).trim().to_string();
        handle_stream_line(&app, &job_id, &line, clip_dur, is_stderr, &err_buf).await;
    }
}

async fn handle_stream_line(
    app: &AppHandle,
    job_id: &str,
    line: &str,
    clip_dur: f64,
    is_stderr: bool,
    err_buf: &Arc<Mutex<Vec<String>>>,
) {
    if line.is_empty() {
        return;
    }

    if let Some(progress) = parse_progress_line(line, clip_dur) {
        match progress {
            ParsedProgress::Download {
                percent,
                downloaded_bytes,
                speed,
                eta,
            } => {
                let _ = app.emit(
                    "clip://progress",
                    ClipProgressEvent {
                        job_id: job_id.to_string(),
                        percent,
                        speed,
                        eta,
                        downloaded_bytes,
                        stage: "Mengunduh".to_string(),
                    },
                );
            }
            ParsedProgress::Postprocess {
                status,
                postprocessor,
            } => {
                if status == "started" || status == "processing" {
                    emit_status(app, job_id, ClipStatusKind::Processing, None, None);
                    let _ = app.emit(
                        "clip://progress",
                        ClipProgressEvent {
                            job_id: job_id.to_string(),
                            percent: 99.0,
                            speed: None,
                            eta: None,
                            downloaded_bytes: None,
                            stage: format!("Memproses ({postprocessor})"),
                        },
                    );
                }
                emit_log(app, job_id, format!("[postprocess] {status}: {postprocessor}"));
            }
            ParsedProgress::Ffmpeg { percent, speed } => {
                let _ = app.emit(
                    "clip://progress",
                    ClipProgressEvent {
                        job_id: job_id.to_string(),
                        percent,
                        speed,
                        eta: None,
                        downloaded_bytes: None,
                        stage: "Memotong / Encode".to_string(),
                    },
                );
            }
        }
        return;
    }

    if is_stderr && (line.contains("ERROR:") || line.contains("error")) {
        let mut errs = err_buf.lock().await;
        if errs.len() < 4 {
            errs.push(line.to_string());
        }
    }

    if !line.starts_with("frame=") {
        emit_log(app, job_id, line.to_string());
    }
}

fn emit_status(
    app: &AppHandle,
    job_id: &str,
    status: ClipStatusKind,
    output_path: Option<String>,
    error: Option<String>,
) {
    let _ = app.emit(
        "clip://status",
        ClipStatusEvent {
            job_id: job_id.to_string(),
            status,
            output_path,
            error,
        },
    );
}

fn emit_log(app: &AppHandle, job_id: &str, line: String) {
    let _ = app.emit(
        "clip://log",
        ClipLogEvent {
            job_id: job_id.to_string(),
            line,
        },
    );
}

fn find_produced_output(dir: &Path, stem: &str, expected_ext: &str) -> Option<PathBuf> {
    let exact = dir.join(format!("{stem}.{expected_ext}"));
    if exact.is_file() && std::fs::metadata(&exact).map(|m| m.len() > 0).unwrap_or(false) {
        return Some(exact);
    }

    let Ok(entries) = std::fs::read_dir(dir) else {
        return None;
    };
    let prefix = format!("{stem}.");
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !name.starts_with(&prefix) {
            continue;
        }
        if name.ends_with(".part") || name.ends_with(".ytdl") {
            continue;
        }
        if std::fs::metadata(&path).map(|m| m.len() > 0).unwrap_or(false) {
            return Some(path);
        }
    }
    None
}

fn cleanup_partial_files(dir: &Path, stem: &str) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let prefix = format!("{stem}.");
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if name.starts_with(&prefix)
            && (name.ends_with(".part") || name.ends_with(".ytdl") || name.contains(".temp."))
        {
            let _ = std::fs::remove_file(path);
        }
    }
}
