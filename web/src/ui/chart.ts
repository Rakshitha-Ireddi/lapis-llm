/** Tiny canvas charts: crisp on HiDPI, theme-aware, no dependencies. */

export interface Series {
  label: string;
  values: number[];
  color: string;
}

function setup(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return null;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** A filled area sparkline. */
export function sparkline(canvas: HTMLCanvasElement, values: number[], color = cssVar("--ink") || "#18181b"): void {
  const s = setup(canvas);
  if (!s || values.length < 2) return;
  const { ctx, w, h } = s;
  const max = Math.max(...values) * 1.15 || 1;
  const x = (i: number) => (i / (values.length - 1)) * w;
  const y = (v: number) => h - 2 - (v / max) * (h - 6);

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, hexA(color, 0.45));
  grad.addColorStop(1, hexA(color, 0));
  ctx.beginPath();
  ctx.moveTo(0, h);
  values.forEach((v, i) => ctx.lineTo(x(i), y(v)));
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  values.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.shadowColor = hexA(color, 0.7);
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.shadowBlur = 0;

  const last = values[values.length - 1];
  ctx.beginPath();
  ctx.arc(x(values.length - 1) - 3, y(last), 3.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

/** Stacked area chart with a light grid and y-axis labels. */
export function stackedArea(canvas: HTMLCanvasElement, series: Series[], unit = "tok/s"): void {
  const s = setup(canvas);
  if (!s) return;
  const { ctx, w, h } = s;
  const n = Math.max(0, ...series.map((x) => x.values.length));
  if (n < 2) return;
  const padL = 44;
  const padB = 22;
  const padT = 18;
  const plotW = w - padL - 8;
  const plotH = h - padB - padT;
  const totals = Array.from({ length: n }, (_, i) => series.reduce((acc, x) => acc + (x.values[i] ?? 0), 0));
  const max = niceMax(Math.max(...totals) * 1.1);
  const x = (i: number) => padL + (i / (n - 1)) * plotW;
  const y = (v: number) => padT + plotH - (v / max) * plotH;

  const muted = cssVar("--muted") || "#888";
  const grid = cssVar("--glass-edge") || "rgba(128,128,128,.2)";
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.fillStyle = muted;
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  for (let k = 0; k <= 4; k++) {
    const v = (max / 4) * k;
    const yy = Math.round(y(v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(padL, yy);
    ctx.lineTo(w - 8, yy);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(`${Math.round(v)}`, padL - 8, yy);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(unit, padL + 6, padT + 12);
  ctx.fillText(`-${n}s`, padL, h - 4);
  ctx.textAlign = "right";
  ctx.fillText("now", w - 8, h - 4);

  const base = new Array<number>(n).fill(0);
  for (const s2 of series) {
    const top = base.map((b, i) => b + (s2.values[i] ?? 0));
    ctx.beginPath();
    top.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(x(i), y(base[i]));
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    grad.addColorStop(0, hexA(s2.color, 0.55));
    grad.addColorStop(1, hexA(s2.color, 0.12));
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    top.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.strokeStyle = s2.color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    top.forEach((v, i) => (base[i] = v));
  }
}

function niceMax(value: number): number {
  if (value <= 0) return 10;
  const exp = 10 ** Math.floor(Math.log10(value));
  const f = value / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

export function hexA(hex: string, alpha: number): string {
  const m = hex.replace("#", "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Greyscale series colours from the theme (--series), so charts follow light/dark. */
export function seriesColors(): string[] {
  const raw = cssVar("--series");
  const list = raw ? raw.split(",").map((c) => c.trim()).filter(Boolean) : [];
  return list.length ? list : ["#18181b", "#55555c", "#8a8a91", "#b4b4ba", "#36363c", "#a0a0a7"];
}
