import { useState } from "react";
import {
  CheckCircle2,
  FolderOpen,
  Play,
  RotateCcw,
  Square,
  Terminal,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import type { ClipItem, ClipStatus } from "../types/clip";
import { formatBytes, formatTime, parseTime } from "../lib/time";
import { revealFile } from "../lib/tauriApi";

interface QueuePanelProps {
  clips: ClipItem[];
  onStartAll: () => void;
  onCancelAll: () => void;
  onCancelClip: (id: string) => void;
  onRetryClip: (id: string) => void;
  onRemoveClip: (id: string) => void;
  onClearDone: () => void;
  onUpdateClip: (
    id: string,
    patch: Partial<Pick<ClipItem, "label" | "startSecs" | "endSecs">>
  ) => void;
  onJumpToClip: (secs: number) => void;
}

export function QueuePanel({
  clips,
  onStartAll,
  onCancelAll,
  onCancelClip,
  onRetryClip,
  onRemoveClip,
  onClearDone,
  onUpdateClip,
  onJumpToClip,
}: QueuePanelProps) {
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());

  const activeCount = clips.filter(
    (c) => c.status === "pending" || c.status === "downloading" || c.status === "processing"
  ).length;
  const runnableCount = clips.filter(
    (c) => c.status === "draft" || c.status === "cancelled" || c.status === "error"
  ).length;
  const doneCount = clips.filter((c) => c.status === "done").length;

  const totalDuration = clips.reduce(
    (acc, c) => acc + Math.max(0, c.endSecs - c.startSecs),
    0
  );

  const toggleLog = (id: string) => {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <section className="flex min-h-[340px] flex-1 flex-col overflow-hidden rounded-xl border border-zinc-800/90 bg-[#12151b]">
      {/* Queue Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 px-3.5 py-2.5">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">
            Daftar Klip & Antrean ({clips.length})
          </h2>
          <p className="text-[11px] tabular-nums text-zinc-400">
            Total durasi klip: {formatTime(totalDuration)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={runnableCount === 0}
            onClick={onStartAll}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Play className="h-3.5 w-3.5" />
            Mulai Download ({runnableCount})
          </button>

          {activeCount > 0 && (
            <button
              type="button"
              onClick={onCancelAll}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 text-xs font-medium text-rose-200 hover:bg-rose-500/25"
            >
              <Square className="h-3 w-3" />
              Batalkan Semua
            </button>
          )}

          {doneCount > 0 && (
            <button
              type="button"
              onClick={onClearDone}
              className="rounded-lg border border-zinc-700 bg-zinc-800/80 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              Hapus Selesai
            </button>
          )}
        </div>
      </div>

      {/* Queue Items */}
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {clips.length === 0 ? (
          <div className="flex h-full min-h-[200px] flex-col items-center justify-center text-center text-xs text-zinc-500">
            <p>Belum ada klip di daftar.</p>
            <p className="mt-1 text-zinc-600">
              Tandai Start/End di preview atau gunakan Auto-Split / Chapters.
            </p>
          </div>
        ) : (
          clips.map((clip, idx) => {
            const isEditable =
              clip.status === "draft" ||
              clip.status === "error" ||
              clip.status === "cancelled";
            const isActive =
              clip.status === "pending" ||
              clip.status === "downloading" ||
              clip.status === "processing";
            const logOpen = expandedLogs.has(clip.id);

            return (
              <div
                key={clip.id}
                className="rounded-lg border border-zinc-800/90 bg-[#0d0f12] p-2.5 transition hover:border-zinc-700/80"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-zinc-800 font-mono text-[10px] text-zinc-300">
                      {idx + 1}
                    </span>
                    {isEditable ? (
                      <input
                        type="text"
                        value={clip.label}
                        onChange={(e) =>
                          onUpdateClip(clip.id, { label: e.target.value })
                        }
                        placeholder="Label klip (opsional)"
                        className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-xs font-medium text-zinc-100 placeholder-zinc-600 hover:border-zinc-800 focus:border-rose-500 focus:bg-[#14171d] focus:outline-none"
                      />
                    ) : (
                      <span className="truncate text-xs font-medium text-zinc-100">
                        {clip.label || `Clip ${idx + 1}`}
                      </span>
                    )}
                  </div>

                  <StatusPill status={clip.status} />
                </div>

                {/* Timestamps + Actions Row */}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <div className="flex items-center gap-1.5 font-mono tabular-nums">
                    {isEditable ? (
                      <>
                        <TimestampInlineInput
                          value={clip.startSecs}
                          onCommit={(secs) => {
                            if (secs < clip.endSecs) {
                              onUpdateClip(clip.id, { startSecs: secs });
                            }
                          }}
                        />
                        <span className="text-zinc-500">→</span>
                        <TimestampInlineInput
                          value={clip.endSecs}
                          onCommit={(secs) => {
                            if (secs > clip.startSecs) {
                              onUpdateClip(clip.id, { endSecs: secs });
                            }
                          }}
                        />
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onJumpToClip(clip.startSecs)}
                        className="text-zinc-300 hover:text-rose-300"
                      >
                        {formatTime(clip.startSecs)} → {formatTime(clip.endSecs)}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onJumpToClip(clip.startSecs)}
                      className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200"
                      title="Lompat preview ke awal klip"
                    >
                      ({formatTime(clip.endSecs - clip.startSecs)})
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    {isActive && (
                      <button
                        type="button"
                        onClick={() => onCancelClip(clip.id)}
                        className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-[11px] text-rose-200 hover:bg-rose-500/25"
                      >
                        <X className="h-3 w-3" /> Batal
                      </button>
                    )}

                    {(clip.status === "error" || clip.status === "cancelled") && (
                      <button
                        type="button"
                        onClick={() => onRetryClip(clip.id)}
                        className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-200 hover:bg-zinc-700"
                      >
                        <RotateCcw className="h-3 w-3" /> Ulangi
                      </button>
                    )}

                    {clip.status === "done" && clip.outputPath && (
                      <button
                        type="button"
                        onClick={() => void revealFile(clip.outputPath!)}
                        className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-200 hover:bg-emerald-500/25"
                      >
                        <FolderOpen className="h-3 w-3" /> Buka File
                      </button>
                    )}

                    {clip.logs.length > 0 && (
                      <button
                        type="button"
                        onClick={() => toggleLog(clip.id)}
                        className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-400 hover:text-zinc-200"
                        title="Lihat log proses"
                      >
                        <Terminal className="h-3 w-3" />
                      </button>
                    )}

                    {!isActive && (
                      <button
                        type="button"
                        onClick={() => onRemoveClip(clip.id)}
                        className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-rose-400"
                        title="Hapus klip dari daftar"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress Bar */}
                {(isActive || clip.status === "done") && (
                  <div className="mt-2 space-y-1">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                      <div
                        style={{ width: `${Math.min(100, Math.max(0, clip.percent))}%` }}
                        className={`h-full transition-all duration-200 ${
                          clip.status === "done"
                            ? "bg-emerald-500"
                            : clip.status === "processing"
                              ? "bg-amber-400"
                              : "bg-rose-500"
                        }`}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] tabular-nums text-zinc-400">
                      <span>
                        {clip.stage} • {clip.percent.toFixed(1)}%
                      </span>
                      <span>
                        {[
                          clip.speed,
                          formatBytes(clip.downloadedBytes),
                          clip.eta ? `ETA ${clip.eta}` : null,
                        ]
                          .filter(Boolean)
                          .join(" • ")}
                      </span>
                    </div>
                  </div>
                )}

                {clip.error && (
                  <p className="mt-1.5 rounded bg-rose-950/40 px-2 py-1 text-[11px] text-rose-300">
                    {clip.error}
                  </p>
                )}

                {logOpen && clip.logs.length > 0 && (
                  <pre className="mt-2 max-h-32 overflow-y-auto rounded border border-zinc-800 bg-black/70 p-2 font-mono text-[10px] leading-relaxed text-zinc-400">
                    {clip.logs.slice(-40).join("\n")}
                  </pre>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function TimestampInlineInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (secs: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setText(formatTime(value));
          setEditing(true);
        }}
        className="rounded border border-zinc-800 bg-[#14171d] px-1.5 py-0.5 text-zinc-200 hover:border-zinc-600"
        title="Klik untuk edit timestamp"
      >
        {formatTime(value)}
      </button>
    );
  }

  const commit = () => {
    const parsed = parseTime(text);
    if (parsed !== null) onCommit(parsed);
    setEditing(false);
  };

  return (
    <input
      type="text"
      autoFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
      className="w-20 rounded border border-rose-500 bg-[#14171d] px-1.5 py-0.5 text-zinc-100 focus:outline-none"
    />
  );
}

function StatusPill({ status }: { status: ClipStatus }) {
  const styles: Record<ClipStatus, string> = {
    draft: "bg-zinc-800 text-zinc-300",
    pending: "bg-zinc-800 text-amber-300",
    downloading: "bg-rose-500/20 text-rose-300",
    processing: "bg-amber-500/20 text-amber-300",
    done: "bg-emerald-500/20 text-emerald-300",
    cancelled: "bg-zinc-800 text-zinc-400",
    error: "bg-rose-950/60 text-rose-300",
  };
  const labels: Record<ClipStatus, string> = {
    draft: "Siap",
    pending: "Menunggu",
    downloading: "Mengunduh",
    processing: "Memproses",
    done: "Selesai",
    cancelled: "Dibatalkan",
    error: "Gagal",
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium ${styles[status]}`}
    >
      {status === "done" && <CheckCircle2 className="h-3 w-3" />}
      {status === "error" && <XCircle className="h-3 w-3" />}
      {labels[status]}
    </span>
  );
}
