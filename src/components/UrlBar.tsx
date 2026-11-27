import { useState } from "react";
import {
  CheckCircle2,
  Loader2,
  RefreshCw,
  Scissors,
  Settings,
  AlertTriangle,
  Link2,
} from "lucide-react";
import type { AppSettings, CookiesSource, EnvironmentStatus } from "../types/clip";
import { pickFilePath } from "../lib/tauriApi";

interface UrlBarProps {
  url: string;
  onUrlChange: (value: string) => void;
  onLoadVideo: () => void;
  isLoading: boolean;
  envStatus: EnvironmentStatus | null;
  onRecheckEnv: () => void;
  settings: AppSettings;
  onSaveSettings: (next: AppSettings) => Promise<void>;
}

export function UrlBar({
  url,
  onUrlChange,
  onLoadVideo,
  isLoading,
  envStatus,
  onRecheckEnv,
  settings,
  onSaveSettings,
}: UrlBarProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [draft, setDraft] = useState<AppSettings>(settings);

  const openModal = () => {
    setDraft(settings);
    setShowSettings(true);
  };

  const handleSave = async () => {
    await onSaveSettings(draft);
    setShowSettings(false);
  };

  return (
    <>
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-800/90 bg-[#12151b] px-4 py-2.5">
        <div className="flex items-center gap-2 pr-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-600/20 text-rose-400 ring-1 ring-rose-500/30">
            <Scissors className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight text-zinc-100">
              YutupCutLoad
            </h1>
            <p className="text-[11px] text-zinc-400">Partial YouTube & VOD Clipper</p>
          </div>
        </div>

        <form
          className="flex min-w-[280px] flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onLoadVideo();
          }}
        >
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={url}
              onChange={(e) => onUrlChange(e.target.value)}
              placeholder="Paste URL YouTube atau livestream VOD (contoh: https://www.youtube.com/watch?v=...)"
              className="w-full rounded-lg border border-zinc-700/80 bg-[#0d0f12] py-2 pl-9 pr-3 text-sm text-zinc-100 placeholder-zinc-500 focus:border-rose-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || !url.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Memuat...
              </>
            ) : (
              "Muat Video"
            )}
          </button>
        </form>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRecheckEnv}
            title={
              envStatus
                ? `yt-dlp: ${envStatus.ytDlpPath ?? "tidak ada"}\nffmpeg: ${envStatus.ffmpegPath ?? "tidak ada"}`
                : "Cek binary"
            }
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-[#0d0f12] px-2.5 py-1.5 text-xs text-zinc-300 hover:border-zinc-700"
          >
            <StatusBadge
              label="yt-dlp"
              ok={Boolean(envStatus?.ytDlpFound)}
              detail={envStatus?.ytDlpVersion ?? undefined}
            />
            <span className="text-zinc-700">|</span>
            <StatusBadge
              label="ffmpeg"
              ok={Boolean(envStatus?.ffmpegFound)}
              detail={envStatus?.ffmpegVersion ? "OK" : undefined}
            />
            <RefreshCw className="h-3 w-3 text-zinc-500" />
          </button>

          <button
            type="button"
            onClick={openModal}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-[#181c24] px-3 py-1.5 text-xs font-medium text-zinc-200 hover:border-zinc-700 hover:bg-zinc-800"
          >
            <Settings className="h-3.5 w-3.5" />
            Pengaturan
          </button>
        </div>
      </header>

      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-xl rounded-xl border border-zinc-800 bg-[#14171d] shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
              <h2 className="text-sm font-semibold text-zinc-100">
                Pengaturan Lanjutan
              </h2>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="text-xs text-zinc-400 hover:text-zinc-200"
              >
                Tutup
              </button>
            </div>

            <div className="max-h-[75vh] space-y-4 overflow-y-auto p-5 text-xs">
              <div>
                <label className="mb-1.5 block font-medium text-zinc-300">
                  Template Nama File Output
                </label>
                <input
                  type="text"
                  value={draft.filenameTemplate}
                  onChange={(e) =>
                    setDraft({ ...draft, filenameTemplate: e.target.value })
                  }
                  className="w-full rounded-lg border border-zinc-700 bg-[#0d0f12] px-3 py-2 font-mono text-xs text-zinc-100 focus:border-rose-500 focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-zinc-500">
                  Variabel tersedia: {"{title}"}, {"{index}"}, {"{start}"}, {"{end}"},{" "}
                  {"{label}"}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block font-medium text-zinc-300">
                    Cookies / Autentikasi YouTube
                  </label>
                  <select
                    value={draft.cookiesSource}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        cookiesSource: e.target.value as CookiesSource,
                      })
                    }
                    className="w-full rounded-lg border border-zinc-700 bg-[#0d0f12] px-3 py-2 text-xs text-zinc-100 focus:border-rose-500 focus:outline-none"
                  >
                    <option value="none">Tanpa Cookies</option>
                    <option value="chrome">Browser: Chrome</option>
                    <option value="edge">Browser: Edge</option>
                    <option value="firefox">Browser: Firefox</option>
                    <option value="brave">Browser: Brave</option>
                    <option value="file">File cookies.txt</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block font-medium text-zinc-300">
                    Batas Unduhan Paralel
                  </label>
                  <select
                    value={draft.maxConcurrent}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        maxConcurrent: Number(e.target.value),
                      })
                    }
                    className="w-full rounded-lg border border-zinc-700 bg-[#0d0f12] px-3 py-2 text-xs text-zinc-100 focus:border-rose-500 focus:outline-none"
                  >
                    <option value={1}>1 proses sekaligus</option>
                    <option value={2}>2 proses paralel (Rekomendasi)</option>
                    <option value={3}>3 proses paralel</option>
                    <option value={4}>4 proses paralel</option>
                  </select>
                </div>
              </div>

              {draft.cookiesSource === "file" && (
                <div>
                  <label className="mb-1.5 block font-medium text-zinc-300">
                    Path File cookies.txt
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={draft.cookiesFile ?? ""}
                      onChange={(e) =>
                        setDraft({ ...draft, cookiesFile: e.target.value || null })
                      }
                      placeholder="C:\path\to\cookies.txt"
                      className="flex-1 rounded-lg border border-zinc-700 bg-[#0d0f12] px-3 py-2 text-xs text-zinc-100"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const chosen = await pickFilePath("Pilih File cookies.txt");
                        if (chosen) setDraft({ ...draft, cookiesFile: chosen });
                      }}
                      className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-200 hover:bg-zinc-700"
                    >
                      Pilih
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1.5 block font-medium text-zinc-300">
                  Custom Path yt-dlp.exe (opsional, kosongkan untuk auto-detect bin/)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={draft.customYtdlpPath ?? ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        customYtdlpPath: e.target.value || null,
                      })
                    }
                    placeholder={envStatus?.ytDlpPath ?? "Auto-detect"}
                    className="flex-1 rounded-lg border border-zinc-700 bg-[#0d0f12] px-3 py-2 text-xs text-zinc-100"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const chosen = await pickFilePath("Pilih yt-dlp.exe");
                      if (chosen) setDraft({ ...draft, customYtdlpPath: chosen });
                    }}
                    className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-200 hover:bg-zinc-700"
                  >
                    Pilih
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block font-medium text-zinc-300">
                  Custom Path ffmpeg.exe (opsional, kosongkan untuk auto-detect bin/)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={draft.customFfmpegPath ?? ""}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        customFfmpegPath: e.target.value || null,
                      })
                    }
                    placeholder={envStatus?.ffmpegPath ?? "Auto-detect"}
                    className="flex-1 rounded-lg border border-zinc-700 bg-[#0d0f12] px-3 py-2 text-xs text-zinc-100"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const chosen = await pickFilePath("Pilih ffmpeg.exe");
                      if (chosen) setDraft({ ...draft, customFfmpegPath: chosen });
                    }}
                    className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-200 hover:bg-zinc-700"
                  >
                    Pilih
                  </button>
                </div>
              </div>

              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-zinc-800 bg-[#0d0f12] p-3">
                <input
                  type="checkbox"
                  checked={draft.preferHlsForVod}
                  onChange={(e) =>
                    setDraft({ ...draft, preferHlsForVod: e.target.checked })
                  }
                  className="mt-0.5 accent-rose-500"
                />
                <span>
                  <span className="block font-medium text-zinc-200">
                    Prioritaskan protokol HLS (m3u8) jika tersedia
                  </span>
                  <span className="text-[11px] text-zinc-400">
                    Membantu seek pada VOD livestream yang baru selesai diproses YouTube.
                  </span>
                </span>
              </label>
            </div>

            <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="rounded-lg border border-zinc-700 px-3.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-rose-500"
              >
                Simpan Pengaturan
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function StatusBadge({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean;
  detail?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      {ok ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
      ) : (
        <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
      )}
      <span className={ok ? "text-zinc-200" : "text-amber-300"}>{label}</span>
      {detail && <span className="text-[10px] text-zinc-500">{detail}</span>}
    </span>
  );
}
