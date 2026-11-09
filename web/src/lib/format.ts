/** Small, pure formatting helpers. */

export function gib(value: number, digits = 1): string {
  return `${value.toFixed(digits)} GiB`;
}

export function compact(value: number): string {
  if (!Number.isFinite(value)) return "–";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${trim(value / 1e9)}B`;
  if (abs >= 1e6) return `${trim(value / 1e6)}M`;
  if (abs >= 1e3) return `${trim(value / 1e3)}k`;
  return `${Math.round(value)}`;
}

function trim(value: number): string {
  return value >= 100 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "");
}

export function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.max(0, Math.min(100, (part / whole) * 100));
}

export function ago(epochSeconds: number | null, now = Date.now() / 1000): string {
  if (epochSeconds === null) return "never";
  const s = Math.max(0, Math.round(now - epochSeconds));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/^.*\//, "")
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape text for safe interpolation into HTML templates. */
export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

/** Average utilisation across a node's GPUs (not just the first card). */
export function avgUtil(gpus: { utilization: number }[]): number | null {
  if (gpus.length === 0) return null;
  return gpus.reduce((sum, g) => sum + g.utilization, 0) / gpus.length;
}
