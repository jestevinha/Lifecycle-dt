/**
 * Diagnostic: run the simulator with a hand-coded policy
 *   rate = 0.50, maintain every shift on the highest-wear workarea.
 *
 * Reports per-shift max wear (rate-minutes + %), whether MAINT was sent,
 * total accidents at the end, and any wear-failure transitions detected.
 *
 * Run with: npx tsx packages/engine/src/probe-fixed-policy.ts
 */
import { runInteractiveSimulation, type StepCommand } from "./runner.js";
import { STEPS_PER_SHIFT } from "./actions.js";
import { WEAR_THRESHOLD, detectFailures } from "./reward.js";
import type { KpiStep } from "./types.js";

const SEED  = 42;
const STEPS = 240;            // 30 shifts × 8 steps/shift
const RATE  = 0.50;

/** argmax of wear, excluding workareas at or above WEAR_THRESHOLD (already failed/in-mandatory-maintenance). */
function argmaxEligible(xs: number[]): number {
  let best = xs.findIndex(w => w < WEAR_THRESHOLD);
  if (best < 0) return 0;  // all failed — fallback (MAINT harmless on a failed wa)
  for (let i = best + 1; i < xs.length; i++) {
    if (xs[i] < WEAR_THRESHOLD && xs[i] > xs[best]) best = i;
  }
  return best;
}

async function main() {
  console.log(`Hand-coded policy probe — seed=${SEED}, steps=${STEPS}, rate=${RATE}, maintain every shift on max-wear`);
  console.log(`WEAR_THRESHOLD = ${WEAR_THRESHOLD} rate-minutes\n`);

  let prevWear: number[] = new Array(16).fill(0);
  let prevAccidents = 0;
  let totalWearFailures = 0;
  let shiftIdx = 0;
  let subStep = 0;
  let lastStep = null as KpiStep | null;

  // Initial command: rate 0.50, no MAINT (we don't know wear yet)
  const initialCmd: StepCommand = { rate: RATE };

  await runInteractiveSimulation(
    { steps: STEPS, seed: SEED },
    initialCmd,
    (kpi: KpiStep) => {
      lastStep = kpi;
      const currWear = kpi.wearByWorkarea ?? prevWear;

      // Wear-failure detection (same logic as reward.ts)
      const failuresThisStep = detectFailures(prevWear, currWear);
      totalWearFailures += failuresThisStep;
      if (failuresThisStep > 0) {
        console.log(`  ⚠ step ${kpi.step}: ${failuresThisStep} wear-failure transition(s)`);
      }

      const accidentDelta = kpi.numberAccidents - prevAccidents;
      prevAccidents = kpi.numberAccidents;
      prevWear = [...currWear];

      subStep++;
      // At shift boundary: log + send MAINT command for the next shift
      if (subStep >= STEPS_PER_SHIFT) {
        const maxIdx = argmaxEligible(currWear);
        const maxWear = currWear[maxIdx];
        const maxFrac = (maxWear / WEAR_THRESHOLD) * 100;
        console.log(
          `shift ${String(shiftIdx).padStart(2)} (step ${String(kpi.step).padStart(3)})  ` +
          `maxWear=${maxWear.toFixed(1)} (${maxFrac.toFixed(1)}%)  ` +
          `wa=${String(maxIdx).padStart(2)}  acc+=${accidentDelta}  totalAcc=${kpi.numberAccidents}  ` +
          `→ MAINT wa${maxIdx}`,
        );
        shiftIdx++;
        subStep = 0;
        return { rate: RATE, maintainWorkarea: maxIdx };
      }
      return RATE;
    },
  );

  console.log("\n─────── summary ───────");
  console.log(`Total accidents:          ${lastStep?.numberAccidents ?? 0}`);
  console.log(`Wear-failure transitions: ${totalWearFailures}`);
  console.log(`Cumulative production:    ${lastStep?.cumProduction ?? 0}`);
  console.log(
    `Final max wear:           ${prevWear.length > 0 ? Math.max(...prevWear).toFixed(1) : 0} rate-minutes ` +
    `(${prevWear.length > 0 ? (Math.max(...prevWear) / WEAR_THRESHOLD * 100).toFixed(1) : 0}%)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
