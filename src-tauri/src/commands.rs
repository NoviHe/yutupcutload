use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::config;
use crate::models::{
    AppSettings, AutoSplitParams, BulkParseResult, ClipInput, EnvironmentStatus, GeneratedClip,
    VideoMetadata,
};
use crate::queue::QueueManager;
use crate::splitter;
use crate::ytdlp;

#[tauri::command]
pub fn check_environment() -> EnvironmentStatus {
    let settings = config::load_settings();
    config::check_environment(&settings)
}

#[tauri::command]
pub fn get_settings() -> AppSettings {
    config::load_settings()
}

#[tauri::command]
pub fn save_settings(settings: AppSettings) -> Result<AppSettings, String> {
    config::save_settings(&settings)
}

#[tauri::command]
pub async fn fetch_video_info(url: String) -> Result<VideoMetadata, String> {
    let settings = config::load_settings();
    let env = config::check_environment(&settings);
    let ytdlp_path = env
        .yt_dlp_path
        .as_deref()
        .map(PathBuf::from)
        .ok_or_else(|| "yt-dlp.exe tidak ditemukan. Periksa folder bin/ atau Settings.".to_string())?;

    ytdlp::fetch_metadata(&ytdlp_path, &url, &settings, env.node_found).await
}

#[tauri::command]
pub async fn resolve_stream_url(url: String) -> Result<String, String> {
    let settings = config::load_settings();
    let env = config::check_environment(&settings);
    let ytdlp_path = env
        .yt_dlp_path
        .as_deref()
        .map(PathBuf::from)
        .ok_or_else(|| "yt-dlp.exe tidak ditemukan. Periksa folder bin/ atau Settings.".to_string())?;

    ytdlp::resolve_fallback_stream_url(&ytdlp_path, &url, &settings, env.node_found).await
}

#[tauri::command]
pub fn generate_auto_split(params: AutoSplitParams) -> Result<Vec<GeneratedClip>, String> {
    splitter::generate_auto_splits(&params)
}

#[tauri::command]
pub fn parse_bulk_clips(text: String, total_duration: Option<f64>) -> BulkParseResult {
    splitter::parse_bulk_timestamps(&text, total_duration)
}

#[tauri::command]
pub async fn enqueue_clips(
    app: AppHandle,
    queue: State<'_, Arc<QueueManager>>,
    clips: Vec<ClipInput>,
    settings: AppSettings,
) -> Result<(), String> {
    let saved = config::save_settings(&settings)?;
    queue.enqueue(app, clips, saved).await
}

#[tauri::command]
pub async fn cancel_clip(
    queue: State<'_, Arc<QueueManager>>,
    job_id: String,
) -> Result<(), String> {
    queue.cancel_job(&job_id).await;
    Ok(())
}

#[tauri::command]
pub async fn cancel_all_clips(queue: State<'_, Arc<QueueManager>>) -> Result<(), String> {
    queue.cancel_all().await;
    Ok(())
}

#[tauri::command]
pub async fn retry_clip(
    app: AppHandle,
    queue: State<'_, Arc<QueueManager>>,
    job_id: String,
) -> Result<(), String> {
    queue.retry_job(app, &job_id).await
}
