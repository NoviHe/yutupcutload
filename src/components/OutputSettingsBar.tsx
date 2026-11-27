import { FolderOpen, Gauge, Zap } from "lucide-react";
import type {
  AppSettings,
  AudioFormat,
  CutMode,
  QualityPreset,
  VideoContainer,
} from "../types/clip";
import { openFolder, pickOutputFolder } from "../lib/tauriApi";

interface OutputSettingsBarProps {
  settings: AppSettings;
  availableHeights: number[];
  onChange: (next: AppSettings) => void;
}

const QUALITY_OPTIONS: { value: QualityPreset; label: string; height?: number }[] = [
  { value: "best", label: "Best (Kualitas Tertinggi)" },
  { value: "p2160", label: "2160p (4K)", height: 2160 },
  { value: "p1440", label: "1440p (2K)", height: 1440 },
  { value: "p1080", label: "1080p (Full HD)", height: 1080 },
  { value: "p720", label: "720p (HD)", height: 720 },
  { value: "p480", label: "480p (SD)", height: 480 },
  { value: "audioOnly", label: "Audio Only" },
];

export function OutputSettingsBar({
  settings,
  availableHeights,
  onChange,
}: OutputSettingsBarProps) {
  const isAudioOnly = settings.quality === "audioOnly";

  const handleBrowseFolder = async () => {
    const chosen = await pickOutputFolder(settings.outputDir);
    if (chosen) {
      onChange({ ...settings, outputDir: chosen });
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-zinc-800/90 bg-[#12151b] p-3.5 text-xs">
      <div className="grid grid-cols-12 gap-2.5">
        <div className="col-span-7">
          <label className="mb-1 block text-[11px] font-medium text-zinc-400">
            Kualitas
          </label>
          <select
            value={settings.quality}
            onChange={(e) =>
              onChange({
                ...settings,
                quality: e.target.value as QualityPreset,
              })
            }
            className="w-full rounded-lg border border-zinc-700 bg-[#0d0f12] px-2.5 py-1.5 text-xs text-zinc-100 focus:border-rose-500 focus:outline-none"
          >
            {QUALITY_OPTIONS.map((opt) => {
              const available =
                !opt.height ||
                availableHeights.length === 0 ||
                availableHeights.some((h) => h >= opt.height!);
              return (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                  {!available ? " (fallback ke terdekat)" : ""}
                </option>
              );
            })}
          </select>
        </div>

        <div className="col-span-5">
          <label className="mb-1 block text-[11px] font-medium text-zinc-400">
            {isAudioOnly ? "Format Audio" : "Container Video"}
          </label>
          {isAudioOnly ? (
            <select
              value={settings.audioFormat}
              onChange={(e) =>
                onChange({
                  ...settings,
                  audioFormat: e.target.value as AudioFormat,
                })
              }
              className="w-full rounded-lg border border-zinc-700 bg-[#0d0f12] px-2.5 py-1.5 text-xs text-zinc-100 focus:border-rose-500 focus:outline-none"
            >
              <option value="mp3">MP3</option>
              <option value="m4a">M4A (AAC)</option>
              <option value="opus">OPUS</option>
            </select>
          ) : (
            <select
              value={settings.videoContainer}
              onChange={(e) =>
                onChange({
                  ...settings,
                  videoContainer: e.target.value as VideoContainer,
                })
              }
              className="w-full rounded-lg border border-zinc-700 bg-[#0d0f12] px-2.5 py-1.5 text-xs text-zinc-100 focus:border-rose-500 focus:outline-none"
            >
              <option value="mp4">MP4</option>
              <option value="mkv">MKV</option>
            </select>
          )}
        </div>
      </div>

      {/* Cut Mode Segmented Control */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] font-medium text-zinc-400">Mode Pemotongan</span>
          <span className="text-[10px] text-zinc-500">
            Paralel: {settings.maxConcurrent}x
            {settings.cookiesSource !== "none"
              ? ` • Cookies: ${settings.cookiesSource}`
              : ""}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-zinc-800 bg-[#0d0f12] p-1">
          <ModeButton
            active={settings.cutMode === "fast"}
            onClick={() => onChange({ ...settings, cutMode: "fast" as CutMode })}
            icon={<Zap className="h-3.5 w-3.5 text-amber-400" />}
            title="Cepat (Stream Copy)"
            desc="Tanpa re-encode, ikut keyframe (±1–4s)"
          />
          <ModeButton
            active={settings.cutMode === "precise"}
            onClick={() => onChange({ ...settings, cutMode: "precise" as CutMode })}
            icon={<Gauge className="h-3.5 w-3.5 text-emerald-400" />}
            title="Presisi (Re-encode)"
            desc="Tepat ke detik/frame target"
          />
        </div>
      </div>

      {/* Output Folder */}
      <div>
        <label className="mb-1 block text-[11px] font-medium text-zinc-400">
          Folder Output
        </label>
        <div className="flex gap-1.5">
          <input
            type="text"
            value={settings.outputDir}
            onChange={(e) => onChange({ ...settings, outputDir: e.target.value })}
            className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-[#0d0f12] px-2.5 py-1.5 text-xs text-zinc-200 focus:border-rose-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleBrowseFolder}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
          >
            Pilih
          </button>
          <button
            type="button"
            onClick={() => void openFolder(settings.outputDir)}
            title="Buka folder output"
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-zinc-200 hover:bg-zinc-700"
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </section>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2.5 py-1.5 text-left transition ${
        active
          ? "bg-[#1a1f28] ring-1 ring-zinc-600"
          : "opacity-70 hover:bg-zinc-900 hover:opacity-100"
      }`}
    >
      <div className="flex items-center gap-1.5 font-medium text-zinc-100">
        {icon}
        <span>{title}</span>
      </div>
      <p className="mt-0.5 text-[10px] text-zinc-400">{desc}</p>
    </button>
  );
}
