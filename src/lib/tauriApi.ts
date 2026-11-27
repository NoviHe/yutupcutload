import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import type {
  AppSettings,
  BulkParseResult,
  ClipInputPayload,
  ClipLogEvent,
  ClipProgressEvent,
  ClipStatusEvent,
  EnvironmentStatus,
  GeneratedClip,
  VideoMetadata,
} from "../types/clip";

export async function checkEnvironment(): Promise<EnvironmentStatus> {
  return invoke<EnvironmentStatus>("check_environment");
}

export async function getSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("get_settings");
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  return invoke<AppSettings>("save_settings", { settings });
}

export async function fetchVideoInfo(url: string): Promise<VideoMetadata> {
  return invoke<VideoMetadata>("fetch_video_info", { url });
}

export async function resolveStreamUrl(url: string): Promise<string> {
  return invoke<string>("resolve_stream_url", { url });
}

export async function generateAutoSplit(params: {
  totalDuration: number;
  rangeStart: number | null;
  rangeEnd: number | null;
  chunkSecs: number;
  overlapSecs: number;
  prefix: string;
}): Promise<GeneratedClip[]> {
  return invoke<GeneratedClip[]>("generate_auto_split", { params });
}

export async function parseBulkClips(
  text: string,
  totalDuration: number | null
): Promise<BulkParseResult> {
  return invoke<BulkParseResult>("parse_bulk_clips", { text, totalDuration });
}

export async function enqueueClips(
  clips: ClipInputPayload[],
  settings: AppSettings
): Promise<void> {
  return invoke<void>("enqueue_clips", { clips, settings });
}

export async function cancelClip(jobId: string): Promise<void> {
  return invoke<void>("cancel_clip", { jobId });
}

export async function cancelAllClips(): Promise<void> {
  return invoke<void>("cancel_all_clips");
}

export async function retryClip(jobId: string): Promise<void> {
  return invoke<void>("retry_clip", { jobId });
}

export async function pickOutputFolder(defaultPath?: string): Promise<string | null> {
  const result = await open({
    directory: true,
    multiple: false,
    defaultPath,
    title: "Pilih Folder Output Klip",
  });
  return typeof result === "string" ? result : null;
}

export async function pickFilePath(title: string): Promise<string | null> {
  const result = await open({
    directory: false,
    multiple: false,
    title,
  });
  return typeof result === "string" ? result : null;
}

export async function revealFile(path: string): Promise<void> {
  await revealItemInDir(path);
}

export async function openFolder(path: string): Promise<void> {
  await openPath(path);
}

export async function onClipProgress(
  handler: (payload: ClipProgressEvent) => void
): Promise<UnlistenFn> {
  return listen<ClipProgressEvent>("clip://progress", (e) => handler(e.payload));
}

export async function onClipStatus(
  handler: (payload: ClipStatusEvent) => void
): Promise<UnlistenFn> {
  return listen<ClipStatusEvent>("clip://status", (e) => handler(e.payload));
}

export async function onClipLog(
  handler: (payload: ClipLogEvent) => void
): Promise<UnlistenFn> {
  return listen<ClipLogEvent>("clip://log", (e) => handler(e.payload));
}
