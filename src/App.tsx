import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import type {
  AppSettings,
  ClipItem,
  EnvironmentStatus,
  GeneratedClip,
  VideoMetadata,
} from "./types/clip";
import {
  cancelAllClips,
  cancelClip,
  checkEnvironment,
  enqueueClips,
  fetchVideoInfo,
  getSettings,
  onClipLog,
  onClipProgress,
  onClipStatus,
  retryClip,
  saveSettings,
} from "./lib/tauriApi";
import { formatTime } from "./lib/time";
import { UrlBar } from "./components/UrlBar";
import { VideoPreview } from "./components/VideoPreview";
import { ClipBuilderTabs } from "./components/ClipBuilderTabs";
import { QueuePanel } from "./components/QueuePanel";
import { OutputSettingsBar } from "./components/OutputSettingsBar";

const FALLBACK_SETTINGS: AppSettings = {
  outputDir: "",
  quality: "p1080",
  videoContainer: "mp4",
  audioFormat: "mp3",
  cutMode: "fast",
  maxConcurrent: 2,
  filenameTemplate: "{title}_{index}_{start}-{end}_{label}",
  cookiesSource: "none",
  cookiesFile: null,
  customYtdlpPath: null,
  customFfmpegPath: null,
  preferHlsForVod: false,
};

export default function App() {
  const [url, setUrl] = useState("");
  const [isLoadingVideo, setIsLoadingVideo] = useState(false);
  const [video, setVideo] = useState<VideoMetadata | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);

  const [envStatus, setEnvStatus] = useState<EnvironmentStatus | null>(null);
  const [settings, setSettings] = useState<AppSettings>(FALLBACK_SETTINGS);

  const [currentTime, setCurrentTime] = useState(0);
  const [startInput, setStartInput] = useState("00:00:00");
  const [endInput, setEndInput] = useState("00:01:00");
  const [selectionStart, setSelectionStart] = useState(0);
  const [selectionEnd, setSelectionEnd] = useState(60);
  const [seekRequest, setSeekRequest] = useState<{ secs: number; seq: number } | null>(
    null
  );

  const [clips, setClips] = useState<ClipItem[]>([]);

  const refreshEnv = useCallback(async () => {
    try {
      const status = await checkEnvironment();
      setEnvStatus(status);
    } catch (err) {
      setBannerError(String(err));
    }
  }, []);

  useEffect(() => {
    void refreshEnv();
    void getSettings()
      .then((loaded) => setSettings(loaded))
      .catch(() => {});
  }, [refreshEnv]);

  // Listen to backend Tauri events for progress, status, and logs
  useEffect(() => {
    let active = true;
    const unlisteners: Array<() => void> = [];

    const setup = async () => {
      const u1 = await onClipProgress((ev) => {
        if (!active) return;
        setClips((prev) =>
          prev.map((c) =>
            c.id === ev.jobId
              ? {
                  ...c,
                  percent: ev.percent,
                  speed: ev.speed,
                  eta: ev.eta,
                  downloadedBytes: ev.downloadedBytes ?? c.downloadedBytes,
                  stage: ev.stage,
                }
              : c
          )
        );
      });

      const u2 = await onClipStatus((ev) => {
        if (!active) return;
        setClips((prev) =>
          prev.map((c) =>
            c.id === ev.jobId
              ? {
                  ...c,
                  status: ev.status,
                  outputPath: ev.outputPath ?? c.outputPath,
                  error: ev.error,
                  percent: ev.status === "done" ? 100 : c.percent,
                  stage:
                    ev.status === "done"
                      ? "Selesai"
                      : ev.status === "pending"
                        ? "Menunggu antrean"
                        : ev.status === "cancelled"
                          ? "Dibatalkan"
                          : c.stage,
                }
              : c
          )
        );
      });

      const u3 = await onClipLog((ev) => {
        if (!active) return;
        setClips((prev) =>
          prev.map((c) =>
            c.id === ev.jobId
              ? {
                  ...c,
                  logs: [...c.logs.slice(-150), ev.line],
                }
              : c
          )
        );
      });

      unlisteners.push(u1, u2, u3);
    };

    void setup();

    return () => {
      active = false;
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  const handleLoadVideo = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setBannerError(null);
    setIsLoadingVideo(true);
    try {
      const meta = await fetchVideoInfo(trimmed);
      setVideo(meta);
      const defaultEnd = Math.min(60, Math.max(1, meta.duration));
      setSelectionStart(0);
      setSelectionEnd(defaultEnd);
      setStartInput(formatTime(0));
      setEndInput(formatTime(defaultEnd));
    } catch (err) {
      setBannerError(String(err));
    } finally {
      setIsLoadingVideo(false);
    }
  };

  const handleSaveSettings = async (next: AppSettings) => {
    try {
      const saved = await saveSettings(next);
      setSettings(saved);
      await refreshEnv();
    } catch (err) {
      setBannerError(String(err));
    }
  };

  const handleSetStart = useCallback((secs: number) => {
    const rounded = Math.round(secs * 100) / 100;
    setSelectionStart(rounded);
    setStartInput(formatTime(rounded));
  }, []);

  const handleSetEnd = useCallback((secs: number) => {
    const rounded = Math.round(secs * 100) / 100;
    setSelectionEnd(rounded);
    setEndInput(formatTime(rounded));
  }, []);

  const handleAddClips = (generated: GeneratedClip[]) => {
    if (!video) return;
    const newItems: ClipItem[] = generated.map((g) => ({
      id: crypto.randomUUID(),
      url: video.url,
      videoTitle: video.title,
      videoDuration: video.duration > 0 ? video.duration : null,
      startSecs: g.startSecs,
      endSecs: g.endSecs,
      label: g.label,
      status: "draft",
      percent: 0,
      speed: null,
      eta: null,
      downloadedBytes: null,
      stage: "Siap",
      outputPath: null,
      error: null,
      logs: [],
    }));
    setClips((prev) => [...prev, ...newItems]);
  };

  const handleStartAll = async () => {
    setBannerError(null);
    const toRun = clips.filter(
      (c) => c.status === "draft" || c.status === "error" || c.status === "cancelled"
    );
    if (toRun.length === 0) return;

    const payloads = toRun.map((c, idx) => ({
      id: c.id,
      url: c.url,
      videoTitle: c.videoTitle,
      videoDuration: c.videoDuration,
      startSecs: c.startSecs,
      endSecs: c.endSecs,
      label: c.label,
      index: idx + 1,
    }));

    try {
      await enqueueClips(payloads, settings);
    } catch (err) {
      setBannerError(String(err));
    }
  };

  const handleRetryClip = async (id: string) => {
    setBannerError(null);
    try {
      const target = clips.find((c) => c.id === id);
      if (!target) return;
      if (target.status === "error" || target.status === "cancelled") {
        await enqueueClips(
          [
            {
              id: target.id,
              url: target.url,
              videoTitle: target.videoTitle,
              videoDuration: target.videoDuration,
              startSecs: target.startSecs,
              endSecs: target.endSecs,
              label: target.label,
              index: clips.findIndex((c) => c.id === id) + 1,
            },
          ],
          settings
        );
      } else {
        await retryClip(id);
      }
    } catch (err) {
      setBannerError(String(err));
    }
  };

  const triggerSeek = (secs: number) => {
    setSeekRequest((prev) => ({ secs, seq: (prev?.seq ?? 0) + 1 }));
  };

  const exportBulkText = () =>
    clips
      .map(
        (c) =>
          `${formatTime(c.startSecs)}-${formatTime(c.endSecs)}${c.label ? ` ${c.label}` : ""}`
      )
      .join("\n");

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#0d0f12] text-zinc-100">
      <UrlBar
        url={url}
        onUrlChange={setUrl}
        onLoadVideo={handleLoadVideo}
        isLoading={isLoadingVideo}
        envStatus={envStatus}
        onRecheckEnv={() => void refreshEnv()}
        settings={settings}
        onSaveSettings={handleSaveSettings}
      />

      {bannerError && (
        <div className="flex items-center justify-between gap-2 border-b border-rose-500/30 bg-rose-950/50 px-4 py-2 text-xs text-rose-200">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
            {bannerError}
          </span>
          <button
            type="button"
            onClick={() => setBannerError(null)}
            className="text-rose-300 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {envStatus && (!envStatus.ytDlpFound || !envStatus.ffmpegFound) && (
        <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-950/40 px-4 py-2 text-xs text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
          <span>
            Binary belum lengkap:{" "}
            {!envStatus.ytDlpFound && "yt-dlp.exe tidak ditemukan "}
            {!envStatus.ffmpegFound && "ffmpeg.exe tidak ditemukan"}. Letakkan di
            folder <code className="rounded bg-black/40 px-1">bin/</code> atau atur
            path-nya di Pengaturan.
          </span>
        </div>
      )}

      <main className="grid flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-12 lg:overflow-hidden">
        {/* Left Column: Preview + Clip Builder */}
        <div className="flex flex-col gap-3 lg:col-span-7 lg:overflow-y-auto lg:pr-0.5">
          <VideoPreview
            video={video}
            currentTime={currentTime}
            onTimeUpdate={setCurrentTime}
            selectionStart={selectionStart}
            selectionEnd={selectionEnd}
            onSetStart={handleSetStart}
            onSetEnd={handleSetEnd}
            clips={clips}
            seekRequest={seekRequest}
          />

          <ClipBuilderTabs
            video={video}
            startInput={startInput}
            endInput={endInput}
            onStartInputChange={(val) => setStartInput(val)}
            onEndInputChange={(val) => setEndInput(val)}
            onAddClips={handleAddClips}
            onSeekPreview={triggerSeek}
            exportBulkText={exportBulkText}
          />
        </div>

        {/* Right Column: Queue + Output Settings */}
        <div className="flex flex-col gap-3 lg:col-span-5 lg:overflow-hidden">
          <QueuePanel
            clips={clips}
            onStartAll={() => void handleStartAll()}
            onCancelAll={() => void cancelAllClips()}
            onCancelClip={(id) => void cancelClip(id)}
            onRetryClip={(id) => void handleRetryClip(id)}
            onRemoveClip={(id) =>
              setClips((prev) => prev.filter((c) => c.id !== id))
            }
            onClearDone={() =>
              setClips((prev) => prev.filter((c) => c.status !== "done"))
            }
            onUpdateClip={(id, patch) =>
              setClips((prev) =>
                prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
              )
            }
            onJumpToClip={triggerSeek}
          />

          <OutputSettingsBar
            settings={settings}
            availableHeights={video?.availableHeights ?? []}
            onChange={(next) => {
              setSettings(next);
              void saveSettings(next);
            }}
          />
        </div>
      </main>
    </div>
  );
}
