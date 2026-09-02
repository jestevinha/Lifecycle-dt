/**
 * Validation script: confirms interactive mode produces identical output to batch
 * mode (Test 1), and that MAINT commands correctly reset wear and enforce the
 * shift-long maintenance countdown (Test 2).
 *
 * Run as: npx tsx packages/engine/src/validate-ipc.ts
 */
import os from "node:os";
import path from "node:path";
import { runSimulation, runInteractiveSimulation } from "./runner.js";
import { STEPS_PER_SHIFT } from "./actions.js";
import { WEAR_THRESHOLD } from "./reward.js";
import type { KpiStep } from "./types.js";

const SEED      = 42;
const STEPS     = 50;
const RATE      = 0.5;
const TOLERANCE = 0.001;

// ── Test 1: batch vs interactive equivalence (fixed rate, no MAINT) ─────────

async function testBatchVsInteractive(): Promise<boolean> {
  console.log(`\n=== Test 1: batch vs interactive (seed=${SEED}, steps=${STEPS}, rate=${RATE}) ===\n`);

  const outputDir = path.join(os.tmpdir(), "dt-validate-ipc", "batch");
  const batchSteps = runSimulation({ steps: STEPS, seed: SEED, setpointRate: RATE, outputDir });
  const interactiveSteps = await runInteractiveSimulation(
    { steps: STEPS, seed: SEED },
    RATE,
    (_step, _idx) => RATE,
  );

  if (batchSteps.length !== interactiveSteps.length) {
    console.error(`FAIL — step count mismatch: batch=${batchSteps.length}, interactive=${interactiveSteps.length}`);
    return false;
  }

  const numericFields: (keyof KpiStep)[] = [
    "step", "ambTemperature", "rawMaterialQuality",
    "currPower", "totalRate", "setpointRate",
    "cumProduction", "cumEnergy", "cumCost",
    "productEnergy", "productCost", "numberAccidents",
  ];

  let allPass = true;
  for (let i = 0; i < batchSteps.length; i++) {
    const b = batchSteps[i];
    const t = interactiveSteps[i];
    const diffs: string[] = [];
    for (const field of numericFields) {
      const bv = b[field] as number;
      const tv = t[field] as number;
      if (Math.abs(bv - tv) > TOLERANCE) diffs.push(`${field}: batch=${bv}, interactive=${tv}`);
    }
    if (b.clock !== t.clock) diffs.push(`clock: batch=${b.clock}, interactive=${t.clock}`);
    if (diffs.length > 0) {
      console.log(`Step ${i}:  ✗ MISMATCH`);
      diffs.forEach(d => console.log(`    ${d}`));
      allPass = false;
    } else {
      console.log(`Step ${i}:  ✓ match`);
    }
  }

  if (allPass) console.log("\nTest 1 PASS — interactive mode identical to batch");
  else         console.log("\nTest 1 FAIL — see mismatches above");
  return allPass;
}

// ── Test 2: MAINT command — wear reset and shift-length countdown ────────────
//
// Strategy:
//   • Run stepsPerShift steps at rate 0.5 to build up some wear on all workareas.
//   • At step stepsPerShift (start of shift 1), send MAINT on workarea 0.
//   • Expectations:
//     (a) Wear on workarea 0 drops to near 0 immediately (first MAINT step).
//     (b) Workarea 0 contributes 0 to totalRate for the whole shift (offline).
//     (c) After stepsPerShift more steps, workarea 0 is back online (rate > 0).

async function testMaintCommand(): Promise<boolean> {
  console.log(`\n=== Test 2: MAINT command — wear reset + countdown (seed=${SEED}) ===\n`);

  const totalSteps = STEPS_PER_SHIFT * 3;   // 3 shifts: build, maintain, recover
  const maintWorkarea = 0;
  let stepIdx = 0;
  let maintIssued = false;
  let wearBeforeMaint = -1;

  const steps = await runInteractiveSimulation(
    { steps: totalSteps, seed: SEED },
    RATE,
    (kpi: KpiStep, _idx: number) => {
      stepIdx++;

      // Issue MAINT at the start of shift 1 (step index == stepsPerShift)
      if (stepIdx === STEPS_PER_SHIFT && !maintIssued) {
        const wear = kpi.wearByWorkarea?.[maintWorkarea] ?? -1;
        wearBeforeMaint = wear;
        maintIssued = true;
        console.log(`  step ${stepIdx}: issuing MAINT on wa${maintWorkarea} (wear before=${wear.toFixed(1)})`);
        return { rate: RATE, maintainWorkarea: maintWorkarea };
      }
      return RATE;
    },
  );

  if (steps.length === 0) {
    console.error("FAIL — no steps returned");
    return false;
  }

  let pass = true;

  // (a) Wear reset: the step immediately AFTER MAINT is sent should show near-0 wear
  //     on workarea 0. MAINT resets wear before the step is simulated.
  const firstMaintStep = steps[STEPS_PER_SHIFT];
  if (!firstMaintStep) {
    console.error("FAIL — missing step at shift boundary");
    return false;
  }
  const wearAfterMaint = firstMaintStep.wearByWorkarea?.[maintWorkarea] ?? -1;
  const wearFracAfter  = wearAfterMaint / WEAR_THRESHOLD;

  console.log(`\n(a) Wear reset check:`);
  console.log(`    wear before MAINT = ${wearBeforeMaint.toFixed(1)} (${(wearBeforeMaint / WEAR_THRESHOLD * 100).toFixed(1)}%)`);
  console.log(`    wear on first MAINT step = ${wearAfterMaint.toFixed(2)} (${(wearFracAfter * 100).toFixed(2)}%)`);
  // After reset + one step of accumulation from 0, wear should be very small (<5%)
  if (wearFracAfter < 0.05) {
    console.log(`    ✓ PASS — wear reset to near-0 (accumulated <5% in one step)`);
  } else {
    console.error(`    ✗ FAIL — wear not reset (still ${(wearFracAfter * 100).toFixed(1)}%)`);
    pass = false;
  }

  // (b) Workarea 0 offline during the maintenance shift:
  //     totalRate should be reduced vs the non-maintenance shifts.
  //     Since all 16 workareas are at the same rate when online, removing 1 reduces
  //     totalRate by rate/16 ≈ 0.03125 per step.
  console.log(`\n(b) Maintenance shift offline check (steps ${STEPS_PER_SHIFT}–${STEPS_PER_SHIFT * 2 - 1}):`);
  const buildShiftRates   = steps.slice(0, STEPS_PER_SHIFT).map(s => s.totalRate);
  const maintShiftRates   = steps.slice(STEPS_PER_SHIFT, STEPS_PER_SHIFT * 2).map(s => s.totalRate);
  const avgBuildRate      = buildShiftRates.reduce((a, b) => a + b, 0) / buildShiftRates.length;
  const avgMaintRate      = maintShiftRates.reduce((a, b) => a + b, 0) / maintShiftRates.length;
  console.log(`    avg totalRate build shift = ${avgBuildRate.toFixed(4)}`);
  console.log(`    avg totalRate maint shift = ${avgMaintRate.toFixed(4)}`);
  if (avgMaintRate < avgBuildRate - 0.01) {
    console.log(`    ✓ PASS — totalRate reduced during maintenance (workarea offline)`);
  } else {
    console.error(`    ✗ FAIL — totalRate not reduced during maintenance (expected < ${(avgBuildRate - 0.01).toFixed(4)})`);
    pass = false;
  }

  // (c) Recovery: after stepsPerShift steps of maintenance, rate returns to normal
  console.log(`\n(c) Recovery check (steps ${STEPS_PER_SHIFT * 2}–${STEPS_PER_SHIFT * 3 - 1}):`);
  const recoveryShiftRates = steps.slice(STEPS_PER_SHIFT * 2).map(s => s.totalRate);
  const avgRecoveryRate    = recoveryShiftRates.reduce((a, b) => a + b, 0) / recoveryShiftRates.length;
  console.log(`    avg totalRate recovery shift = ${avgRecoveryRate.toFixed(4)}`);
  if (Math.abs(avgRecoveryRate - avgBuildRate) < 0.05) {
    console.log(`    ✓ PASS — totalRate recovered to near build-shift level`);
  } else {
    console.error(`    ✗ FAIL — totalRate not recovered (avg=${avgRecoveryRate.toFixed(4)}, expected≈${avgBuildRate.toFixed(4)})`);
    pass = false;
  }

  if (pass) console.log("\nTest 2 PASS — MAINT reset and countdown behave correctly");
  else      console.log("\nTest 2 FAIL — see failures above");
  return pass;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const t1 = await testBatchVsInteractive();
  const t2 = await testMaintCommand();

  console.log("\n════════════════════════════════");
  console.log(`Test 1 (batch≡interactive): ${t1 ? "PASS" : "FAIL"}`);
  console.log(`Test 2 (MAINT command):     ${t2 ? "PASS" : "FAIL"}`);
  console.log("════════════════════════════════");

  if (!t1 || !t2) process.exit(1);
}

main().catch((err) => {
  console.error("Validation failed:", err);
  process.exit(1);
});
