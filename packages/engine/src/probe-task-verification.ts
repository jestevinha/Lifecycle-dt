/**
 * Task verification probe: heterogeneous per-workarea wear + targeted maintenance.
 *
 * Runs three spread values (0.0, 0.2, 0.4) at seed=42 and for each:
 *   1. Wear trace (no maintenance): logs per-workarea wear at every shift boundary.
 *      Shows whether failures cluster (spread=0) or stagger (spread>0).
 *   2. Run-to-failure baseline: counts total unplanned failures with no MAINT.
 *   3. Threshold-85% maintenance: counts unplanned failures when MAINT fires on
 *      the highest eligible wear workarea whenever maxWearFraction >= 0.85,
 *      one action per shift. Eligible = wear < WEAR_THRESHOLD (not already failed).
 *
 * Expected results:
 *   spread=0 : all 16 workareas fail in the same shift; threshold-85% saves only 1.
 *   spread>0 : failures stagger across shifts; threshold-85% prevents many.
 *
 * Run: npx tsx packages/engine/src/probe-task-verification.ts
 */

import { runInteractiveSimulation } from "./runner.js";
import { WEAR_THRESHOLD } from "./reward.js";
import { STEPS_PER_SHIFT } from "./actions.js";
import type { KpiStep } from "./types.js";

const SEED           = 42;
const SPREADS        = [0.0, 0.2, 0.4];
const RATE           = 0.50;
const SHIFTS_PER_EP  = 30;
const TOTAL_STEPS    = SHIFTS_PER_EP * STEPS_PER_SHIFT;
const N_WORKAREAS    = 16;
const MAINT_THRESH   = 0.85;  // 85% wear fraction triggers maintenance

// ── failure detection ────────────────────────────────────────────────────────

/**
 * Detects wear-driven failures: workarea was >= 95% of threshold, then either
 * reset by auto-maintenance (dropped sharply) or crossed the threshold.
 */
function countNewFailures(prevWear: number[], currWear: number[]): number {
  let n = 0;
  for (let i = 0; i < Math.min(prevWear.length, currWear.length); i++) {
    // Wear reached threshold on this step → failure
    if (prevWear[i] < WEAR_THRESHOLD && currWear[i] >= WEAR_THRESHOLD) n++;
  }
  return n;
}

/** argmax of wear among workareas below WEAR_THRESHOLD (not already failed/maintained). */
function argmaxEligible(wear: number[]): number {
  let best = wear.findIndex(w => w < WEAR_THRESHOLD);
  if (best < 0) return -1;
  for (let i = best + 1; i < wear.length; i++) {
    if (wear[i] < WEAR_THRESHOLD && wear[i] > wear[best]) best = i;
  }
  return best;
}

// ── wear trace (no maintenance) ───────────────────────────────────────────────

async function runWearTrace(seed: number, spread: number): Promise<{
  shiftWear: number[][];   // [shift][workarea] — wear at each shift boundary
  failures: number;
  failureByShift: number[];
}> {
  const shiftWear: number[][] = [];
  const failureByShift = new Array<number>(SHIFTS_PER_EP).fill(0);
  let totalFailures = 0;
  let prevWear = new Array<number>(N_WORKAREAS).fill(0);
  let shiftStep = 0;
  let currentShift = 0;

  await runInteractiveSimulation(
    { steps: TOTAL_STEPS, seed, wearRateSpread: spread },
    RATE,
    (kpi: KpiStep) => {
      const currWear = kpi.wearByWorkarea ?? prevWear;
      const newFail = countNewFailures(prevWear, currWear);
      if (newFail > 0) {
        totalFailures += newFail;
        if (currentShift < SHIFTS_PER_EP) failureByShift[currentShift] += newFail;
      }
      prevWear = [...currWear];

      shiftStep++;
      if (shiftStep >= STEPS_PER_SHIFT) {
        shiftStep = 0;
        shiftWear.push([...currWear]);
        currentShift++;
      }
      return RATE;
    },
  );

  return { shiftWear, failures: totalFailures, failureByShift };
}

// ── threshold-85% maintenance policy ─────────────────────────────────────────

async function runThresholdMaint(seed: number, spread: number): Promise<{
  failures: number;
  failureByShift: number[];
  maintEvents: number;
}> {
  const failureByShift = new Array<number>(SHIFTS_PER_EP).fill(0);
  let totalFailures = 0;
  let maintEvents = 0;
  let prevWear = new Array<number>(N_WORKAREAS).fill(0);
  let shiftStep = 0;
  let currentShift = 0;
  let lastBoundaryWear: number[] | null = null;
  let pendingMaint = -1;   // workarea index to maintain on sub-step 0, or -1

  await runInteractiveSimulation(
    { steps: TOTAL_STEPS, seed, wearRateSpread: spread },
    RATE,
    (kpi: KpiStep) => {
      const currWear = kpi.wearByWorkarea ?? prevWear;
      const newFail = countNewFailures(prevWear, currWear);
      if (newFail > 0) {
        totalFailures += newFail;
        if (currentShift < SHIFTS_PER_EP) failureByShift[currentShift] += newFail;
      }
      prevWear = [...currWear];

      shiftStep++;
      if (shiftStep >= STEPS_PER_SHIFT) {
        shiftStep = 0;
        lastBoundaryWear = [...currWear];
        currentShift++;

        // Select maintenance target for next shift's sub-step 0
        const maxWa = argmaxEligible(lastBoundaryWear);
        if (maxWa >= 0) {
          const frac = lastBoundaryWear[maxWa] / WEAR_THRESHOLD;
          if (frac >= MAINT_THRESH) {
            pendingMaint = maxWa;
            maintEvents++;
            return { rate: RATE, maintainWorkarea: pendingMaint };
          }
        }
        pendingMaint = -1;
        return RATE;
      }

      // Within shift: only the shift-boundary step sends MAINT; rest send plain rate
      return RATE;
    },
  );

  return { failures: totalFailures, failureByShift, maintEvents };
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${"═".repeat(72)}`);
  console.log(`Task verification — heterogeneous wear + targeted maintenance`);
  console.log(`seed=${SEED}  WEAR_THRESHOLD=${WEAR_THRESHOLD}  rate=${RATE}  STEPS_PER_SHIFT=${STEPS_PER_SHIFT}`);
  console.log(`shifts/ep=${SHIFTS_PER_EP}  maint_thresh=${(MAINT_THRESH * 100).toFixed(0)}%`);
  console.log(`${"═".repeat(72)}\n`);

  for (const spread of SPREADS) {
    console.log(`${"─".repeat(72)}`);
    console.log(`SPREAD = ±${(spread * 100).toFixed(0)}%  (wearRateSpread=${spread})`);
    console.log(`${"─".repeat(72)}\n`);

    // 1. Wear trace — no maintenance
    console.log(`[A] Wear trace — NO maintenance (seed=${SEED}, spread=${spread})`);
    const trace = await runWearTrace(SEED, spread);

    console.log(`\n  shift | failures | wear[0..15] (rate-min / % of threshold)`);
    console.log(`  ${"─".repeat(68)}`);
    for (let s = 0; s < trace.shiftWear.length; s++) {
      const wear = trace.shiftWear[s];
      const failsThisShift = trace.failureByShift[s] ?? 0;
      const wearPcts = wear.map(w => `${(w / WEAR_THRESHOLD * 100).toFixed(0)}%`.padStart(5)).join(" ");
      const failStr = failsThisShift > 0 ? `  ← ${failsThisShift} FAILURE(S)` : "";
      console.log(`  ${String(s).padStart(5)} | ${String(failsThisShift).padStart(8)} | ${wearPcts}${failStr}`);
    }
    console.log(`\n  Total unplanned failures (run-to-failure): ${trace.failures}`);

    // Find shifts at which each workarea first crosses threshold
    const firstFailShift: number[] = new Array(N_WORKAREAS).fill(-1);
    for (let s = 0; s < trace.shiftWear.length; s++) {
      for (let wa = 0; wa < N_WORKAREAS; wa++) {
        if (firstFailShift[wa] < 0 && trace.shiftWear[s][wa] >= WEAR_THRESHOLD) {
          firstFailShift[wa] = s;
        }
      }
    }
    const failedWas = firstFailShift.filter(s => s >= 0);
    if (failedWas.length > 0) {
      const minShift = Math.min(...failedWas);
      const maxShift = Math.max(...failedWas);
      console.log(`\n  First failure shift per workarea: [${firstFailShift.map(s => s < 0 ? "-" : s).join(",")}]`);
      console.log(`  Failure range: shifts ${minShift}–${maxShift}  (spread = ${maxShift - minShift} shifts)`);
      if (minShift === maxShift) {
        console.log(`  → CLUSTERED: all workareas fail on the same shift (expected at spread=0)`);
      } else {
        console.log(`  → STAGGERED: failures distributed over ${maxShift - minShift + 1} shifts (expected at spread>0)`);
      }
    } else {
      console.log(`  No workarea reached failure threshold within ${SHIFTS_PER_EP} shifts`);
    }

    // 2. Threshold-85% maintenance policy
    console.log(`\n[B] Threshold-85% maintenance (seed=${SEED}, spread=${spread})`);
    const maint = await runThresholdMaint(SEED, spread);
    console.log(`  Maintenance events triggered : ${maint.maintEvents}`);
    console.log(`  Unplanned failures remaining : ${maint.failures}`);
    const saved = trace.failures - maint.failures;
    const pct = trace.failures > 0
      ? ((saved / trace.failures) * 100).toFixed(1)
      : "n/a";
    console.log(`  Failures prevented by maint  : ${saved} of ${trace.failures} (${pct}%)`);

    // Interpretation
    if (spread === 0.0) {
      console.log(`\n  INTERPRETATION (spread=0): failures cluster → maintenance saves ≤1/16 per shift`);
      console.log(`  Expected: maintenance ~useless → confirmed if saved failures near 0.`);
    } else {
      console.log(`\n  INTERPRETATION (spread>0): staggered failures → maintenance can pre-empt each`);
      console.log(`  Expected: meaningful reduction in failures (>50% vs run-to-failure).`);
    }

    console.log();
  }

  console.log(`${"═".repeat(72)}`);
  console.log(`SUMMARY`);
  console.log(`${"═".repeat(72)}`);
  console.log(`
The table above documents:
  1. Per-workarea wear at each shift boundary (columns 0–15).
  2. Whether failures cluster (spread=0) or stagger (spread>0).
  3. Reduction in unplanned failures from threshold-85% maintenance per spread.

Key criterion: at spread≥0.2 the threshold maintenance policy should prevent
≥50% of unplanned failures that occur in the run-to-failure baseline.
At spread=0 the policy should save at most 1 failure per failure wave (≤1/16).
`);
}

main().catch(err => { console.error("Probe failed:", err); process.exit(1); });
