/**
 * Theme values for code that can't use Tailwind classes — mainly Recharts
 * props (stroke, tick fill, tooltip style). Mirrors the @theme tokens in
 * index.css; change both together.
 */
export const T = {
  canvas: "#F3F3EF",
  surface: "#FFFFFF",
  line: "#E3E3DD",
  lineStrong: "#CFCFC8",
  grid: "#ECECE7",
  ink: "#17191C",
  ink2: "#454A52",
  ink3: "#646973",
  accent: "#0B4F5C",
  ok: "#15803D",
  warn: "#B45309",
  crit: "#B91C1C",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
} as const;

/** Shared Recharts styling so every chart reads the same. */
export const CHART = {
  grid: { stroke: T.grid, vertical: false },
  axis: {
    stroke: T.lineStrong,
    tick: { fill: T.ink3, fontSize: 11, fontFamily: T.mono },
    tickLine: false,
  },
  axisLabel: { fill: T.ink3, fontSize: 11 },
  tooltip: {
    contentStyle: {
      backgroundColor: T.surface,
      border: `1px solid ${T.line}`,
      borderRadius: 8,
      fontSize: 12,
      boxShadow: "0 4px 16px rgba(23,25,28,0.08)",
    },
    labelStyle: { color: T.ink, fontWeight: 600 },
    itemStyle: { padding: 0 },
  },
} as const;

/** Unit colors on the plant floor (A raw processing, B assembly, C finishing). */
export const UNIT_COLORS = { A: "#2563EB", B: "#B45309", C: "#7C3AED" } as const;

/** Round tick step (1, 2, 2.5, 5 × 10^n) giving roughly `count` intervals over `span`. */
function niceStep(span: number, count: number): number {
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((st) => st >= raw) ?? raw;
}

/**
 * Round-numbered ticks covering [lo, hi], expanded outward to whole steps.
 * Returns the ticks plus the matching axis domain so the two always agree.
 */
export function niceAxis(lo: number, hi: number, count = 5): { ticks: number[]; domain: [number, number] } {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { ticks: [], domain: [0, 1] };
  if (hi === lo) { hi = lo + 1; lo = lo - 1; }
  const step = niceStep(hi - lo, count);
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return { ticks, domain: [start, end] };
}
