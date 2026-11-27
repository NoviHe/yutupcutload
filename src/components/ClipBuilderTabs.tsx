import { useMemo, useState } from "react";
import {
  FileText,
  ListChecks,
  Plus,
  ScissorsLineDashed,
  Sparkles,
} from "lucide-react";
import type {
  BulkParseLineError,
  GeneratedClip,
  VideoMetadata,
} from "../types/clip";
import { formatTime, parseTime } from "../lib/time";
import { generateAutoSplit, parseBulkClips } from "../lib/tauriApi";

interface ClipBuilderTabsProps {
  video: VideoMetadata | null;
  startInput: string;
  endInput: string;
  onStartInputChange: (val: string) => void;
  onEndInputChange: (val: string) => void;
  onAddClips: (clips: GeneratedClip[]) => void;
  onSeekPreview: (secs: number) => void;
  exportBulkText: () => string;
}

export function ClipBuilderTabs({
  video,
  startInput,
  endInput,
  onStartInputChange,
  onEndInputChange,
  onAddClips,
  onSeekPreview,
  exportBulkText,
}: ClipBuilderTabsProps) {
  const [tab, setTab] = useState<"custom" | "autosplit" | "chapters">("custom");
  const [label, setLabel] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);

  // Bulk import
  const [showBulk, setShowBulk] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkErrors, setBulkErrors] = useState<BulkParseLineError[]>([]);

  // Auto-split state
  const [chunkMinutes, setChunkMinutes] = useState(15);
  const [chunkSeconds, setChunkSeconds] = useState(0);
  const [overlapSeconds, setOverlapSeconds] = useState(0);
  const [splitFrom, setSplitFrom] = useState("");
  const [splitTo, setSplitTo] = useState("");
  const [splitPrefix, setSplitPrefix] = useState("Part");
  const [splitError, setSplitError] = useState<string | null>(null);

  // Chapters state
  const [chapterSearch, setChapterSearch] = useState("");
  const [selectedChapters, setSelectedChapters] = useState<Set<number>>(new Set());

  const parsedStart = parseTime(startInput);
  const parsedEnd = parseTime(endInput);
  const clipDuration =
    parsedStart !== null && parsedEnd !== null && parsedEnd > parsedStart
      ? parsedEnd - parsedStart
      : null;

  const handleAddCustom = (e: React.FormEvent) => {
    e.preventDefault();
    setCustomError(null);
    if (parsedStart === null || parsedEnd === null) {
      setCustomError("Format timestamp harus HH:MM:SS atau MM:SS");
      return;
    }
    if (parsedEnd <= parsedStart) {
      setCustomError("Waktu End harus lebih besar dari Start");
      return;
    }
    if (parsedEnd - parsedStart < 0.5) {
      setCustomError("Durasi klip minimal 0.5 detik");
      return;
    }
    if (video && parsedEnd > video.duration + 0.5) {
      setCustomError(`End melebihi durasi video (${formatTime(video.duration)})`);
      return;
    }
    onAddClips([
      {
        startSecs: parsedStart,
        endSecs: parsedEnd,
        label: label.trim(),
      },
    ]);
    setLabel("");
  };

  const handleBulkImport = async () => {
    setBulkErrors([]);
    const res = await parseBulkClips(bulkText, video ? video.duration : null);
    if (res.clips.length > 0) {
      onAddClips(res.clips);
    }
    if (res.errors.length > 0) {
      setBulkErrors(res.errors);
    } else if (res.clips.length > 0) {
      setBulkText("");
      setShowBulk(false);
    }
  };

  const estimatedParts = useMemo(() => {
    if (!video) return 0;
    const totalChunk = chunkMinutes * 60 + chunkSeconds;
    if (totalChunk < 1 || overlapSeconds >= totalChunk) return 0;
    const from = splitFrom.trim() ? parseTime(splitFrom) ?? 0 : 0;
    const to = splitTo.trim()
      ? Math.min(video.duration, parseTime(splitTo) ?? video.duration)
      : video.duration;
    if (to <= from) return 0;
    const step = totalChunk - overlapSeconds;
    return Math.ceil((to - from) / step);
  }, [video, chunkMinutes, chunkSeconds, overlapSeconds, splitFrom, splitTo]);

  const handleGenerateSplit = async () => {
    if (!video) return;
    setSplitError(null);
    const totalChunk = chunkMinutes * 60 + chunkSeconds;
    const rangeStart = splitFrom.trim() ? parseTime(splitFrom) : null;
    const rangeEnd = splitTo.trim() ? parseTime(splitTo) : null;

    if (splitFrom.trim() && rangeStart === null) {
      setSplitError("Format timestamp 'Dari' tidak valid");
      return;
    }
    if (splitTo.trim() && rangeEnd === null) {
      setSplitError("Format timestamp 'Sampai' tidak valid");
      return;
    }

    try {
      const generated = await generateAutoSplit({
        totalDuration: video.duration,
        rangeStart,
        rangeEnd,
        chunkSecs: totalChunk,
        overlapSecs: overlapSeconds,
        prefix: splitPrefix,
      });
      onAddClips(generated);
    } catch (err) {
      setSplitError(String(err));
    }
  };

  const chapters = video?.chapters ?? [];
  const filteredChapters = chapters
    .map((ch, idx) => ({ ...ch, idx }))
    .filter((ch) =>
      ch.title.toLowerCase().includes(chapterSearch.trim().toLowerCase())
    );

  const toggleChapter = (idx: number) => {
    setSelectedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const addSelectedChapters = () => {
    const chosen = chapters
      .map((ch, idx) => ({ ch, idx }))
      .filter(({ idx }) => selectedChapters.has(idx))
      .map(({ ch }) => ({
        startSecs: ch.startTime,
        endSecs: ch.endTime,
        label: ch.title,
      }));
    if (chosen.length > 0) {
      onAddClips(chosen);
      setSelectedChapters(new Set());
    }
  };

  return (
    <section className="rounded-xl border border-zinc-800/90 bg-[#12151b]">
      {/* Tab Selector */}
      <div className="flex border-b border-zinc-800/80 px-2 pt-2">
        <TabButton
          active={tab === "custom"}
          onClick={() => setTab("custom")}
          icon={<Plus className="h-3.5 w-3.5" />}
          label="Custom Range"
        />
        <TabButton
          active={tab === "autosplit"}
          onClick={() => setTab("autosplit")}
          icon={<ScissorsLineDashed className="h-3.5 w-3.5" />}
          label="Auto-Split Durasi"
        />
        <TabButton
          active={tab === "chapters"}
          onClick={() => setTab("chapters")}
          icon={<ListChecks className="h-3.5 w-3.5" />}
          label={`Chapters (${chapters.length})`}
        />
      </div>

      <div className="p-3.5">
        {tab === "custom" && (
          <div className="space-y-3">
            <form onSubmit={handleAddCustom} className="space-y-2.5">
              <div className="grid grid-cols-12 gap-2.5">
                <div className="col-span-4">
                  <label className="mb-1 block text-[11px] font-medium text-zinc-400">
                    Start (HH:MM:SS)
                  </label>
                  <input
                    type="text"
                    value={startInput}
                    onChange={(e) => onStartInputChange(e.target.value)}
                    className="w-full rounded-lg border border-zinc-700 bg-[#0d0f12] px-2.5 py-1.5 font-mono text-xs text-zinc-100 focus:border-rose-500 focus:outline-none"
                  />
                </div>
                <div className="col-span-4">
                  <label className="mb-1 block text-[11px] font-medium text-zinc-400">
                    End (HH:MM:SS)
                  </label>
                  <input
                    type="text"
                    value={endInput}
                    onChange={(e) => onEndInputChange(e.target.value)}
                    className="w-full rounded-lg border border-zinc-700 bg-[#0d0f12] px-2.5 py-1.5 font-mono text-xs text-zinc-100 focus:border-rose-500 focus:outline-none"
                  />
                </div>
                <div className="col-span-4">
                  <label className="mb-1 block text-[11px] font-medium text-zinc-400">
                    Durasi Klip
                  </label>
                  <div className="flex h-[30px] items-center rounded-lg border border-zinc-800 bg-[#0d0f12] px-2.5 font-mono text-xs text-emerald-300">
                    {clipDuration !== null ? formatTime(clipDuration) : "--:--:--"}
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Label klip (opsional, misal: Boss Fight / Highlight)"
                  className="flex-1 rounded-lg border border-zinc-700 bg-[#0d0f12] px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-rose-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!video}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" /> Tambah Klip
                </button>
              </div>

              {customError && (
                <p className="text-xs text-rose-400">{customError}</p>
              )}
            </form>

            <div className="flex items-center justify-between border-t border-zinc-800/70 pt-2.5">
              <button
                type="button"
                onClick={() => setShowBulk((v) => !v)}
                className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200"
              >
                <FileText className="h-3.5 w-3.5" />
                {showBulk ? "Tutup Bulk Import Teks" : "Bulk Import / Export Teks Timestamp"}
              </button>
              {showBulk && (
                <button
                  type="button"
                  onClick={() => setBulkText(exportBulkText())}
                  className="text-[11px] text-sky-400 hover:text-sky-300"
                >
                  Export Daftar Klip ke Teks
                </button>
              )}
            </div>

            {showBulk && (
              <div className="space-y-2 rounded-lg border border-zinc-800 bg-[#0d0f12] p-2.5">
                <textarea
                  rows={4}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={`Satu baris satu klip:\n00:45:10-00:48:30 Boss Fight\n03:12:00 - 03:15:45 | Momen Lucu`}
                  className="w-full rounded border border-zinc-800 bg-[#12151b] p-2 font-mono text-xs text-zinc-200 placeholder-zinc-600 focus:border-rose-500 focus:outline-none"
                />
                {bulkErrors.length > 0 && (
                  <div className="max-h-24 space-y-1 overflow-y-auto rounded bg-rose-950/30 p-2 text-[11px] text-rose-300">
                    {bulkErrors.map((err) => (
                      <div key={err.lineNumber}>
                        Baris {err.lineNumber}: {err.error}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={!video || !bulkText.trim()}
                    onClick={handleBulkImport}
                    className="rounded-md bg-zinc-200 px-3 py-1 text-xs font-medium text-zinc-900 hover:bg-white disabled:opacity-40"
                  >
                    Import ke Daftar Klip
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "autosplit" && (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label className="mb-1 block text-[11px] text-zinc-400">
                  Durasi per bagian (Menit)
                </label>
                <input
                  type="number"
                  min={0}
                  value={chunkMinutes}
                  onChange={(e) => setChunkMinutes(Math.max(0, Number(e.target.value)))}
                  className="w-full rounded-lg border border-zinc-700 bg-[#0d0f12] px-2.5 py-1.5 font-mono text-zinc-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-zinc-400">
                  + Detik
                </label>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={chunkSeconds}
                  onChange={(e) => setChunkSeconds(Math.max(0, Number(e.target.value)))}
                  className="w-full rounded-lg border border-zinc-700 bg-[#0d0f12] px-2.5 py-1.5 font-mono text-zinc-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-zinc-400">
                  Overlap (Detik)
                </label>
                <input
                  type="number"
                  min={0}
                  value={overlapSeconds}
                  onChange={(e) => setOverlapSeconds(Math.max(0, Number(e.target.value)))}
                  className="w-full rounded-lg border border-zinc-700 bg-[#0d0f12] px-2.5 py-1.5 font-mono text-zinc-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label className="mb-1 block text-[11px] text-zinc-400">
                  Dari (opsional)
                </label>
                <input
                  type="text"
                  value={splitFrom}
                  onChange={(e) => setSplitFrom(e.target.value)}
                  placeholder="00:00:00"
                  className="w-full rounded-lg border border-zinc-700 bg-[#0d0f12] px-2.5 py-1.5 font-mono text-zinc-100 placeholder-zinc-600"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-zinc-400">
                  Sampai (opsional)
                </label>
                <input
                  type="text"
                  value={splitTo}
                  onChange={(e) => setSplitTo(e.target.value)}
                  placeholder={video ? formatTime(video.duration) : "Akhir"}
                  className="w-full rounded-lg border border-zinc-700 bg-[#0d0f12] px-2.5 py-1.5 font-mono text-zinc-100 placeholder-zinc-600"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-zinc-400">
                  Prefix Label
                </label>
                <input
                  type="text"
                  value={splitPrefix}
                  onChange={(e) => setSplitPrefix(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-[#0d0f12] px-2.5 py-1.5 text-zinc-100"
                />
              </div>
            </div>

            {splitError && <p className="text-rose-400">{splitError}</p>}

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-zinc-400">
                Estimasi hasil: <strong className="text-zinc-200">{estimatedParts} klip</strong>
              </span>
              <button
                type="button"
                disabled={!video || estimatedParts <= 0}
                onClick={handleGenerateSplit}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-40"
              >
                <Sparkles className="h-3.5 w-3.5" /> Generate ke Daftar Klip
              </button>
            </div>
          </div>
        )}

        {tab === "chapters" && (
          <div className="space-y-2.5 text-xs">
            {chapters.length === 0 ? (
              <p className="py-4 text-center text-zinc-500">
                Video ini tidak memiliki YouTube Chapters.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <input
                    type="text"
                    value={chapterSearch}
                    onChange={(e) => setChapterSearch(e.target.value)}
                    placeholder="Filter nama chapter..."
                    className="w-48 rounded-lg border border-zinc-700 bg-[#0d0f12] px-2.5 py-1 text-xs text-zinc-100 placeholder-zinc-500"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedChapters(new Set(chapters.map((_, i) => i)))
                      }
                      className="text-[11px] text-zinc-300 hover:text-white"
                    >
                      Pilih Semua
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedChapters(new Set())}
                      className="text-[11px] text-zinc-400 hover:text-zinc-200"
                    >
                      Hapus Pilihan
                    </button>
                    <button
                      type="button"
                      disabled={selectedChapters.size === 0}
                      onClick={addSelectedChapters}
                      className="rounded-md bg-rose-600 px-3 py-1 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-40"
                    >
                      Tambah ({selectedChapters.size})
                    </button>
                  </div>
                </div>

                <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                  {filteredChapters.map((ch) => (
                    <div
                      key={ch.idx}
                      className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800/80 bg-[#0d0f12] px-2.5 py-1.5"
                    >
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedChapters.has(ch.idx)}
                          onChange={() => toggleChapter(ch.idx)}
                          className="accent-rose-500"
                        />
                        <span className="truncate text-zinc-200">{ch.title}</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => onSeekPreview(ch.startTime)}
                        className="shrink-0 font-mono text-[11px] text-zinc-400 hover:text-rose-300"
                        title="Preview chapter ini"
                      >
                        {formatTime(ch.startTime)}–{formatTime(ch.endTime)}
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition ${
        active
          ? "border-rose-500 text-zinc-100"
          : "border-transparent text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
