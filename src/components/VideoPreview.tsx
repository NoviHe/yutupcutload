import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Loader2,
  Pause,
  Play,
  Radio,
  Tv,
  CornerDownRight,
} from "lucide-react";
import type { ClipItem, VideoMetadata } from "../types/clip";
import { extractYouTubeId, formatTime, parseTime } from "../lib/time";
import { resolveStreamUrl } from "../lib/tauriApi";

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement | string,
        options: {
          videoId: string;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: () => void;
            onStateChange?: (e: { data: number }) => void;
            onError?: (e: { data: number }) => void;
          };
        }
      ) => YTPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YTPlayer {
  destroy: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  getPlayerState: () => number;
}

let ytApiPromise: Promise<void> | null = null;
function loadYouTubeIframeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    document.head.appendChild(script);
  });
  return ytApiPromise;
}

interface VideoPreviewProps {
  video: VideoMetadata | null;
  currentTime: number;
  onTimeUpdate: (secs: number) => void;
  selectionStart: number;
  selectionEnd: number;
  onSetStart: (secs: number) => void;
  onSetEnd: (secs: number) => void;
  clips: ClipItem[];
  seekRequest: { secs: number; seq: number } | null;
}

export function VideoPreview({
  video,
  currentTime,
  onTimeUpdate,
  selectionStart,
  selectionEnd,
  onSetStart,
  onSetEnd,
  clips,
  seekRequest,
}: VideoPreviewProps) {
  const [mode, setMode] = useState<"iframe" | "direct">("iframe");
  const [iframeError, setIframeError] = useState<string | null>(null);
  const [directUrl, setDirectUrl] = useState<string | null>(null);
  const [loadingDirect, setLoadingDirect] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [jumpInput, setJumpInput] = useState("");

  const containerRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<YTPlayer | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;

  const videoId = video ? extractYouTubeId(video.url) || video.id : null;
  const duration = video?.duration ?? 0;

  useEffect(() => {
    setMode("iframe");
    setIframeError(null);
    setDirectUrl(null);
    setIsPlaying(false);
    onTimeUpdate(0);
  }, [video?.url]);

  // Mount / destroy YouTube IFrame player
  useEffect(() => {
    if (mode !== "iframe" || !videoId || !containerRef.current) return;

    let cancelled = false;
    let pollTimer: number | null = null;

    loadYouTubeIframeApi().then(() => {
      if (cancelled || !containerRef.current || !window.YT?.Player) return;

      containerRef.current.innerHTML = "";
      const mountEl = document.createElement("div");
      mountEl.className = "w-full h-full";
      containerRef.current.appendChild(mountEl);

      ytPlayerRef.current = new window.YT.Player(mountEl, {
        videoId,
        playerVars: {
          autoplay: 0,
          controls: 1,
          rel: 0,
          modestbranding: 1,
          enablejsapi: 1,
        },
        events: {
          onReady: () => {
            if (cancelled) return;
            pollTimer = window.setInterval(() => {
              const p = ytPlayerRef.current;
              if (!p) return;
              try {
                const t = p.getCurrentTime();
                if (Number.isFinite(t)) onTimeUpdate(t);
              } catch {
                // ignore transient player read errors
              }
            }, 250);
          },
          onStateChange: (e) => {
            setIsPlaying(e.data === 1);
            try {
              const t = ytPlayerRef.current?.getCurrentTime();
              if (typeof t === "number" && Number.isFinite(t)) onTimeUpdate(t);
            } catch {
              // ignore
            }
          },
          onError: (e) => {
            const code = e.data;
            const msg =
              code === 101 || code === 150
                ? "Pemilik video memblokir pemutaran embed (Error 101/150)."
                : `YouTube player error (${code}).`;
            setIframeError(msg);
          },
        },
      });
    });

    return () => {
      cancelled = true;
      if (pollTimer !== null) window.clearInterval(pollTimer);
      try {
        ytPlayerRef.current?.destroy();
      } catch {
        // ignore
      }
      ytPlayerRef.current = null;
    };
  }, [mode, videoId]);

  const seekTo = (target: number) => {
    const clamped = Math.max(0, duration > 0 ? Math.min(target, duration) : target);
    onTimeUpdate(clamped);
    if (mode === "iframe") {
      try {
        ytPlayerRef.current?.seekTo(clamped, true);
      } catch {
        // ignore
      }
    } else if (videoElRef.current) {
      videoElRef.current.currentTime = clamped;
    }
  };

  const togglePlay = () => {
    if (mode === "iframe") {
      const p = ytPlayerRef.current;
      if (!p) return;
      try {
        if (p.getPlayerState() === 1) {
          p.pauseVideo();
        } else {
          p.playVideo();
        }
      } catch {
        // ignore
      }
    } else if (videoElRef.current) {
      if (videoElRef.current.paused) {
        void videoElRef.current.play();
      } else {
        videoElRef.current.pause();
      }
    }
  };

  useEffect(() => {
    if (!seekRequest) return;
    seekTo(seekRequest.secs);
  }, [seekRequest]);

  // Keyboard shortcuts when not typing in an input
  useEffect(() => {
    if (!video) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seekTo(currentTimeRef.current - (e.shiftKey ? 30 : 5));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        seekTo(currentTimeRef.current + (e.shiftKey ? 30 : 5));
      } else if (e.key === "[") {
        e.preventDefault();
        onSetStart(currentTimeRef.current);
      } else if (e.key === "]") {
        e.preventDefault();
        onSetEnd(currentTimeRef.current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [video, mode, duration, onSetStart, onSetEnd]);

  const switchToDirectStream = async () => {
    if (!video) return;
    setLoadingDirect(true);
    setIframeError(null);
    try {
      const resolved = await resolveStreamUrl(video.url);
      setDirectUrl(resolved);
      setMode("direct");
    } catch (err) {
      setIframeError(String(err));
    } finally {
      setLoadingDirect(false);
    }
  };

  const handleJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseTime(jumpInput);
    if (parsed !== null) {
      seekTo(parsed);
      setJumpInput("");
    }
  };

  const startPct = duration > 0 ? Math.min(100, (selectionStart / duration) * 100) : 0;
  const endPct = duration > 0 ? Math.min(100, (selectionEnd / duration) * 100) : 0;
  const playheadPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <section className="flex flex-col rounded-xl border border-zinc-800/90 bg-[#12151b]">
      {/* Metadata Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          {video ? (
            <>
              <h2 className="truncate text-sm font-semibold text-zinc-100">
                {video.title}
              </h2>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                <span>{video.channel}</span>
                <span>•</span>
                <span className="tabular-nums font-mono text-zinc-300">
                  Durasi: {formatTime(video.duration)}
                </span>
                {video.wasLive && (
                  <span className="inline-flex items-center gap-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">
                    <Radio className="h-3 w-3" /> VOD Livestream
                  </span>
                )}
                {video.isLive && (
                  <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-medium text-rose-300">
                    Sedang Live
                  </span>
                )}
              </div>
            </>
          ) : (
            <p className="text-xs text-zinc-400">
              Belum ada video dimuat — paste link YouTube di atas lalu klik Muat Video.
            </p>
          )}
        </div>

        {video && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setMode("iframe")}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                mode === "iframe"
                  ? "bg-zinc-700 text-white"
                  : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              IFrame
            </button>
            <button
              type="button"
              onClick={switchToDirectStream}
              disabled={loadingDirect}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                mode === "direct"
                  ? "bg-rose-600 text-white"
                  : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {loadingDirect && <Loader2 className="h-3 w-3 animate-spin" />}
              Direct Stream
            </button>
          </div>
        )}
      </div>

      {/* Video Player Viewport */}
      <div className="relative aspect-video w-full overflow-hidden bg-black">
        {!video ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-500">
            <Tv className="h-10 w-10 opacity-40" />
            <p className="text-xs">Preview video 11 jam langsung jalan tanpa download full</p>
          </div>
        ) : mode === "iframe" ? (
          <div ref={containerRef} className="h-full w-full" />
        ) : directUrl ? (
          <video
            ref={videoElRef}
            src={directUrl}
            controls
            className="h-full w-full"
            onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime)}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-zinc-400">
            Memuat direct stream...
          </div>
        )}

        {iframeError && mode === "iframe" && (
          <div className="absolute inset-x-3 bottom-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-zinc-950/95 px-3 py-2 text-xs text-amber-200">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-amber-400" />
              {iframeError}
            </span>
            <button
              type="button"
              onClick={switchToDirectStream}
              disabled={loadingDirect}
              className="rounded-md bg-amber-500 px-3 py-1 font-medium text-zinc-950 hover:bg-amber-400"
            >
              {loadingDirect ? "Mengambil stream..." : "Putar via Direct Stream"}
            </button>
          </div>
        )}
      </div>

      {/* Interactive Timeline Scrubber + Selection Highlight */}
      <div className="space-y-2.5 border-t border-zinc-800/80 p-3">
        <div className="space-y-1">
          <div
            onClick={(e) => {
              if (!duration) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              seekTo(ratio * duration);
            }}
            className="relative h-4 w-full cursor-pointer overflow-hidden rounded bg-zinc-900 ring-1 ring-zinc-800"
            title="Klik untuk lompat ke posisi video"
          >
            {/* Saved clips markers */}
            {duration > 0 &&
              clips.map((c) => {
                const left = (c.startSecs / duration) * 100;
                const width = Math.max(0.4, ((c.endSecs - c.startSecs) / duration) * 100);
                return (
                  <div
                    key={c.id}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    className="absolute inset-y-0 bg-emerald-500/25"
                  />
                );
              })}

            {/* Current active selection */}
            {duration > 0 && endPct > startPct && (
              <div
                style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
                className="absolute inset-y-0 border-x border-rose-400 bg-rose-500/35"
              />
            )}

            {/* Playhead */}
            <div
              style={{ left: `${playheadPct}%` }}
              className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)]"
            />
          </div>

          <div className="flex items-center justify-between text-[11px] tabular-nums font-mono text-zinc-400">
            <span>
              Playhead: <strong className="text-zinc-100">{formatTime(currentTime)}</strong> /{" "}
              {formatTime(duration)}
            </span>
            <span>
              Seleksi:{" "}
              <span className="text-rose-300">
                {formatTime(selectionStart)} → {formatTime(selectionEnd)}
              </span>
            </span>
          </div>
        </div>

        {/* Transport & Quick Mark Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1">
            {[
              { label: "-5m", delta: -300 },
              { label: "-30s", delta: -30 },
              { label: "-5s", delta: -5 },
            ].map((btn) => (
              <button
                key={btn.label}
                type="button"
                disabled={!video}
                onClick={() => seekTo(currentTime + btn.delta)}
                className="rounded border border-zinc-800 bg-[#181c24] px-2 py-1 font-mono text-[11px] text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800 disabled:opacity-40"
              >
                {btn.label}
              </button>
            ))}

            <button
              type="button"
              disabled={!video}
              onClick={togglePlay}
              className="inline-flex items-center gap-1 rounded bg-zinc-200 px-2.5 py-1 text-[11px] font-semibold text-zinc-900 hover:bg-white disabled:opacity-40"
              title="Play/Pause (Space)"
            >
              {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>

            {[
              { label: "+5s", delta: 5 },
              { label: "+30s", delta: 30 },
              { label: "+5m", delta: 300 },
            ].map((btn) => (
              <button
                key={btn.label}
                type="button"
                disabled={!video}
                onClick={() => seekTo(currentTime + btn.delta)}
                className="rounded border border-zinc-800 bg-[#181c24] px-2 py-1 font-mono text-[11px] text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800 disabled:opacity-40"
              >
                {btn.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleJumpSubmit} className="flex items-center gap-1">
            <input
              type="text"
              value={jumpInput}
              onChange={(e) => setJumpInput(e.target.value)}
              placeholder="HH:MM:SS"
              disabled={!video}
              className="w-24 rounded border border-zinc-800 bg-[#0d0f12] px-2 py-1 font-mono text-[11px] text-zinc-200 placeholder-zinc-600 focus:border-rose-500 focus:outline-none disabled:opacity-40"
            />
            <button
              type="submit"
              disabled={!video || !jumpInput.trim()}
              className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-[#181c24] px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
              title="Lompat ke timestamp"
            >
              <CornerDownRight className="h-3 w-3" /> Go
            </button>
          </form>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={!video}
              onClick={() => onSetStart(currentTime)}
              className="rounded-md border border-rose-500/40 bg-rose-500/15 px-2.5 py-1 text-xs font-medium text-rose-200 hover:bg-rose-500/25 disabled:opacity-40"
              title="Tandai Start dari playhead ([)"
            >
              Set Start [
            </button>
            <button
              type="button"
              disabled={!video}
              onClick={() => onSetEnd(currentTime)}
              className="rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-40"
              title="Tandai End dari playhead (])"
            >
              Set End ]
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
