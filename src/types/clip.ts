export interface EnvironmentStatus {
  ytDlpFound: boolean;
  ytDlpPath: string | null;
  ytDlpVersion: string | null;
  ffmpegFound: boolean;
  ffmpegPath: string | null;
  ffmpegVersion: string | null;
  ffprobeFound: boolean;
  ffprobePath: string | null;
  nodeFound: boolean;
  nodePath: string | null;
}

export interface VideoFormatSummary {
  height: number;
  fps: number | null;
  ext: string;
  label: string;
}

export interface ChapterInfo {
  title: string;
  startTime: number;
  endTime: number;
}

export interface VideoMetadata {
  id: string;
  url: string;
  title: string;
  channel: string;
  duration: number;
  thumbnail: string | null;
  isLive: boolean;
  wasLive: boolean;
  availableHeights: number[];
  formats: VideoFormatSummary[];
  chapters: ChapterInfo[];
}

export type CutMode = "fast" | "precise";
export type QualityPreset =
  | "best"
  | "p2160"
  | "p1440"
  | "p1080"
  | "p720"
  | "p480"
  | "audioOnly";
export type VideoContainer = "mp4" | "mkv";
export type AudioFormat = "mp3" | "m4a" | "opus";
export type CookiesSource = "none" | "chrome" | "edge" | "firefox" | "brave" | "file";

export interface AppSettings {
  outputDir: string;
  quality: QualityPreset;
  videoContainer: VideoContainer;
  audioFormat: AudioFormat;
  cutMode: CutMode;
  maxConcurrent: number;
  filenameTemplate: string;
  cookiesSource: CookiesSource;
  cookiesFile: string | null;
  customYtdlpPath: string | null;
  customFfmpegPath: string | null;
  preferHlsForVod: boolean;
}

export type ClipStatus =
  | "draft"
  | "pending"
  | "downloading"
  | "processing"
  | "done"
  | "cancelled"
  | "error";

export interface ClipItem {
  id: string;
  url: string;
  videoTitle: string;
  videoDuration: number | null;
  startSecs: number;
  endSecs: number;
  label: string;
  status: ClipStatus;
  percent: number;
  speed: string | null;
  eta: string | null;
  downloadedBytes: number | null;
  stage: string;
  outputPath: string | null;
  error: string | null;
  logs: string[];
}

export interface ClipInputPayload {
  id: string;
  url: string;
  videoTitle: string;
  videoDuration: number | null;
  startSecs: number;
  endSecs: number;
  label: string;
  index: number;
}

export interface ClipProgressEvent {
  jobId: string;
  percent: number;
  speed: string | null;
  eta: string | null;
  downloadedBytes: number | null;
  stage: string;
}

export interface ClipStatusEvent {
  jobId: string;
  status: Exclude<ClipStatus, "draft">;
  outputPath: string | null;
  error: string | null;
}

export interface ClipLogEvent {
  jobId: string;
  line: string;
}

export interface GeneratedClip {
  startSecs: number;
  endSecs: number;
  label: string;
}

export interface BulkParseLineError {
  lineNumber: number;
  raw: string;
  error: string;
}

export interface BulkParseResult {
  clips: GeneratedClip[];
  errors: BulkParseLineError[];
}
