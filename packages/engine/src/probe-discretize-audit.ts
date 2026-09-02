/**
 * Probe 2 — Discretization audit.
 *
 * Falsifiable question: is the Q-Learning state space ≤243 states (3^5),
 * or is the actual space larger due to a 6th dimension not accounted for?
 *
 * Protocol:
 *   - Run 3 interactive ManuSim episodes (~30 shifts each) with a fixed
 *     mid-rate policy (0.5, no maintenance) so wear accumulates naturally.
 *   - For each shift boundary: log the raw extractState output AND the
 *     bin each dimension falls into using the ACTUAL discretize formula
 *     from qlearning.ts.
 *   - Report: distinct values per dimension, distinct full Q-Learning keys,
 *     total Q-table size vs 243 limit.
 *   - Cross-check the LinUCB feature vector (raw continuous, no discretize).
 *   - Cross-check: any dimension with >3 distinct values? Any key count >243?
 *
 * Run: npx tsx packages/engine/src/probe-discretize-audit.ts
 */

import { runInteractiveSimulation } from "./runner.js";
import { extractState, WEAR_THRESHOLD } from "./reward.js";
import { STEPS_PER_SHIFT }             from "./actions.js";
import type { KpiStep, State }         from "./types.js";

const N_EPISODES = 3;
const SIM_STEPS  = 240; // 30 shifts per episode
const RATE       = 0.5; // fixed mid policy
const BASE_SEED  = 777;

// ── discretize (verbatim copy of qlearning.ts private method) ────────────────

function discretize(s: State): { key: string; bins: number[] } {
  const bins = [
    s.ambTemperature < 15 ? 0 : s.ambTemperature <= 25 ? 1 : 2,
    s.rawMaterialQuality < 0.4 ? 0 : s.rawMaterialQuality <= 0.7 ? 1 : 2,
    s.stepNorm < 0.33 ? 0 : s.stepNorm <= 0.66 ? 1 : 2,
    s.shiftPhaseNorm < 0.33 ? 0 : s.shiftPhaseNorm <= 0.66 ? 1 : 2,
    s.numberAccidents === 0 ? 0 : s.numberAccidents <= 2 ? 1 : 2,
  ];
  if (s.maxWearFraction !== undefined) {
    const w = s.maxWearFraction;
    bins.push(w < 0.30 ? 0 : w < 0.50 ? 1 : w < 0.70 ? 2 : w < 0.85 ? 3 : w < 0.95 ? 4 : 5);
  }
  return { key: bins.join(","), bins };
}

// ── LinUCB feature vector (mirrors linucb.ts stateToVector) ─────────────────

function stateToLinUCBVector(s: State): number[] {
  const v = [
    s.ambTemperature,
    s.rawMaterialQuality,
    s.stepNorm,
    s.shiftPhaseNorm,
    s.numberAccidents,
  ];
  if (s.maxWearFraction !== undefined) v.push(s.maxWearFraction);
  return v;
}

// ── per-episode collection ────────────────────────────────────────────────────

interface ShiftRecord {
  episode:    number;
  shiftNum:   number;
  raw:        State;
  bins:       number[];
  key:        string;
  lucbVec:    number[];
  maxWearRaw: number;  // raw wearByWorkarea max (rate-min)
}

async function runEpisode(ep: number, seed: number): Promise<ShiftRecord[]> {
  const records: ShiftRecord[] = [];
  let   subStep = 0;
  let   shiftNum = 0;

  await runInteractiveSimulation(
    { steps: SIM_STEPS, seed },
    RATE,
    (kpi: KpiStep, stepIndex: number) => {
      subStep++;
      const isShiftBoundary = subStep >= STEPS_PER_SHIFT || stepIndex === SIM_STEPS - 1;

      if (isShiftBoundary) {
        const state = extractState(kpi, SIM_STEPS);
        const { key, bins } = discretize(state);
        const lucbVec = stateToLinUCBVector(state);
        const maxWearRaw = kpi.wearByWorkarea ? Math.max(...kpi.wearByWorkarea) : 0;

        records.push({ episode: ep, shiftNum, raw: state, bins, key, lucbVec, maxWearRaw });
        shiftNum++;
        subStep = 0;
      }

      return RATE;
    },
  );

  return records;
}

// ── bin formula report ───────────────────────────────────────────────────────

function printBinFormula() {
  console.log("\n── Bin formula (verbatim from qlearning.ts:discretize) ─────────────────────");
  console.log("  Dim 0  ambTemperature   : < 15 → bin 0 | [15,25] → bin 1 | > 25 → bin 2");
  console.log("  Dim 1  rawMaterialQual. : < 0.4 → 0 | [0.4,0.7] → 1 | > 0.7 → 2");
  console.log("  Dim 2  stepNorm         : < 0.33 → 0 | [0.33,0.66] → 1 | > 0.66 → 2");
  console.log("  Dim 3  shiftPhaseNorm   : same boundaries as stepNorm (3 bins)");
  console.log("         NOTE: shiftPhaseNorm ∈ {0, 0.5, 1.0} → exactly bins {0, 1, 2}");
  console.log("  Dim 4  numberAccidents  : = 0 → 0 | [1,2] → 1 | > 2 → 2");
  console.log("  Dim 5  maxWearFraction  : ONLY when maxWearFraction is defined (interactive mode)");
  console.log("         < 0.30 → 0 | [0.30,0.50) → 1 | [0.50,0.70) → 2");
  console.log("         [0.70,0.85) → 3 | [0.85,0.95) → 4 | ≥ 0.95 → 5  (6 bins)");
  console.log("\n  Theoretical state space:");
  console.log("    WITHOUT dim 5 (batch mode): 3^5 = 243");
  console.log("    WITH    dim 5 (interactive): 3^5 × 6 = 1458");
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("PROBE 2 — Discretization audit");
  console.log(`${N_EPISODES} episodes × 30 shifts, rate=${RATE}, no maintenance, seeds ${BASE_SEED}..${BASE_SEED + N_EPISODES - 1}`);
  console.log("═══════════════════════════════════════════════════════════════");

  printBinFormula();

  const allRecords: ShiftRecord[] = [];

  for (let ep = 0; ep < N_EPISODES; ep++) {
    console.log(`\n── Episode ${ep} (seed=${BASE_SEED + ep}) ──`);
    console.log("  shft | ambT  RMQ   stepN phN   acc   maxW(raw)   maxW(frac) | bins              | key");
    console.log("  ─────────────────────────────────────────────────────────────────────────────────────────");

    const recs = await runEpisode(ep, BASE_SEED + ep);
    for (const r of recs) {
      const raw = r.raw;
      const frac = raw.maxWearFraction !== undefined ? raw.maxWearFraction.toFixed(3) : " n/a ";
      const wRaw = r.maxWearRaw.toFixed(0).padStart(7);
      const dim0 = raw.ambTemperature.toFixed(1).padStart(5);
      const dim1 = raw.rawMaterialQuality.toFixed(3).padStart(5);
      const dim2 = raw.stepNorm.toFixed(3).padStart(5);
      const dim3 = raw.shiftPhaseNorm.toFixed(3).padStart(5);
      const dim4 = String(raw.numberAccidents).padStart(5);
      const binsStr = r.bins.join(",").padEnd(17);
      console.log(`  ${String(r.shiftNum).padStart(4)} | ${dim0} ${dim1} ${dim2} ${dim3} ${dim4} ${wRaw} ${frac.padStart(10)} | ${binsStr} | ${r.key}`);
    }
    allRecords.push(...recs);
  }

  // ── aggregation ─────────────────────────────────────────────────────────────

  console.log("\n── Distinct-value aggregation (across all 3 episodes) ──────────────────────");

  const dimSets = [new Set<number>(), new Set<number>(), new Set<number>(),
                   new Set<number>(), new Set<number>(), new Set<number>()];
  const keySet  = new Set<string>();
  const rawSets = [new Set<string>(), new Set<string>(), new Set<string>(),
                   new Set<string>(), new Set<string>(), new Set<string>()];
  let hasDim5 = false;

  for (const r of allRecords) {
    r.bins.forEach((b, i) => dimSets[i].add(b));
    keySet.add(r.key);

    const raw = r.raw;
    rawSets[0].add(raw.ambTemperature.toFixed(2));
    rawSets[1].add(raw.rawMaterialQuality.toFixed(3));
    rawSets[2].add(raw.stepNorm.toFixed(4));
    rawSets[3].add(raw.shiftPhaseNorm.toFixed(2));
    rawSets[4].add(String(raw.numberAccidents));
    if (raw.maxWearFraction !== undefined) {
      rawSets[5].add(raw.maxWearFraction.toFixed(4));
      hasDim5 = true;
    }
  }

  const dimNames = ["ambTemperature", "rawMaterialQuality", "stepNorm", "shiftPhaseNorm",
                    "numberAccidents", "maxWearFraction"];

  console.log("  Dim | Name                | Max bins | Distinct bin values seen | Distinct raw values");
  console.log("  ────────────────────────────────────────────────────────────────────────────────────");
  for (let i = 0; i < (hasDim5 ? 6 : 5); i++) {
    const maxBins = i === 5 ? 6 : 3;
    const binsPresent = Array.from(dimSets[i]).sort((a,b)=>a-b).join(",");
    const rawCount = rawSets[i].size;
    const excess = dimSets[i].size > maxBins ? " ← EXCEEDS STATED BINS!" : "";
    console.log(`  ${i}   | ${dimNames[i].padEnd(19)} | ${maxBins}        | ${binsPresent.padEnd(24)} | ${rawCount}${excess}`);
  }

  console.log(`\n  Total distinct Q-Learning keys: ${keySet.size}`);
  console.log(`  Keys: ${Array.from(keySet).sort().join("  ")}`);
  console.log(`\n  Theoretical maximum: ${hasDim5 ? "3^5 × 6 = 1458 (interactive — dim 5 present)" : "3^5 = 243 (batch — no dim 5)"}`);
  if (keySet.size > 243 && !hasDim5) {
    console.log(`  ✗ IMPOSSIBLE: >243 keys without dim 5 — discretize has a BUG`);
  } else if (keySet.size > 243 && hasDim5) {
    console.log(`  ✓ EXPLAINED: >243 keys because dim 5 (maxWearFraction, 6 bins) is present in interactive mode`);
    console.log(`    → stated design "3 bins × 5 dimensions" missed the 6th dimension`);
    console.log(`    → 391 states in exp 23 is perfectly consistent: 391 < 1458`);
  } else {
    console.log(`  ✓ Within theoretical limit for these ${N_EPISODES} short episodes`);
  }

  // ── LinUCB confirmation ──────────────────────────────────────────────────────

  console.log("\n── LinUCB feature vector audit ─────────────────────────────────────────────");
  console.log("  LinUCB receives raw continuous values (NO discretization).");
  console.log("  The stateToVector() function in linucb.ts returns:");
  console.log("    [ambTemperature, rawMaterialQuality, stepNorm, shiftPhaseNorm, numberAccidents");
  console.log("     (, maxWearFraction if defined)]");
  console.log("  No normalization is applied — raw physical units / fractions.");
  console.log();

  const sample = allRecords[allRecords.length - 1];
  if (sample) {
    const vec = sample.lucbVec;
    console.log(`  Sample vector (ep=${sample.episode} shift=${sample.shiftNum}):`);
    const dimLabels = ["ambTemp", "rawMQ", "stepN", "phaseN", "acc", "maxWear"];
    vec.forEach((v, i) => console.log(`    [${i}] ${dimLabels[i]}: ${v.toFixed(4)}`));
    console.log(`\n  Scale note — ambTemperature (≈10–35) is 20–70× larger than stepNorm (0–1).`);
    console.log(`  This creates a scale imbalance: the temperature dimension dominates the dot product.`);
    console.log(`  LinUCB has no built-in normalization; the A matrix compensates via its inverse,`);
    console.log(`  but convergence speed and numerical conditioning may be affected.`);
  }

  // ── Closing cross-check ──────────────────────────────────────────────────────

  console.log("\n── Cross-check summary ─────────────────────────────────────────────────────");
  console.log(`  (a) Any dimension with >3 distinct bins observed? `);
  for (let i = 0; i < (hasDim5 ? 6 : 5); i++) {
    const maxBins = i === 5 ? 6 : 3;
    if (dimSets[i].size > maxBins) {
      console.log(`      YES — dim ${i} (${dimNames[i]}) has ${dimSets[i].size} > ${maxBins} bins`);
    }
  }
  const noExcess = Array.from({length: hasDim5 ? 6 : 5}, (_, i) =>
    dimSets[i].size <= (i === 5 ? 6 : 3)
  ).every(Boolean);
  if (noExcess) console.log("      NO — all dimensions within stated bin counts ✓");

  console.log(`\n  (b) Total distinct keys > 243? ${keySet.size > 243 ? "YES (" + keySet.size + ")" : "NO (" + keySet.size + ")"}`);
  if (keySet.size > 243) {
    console.log(`      Explained by 6th dimension (maxWearFraction) in interactive mode.`);
    console.log(`      Max keys with dim5: 3^5 × 6 = 1458.  Current: ${keySet.size} < 1458 ✓`);
  }

  console.log(`\n  (c) Is dim 5 (maxWearFraction) present in these episodes? ${hasDim5 ? "YES" : "NO"}`);
  console.log(`      (It is present iff KpiStep.wearByWorkarea is non-empty — only in interactive mode)`);

  console.log(`\n  (d) Q-table size growth tied to key count? YES — getQ() creates an entry on first`);
  console.log(`      access, so qTable.size == number of distinct keys ever observed in all episodes.`);
  console.log(`      A saturated table of 391 requires 391 distinct (dim0,dim1,dim2,dim3,dim4,dim5)`);
  console.log(`      combinations. Under 6-dim design this is trivially achievable.`);
}

main().catch(err => { console.error("Probe failed:", err); process.exit(1); });
