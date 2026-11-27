use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentStatus {
    pub yt_dlp_found: bool,
    pub yt_dlp_path: Option<String>,
    pub yt_dlp_version: Option<String>,
    pub ffmpeg_found: bool,
    pub ffmpeg_path: Option<String>,
    pub ffmpeg_version: Option<String>,
    pub ffprobe_found: bool,
    pub ffprobe_path: Option<String>,
    pub node_found: bool,
    pub node_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoFormatSummary {
    pub height: u32,
    pub fps: Option<f64>,
    pub ext: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterInfo {
    pub title: String,
    pub start_time: f64,
    pub end_time: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoMetadata {
    pub id: String,
    pub url: String,
    pub title: String,
    pub channel: String,
    pub duration: f64,
    pub thumbnail: Option<String>,
    pub is_live: bool,
    pub was_live: bool,
    pub available_heights: Vec<u32>,
    pub formats: Vec<VideoFormatSummary>,
    pub chapters: Vec<ChapterInfo>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CutMode {
    Fast,
    Precise,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QualityPreset {
    Best,
    P2160,
    P1440,
    P1080,
    P720,
    P480,
    AudioOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VideoContainer {
    Mp4,
    Mkv,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AudioFormat {
    Mp3,
    M4a,
    Opus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CookiesSource {
    None,
    Chrome,
    Edge,
    Firefox,
    Brave,
    File,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub output_dir: String,
    pub quality: QualityPreset,
    pub video_container: VideoContainer,
    pub audio_format: AudioFormat,
    pub cut_mode: CutMode,
    pub max_concurrent: usize,
    pub filename_template: String,
    pub cookies_source: CookiesSource,
    pub cookies_file: Option<String>,
    pub custom_ytdlp_path: Option<String>,
    pub custom_ffmpeg_path: Option<String>,
    pub prefer_hls_for_vod: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipInput {
    pub id: String,
    pub url: String,
    pub video_title: String,
    pub video_duration: Option<f64>,
    pub start_secs: f64,
    pub end_secs: f64,
    pub label: String,
    pub index: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ClipStatusKind {
    Pending,
    Downloading,
    Processing,
    Done,
    Cancelled,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipProgressEvent {
    pub job_id: String,
    pub percent: f64,
    pub speed: Option<String>,
    pub eta: Option<String>,
    pub downloaded_bytes: Option<u64>,
    pub stage: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipStatusEvent {
    pub job_id: String,
    pub status: ClipStatusKind,
    pub output_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipLogEvent {
    pub job_id: String,
    pub line: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoSplitParams {
    pub total_duration: f64,
    pub range_start: Option<f64>,
    pub range_end: Option<f64>,
    pub chunk_secs: f64,
    pub overlap_secs: f64,
    pub prefix: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedClip {
    pub start_secs: f64,
    pub end_secs: f64,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BulkParseLineError {
    pub line_number: usize,
    pub raw: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkParseResult {
    pub clips: Vec<GeneratedClip>,
    pub errors: Vec<BulkParseLineError>,
}
