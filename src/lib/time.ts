export function formatTime(secs: number, showMs = false): string {
  if (!Number.isFinite(secs) || secs < 0) return "00:00:00";
  const totalMs = Math.round(secs * 1000);
  const ms = totalMs % 1000;
  const totalSecs = Math.floor(totalMs / 1000);
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const rem = totalSecs % 60;
  const base = `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
  if (showMs && ms > 0) {
    return `${base}.${String(ms).padStart(3, "0")}`;
  }
  return base;
}

export function parseTime(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("-")) return null;
  const parts = trimmed.split(":");
  if (parts.length === 1) {
    const s = Number(parts[0]);
    return Number.isFinite(s) && s >= 0 ? Math.round(s * 1000) / 1000 : null;
  }
  if (parts.length === 2) {
    const m = Number(parts[0]);
    const s = Number(parts[1]);
    if (!Number.isInteger(m) || m < 0 || m >= 60) return null;
    if (!Number.isFinite(s) || s < 0 || s >= 60) return null;
    return Math.round((m * 60 + s) * 1000) / 1000;
  }
  if (parts.length === 3) {
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    const s = Number(parts[2]);
    if (!Number.isInteger(h) || h < 0) return null;
    if (!Number.isInteger(m) || m < 0 || m >= 60) return null;
    if (!Number.isFinite(s) || s < 0 || s >= 60) return null;
    return Math.round((h * 3600 + m * 60 + s) * 1000) / 1000;
  }
  return null;
}

export function extractYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (host.endsWith("youtube.com")) {
      const v = url.searchParams.get("v");
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const parts = url.pathname.split("/").filter(Boolean);
      if (
        parts.length >= 2 &&
        (parts[0] === "live" || parts[0] === "shorts" || parts[0] === "embed")
      ) {
        return /^[a-zA-Z0-9_-]{11}$/.test(parts[1]) ? parts[1] : null;
      }
    }
  } catch {
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  }
  return null;
}

export function formatBytes(bytes: number | null): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(0)} KiB`;
  }
  return `${bytes} B`;
}
