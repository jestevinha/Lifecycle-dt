/**
 * B.3 verification probe: per-workarea wear-rate heterogeneity.
 *
 * For each spread value [0.10, 0.20, 0.30]:
 *   - Runs PROBE_EPISODES episodes, each lasting SHIFTS_PER_EPISODE shifts.
 *   - Uses two fixed policies in parallel on separate seeds to measure:
 *       (A) greedy-imminent: always maintains the highest-wear workarea
 *           when maxWearFrac >= IMMINENT_THRESHOLD.
 *       (B) periodic: maintains a workarea every PERIODIC_INTERVAL shifts
 *           cycling through all 16 in round-robin (same cadence as the
 *           baseline greedy probe that showed 0 failures under lockstep).
 *   - Reports per-shift maxWear and wear spread, failure shift distribution,
 *     and failure counts for both policies.
 *
 * Run as: npx tsx packages/engine/src/probe-wear-heterogeneity.ts
 */
import { runInteractiveSimulation } from "./runner.js";
import { WEAR_THRESHOLD } from "./reward.js";
import { STEPS_PER_SHIFT } from "./actions.js";
import type { KpiStep } from "./types.js";

const SPREADS          = [0.10, 0.20, 0.30];
const PROBE_EPISODES   = 30;           // 30 episodes per spread
const SHIFTS_PER_EP    = 30;           // 30 shifts per episode
const BASE_SEED        = 1000;
const RATE             = 0.5;
const IMMINENT_THRESH  = 0.80;        // greedy fires MAINT when maxWear >= 80%
const N_WORKAREAS      = 16;
const PERIODIC_INTERVAL = N_WORKAREAS; // one round through all workareas = 16 shifts

// ── helpers ──────────────────────────────────────────────────────────────────

function wearSpread(wears: number[]): number {
  const mx = Math.max(...wears);
  const mn = Math.min(...wears);
  return mx - mn;
}

interface EpisodeResult {
  failureShifts: number[];   // shift indices where at least one failure occurred
  failures: number;          // total unplanned failure events
  failurePerWorkarea: number[];
}

// ── greedy-imminent policy ───────────────────────────────────────────────────

async function runGreedyEpisode(seed: number, spread: number): Promise<EpisodeResult> {
  const totalSteps = SHIFTS_PER_EP * STEPS_PER_SHIFT;
  const failureShifts: number[] = [];
  const failurePerWorkarea = new Array<number>(N_WORKAREAS).fill(0);
  let totalFailures = 0;

  let prevWear: number[] = new Array(N_WORKAREAS).fill(0);
  let shiftStep = 0;
  let currentShift = 0;
  let lastShiftBoundaryWear: number[] | null = null;
  const maintInFlight = new Set<number>();

  const steps = await runInteractiveSimulation(
    { steps: totalSteps, seed, wearRateSpread: spread },
    RATE,
    (kpi: KpiStep, stepIndex: number) => {
      const currWear = kpi.wearByWorkarea ?? [];

      // detect failures: wear drops >90% from near-threshold
      for (let wa = 0; wa < N_WORKAREAS; wa++) {
        const prev = prevWear[wa] ?? 0;
        const curr = currWear[wa] ?? 0;
        if (prev > WEAR_THRESHOLD * 0.90 && curr < prev * 0.1) {
          totalFailures++;
          failurePerWorkarea[wa]++;
          if (!failureShifts.includes(currentShift)) failureShifts.push(currentShift);
        }
      }
      prevWear = [...currWear];

      shiftStep++;
      if (shiftStep >= STEPS_PER_SHIFT) {
        shiftStep = 0;
        currentShift++;
        lastShiftBoundaryWear = [...currWear];
        maintInFlight.clear();
      }

      // at shift boundaries: pick highest-wear workarea above threshold,
      // excluding already-failed workareas (wear >= WEAR_THRESHOLD) and
      // workareas with maintenance already in-flight this shift.
      if (shiftStep === 0 && lastShiftBoundaryWear) {
        const wears = lastShiftBoundaryWear;
        let maxWear = 0, maxWa = -1;
        for (let wa = 0; wa < N_WORKAREAS; wa++) {
          if (wears[wa] > maxWear && wears[wa] < WEAR_THRESHOLD && !maintInFlight.has(wa)) {
            maxWear = wears[wa];
            maxWa = wa;
          }
        }
        const maxFrac = maxWear / WEAR_THRESHOLD;
        if (maxFrac >= IMMINENT_THRESH && maxWa >= 0) {
          maintInFlight.add(maxWa);
          return { rate: RATE, maintainWorkarea: maxWa };
        }
      }

      return RATE;
    },
  );
  void steps;

  return { failureShifts, failures: totalFailures, failurePerWorkarea };
}

// ── periodic policy ─────────────────────────────────────────────────────────

async function runPeriodicEpisode(seed: number, spread: number): Promise<EpisodeResult> {
  const totalSteps = SHIFTS_PER_EP * STEPS_PER_SHIFT;
  const failureShifts: number[] = [];
  const failurePerWorkarea = new Array<number>(N_WORKAREAS).fill(0);
  let totalFailures = 0;

  let prevWear: number[] = new Array(N_WORKAREAS).fill(0);
  let shiftStep = 0;
  let currentShift = 0;

  const steps = await runInteractiveSimulation(
    { steps: totalSteps, seed, wearRateSpread: spread },
    RATE,
    (kpi: KpiStep, _stepIndex: number) => {
      const currWear = kpi.wearByWorkarea ?? [];

      for (let wa = 0; wa < N_WORKAREAS; wa++) {
        const prev = prevWear[wa] ?? 0;
        const curr = currWear[wa] ?? 0;
        if (prev > WEAR_THRESHOLD * 0.90 && curr < prev * 0.1) {
          totalFailures++;
          failurePerWorkarea[wa]++;
          if (!failureShifts.includes(currentShift)) failureShifts.push(currentShift);
        }
      }
      prevWear = [...currWear];

      shiftStep++;
      const isShiftBoundary = shiftStep >= STEPS_PER_SHIFT;
      if (isShiftBoundary) {
        shiftStep = 0;
        currentShift++;
        // maintain the next workarea in round-robin
        const waToMaint = (currentShift - 1) % N_WORKAREAS;
        return { rate: RATE, maintainWorkarea: waToMaint };
      }

      return RATE;
    },
  );
  void steps;

  return { failureShifts, failures: totalFailures, failurePerWorkarea };
}

// ── per-shift maxWear + spread sampling (one episode, full trace) ────────────

async function runWearTrace(seed: number, spread: number): Promise<{ maxWears: number[]; spreads: number[] }> {
  const totalSteps = SHIFTS_PER_EP * STEPS_PER_SHIFT;
  const maxWears: number[] = [];
  const wearSpreads: number[] = [];
  let shiftStep = 0;

  await runInteractiveSimulation(
    { steps: totalSteps, seed, wearRateSpread: spread },
    RATE,
    (kpi: KpiStep, _stepIndex: number) => {
      shiftStep++;
      if (shiftStep >= STEPS_PER_SHIFT) {
        shiftStep = 0;
        const w = kpi.wearByWorkarea ?? [];
        if (w.length > 0) {
          maxWears.push(Math.max(...w));
          wearSpreads.push(wearSpread(w));
        }
      }
      return RATE;
    },
  );

  return { maxWears, spreads: wearSpreads };
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nB.3 wear-heterogeneity verification`);
  console.log(`PROBE_EPISODES=${PROBE_EPISODES}, SHIFTS_PER_EP=${SHIFTS_PER_EP}, BASE_SEED=${BASE_SEED}`);
  console.log(`IMMINENT_THRESH=${(IMMINENT_THRESH * 100).toFixed(0)}%, PERIODIC_INTERVAL=every ${PERIODIC_INTERVAL} shifts`);
  console.log(`WEAR_THRESHOLD=${WEAR_THRESHOLD} rate-min, STEPS_PER_SHIFT=${STEPS_PER_SHIFT}\n`);

  for (const spread of SPREADS) {
    console.log(`${"═".repeat(70)}`);
    console.log(`SPREAD = ±${(spread * 100).toFixed(0)}%`);
    console.log(`${"═".repeat(70)}\n`);

    // 1. Wear trace (one episode, no maintenance — observe natural divergence)
    console.log(`--- Wear trace (no MAINT, seed=${BASE_SEED}) ---`);
    const trace = await runWearTrace(BASE_SEED, spread);
    console.log(`  shift | maxWear (frac%) | wearSpread`);
    for (let s = 0; s < trace.maxWears.length; s++) {
      const mx = trace.maxWears[s];
      const sp = trace.spreads[s];
      console.log(
        `  ${String(s).padStart(5)} | ${mx.toFixed(0).padStart(7)} (${(mx / WEAR_THRESHOLD * 100).toFixed(1).padStart(5)}%) | ${sp.toFixed(1)}`,
      );
    }
    console.log();

    // 2. Multi-episode failure counts — greedy vs periodic
    let greedyTotal = 0, periodicTotal = 0;
    let greedyEpsWithFailures = 0, periodicEpsWithFailures = 0;
    const greedyFailureShiftCounts: number[] = [];
    const periodicFailureShiftCounts: number[] = [];

    process.stdout.write(`--- Running ${PROBE_EPISODES} episodes per policy...`);
    for (let ep = 0; ep < PROBE_EPISODES; ep++) {
      const seed = BASE_SEED + ep;
      const [g, p] = await Promise.all([
        runGreedyEpisode(seed, spread),
        runPeriodicEpisode(seed, spread),
      ]);
      greedyTotal += g.failures;
      periodicTotal += p.failures;
      if (g.failures > 0) greedyEpsWithFailures++;
      if (p.failures > 0) periodicEpsWithFailures++;
      greedyFailureShiftCounts.push(g.failures);
      periodicFailureShiftCounts.push(p.failures);
      if ((ep + 1) % 5 === 0) process.stdout.write(` ${ep + 1}`);
    }
    console.log(" done\n");

    const greedyAvg = greedyTotal / PROBE_EPISODES;
    const periodicAvg = periodicTotal / PROBE_EPISODES;

    console.log(`  Policy          | Total failures | Avg/ep | Eps with ≥1 failure`);
    console.log(`  ─────────────────────────────────────────────────────────────────`);
    console.log(`  Greedy-imminent | ${String(greedyTotal).padStart(14)} | ${greedyAvg.toFixed(2).padStart(6)} | ${greedyEpsWithFailures}/${PROBE_EPISODES}`);
    console.log(`  Periodic        | ${String(periodicTotal).padStart(14)} | ${periodicAvg.toFixed(2).padStart(6)} | ${periodicEpsWithFailures}/${PROBE_EPISODES}`);

    const reduction = periodicAvg > 0 ? ((periodicAvg - greedyAvg) / periodicAvg * 100) : 0;
    console.log(`\n  KEY CRITERION: greedy reduces failures vs periodic by ${reduction.toFixed(1)}%`);
    if (periodicAvg === 0 && greedyAvg === 0) {
      console.log(`  ⚠ BOTH POLICIES HAVE ZERO FAILURES — spread insufficient for differentiation`);
    } else if (greedyAvg < periodicAvg * 0.8) {
      console.log(`  ✓ CRITERION MET — greedy-imminent measurably outperforms periodic (>20% fewer failures)`);
    } else if (greedyAvg < periodicAvg) {
      console.log(`  ~ PARTIAL — greedy is better but margin is small (<20%); consider higher spread`);
    } else {
      console.log(`  ✗ CRITERION NOT MET — greedy does not outperform periodic at this spread`);
    }
    console.log();

    // Per-episode failure detail
    console.log(`  Episode failure breakdown (greedy | periodic):`);
    for (let ep = 0; ep < PROBE_EPISODES; ep++) {
      if (greedyFailureShiftCounts[ep] > 0 || periodicFailureShiftCounts[ep] > 0) {
        console.log(`    ep${ep.toString().padStart(3)}: greedy=${greedyFailureShiftCounts[ep]}  periodic=${periodicFailureShiftCounts[ep]}`);
      }
    }
    if (greedyTotal === 0 && periodicTotal === 0) {
      console.log(`    (no failures in any episode for either policy)`);
    }
    console.log();
  }

  console.log(`${"═".repeat(70)}`);
  console.log(`SUMMARY AND RECOMMENDATION`);
  console.log(`${"═".repeat(70)}`);
  console.log(`
Report above gives the evidence. Stopping here per instructions.
You choose the spread; the candidates are ±10%, ±20%, ±30%.
  `);
}

main().catch((err) => {
  console.error("Probe failed:", err);
  process.exit(1);
});
