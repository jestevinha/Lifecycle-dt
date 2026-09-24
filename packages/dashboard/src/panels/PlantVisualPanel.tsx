/**
 * PlantVisualPanel.tsx
 * ─────────────────────────────────────────────────────────────────
 * Top-down plant floor matching the real ManuSim plant structure:
 *
 *   16 workareas in a 4×4 grid (IDs: 22,24,26,28 / 42..48 / 62..68 / 82..88)
 *   Each workarea has 3 unit types operating in parallel:
 *     Unit A — raw processing (material-quality dependent, 20 kW max)
 *     Unit B — assembly (safety-critical, accidents originate here)
 *     Unit C — finishing (temperature & wear dependent, 10 kW max)
 *
 *   Production is parallel across all workareas (no conveyor/sequential flow).
 *   totalRate is the aggregate rate across all 16 workareas (max ~16).
 *
 * Each workarea is a card showing its status, wear against the failure
 * threshold, and A/B/C unit activity. Replays a stored episode with playback
 * controls, or follows the newest step when `live`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { SimKpiStep } from "../api";
import { AGENT_COLORS, AGENT_LABELS } from "../api";
import { T, UNIT_COLORS } from "../theme";

// ─── types ────────────────────────────────────────────────────────
interface Props {
  kpiData: SimKpiStep[];
  agentName?: string;
  episode?: number;
  /** When true, auto-advance to the latest step as data grows (live streaming mode) */
  live?: boolean;
  /** Show the step KPI strip under the floor (off when the page shows KPIs elsewhere). */
  showStats?: boolean;
  /** Smaller cells for narrow cards. */
  compact?: boolean;
}

// ─── constants ────────────────────────────────────────────────────
// ManuSim 4×4 workarea grid — IDs match the Java model (row*10 + col)
const WORKAREA_IDS = [
  [22, 24, 26, 28],
  [42, 44, 46, 48],
  [62, 64, 66, 68],
  [82, 84, 86, 88],
];

const PLAYBACK_SPEEDS = [0.5, 1, 2, 4];

// ─── helpers ──────────────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
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

/** Number of wear-reset failures between consecutive steps (same rule as detectWorkareaStates). */
function failuresBetween(prev: Map<number, number>, curr: Map<number, number>): number {
  let n = 0;
  for (const waId of WORKAREA_FLAT) {
    const cF = curr.get(waId) ?? 0;
    const pF = prev.get(waId) ?? 0;
    if (pF > 0.95 && cF < pF * 0.1) n++;
  }
  return n;
}

const STATUS_META: Record<WorkareaStatus | "idle", { label: string; text: string; box: string }> = {
  active: { label: "Running", text: "text-ink-2", box: "border-line bg-surface" },
  idle: { label: "Idle", text: "text-ink-3", box: "border-line bg-canvas" },
  maintenance: { label: "Maintenance", text: "text-warn", box: "border-warn/40 bg-warn-soft" },
  failure: { label: "Failure", text: "text-crit", box: "border-crit/50 bg-crit-soft" },
  accident: { label: "Accident", text: "text-crit", box: "border-crit bg-crit-soft" },
};

function wearBarColor(frac: number): string {
  if (frac >= 0.95) return T.crit;
  if (frac >= 0.5) return T.warn;
  return "#2F6F68";
}

// ─── sub-components ───────────────────────────────────────────────
function IconButton({ label, onClick, disabled, children }: {
  label: string; onClick: () => void; disabled?: boolean; children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line-strong bg-surface text-ink transition-colors hover:border-ink-3 disabled:opacity-40"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}

function WorkareaCard({
  waId, status, wearFrac, hasWear, rate, compact,
}: {
  waId: number; status: WorkareaStatus | "idle"; wearFrac: number; hasWear: boolean; rate: number; compact: boolean;
}) {
  const meta = STATUS_META[status];
  const down = status === "maintenance" || status === "failure";
  const units = [
    { key: "A", color: UNIT_COLORS.A, fill: down ? 0 : rate },
    { key: "B", color: status === "accident" ? T.crit : UNIT_COLORS.B, fill: down || status === "accident" ? 0 : rate },
    { key: "C", color: UNIT_COLORS.C, fill: down ? 0 : rate },
  ];
  return (
    <div className={`flex min-w-0 flex-col rounded-lg border ${meta.box} ${compact ? "gap-2 px-2.5 py-2" : "gap-2.5 px-3.5 py-3"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`font-bold text-ink ${compact ? "text-xs" : "text-[13px]"}`}>WA {waId}</span>
        <span className={`truncate text-[11px] font-semibold ${meta.text}`}>{meta.label}</span>
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between text-[11px] text-ink-3">
          <span>Wear</span>
          <span className="tabular font-mono font-semibold text-ink">
            {hasWear ? `${(wearFrac * 100).toFixed(compact ? 0 : 1)}%` : "—"}
          </span>
        </div>
        <div className="relative h-1.5 overflow-hidden rounded-full bg-grid">
          <div className="h-full rounded-full" style={{ width: `${wearFrac * 100}%`, backgroundColor: wearBarColor(wearFrac) }} />
          <div className="absolute inset-y-0 w-px bg-crit/60" style={{ left: "95%" }} />
        </div>
      </div>
      {!compact && (
        <div className="flex gap-2">
          {units.map((u) => (
            <div key={u.key} className="flex flex-1 flex-col gap-1">
              <span className="text-[10px] text-ink-3">{u.key}</span>
              <div className="h-1.5 overflow-hidden rounded-full bg-grid">
                <div className="h-full rounded-full transition-[width] duration-150" style={{ width: `${u.fill * 100}%`, backgroundColor: u.color }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────
export function PlantVisualPanel({
  kpiData,
  agentName = "none",
  episode,
  live = false,
  showStats = true,
  compact = false,
}: Props) {
  const agentColor = AGENT_COLORS[agentName] ?? T.accent;
  const totalSteps = kpiData.length;

  // Playback state
  const [currentIdx, setCurrentIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const idx = live ? totalSteps - 1 : Math.min(currentIdx, totalSteps - 1);
  const step = kpiData[idx];

  // In live mode, always show the latest step
  useEffect(() => {
    if (live) setCurrentIdx(totalSteps - 1);
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

  // Running total of failures up to each step, computed once per dataset
  // instead of re-scanning every earlier step on each playback tick.
  const cumulativeFailuresAt = useMemo(() => {
    const out: number[] = new Array(kpiData.length).fill(0);
    let prev = wearByWorkareaMap(kpiData[0]?.wearByWorkarea);
    for (let s = 1; s < kpiData.length; s++) {
      const curr = wearByWorkareaMap(kpiData[s]?.wearByWorkarea);
      out[s] = out[s - 1] + failuresBetween(prev, curr);
      prev = curr;
    }
    return out;
  }, [kpiData]);

  if (!step) return null;

  // Derived values
  const areaRate = perAreaRate(step.totalRate);
  const prevStep = idx > 0 ? kpiData[idx - 1] : undefined;
  const wearMap = wearByWorkareaMap(step.wearByWorkarea);
  const hasWear = wearMap.size > 0;
  const waStates = detectWorkareaStates(
    step.numberAccidents,
    prevStep?.numberAccidents ?? 0,
    wearMap,
    wearByWorkareaMap(prevStep?.wearByWorkarea),
  );
  const cumulativeFailures = cumulativeFailuresAt[idx] ?? 0;
  const stepPct = clamp((idx / Math.max(totalSteps - 1, 1)) * 100, 0, 100);
  const estimatedPowerKW = step.currPower / 1000;
  const overLimit = WORKAREA_FLAT.filter((id) => (wearMap.get(id) ?? 0) >= 0.95).length;

  return (
    <div className="flex flex-col gap-3">
      {/* ── context line ── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-3">
        {agentName !== "none" && (
          <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: agentColor }} />
            {AGENT_LABELS[agentName] ?? agentName}
          </span>
        )}
        {episode !== undefined && <span>Episode <b className="tabular font-mono text-ink-2">{episode}</b></span>}
        <span>Step <b className="tabular font-mono text-ink-2">{step.step}</b> / {totalSteps}</span>
        {step.clock && <span>Clock <b className="tabular font-mono text-ink-2">{step.clock}</b></span>}
        {live && (
          <span className="ml-auto inline-flex items-center gap-1.5 font-semibold text-warn">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warn" /> Live
          </span>
        )}
      </div>

      {/* ── playback ── */}
      {live ? (
        <div className="h-1 overflow-hidden rounded-full bg-grid">
          <div className="h-full rounded-full transition-[width] duration-100" style={{ width: `${stepPct}%`, backgroundColor: agentColor }} />
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <IconButton label="Previous step" onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}>
            <path d="M11 3 5 8l6 5" />
          </IconButton>
          <IconButton label={playing ? "Pause" : "Play"} onClick={() => setPlaying((p) => !p)}>
            {playing ? <path d="M5.5 3v10M10.5 3v10" /> : <path d="M5 3v10l8-5z" fill="currentColor" />}
          </IconButton>
          <IconButton label="Next step" onClick={() => setCurrentIdx((i) => Math.min(totalSteps - 1, i + 1))} disabled={idx >= totalSteps - 1}>
            <path d="m5 3 6 5-6 5" />
          </IconButton>
          <button
            type="button"
            onClick={() => setSpeedIdx((i) => (i + 1) % PLAYBACK_SPEEDS.length)}
            aria-label="Playback speed"
            className="tabular h-8 min-w-[44px] rounded-md border border-line-strong bg-surface px-2 font-mono text-xs text-ink hover:border-ink-3"
          >
            {PLAYBACK_SPEEDS[speedIdx]}×
          </button>
          <input
            type="range"
            aria-label="Step"
            min={0}
            max={totalSteps - 1}
            value={idx}
            onChange={(e) => setCurrentIdx(Number(e.target.value))}
            className="h-1 min-w-0 flex-1 cursor-pointer accent-[#0B4F5C]"
          />
        </div>
      )}

      {/* ── 4×4 workarea grid ── */}
      <div className={`grid grid-cols-4 ${compact ? "gap-1.5" : "gap-2.5"}`}>
        {WORKAREA_FLAT.map((waId) => {
          const status = getWorkareaStatus(waId, waStates);
          return (
            <WorkareaCard
              key={waId}
              waId={waId}
              status={status === "active" && areaRate === 0 ? "idle" : status}
              wearFrac={wearMap.get(waId) ?? 0}
              hasWear={hasWear}
              rate={areaRate}
              compact={compact}
            />
          );
        })}
      </div>

      {/* ── legend ── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-2">
        {!compact && (
          <>
            <span className="text-ink-3">Units:</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: UNIT_COLORS.A }} />A · raw processing</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: UNIT_COLORS.B }} />B · assembly (safety-critical)</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: UNIT_COLORS.C }} />C · finishing</span>
          </>
        )}
        <span className="text-ink-3 sm:ml-auto">
          {hasWear ? `${overLimit} of 16 at or above 95% wear · red tick = failure threshold` : "No per-workarea wear recorded (batch mode)"}
        </span>
      </div>

      {/* ── step KPIs ── */}
      {showStats && (
        <dl className="grid grid-cols-3 gap-x-4 gap-y-2 border-t border-grid pt-3 text-xs sm:grid-cols-4">
          {[
            { label: "Production", value: `${Math.round(step.cumProduction).toLocaleString()} parts` },
            { label: "Rate", value: `${step.totalRate.toFixed(1)} / 16` },
            { label: "Set-point", value: step.setpointRate.toFixed(2) },
            { label: "Power", value: `${estimatedPowerKW.toFixed(0)} kW` },
            { label: "Energy", value: `${Math.round(step.cumEnergy).toLocaleString()} kWh` },
            { label: "Cost", value: `${step.cumCost.toFixed(1)} EUR` },
            { label: "Accidents", value: String(step.numberAccidents), crit: step.numberAccidents > 0 },
            { label: "Failures", value: String(cumulativeFailures), crit: cumulativeFailures > 0 },
            { label: "Ambient", value: `${step.ambTemperature.toFixed(1)} °C` },
            { label: "Material quality", value: `${(step.rawMaterialQuality * 100).toFixed(0)}%` },
          ].map((s) => (
            <div key={s.label} className="flex min-w-0 flex-col">
              <dt className="text-[11px] text-ink-3">{s.label}</dt>
              <dd className={`tabular truncate font-mono font-semibold ${s.crit ? "text-crit" : "text-ink"}`}>{s.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
