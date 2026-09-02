/**
 * PlantVisualPanel.tsx
 * ─────────────────────────────────────────────────────────────────
 * Animated top-down plant floor visualization matching the real
 * ManuSim plant structure:
 *
 *   16 workareas in a 4×4 grid (IDs: 22,24,26,28 / 42..48 / 62..68 / 82..88)
 *   Each workarea has 3 unit types operating in parallel:
 *     Unit A — raw processing (material-quality dependent, 20 kW max)
 *     Unit B — assembly (safety-critical, accidents originate here)
 *     Unit C — finishing (temperature & wear dependent, 10 kW max)
 *
 *   Production is parallel across all workareas (no conveyor/sequential flow).
 *   totalRate is the aggregate rate across all 16 workareas (max ~16).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { SimKpiStep } from "../api";

// ─── types ────────────────────────────────────────────────────────
interface Props {
  kpiData: SimKpiStep[];
  agentName?: string;
  episode?: number;
  /** When true, auto-advance to the latest step as data grows (live streaming mode) */
  live?: boolean;
}

// ─── constants ────────────────────────────────────────────────────
const AGENT_COLORS: Record<string, string> = {
  mab: "#2dd4bf",
  linucb: "#818cf8",
  qlearning: "#f472b6",
  none: "#0D9488",
};

// ManuSim 4×4 workarea grid — IDs match the Java model (row*10 + col)
const WORKAREA_IDS = [
  [22, 24, 26, 28],
  [42, 44, 46, 48],
  [62, 64, 66, 68],
  [82, 84, 86, 88],
];

// Unit type colors and labels
const UNIT_A_COLOR = "#3b82f6"; // blue — raw processing
const UNIT_B_COLOR = "#f59e0b"; // amber — assembly / safety
const UNIT_C_COLOR = "#8b5cf6"; // violet — finishing / temp

// SVG layout for the 4×4 grid
const GRID = {
  ox: 80,  // origin x
  oy: 60,  // origin y
  cellW: 105,
  cellH: 72,
  gap: 8,
};

const PLAYBACK_SPEEDS = [0.5, 1, 2, 4];

// ─── helpers ──────────────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function qualityColor(q: number) {
  const r = Math.round(lerp(220, 34, q));
  const g = Math.round(lerp(38, 197, q));
  const b = Math.round(lerp(38, 94, q));
  return `rgb(${r},${g},${b})`;
}

function tempColor(t: number) {
  const pct = clamp((t - 10) / 20, 0, 1); // 10–30°C range from Const.java
  const r = Math.round(lerp(56, 245, pct));
  const g = Math.round(lerp(189, 158, pct));
  const b = Math.round(lerp(248, 11, pct));
  return `rgb(${r},${g},${b})`;
}

/** Per-workarea rate (totalRate / 16 workareas) */
function perAreaRate(totalRate: number) {
  return clamp(totalRate / 16, 0, 1);
}

// Must match engine reward.ts — Java's Const.NO_PARTS_WEAR_BREAKDOWN.
const WEAR_THRESHOLD = 4320;

/** Flat workarea order matching Java PlantModel: 22,24,26,28,42..48,62..68,82..88 */
const WORKAREA_FLAT = WORKAREA_IDS.flat();

/**
 * Per-workarea wear fraction [0..1] from wearByWorkarea data.
 * Returns a Map<workareaId, fraction> or empty map if no data.
 */
function wearByWorkareaMap(wear?: number[]): Map<number, number> {
  const m = new Map<number, number>();
  if (!wear || wear.length !== 16) return m;
  for (let i = 0; i < 16; i++) {
    m.set(WORKAREA_FLAT[i], clamp(wear[i] / WEAR_THRESHOLD, 0, 1));
  }
  return m;
}

/** Color for wear fraction: green → yellow → red */
function wearColor(frac: number): string {
  if (frac < 0.5) {
    const t = frac / 0.5;
    return `rgb(${Math.round(lerp(34, 234, t))},${Math.round(lerp(197, 179, t))},${Math.round(lerp(94, 8, t))})`;
  }
  const t = (frac - 0.5) / 0.5;
  return `rgb(${Math.round(lerp(234, 239, t))},${Math.round(lerp(179, 68, t))},${Math.round(lerp(8, 68, t))})`;
}

/** Workarea status for visual rendering */
type WorkareaStatus = "active" | "accident" | "failure" | "maintenance";

interface WorkareaStates {
  accidents: Set<number>;   // workareas with active accident
  failures: Set<number>;    // workareas that just entered failure (wear reset)
  maintenance: Set<number>; // workareas under maintenance (wear ~0 after prior high wear)
  failureCount: number;     // total failures detected up to this step
}

/**
 * Detect workarea states by comparing current and previous wear data.
 * - Accident: new accident delta + high-wear workareas or fallback heuristic
 * - Failure: wear was near threshold in prev step, now reset (dropped >90%)
 * - Maintenance: wear is 0 (or very low) but was previously high
 */
function detectWorkareaStates(
  currentAccidents: number,
  prevAccidents: number,
  wearMap: Map<number, number>,
  prevWearMap: Map<number, number>,
): WorkareaStates {
  const accidents = new Set<number>();
  const failures = new Set<number>();
  const maintenance = new Set<number>();
  let failureCount = 0;

  // Detect failures and maintenance from wear transitions
  for (const waId of WORKAREA_FLAT) {
    const currFrac = wearMap.get(waId) ?? 0;
    const prevFrac = prevWearMap.get(waId) ?? 0;

    // Failure transition: was near threshold, now reset
    if (prevFrac > 0.95 && currFrac < prevFrac * 0.1) {
      failures.add(waId);
      failureCount++;
    }
    // Maintenance: wear is very low but was significant recently
    // (heuristic: prevFrac was moderate-high and currFrac dropped to ~0)
    else if (prevFrac > 0.5 && currFrac < 0.05 && currFrac < prevFrac * 0.1) {
      maintenance.add(waId);
    }
  }

  // Detect accidents (same logic as before, but excluding failure/maintenance workareas)
  const newAccidents = currentAccidents - prevAccidents;
  if (newAccidents > 0 || currentAccidents > 0) {
    for (const [waId, frac] of wearMap) {
      if (frac >= 0.95 && !failures.has(waId)) accidents.add(waId);
    }
    if (accidents.size === 0 && newAccidents > 0) {
      const order = [28, 82, 88, 22, 48, 62, 68, 42, 26, 84, 86, 24, 46, 64, 66, 44];
      for (let i = 0; i < Math.min(newAccidents, order.length); i++) {
        const waId = order[i];
        if (!failures.has(waId) && !maintenance.has(waId)) accidents.add(waId);
      }
    }
  }

  return { accidents, failures, maintenance, failureCount };
}

/** Get the visual status of a single workarea */
function getWorkareaStatus(
  waId: number,
  states: WorkareaStates,
): WorkareaStatus {
  if (states.failures.has(waId)) return "failure";
  if (states.maintenance.has(waId)) return "maintenance";
  if (states.accidents.has(waId)) return "accident";
  return "active";
}

/** Border color based on workarea status */
function statusBorderColor(status: WorkareaStatus): string {
  switch (status) {
    case "failure":     return "#7f1d1d"; // dark red
    case "maintenance": return "#92400e"; // dark amber
    case "accident":    return "#dc2626"; // bright red
    case "active":      return "#1e3a5f"; // normal blue
  }
}

/** Background color based on workarea status */
function statusBgColor(status: WorkareaStatus): string {
  switch (status) {
    case "failure":     return "#2a0f0f";
    case "maintenance": return "#271a0a";
    case "accident":    return "#2a1215";
    case "active":      return "#0f1f35";
  }
}

// ─── sub-components ───────────────────────────────────────────────

/** 3 small unit indicators inside a workarea (A, B, C) */
function UnitIndicators({
  x,
  y,
  w,
  rate,
  hasAccident,
}: {
  x: number;
  y: number;
  w: number;
  rate: number;
  hasAccident: boolean;
}) {
  const unitW = (w - 8) / 3;
  const barH = 4;
  const units = [
    { label: "A", color: UNIT_A_COLOR, fill: rate },
    { label: "B", color: hasAccident ? "#ef4444" : UNIT_B_COLOR, fill: hasAccident ? 0 : rate },
    { label: "C", color: UNIT_C_COLOR, fill: rate },
  ];

  return (
    <g>
      {units.map((u, i) => {
        const ux = x + 4 + i * (unitW + 2);
        return (
          <g key={u.label}>
            <text
              x={ux + unitW / 2}
              y={y}
              textAnchor="middle"
              fontSize={6}
              fill={u.color}
              fontFamily="monospace"
              opacity={0.8}
            >
              {u.label}
            </text>
            {/* rate bar background */}
            <rect
              x={ux}
              y={y + 2}
              width={unitW}
              height={barH}
              rx={1}
              fill="#0f172a"
            />
            {/* rate bar fill */}
            <rect
              x={ux}
              y={y + 2}
              width={u.fill * unitW}
              height={barH}
              rx={1}
              fill={u.color}
              opacity={0.7}
            />
          </g>
        );
      })}
    </g>
  );
}

/** Pulsing activity ring for active workareas */
function ActivityPulse({
  cx,
  cy,
  r,
  color,
}: {
  cx: number;
  cy: number;
  r: number;
  color: string;
}) {
  return (
    <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={1} opacity={0}>
      <animate
        attributeName="r"
        values={`${r};${r + 4};${r}`}
        dur="2s"
        repeatCount="indefinite"
      />
      <animate
        attributeName="opacity"
        values="0.5;0;0.5"
        dur="2s"
        repeatCount="indefinite"
      />
    </circle>
  );
}

// ─── main component ───────────────────────────────────────────────
export function PlantVisualPanel({
  kpiData,
  agentName = "none",
  episode,
  live = false,
}: Props) {
  const agentColor = AGENT_COLORS[agentName] ?? "#0D9488";
  const totalSteps = kpiData.length;

  // Playback state
  const [currentIdx, setCurrentIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const step = kpiData[live ? totalSteps - 1 : currentIdx];

  // In live mode, always show the latest step
  useEffect(() => {
    if (live) {
      setCurrentIdx(totalSteps - 1);
    }
  }, [live, totalSteps]);

  useEffect(() => {
    if (live) return; // don't reset in live mode
    setCurrentIdx(0);
    setPlaying(false);
  }, [kpiData, live]);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (!playing) return;

    const ms = Math.round(200 / PLAYBACK_SPEEDS[speedIdx]);
    intervalRef.current = setInterval(() => {
      setCurrentIdx((prev) => {
        if (prev >= totalSteps - 1) {
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, ms);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [playing, speedIdx, totalSteps]);

  const togglePlay = useCallback(() => setPlaying((p) => !p), []);
  const stepBack = useCallback(() => setCurrentIdx((i) => Math.max(0, i - 1)), []);
  const stepForward = useCallback(
    () => setCurrentIdx((i) => Math.min(totalSteps - 1, i + 1)),
    [totalSteps],
  );
  const cycleSpeed = useCallback(
    () => setSpeedIdx((i) => (i + 1) % PLAYBACK_SPEEDS.length),
    [],
  );

  if (!step) return null;

  // Derived values
  const areaRate = perAreaRate(step.totalRate);
  const prevStep = currentIdx > 0 ? kpiData[currentIdx - 1] : undefined;
  const wearMap = wearByWorkareaMap(step.wearByWorkarea);
  const prevWearMap = wearByWorkareaMap(prevStep?.wearByWorkarea);
  const waStates = detectWorkareaStates(
    step.numberAccidents,
    prevStep?.numberAccidents ?? 0,
    wearMap,
    prevWearMap,
  );
  // Accumulate total failures across all steps up to current
  const cumulativeFailures = (() => {
    let total = 0;
    for (let s = 1; s <= currentIdx; s++) {
      const curr = wearByWorkareaMap(kpiData[s]?.wearByWorkarea);
      const prev = wearByWorkareaMap(kpiData[s - 1]?.wearByWorkarea);
      for (const waId of WORKAREA_FLAT) {
        const cF = curr.get(waId) ?? 0;
        const pF = prev.get(waId) ?? 0;
        if (pF > 0.95 && cF < pF * 0.1) total++;
      }
    }
    return total;
  })();
  const stepPct = clamp((currentIdx / Math.max(totalSteps - 1, 1)) * 100, 0, 100);

  // Power estimate: each area has A(20kW) + B(10kW) + C(10kW) = 40kW max × 16 areas × rate
  const estimatedPowerKW = step.currPower / 1000;

  return (
    <div className="rounded-xl border border-gray-800 bg-[#0f172a] p-4 font-mono text-gray-200">
      {/* ── header ── */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: agentColor, boxShadow: `0 0 8px ${agentColor}` }}
          />
          <span className="text-[13px] font-semibold tracking-wide text-gray-100">
            PLANT FLOOR
          </span>
          <span className="text-[10px] text-gray-500">4×4 · 16 WORKAREAS · 48 UNITS</span>
          {agentName !== "none" && (
            <span
              className="rounded border px-2 py-0.5 text-[11px]"
              style={{ borderColor: `${agentColor}44`, color: agentColor, background: "#1e293b" }}
            >
              {agentName.toUpperCase()}
            </span>
          )}
        </div>
        <div className="flex gap-4 text-[11px] text-gray-500">
          {episode !== undefined && <span>EP {episode}</span>}
          <span>
            STEP <span className="text-gray-400">{step.step}</span>/{totalSteps}
          </span>
          {step.clock && <span className="text-gray-400">{step.clock}</span>}
        </div>
      </div>

      {/* ── playback progress bar ── */}
      <div className="mb-1 h-[3px] overflow-hidden rounded bg-gray-800">
        <div
          className="h-full rounded transition-[width] duration-100 ease-linear"
          style={{
            width: `${stepPct}%`,
            background: `linear-gradient(90deg, ${agentColor}88, ${agentColor})`,
          }}
        />
      </div>

      {/* ── playback controls ── */}
      <div className="mb-3 flex items-center gap-3">
        <button
          onClick={stepBack}
          disabled={currentIdx === 0}
          className="rounded px-1.5 py-0.5 text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-200 disabled:opacity-30"
        >
          ⏮
        </button>
        <button
          onClick={togglePlay}
          className="rounded px-2 py-0.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-white"
        >
          {playing ? "⏸" : "▶"}
        </button>
        <button
          onClick={stepForward}
          disabled={currentIdx >= totalSteps - 1}
          className="rounded px-1.5 py-0.5 text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-200 disabled:opacity-30"
        >
          ⏭
        </button>
        <button
          onClick={cycleSpeed}
          className="rounded border border-gray-700 px-2 py-0.5 text-[10px] text-gray-400 hover:border-gray-500 hover:text-gray-200"
        >
          {PLAYBACK_SPEEDS[speedIdx]}x
        </button>
        <input
          type="range"
          min={0}
          max={totalSteps - 1}
          value={currentIdx}
          onChange={(e) => setCurrentIdx(Number(e.target.value))}
          className="h-1 flex-1 cursor-pointer appearance-none rounded bg-gray-700 accent-teal-500"
        />
      </div>

      {/* ── SVG plant floor ── */}
      <svg
        viewBox="0 0 580 480"
        className="block w-full rounded-lg"
        style={{ background: "#0a1628" }}
      >
        {/* ambient temperature overlay */}
        <rect x={0} y={0} width={580} height={440} fill={tempColor(step.ambTemperature)} opacity={0.03} />

        {/* plant boundary */}
        <rect
          x={GRID.ox - 20}
          y={GRID.oy - 20}
          width={4 * (GRID.cellW + GRID.gap) - GRID.gap + 40}
          height={4 * (GRID.cellH + GRID.gap) - GRID.gap + 40}
          rx={8}
          fill="none"
          stroke="#334155"
          strokeWidth={1}
          strokeDasharray="6 3"
        />
        <text x={GRID.ox - 16} y={GRID.oy - 26} fill="#475569" fontSize={9} fontFamily="monospace">
          MANUFACTURING PLANT —  16 WORKAREAS
        </text>

        {/* ── raw material input (left) ── */}
        <g>
          <rect x={8} y={GRID.oy + 60} width={44} height={56} rx={5} fill="#1e293b" stroke="#334155" strokeWidth={1} />
          <text x={30} y={GRID.oy + 75} textAnchor="middle" fontSize={7} fill="#94a3b8" fontFamily="monospace">RAW</text>
          <text x={30} y={GRID.oy + 84} textAnchor="middle" fontSize={7} fill="#94a3b8" fontFamily="monospace">MAT.</text>
          <rect x={14} y={GRID.oy + 90} width={32} height={5} rx={2} fill="#0f172a" />
          <rect
            x={14}
            y={GRID.oy + 90}
            width={step.rawMaterialQuality * 32}
            height={5}
            rx={2}
            fill={qualityColor(step.rawMaterialQuality)}
          />
          <text
            x={30}
            y={GRID.oy + 107}
            textAnchor="middle"
            fontSize={7}
            fill={qualityColor(step.rawMaterialQuality)}
            fontFamily="monospace"
          >
            {(step.rawMaterialQuality * 100).toFixed(0)}%
          </text>
          {/* arrows into plant rows */}
          {[0, 1, 2, 3].map((row) => {
            const cy = GRID.oy + row * (GRID.cellH + GRID.gap) + GRID.cellH / 2;
            return (
              <line key={row} x1={52} y1={cy} x2={GRID.ox - 22} y2={cy} stroke="#334155" strokeWidth={1} strokeDasharray="3 2" markerEnd="url(#arr)" />
            );
          })}
        </g>

        {/* ── output (right) ── */}
        <g>
          <rect x={528} y={GRID.oy + 60} width={44} height={56} rx={5} fill="#1e293b" stroke="#334155" strokeWidth={1} />
          <text x={550} y={GRID.oy + 75} textAnchor="middle" fontSize={7} fill="#94a3b8" fontFamily="monospace">OUTPUT</text>
          <text x={550} y={GRID.oy + 88} textAnchor="middle" fontSize={9} fill="#22c55e" fontFamily="monospace">{Math.round(step.cumProduction)}</text>
          <text x={550} y={GRID.oy + 98} textAnchor="middle" fontSize={6} fill="#475569" fontFamily="monospace">parts</text>
          {/* arrows from plant rows */}
          {[0, 1, 2, 3].map((row) => {
            const cy = GRID.oy + row * (GRID.cellH + GRID.gap) + GRID.cellH / 2;
            const rightEdge = GRID.ox + 4 * (GRID.cellW + GRID.gap) - GRID.gap + 20;
            return (
              <line key={row} x1={526} y1={cy} x2={rightEdge} y2={cy} stroke="#334155" strokeWidth={1} strokeDasharray="3 2" markerEnd="url(#arr)" />
            );
          })}
        </g>

        {/* ── 4×4 workarea grid ── */}
        {WORKAREA_IDS.map((row, ri) =>
          row.map((waId, ci) => {
            const x = GRID.ox + ci * (GRID.cellW + GRID.gap);
            const y = GRID.oy + ri * (GRID.cellH + GRID.gap);
            const cx = x + GRID.cellW / 2;
            const cy = y + GRID.cellH / 2;
            const status = getWorkareaStatus(waId, waStates);
            const isDown = status !== "active";
            const wearFrac = wearMap.get(waId) ?? 0;
            const borderCol = statusBorderColor(status);
            const bgCol = statusBgColor(status);

            return (
              <g key={waId}>
                {/* workarea background */}
                <rect
                  x={x}
                  y={y}
                  width={GRID.cellW}
                  height={GRID.cellH}
                  rx={5}
                  fill={bgCol}
                  stroke={borderCol}
                  strokeWidth={isDown ? 1.5 : 1}
                />

                {/* pulse for accident or failure */}
                {(status === "accident" || status === "failure") && (
                  <rect x={x} y={y} width={GRID.cellW} height={GRID.cellH} rx={5} fill="none"
                    stroke={status === "failure" ? "#991b1b" : "#ef4444"}
                    strokeWidth={2} opacity={0}>
                    <animate attributeName="opacity" values="0;0.5;0"
                      dur={status === "failure" ? "0.8s" : "1.4s"} repeatCount="indefinite" />
                  </rect>
                )}

                {/* workarea ID label */}
                <text
                  x={x + 6}
                  y={y + 11}
                  fontSize={8}
                  fill={status === "failure" ? "#fca5a5"
                      : status === "maintenance" ? "#fbbf24"
                      : status === "accident" ? "#fca5a5"
                      : "#60a5fa"}
                  fontFamily="monospace"
                  fontWeight={600}
                >
                  WA-{waId}
                </text>

                {/* wear bar (Unit C degradation) */}
                {wearFrac > 0 && (
                  <g>
                    <rect x={x + 42} y={y + 4} width={GRID.cellW - 52} height={4} rx={1.5} fill="#0f172a" />
                    <rect
                      x={x + 42}
                      y={y + 4}
                      width={wearFrac * (GRID.cellW - 52)}
                      height={4}
                      rx={1.5}
                      fill={wearColor(wearFrac)}
                      opacity={0.85}
                    />
                    <text x={x + GRID.cellW - 16} y={y + 8} textAnchor="end" fontSize={5} fill="#64748b" fontFamily="monospace">
                      {(wearFrac * 100).toFixed(0)}%
                    </text>
                  </g>
                )}

                {/* status dot */}
                <circle cx={x + GRID.cellW - 8} cy={y + 8} r={3}
                  fill={status === "failure" ? "#991b1b"
                      : status === "maintenance" ? "#d97706"
                      : status === "accident" ? "#ef4444"
                      : wearFrac >= 0.95 ? "#f59e0b"
                      : "#22c55e"}>
                  {status === "active" && (
                    <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />
                  )}
                </circle>

                {/* activity pulse when producing */}
                {status === "active" && areaRate > 0.1 && (
                  <ActivityPulse cx={cx} cy={cy - 2} r={8} color={agentColor} />
                )}

                {/* production rate indicator — spinning gear, wrench (maint), or status icon */}
                {status === "active" ? (
                  <g>
                    <g>
                      <animateTransform
                        attributeName="transform"
                        type="rotate"
                        from={`0 ${cx} ${cy - 4}`}
                        to={`360 ${cx} ${cy - 4}`}
                        dur={`${lerp(5, 1, areaRate)}s`}
                        repeatCount="indefinite"
                      />
                      <circle cx={cx} cy={cy - 4} r={8} fill="none" stroke="#475569" strokeWidth={1.5} />
                      {[0, 1, 2, 3].map((i) => {
                        const a = (i * Math.PI) / 2;
                        return (
                          <line
                            key={i}
                            x1={cx + Math.cos(a) * 6}
                            y1={cy - 4 + Math.sin(a) * 6}
                            x2={cx + Math.cos(a) * 11}
                            y2={cy - 4 + Math.sin(a) * 11}
                            stroke="#475569"
                            strokeWidth={2}
                            strokeLinecap="round"
                          />
                        );
                      })}
                    </g>
                  </g>
                ) : status === "maintenance" ? (
                  /* wrench icon for maintenance */
                  <text
                    x={cx}
                    y={cy - 1}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={12}
                    fill="#d97706"
                  >
                    {"\u{1F527}"}
                  </text>
                ) : status === "failure" ? (
                  /* broken gear for failure */
                  <text
                    x={cx}
                    y={cy - 1}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={12}
                    fill="#991b1b"
                  >
                    {"\u{2699}"}
                  </text>
                ) : (
                  /* warning for accident */
                  <text
                    x={cx}
                    y={cy - 1}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={14}
                    fill="#f59e0b"
                  >
                    {"\u26A0"}
                  </text>
                )}

                {/* status label for non-active workareas */}
                {status !== "active" && (
                  <text
                    x={cx}
                    y={y + GRID.cellH - 20}
                    textAnchor="middle"
                    fontSize={6}
                    fontFamily="monospace"
                    fontWeight={600}
                    fill={status === "failure" ? "#fca5a5"
                        : status === "maintenance" ? "#fbbf24"
                        : "#fca5a5"}
                  >
                    {status === "failure" ? "FAILURE"
                      : status === "maintenance" ? "MAINT"
                      : "ACCIDENT"}
                  </text>
                )}

                {/* unit A/B/C indicators at bottom */}
                <UnitIndicators
                  x={x}
                  y={y + GRID.cellH - 16}
                  w={GRID.cellW}
                  rate={isDown ? 0 : areaRate}
                  hasAccident={status === "accident"}
                />
              </g>
            );
          }),
        )}

        {/* ── environment badges (top right) ── */}
        <g>
          {/* temperature */}
          <rect x={GRID.ox + 4 * (GRID.cellW + GRID.gap) + 4} y={GRID.oy - 18} width={40} height={26} rx={4}
            fill={tempColor(step.ambTemperature)} opacity={0.2} />
          <rect x={GRID.ox + 4 * (GRID.cellW + GRID.gap) + 4} y={GRID.oy - 18} width={40} height={26} rx={4}
            fill="none" stroke={tempColor(step.ambTemperature)} strokeWidth={1} opacity={0.5} />
          <text
            x={GRID.ox + 4 * (GRID.cellW + GRID.gap) + 24}
            y={GRID.oy - 10}
            textAnchor="middle"
            fontSize={6}
            fill={tempColor(step.ambTemperature)}
            fontFamily="monospace"
          >
            TEMP
          </text>
          <text
            x={GRID.ox + 4 * (GRID.cellW + GRID.gap) + 24}
            y={GRID.oy + 2}
            textAnchor="middle"
            fontSize={9}
            fill={tempColor(step.ambTemperature)}
            fontFamily="monospace"
            fontWeight={600}
          >
            {step.ambTemperature.toFixed(1)}°
          </text>
        </g>

        {/* ── accident & failure counters (top left) ── */}
        {(step.numberAccidents > 0 || cumulativeFailures > 0) && (
          <g>
            <rect x={GRID.ox - 18} y={GRID.oy - 18}
              width={cumulativeFailures > 0 ? 96 : 46} height={16} rx={3}
              fill="#450a0a" stroke="#dc2626" strokeWidth={1} />
            <text x={GRID.ox + 5} y={GRID.oy - 7} textAnchor="middle" fontSize={7} fill="#fca5a5" fontFamily="monospace">
              ACCID: {step.numberAccidents}
            </text>
            {cumulativeFailures > 0 && (
              <text x={GRID.ox + 55} y={GRID.oy - 7} textAnchor="middle" fontSize={7} fill="#fbbf24" fontFamily="monospace">
                FAIL: {cumulativeFailures}
              </text>
            )}
          </g>
        )}

        {/* ── controller (bottom center) ── */}
        <g>
          <rect
            x={180}
            y={GRID.oy + 4 * (GRID.cellH + GRID.gap) + 50}
            width={220}
            height={30}
            rx={5}
            fill="#0f1f3d"
            stroke={agentColor}
            strokeWidth={1.5}
          />
          <text
            x={290}
            y={GRID.oy + 4 * (GRID.cellH + GRID.gap) + 62}
            textAnchor="middle"
            fontSize={8}
            fill={agentColor}
            fontFamily="monospace"
            fontWeight={600}
          >
            {agentName !== "none" ? "AGENT CONTROLLER" : "SETPOINT CONTROLLER"}
          </text>
          <text
            x={290}
            y={GRID.oy + 4 * (GRID.cellH + GRID.gap) + 73}
            textAnchor="middle"
            fontSize={7}
            fill="#94a3b8"
            fontFamily="monospace"
          >
            {agentName !== "none"
              ? `${agentName.toUpperCase()} · setpoint→ ${step.setpointRate.toFixed(2)}`
              : `setpoint→ ${step.setpointRate.toFixed(2)}`}
          </text>
          {/* dashed line up to plant */}
          <line
            x1={290}
            y1={GRID.oy + 4 * (GRID.cellH + GRID.gap) + 50}
            x2={290}
            y2={GRID.oy + 4 * (GRID.cellH + GRID.gap) + 2}
            stroke={agentColor}
            strokeWidth={1}
            strokeDasharray="3 2"
            opacity={0.5}
          />
        </g>

        {/* ── bottom left: rate + power meters ── */}
        <g>
          <text x={GRID.ox - 18} y={GRID.oy + 4 * (GRID.cellH + GRID.gap) + 18} fontSize={7} fill="#64748b" fontFamily="monospace">RATE</text>
          <rect x={GRID.ox - 18} y={GRID.oy + 4 * (GRID.cellH + GRID.gap) + 22} width={80} height={6} rx={2} fill="#1e293b" />
          <rect
            x={GRID.ox - 18}
            y={GRID.oy + 4 * (GRID.cellH + GRID.gap) + 22}
            width={perAreaRate(step.totalRate) * 80}
            height={6}
            rx={2}
            fill={agentColor}
            opacity={0.8}
          />
          <text
            x={GRID.ox + 66}
            y={GRID.oy + 4 * (GRID.cellH + GRID.gap) + 28}
            fontSize={7}
            fill={agentColor}
            fontFamily="monospace"
          >
            {step.totalRate.toFixed(1)}
          </text>
        </g>

        {/* ── bottom right: energy + power ── */}
        <g>
          <text
            x={GRID.ox + 4 * (GRID.cellW + GRID.gap) - 10}
            y={GRID.oy + 4 * (GRID.cellH + GRID.gap) + 18}
            textAnchor="end"
            fontSize={7}
            fill="#64748b"
            fontFamily="monospace"
          >
            ENERGY {Math.round(step.cumEnergy)} kWh
          </text>
          <text
            x={GRID.ox + 4 * (GRID.cellW + GRID.gap) - 10}
            y={GRID.oy + 4 * (GRID.cellH + GRID.gap) + 28}
            textAnchor="end"
            fontSize={7}
            fill="#a78bfa"
            fontFamily="monospace"
          >
            POWER {estimatedPowerKW.toFixed(0)} kW
          </text>
        </g>

        {/* ── unit type legend ── */}
        <g>
          {[
            { label: "A: Raw Processing", color: UNIT_A_COLOR },
            { label: "B: Assembly", color: UNIT_B_COLOR },
            { label: "C: Finishing", color: UNIT_C_COLOR },
          ].map((u, i) => (
            <g key={u.label}>
              <rect x={GRID.ox - 18 + i * 150} y={GRID.oy + 4 * (GRID.cellH + GRID.gap) + 36} width={6} height={6} rx={1} fill={u.color} opacity={0.7} />
              <text
                x={GRID.ox - 8 + i * 150}
                y={GRID.oy + 4 * (GRID.cellH + GRID.gap) + 42}
                fontSize={6}
                fill="#64748b"
                fontFamily="monospace"
              >
                {u.label}
              </text>
            </g>
          ))}
        </g>

        {/* defs */}
        <defs>
          <marker id="arr" viewBox="0 0 10 10" refX={8} refY={5} markerWidth={4} markerHeight={4} orient="auto">
            <path d="M2 1L8 5L2 9" fill="none" stroke="#475569" strokeWidth={2} strokeLinecap="round" />
          </marker>
        </defs>
      </svg>

      {/* ── KPI stat row ── */}
      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-7">
        {[
          { label: "Production", value: Math.round(step.cumProduction), unit: "parts", color: "#22c55e" },
          { label: "Rate", value: step.totalRate.toFixed(1), unit: "/16 max", color: agentColor },
          { label: "Energy", value: Math.round(step.cumEnergy), unit: "kWh", color: "#a78bfa" },
          { label: "Power", value: estimatedPowerKW.toFixed(0), unit: "kW", color: "#3b82f6" },
          { label: "Cost", value: step.cumCost.toFixed(1), unit: "EUR", color: "#f59e0b" },
          { label: "Accidents", value: step.numberAccidents, unit: "", color: step.numberAccidents > 0 ? "#ef4444" : "#22c55e" },
          { label: "Failures", value: cumulativeFailures, unit: "wear", color: cumulativeFailures > 0 ? "#d97706" : "#22c55e" },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5">
            <div className="text-[9px] text-gray-500">{s.label.toUpperCase()}</div>
            <div className="text-base font-bold leading-tight" style={{ color: s.color }}>
              {s.value}
            </div>
            {s.unit && <div className="mt-0.5 text-[8px] text-gray-600">{s.unit}</div>}
          </div>
        ))}
      </div>

      {/* ── material quality + temp bar ── */}
      <div className="mt-2 flex items-center gap-2.5">
        <span className="min-w-[80px] text-[10px] text-gray-600">MAT. QUALITY</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded bg-gray-800">
          <div
            className="h-full rounded transition-[width,background] duration-300 ease-out"
            style={{
              width: `${step.rawMaterialQuality * 100}%`,
              background: qualityColor(step.rawMaterialQuality),
            }}
          />
        </div>
        <span className="min-w-[32px] text-[10px]" style={{ color: qualityColor(step.rawMaterialQuality) }}>
          {(step.rawMaterialQuality * 100).toFixed(0)}%
        </span>
        <span className="min-w-[36px] text-[10px] text-gray-600">TEMP</span>
        <span className="text-[10px]" style={{ color: tempColor(step.ambTemperature) }}>
          {step.ambTemperature.toFixed(1)}°C
        </span>
      </div>
    </div>
  );
}
