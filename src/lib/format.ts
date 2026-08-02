export function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds)) return "—";
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds
        .toString()
        .padStart(2, "0")}`
    : `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${
    units[index]
  }`;
}

export function formatViewCount(
  count: number | null,
  locale = "es",
  viewsLabel = "visualizaciones",
): string {
  if (count == null || !Number.isFinite(count) || count < 0) return "";
  const compact = new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(count);
  return `${compact} ${viewsLabel}`;
}

export function parseTimeInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  const parts = trimmed.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  if (parts.some((part) => !/^\d+$/.test(part))) return null;
  const numbers = parts.map(Number);
  if (numbers.slice(1).some((section) => section > 59)) return null;
  return numbers.reduce((total, section) => total * 60 + section, 0);
}

export type DurationFilter = "all" | "short" | "medium" | "long";

export function matchesDurationFilter(
  duration: number | null,
  filter: DurationFilter,
): boolean {
  if (filter === "all") return true;
  if (duration == null || !Number.isFinite(duration)) return false;
  if (filter === "short") return duration < 240;
  if (filter === "medium") return duration >= 240 && duration <= 1800;
  return duration > 1800;
}

export function previewEmbedUrl(
  source: string,
  id: string,
  url: string,
): string | null {
  const normalized = source.toLowerCase();
  if (normalized.includes("youtube")) {
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1`;
  }
  if (normalized.includes("dailymotion")) {
    return `https://www.dailymotion.com/embed/video/${encodeURIComponent(id)}?autoplay=1`;
  }
  if (normalized.includes("soundcloud")) {
    return `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=true`;
  }
  return null;
}

export function sourceLabel(extractor: string): string {
  const normalized = extractor.toLowerCase();
  if (normalized.includes("youtube")) return "YouTube";
  if (normalized.includes("dailymotion")) return "Dailymotion";
  if (normalized.includes("vimeo")) return "Vimeo";
  if (normalized.includes("soundcloud")) return "SoundCloud";
  if (normalized.includes("tiktok")) return "TikTok";
  return extractor || "Sitio compatible";
}

export function qualityLabel(quality: string, kind: "video" | "audio"): string {
  if (quality === "best") return "Máxima";
  return kind === "video" ? `${quality}p` : `${quality} kbps`;
}
