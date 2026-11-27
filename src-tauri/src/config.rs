use std::path::{Path, PathBuf};
use std::process::Command;

use crate::models::{
    AppSettings, AudioFormat, CookiesSource, CutMode, EnvironmentStatus, QualityPreset,
    VideoContainer,
};
use crate::process::configure_std_background_command;

pub fn default_output_dir() -> String {
    let base = dirs::video_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("YutupCutLoad").to_string_lossy().to_string()
}

pub fn default_settings() -> AppSettings {
    AppSettings {
        output_dir: default_output_dir(),
        quality: QualityPreset::P1080,
        video_container: VideoContainer::Mp4,
        audio_format: AudioFormat::Mp3,
        cut_mode: CutMode::Fast,
        max_concurrent: 2,
        filename_template: "{title}_{index}_{start}-{end}_{label}".to_string(),
        cookies_source: CookiesSource::None,
        cookies_file: None,
        custom_ytdlp_path: None,
        custom_ffmpeg_path: None,
        prefer_hls_for_vod: false,
    }
}

pub fn settings_file_path() -> PathBuf {
    let base = dirs::config_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("YutupCutLoad").join("settings.json")
}

pub fn load_settings() -> AppSettings {
    let path = settings_file_path();
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return default_settings();
    };
    let mut parsed: AppSettings = serde_json::from_str(&raw).unwrap_or_else(|_| default_settings());
    parsed.max_concurrent = parsed.max_concurrent.clamp(1, 4);
    if parsed.output_dir.trim().is_empty() {
        parsed.output_dir = default_output_dir();
    }
    if parsed.filename_template.trim().is_empty() {
        parsed.filename_template = "{title}_{index}_{start}-{end}_{label}".to_string();
    }
    parsed
}

pub fn save_settings(settings: &AppSettings) -> Result<AppSettings, String> {
    let mut normalized = settings.clone();
    normalized.max_concurrent = normalized.max_concurrent.clamp(1, 4);
    if normalized.output_dir.trim().is_empty() {
        normalized.output_dir = default_output_dir();
    }
    if normalized.filename_template.trim().is_empty() {
        normalized.filename_template = "{title}_{index}_{start}-{end}_{label}".to_string();
    }

    let path = settings_file_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Gagal membuat folder konfigurasi: {e}"))?;
    }
    let json = serde_json::to_string_pretty(&normalized)
        .map_err(|e| format!("Gagal serialisasi konfigurasi: {e}"))?;
    std::fs::write(&path, json).map_err(|e| format!("Gagal menyimpan konfigurasi: {e}"))?;
    Ok(normalized)
}

pub fn resolve_binary(exe_name: &str, custom_path: Option<&str>) -> Option<PathBuf> {
    if let Some(custom) = custom_path {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            let p = PathBuf::from(trimmed);
            if p.is_file() {
                return Some(p);
            }
        }
    }

    if let Ok(current_exe) = std::env::current_exe() {
        let mut cursor = current_exe.parent().map(|p| p.to_path_buf());
        for _ in 0..6 {
            let Some(dir) = cursor else { break };
            let candidate = dir.join("bin").join(exe_name);
            if candidate.is_file() {
                return Some(candidate);
            }
            let direct = dir.join(exe_name);
            if direct.is_file() {
                return Some(direct);
            }
            cursor = dir.parent().map(|p| p.to_path_buf());
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        let candidate = cwd.join("bin").join(exe_name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    find_in_path(exe_name)
}

fn find_in_path(exe_name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(exe_name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn read_binary_first_line(exe_path: &Path, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new(exe_path);
    cmd.args(args);
    configure_std_background_command(&mut cmd);
    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines().next().map(|l| l.trim().to_string())
}

pub fn check_environment(settings: &AppSettings) -> EnvironmentStatus {
    let ytdlp_name = if cfg!(windows) { "yt-dlp.exe" } else { "yt-dlp" };
    let ffmpeg_name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    let ffprobe_name = if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" };
    let node_name = if cfg!(windows) { "node.exe" } else { "node" };

    let yt_dlp_path = resolve_binary(ytdlp_name, settings.custom_ytdlp_path.as_deref());
    let ffmpeg_path = resolve_binary(ffmpeg_name, settings.custom_ffmpeg_path.as_deref());
    let ffprobe_path = ffmpeg_path
        .as_ref()
        .and_then(|p| p.parent().map(|d| d.join(ffprobe_name)))
        .filter(|p| p.is_file())
        .or_else(|| resolve_binary(ffprobe_name, None));
    let node_path = find_in_path(node_name);

    let yt_dlp_version = yt_dlp_path
        .as_deref()
        .and_then(|p| read_binary_first_line(p, &["--version"]));
    let ffmpeg_version = ffmpeg_path
        .as_deref()
        .and_then(|p| read_binary_first_line(p, &["-version"]));

    EnvironmentStatus {
        yt_dlp_found: yt_dlp_path.is_some(),
        yt_dlp_path: yt_dlp_path.map(|p| p.to_string_lossy().to_string()),
        yt_dlp_version,
        ffmpeg_found: ffmpeg_path.is_some(),
        ffmpeg_path: ffmpeg_path.map(|p| p.to_string_lossy().to_string()),
        ffmpeg_version,
        ffprobe_found: ffprobe_path.is_some(),
        ffprobe_path: ffprobe_path.map(|p| p.to_string_lossy().to_string()),
        node_found: node_path.is_some(),
        node_path: node_path.map(|p| p.to_string_lossy().to_string()),
    }
}
