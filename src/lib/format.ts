/** Time-ago + counts, tiny and dependency-free. */

export function timeAgo(ts: number, lang: "en" | "ar" = "en"): string {
  const diff = Date.now() - ts;
  const s = Math.max(1, Math.floor(diff / 1000));
  if (lang === "ar") {
    if (s < 60) return "الآن";
    const m = Math.floor(s / 60);
    if (m < 60) return `منذ ${m} د`;
    const h = Math.floor(m / 60);
    if (h < 24) return `منذ ${h} س`;
    const d = Math.floor(h / 24);
    if (d < 30) return `منذ ${d} يوم`;
    return new Date(ts).toLocaleDateString("ar");
  }
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return new Date(ts).toLocaleDateString();
}

export function fullDate(ts: number, lang: "en" | "ar" = "en"): string {
  return new Date(ts).toLocaleString(lang === "ar" ? "ar" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function counts(text: string): { chars: number; words: number } {
  const chars = [...text].length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return { chars, words };
}

export function preview(text: string, max = 160): string {
  const single = text.replace(/\s+/g, " ").trim();
  if (single.length <= max) return single;
  return single.slice(0, max - 1).trimEnd() + "…";
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
