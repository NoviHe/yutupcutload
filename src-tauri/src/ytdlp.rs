use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use std::process::Stdio;

use serde_json::Value;
use tokio::process::Command;

use crate::models::{
    AppSettings, AudioFormat, ChapterInfo, ClipInput, CookiesSource, CutMode, QualityPreset,
    VideoContainer, VideoFormatSummary, VideoMetadata,
};
use crate::process::configure_background_command;
use crate::splitter::format_timestamp;

pub fn output_extension(settings: &AppSettings) -> &'static str {
    if settings.quality == QualityPreset::AudioOnly {
        match settings.audio_format {
            AudioFormat::Mp3 => "mp3",
            AudioFormat::M4a => "m4a",
            AudioFormat::Opus => "opus",
        }
    } else {
        match settings.video_container {
            VideoContainer::Mp4 => "mp4",
            VideoContainer::Mkv => "mkv",
        }
    }
}

fn push_common_auth_and_runtime_args(
    args: &mut Vec<String>,
    settings: &AppSettings,
    use_node_js_runtime: bool,
) {
    if use_node_js_runtime {
        args.push("--js-runtimes".to_string());
        args.push("node".to_string());
    }

    match settings.cookies_source {
        CookiesSource::None => {}
        CookiesSource::Chrome => {
            args.push("--cookies-from-browser".to_string());
            args.push("chrome".to_string());
        }
        CookiesSource::Edge => {
            args.push("--cookies-from-browser".to_string());
            args.push("edge".to_string());
        }
        CookiesSource::Firefox => {
            args.push("--cookies-from-browser".to_string());
            args.push("firefox".to_string());
        }
        CookiesSource::Brave => {
            args.push("--cookies-from-browser".to_string());
            args.push("brave".to_string());
        }
        CookiesSource::File => {
            if let Some(file) = settings.cookies_file.as_deref() {
                let trimmed = file.trim();
                if !trimmed.is_empty() {
                    args.push("--cookies".to_string());
                    args.push(trimmed.to_string());
                }
            }
        }
    }
}

pub async fn fetch_metadata(
    ytdlp_path: &Path,
    url: &str,
    settings: &AppSettings,
    use_node_js_runtime: bool,
) -> Result<VideoMetadata, String> {
    let trimmed_url = url.trim();
    if trimmed_url.is_empty() {
        return Err("URL YouTube tidak boleh kosong".to_string());
    }

    let mut args = vec![
        "--dump-single-json".to_string(),
        "--no-playlist".to_string(),
        "--no-warnings".to_string(),
    ];
    push_common_auth_and_runtime_args(&mut args, settings, use_node_js_runtime);
    args.push(trimmed_url.to_string());

    let mut cmd = Command::new(ytdlp_path);
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_background_command(&mut cmd);

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Gagal menjalankan yt-dlp: {e}"))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err.is_empty() {
            format!("yt-dlp gagal mengambil metadata (exit {:?})", output.status.code())
        } else {
            err
        });
    }

    let raw_json = String::from_utf8_lossy(&output.stdout);
    let val: Value = serde_json::from_str(&raw_json)
        .map_err(|e| format!("Gagal parse metadata JSON yt-dlp: {e}"))?;

    let id = val
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let webpage_url = val
        .get("webpage_url")
        .and_then(|v| v.as_str())
        .unwrap_or(trimmed_url)
        .to_string();
    let title = val
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Untitled Video")
        .to_string();
    let channel = val
        .get("channel")
        .or_else(|| val.get("uploader"))
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown Channel")
        .to_string();
    let duration = val
        .get("duration")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let thumbnail = val
        .get("thumbnail")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let is_live = val
        .get("is_live")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let was_live = val
        .get("was_live")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let mut heights_set = BTreeSet::new();
    let mut format_map: HashMap<u32, VideoFormatSummary> = HashMap::new();
    if let Some(arr) = val.get("formats").and_then(|v| v.as_array()) {
        for f in arr {
            let vcodec = f.get("vcodec").and_then(|v| v.as_str()).unwrap_or("none");
            if vcodec == "none" {
                continue;
            }
            let Some(h) = f.get("height").and_then(|v| v.as_u64()) else {
                continue;
            };
            if h == 0 {
                continue;
            }
            let height = h as u32;
            let fps = f.get("fps").and_then(|v| v.as_f64());
            let ext = f
                .get("ext")
                .and_then(|v| v.as_str())
                .unwrap_or("mp4")
                .to_string();
            heights_set.insert(height);
            format_map.entry(height).or_insert_with(|| VideoFormatSummary {
                height,
                fps,
                ext,
                label: match fps {
                    Some(fps_val) if fps_val > 30.0 => format!("{height}p{}", fps_val.round() as u32),
                    _ => format!("{height}p"),
                },
            });
        }
    }

    let mut available_heights: Vec<u32> = heights_set.into_iter().collect();
    available_heights.sort_by(|a, b| b.cmp(a));

    let mut formats: Vec<VideoFormatSummary> = format_map.into_values().collect();
    formats.sort_by(|a, b| b.height.cmp(&a.height));

    let mut chapters = Vec::new();
    if let Some(arr) = val.get("chapters").and_then(|v| v.as_array()) {
        for ch in arr {
            let start_time = ch.get("start_time").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let end_time = ch.get("end_time").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let ch_title = ch
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("Chapter")
                .trim()
                .to_string();
            if end_time > start_time {
                chapters.push(ChapterInfo {
                    title: ch_title,
                    start_time,
                    end_time,
                });
            }
        }
    }

    Ok(VideoMetadata {
        id,
        url: webpage_url,
        title,
        channel,
        duration,
        thumbnail,
        is_live,
        was_live,
        available_heights,
        formats,
        chapters,
    })
}

pub async fn resolve_fallback_stream_url(
    ytdlp_path: &Path,
    url: &str,
    settings: &AppSettings,
    use_node_js_runtime: bool,
) -> Result<String, String> {
    let mut args = vec![
        "-f".to_string(),
        "18/best[ext=mp4][acodec!=none][vcodec!=none][height<=720]/best[acodec!=none][vcodec!=none]"
            .to_string(),
        "-g".to_string(),
        "--no-playlist".to_string(),
        "--no-warnings".to_string(),
    ];
    push_common_auth_and_runtime_args(&mut args, settings, use_node_js_runtime);
    args.push(url.trim().to_string());

    let mut cmd = Command::new(ytdlp_path);
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_background_command(&mut cmd);

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Gagal menjalankan yt-dlp: {e}"))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "Gagal mengambil direct stream URL".to_string()
        } else {
            err
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .map(str::trim)
        .find(|l| l.starts_with("http"))
        .map(|s| s.to_string())
        .ok_or_else(|| "Stream URL langsung tidak tersedia untuk video ini".to_string())
}

pub fn build_clip_args(
    clip: &ClipInput,
    settings: &AppSettings,
    output_template_path: &Path,
    ffmpeg_dir: Option<&Path>,
    use_node_js_runtime: bool,
) -> Vec<String> {
    let start_str = format_timestamp(clip.start_secs);
    let end_str = format_timestamp(clip.end_secs);

    let mut args = vec![
        "--no-playlist".to_string(),
        "--no-color".to_string(),
        "--newline".to_string(),
        "--download-sections".to_string(),
        format!("*{start_str}-{end_str}"),
        "--concurrent-fragments".to_string(),
        "4".to_string(),
        "--progress-template".to_string(),
        "download:YCL_PROG|%(progress._percent_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s".to_string(),
        "--progress-template".to_string(),
        "postprocess:YCL_PP|%(progress.status)s|%(progress.postprocessor)s".to_string(),
    ];

    if let Some(dir) = ffmpeg_dir {
        args.push("--ffmpeg-location".to_string());
        args.push(dir.to_string_lossy().to_string());
    }

    if settings.cut_mode == CutMode::Precise {
        args.push("--force-keyframes-at-cuts".to_string());
    }

    push_common_auth_and_runtime_args(&mut args, settings, use_node_js_runtime);

    if settings.quality == QualityPreset::AudioOnly {
        args.push("-f".to_string());
        args.push("bestaudio/best".to_string());
        args.push("-x".to_string());
        args.push("--audio-format".to_string());
        args.push(output_extension(settings).to_string());
    } else {
        let height_filter = match settings.quality {
            QualityPreset::Best => String::new(),
            QualityPreset::P2160 => "[height<=2160]".to_string(),
            QualityPreset::P1440 => "[height<=1440]".to_string(),
            QualityPreset::P1080 => "[height<=1080]".to_string(),
            QualityPreset::P720 => "[height<=720]".to_string(),
            QualityPreset::P480 => "[height<=480]".to_string(),
            QualityPreset::AudioOnly => unreachable!(),
        };

        let format_expr = if settings.prefer_hls_for_vod {
            format!(
                "bestvideo{height_filter}[protocol*=m3u8]+bestaudio[protocol*=m3u8]/best{height_filter}[protocol*=m3u8]/bestvideo{height_filter}+bestaudio/best{height_filter}/best"
            )
        } else if settings.video_container == VideoContainer::Mp4 {
            format!(
                "bestvideo{height_filter}[ext=mp4]+bestaudio[ext=m4a]/bestvideo{height_filter}+bestaudio/best{height_filter}/best"
            )
        } else {
            format!("bestvideo{height_filter}+bestaudio/best{height_filter}/best")
        };

        args.push("-f".to_string());
        args.push(format_expr);
        args.push("--merge-output-format".to_string());
        args.push(output_extension(settings).to_string());
    }

    args.push("-o".to_string());
    args.push(output_template_path.to_string_lossy().to_string());
    args.push(clip.url.clone());

    args
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn sample_clip() -> ClipInput {
        ClipInput {
            id: "job-1".to_string(),
            url: "https://www.youtube.com/watch?v=jNQXAC9IVRw".to_string(),
            video_title: "Test VOD".to_string(),
            video_duration: Some(39600.0),
            start_secs: 3600.0,
            end_secs: 3720.5,
            label: "Clip 1".to_string(),
            index: 1,
        }
    }

    fn base_settings() -> AppSettings {
        AppSettings {
            output_dir: "D:\\Clips".to_string(),
            quality: QualityPreset::P1080,
            video_container: VideoContainer::Mp4,
            audio_format: AudioFormat::Mp3,
            cut_mode: CutMode::Fast,
            max_concurrent: 2,
            filename_template: "{title}_{index}".to_string(),
            cookies_source: CookiesSource::None,
            cookies_file: None,
            custom_ytdlp_path: None,
            custom_ffmpeg_path: None,
            prefer_hls_for_vod: false,
        }
    }

    #[test]
    fn test_build_clip_args_fast_mp4_1080p() {
        let args = build_clip_args(
            &sample_clip(),
            &base_settings(),
            &PathBuf::from("D:\\Clips\\out.%(ext)s"),
            Some(&PathBuf::from("E:\\bin")),
            true,
        );
        assert!(args.windows(2).any(|w| w == ["--download-sections", "*01:00:00-01:02:00.500"]));
        assert!(args.windows(2).any(|w| w == ["--ffmpeg-location", "E:\\bin"]));
        assert!(args.windows(2).any(|w| w == ["--js-runtimes", "node"]));
        assert!(args.windows(2).any(|w| w == ["--merge-output-format", "mp4"]));
        assert!(!args.contains(&"--force-keyframes-at-cuts".to_string()));
    }

    #[test]
    fn test_build_clip_args_precise_mkv_720p() {
        let mut settings = base_settings();
        settings.quality = QualityPreset::P720;
        settings.video_container = VideoContainer::Mkv;
        settings.cut_mode = CutMode::Precise;

        let args = build_clip_args(
            &sample_clip(),
            &settings,
            &PathBuf::from("D:\\Clips\\out.%(ext)s"),
            None,
            false,
        );
        assert!(args.contains(&"--force-keyframes-at-cuts".to_string()));
        assert!(args.windows(2).any(|w| w == ["--merge-output-format", "mkv"]));
        assert!(args.iter().any(|a| a.contains("[height<=720]")));
        assert!(!args.contains(&"--js-runtimes".to_string()));
    }

    #[test]
    fn test_build_clip_args_audio_only_mp3() {
        let mut settings = base_settings();
        settings.quality = QualityPreset::AudioOnly;
        settings.audio_format = AudioFormat::Mp3;

        let args = build_clip_args(
            &sample_clip(),
            &settings,
            &PathBuf::from("D:\\Clips\\out.%(ext)s"),
            None,
            false,
        );
        assert!(args.contains(&"-x".to_string()));
        assert!(args.windows(2).any(|w| w == ["--audio-format", "mp3"]));
        assert!(!args.contains(&"--merge-output-format".to_string()));
    }
}
