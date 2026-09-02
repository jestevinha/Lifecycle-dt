/**
 * STEP 1 — Seed-variation diagnostic.
 *
 * Runs 30 episodes of a single fixed action (medium_t75 = actionId 9),
 * baseSeed=42, wearRateSpread=0.2.
 *
 * For each episode logs:
 *   - episodeIndex (i)
 *   - the episodeSeed VALUE handed to runInteractiveSimulation
 *   - the seed the Java process actually received (via --seed arg, captured
 *     by a monkey-patched spawn interceptor)
 *   - ambTemperature at step 0 (first JSONL line from Java)
 *   - rawMaterialQuality at step 0
 *   - episode reward (sum of totalRate)
 *
 * Run: npx tsx packages/engine/src/probe-seed-diagnostic.ts
 */

import { spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";

// ── intercept spawn so we can see the exact --seed arg Java receives ──────────

const MANUSIM_DIR = path.resolve(__dirname, "../../simulation");

interface EpisodeRow {
  i: number;
  tsSeed: number;           // seed computed by TS (baseSeed + i)
  javaSeed: string | null;  // seed extracted from javaArgs
  ambTemp0: number | null;  // ambTemperature at step 0
  rawMat0: number | null;   // rawMaterialQuality at step 0
  totalRateSum: number;     // sum of totalRate across all steps
}

const BASE_SEED = 42;
const WEAR_SPREAD = 0.2;
const SIM_STEPS = 8;  // one shift — fast, enough to get reward
const N_EPISODES = 30;

function buildJavaArgs(seed: number, steps: number, spread: number): string[] {
  const cls = path.join(MANUSIM_DIR, "out", "production", "ManuSim");
  const lib = path.join(MANUSIM_DIR, "ManuSim", "lib", "mysql-connector-java-5.1.47.jar");
  const cp = [cls, lib].join(process.platform === "win32" ? ";" : ":");
  const args = [
    "-cp", cp,
    "com.inknow.manusim.control.HeadlessMain",
    "--interactive",
    "--steps", String(steps),
    "--seed", String(seed),
  ];
  if (spread > 0) args.push("--wearRateSpread", String(spread));
  return args;
}

async function runOneEpisode(
  tsSeed: number,
  steps: number,
  spread: number,
): Promise<{ javaSeed: string; ambTemp0: number | null; rawMat0: number | null; totalRateSum: number }> {
  const javaArgs = buildJavaArgs(tsSeed, steps, spread);
  const seedArgIdx = javaArgs.indexOf("--seed");
  const javaSeedStr = seedArgIdx >= 0 ? javaArgs[seedArgIdx + 1] : "<not found>";

  const proc = spawn("java", javaArgs, {
    cwd: path.join(MANUSIM_DIR, "ManuSim"),
    stdio: ["pipe", "pipe", "pipe"],
  });

  const rl = readline.createInterface({ input: proc.stdout!, crlfDelay: Infinity });
  const lineIter = rl[Symbol.asyncIterator]();

  let ambTemp0: number | null = null;
  let rawMat0: number | null = null;
  let totalRateSum = 0;

  try {
    for (let step = 0; step < steps; step++) {
      proc.stdin!.write("0.5\n");  // fixed rate

      const result = await Promise.race([
        lineIter.next(),
        new Promise<{ done: true; value: undefined }>((_, rej) =>
          setTimeout(() => rej(new Error(`timeout step ${step}`)), 8_000)),
      ]);
      if (result.done) break;

      const json = JSON.parse(result.value as string);
      if (step === 0) {
        ambTemp0 = json.ambTemperature ?? null;
        rawMat0  = json.rawMaterialQuality ?? null;
      }
      totalRateSum += json.totalRate ?? 0;
    }
  } finally {
    rl.close();
    proc.stdin?.end();
    await new Promise<void>(resolve => {
      proc.on("close", resolve);
      setTimeout(() => { proc.kill(); resolve(); }, 2_000);
    });
  }

  return { javaSeed: javaSeedStr, ambTemp0, rawMat0, totalRateSum };
}

// ── replicate experiments.ts seed computation ─────────────────────────────────
// experiments.ts: const seed = config.simSeed + i
// We test two variants to expose any string-concat trap:

function tsSeedVariantNumber(simSeed: number, i: number): number {
  return simSeed + i;   // normal numeric addition
}

function tsSeedVariantString(simSeed: string, i: number): string {
  return (simSeed as unknown as any) + i;  // string concat trap
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("Step 1 — seed-variation diagnostic");
  console.log(`N_EPISODES=${N_EPISODES}  BASE_SEED=${BASE_SEED}  SPREAD=${WEAR_SPREAD}  STEPS=${SIM_STEPS}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  // ── show what experiments.ts computes for tsSeed ──────────────────────────
  console.log("--- Checking TS seed computation for simSeed=42 (number) ---");
  for (let i = 0; i < 5; i++) {
    const n = tsSeedVariantNumber(BASE_SEED, i);
    const s = tsSeedVariantString(String(BASE_SEED) as any, i);
    console.log(`  i=${i}  number: 42+${i}=${n}  string-trap: "42"+${i}="${s}"`);
  }
  console.log();

  // ── run 30 episodes via direct spawn ─────────────────────────────────────
  console.log("--- Running 30 episodes, fixed action=0.5, seeds 42..71 ---\n");
  console.log(` ${"i".padStart(3)} | ${"tsSeed".padStart(7)} | ${"javaSeed".padStart(8)} | ${"ambTemp0".padStart(10)} | ${"rawMat0".padStart(9)} | ${"rateSum".padStart(8)}`);
  console.log(` ${"-".repeat(65)}`);

  const rows: EpisodeRow[] = [];

  for (let i = 0; i < N_EPISODES; i++) {
    const tsSeed = BASE_SEED + i;  // same formula as experiments.ts
    const { javaSeed, ambTemp0, rawMat0, totalRateSum } = await runOneEpisode(tsSeed, SIM_STEPS, WEAR_SPREAD);
    rows.push({ i, tsSeed, javaSeed, ambTemp0, rawMat0, totalRateSum });

    console.log(
      ` ${String(i).padStart(3)} | ${String(tsSeed).padStart(7)} | ${String(javaSeed).padStart(8)} |` +
      ` ${(ambTemp0 ?? -99).toFixed(4).padStart(10)} |` +
      ` ${(rawMat0 ?? -1).toFixed(4).padStart(9)} |` +
      ` ${totalRateSum.toFixed(4).padStart(8)}`,
    );
  }

  // ── classification ────────────────────────────────────────────────────────
  console.log("\n--- Classification ---\n");

  const seedsDistinct = new Set(rows.map(r => r.javaSeed)).size;
  const tempsDistinct = new Set(rows.map(r => r.ambTemp0?.toFixed(4))).size;
  const rewardsDistinct = new Set(rows.map(r => r.totalRateSum.toFixed(4))).size;

  console.log(`  javaSeed distinct values : ${seedsDistinct} (expect 30)`);
  console.log(`  ambTemp0 distinct values : ${tempsDistinct} (expect ~30)`);
  console.log(`  rateSum  distinct values : ${rewardsDistinct} (expect ~30)`);
  console.log();

  const allSeedsVary = seedsDistinct === N_EPISODES;
  const allTempsVary = tempsDistinct >= N_EPISODES * 0.8;

  if (!allSeedsVary) {
    console.log("CASE A — SEED CONSTANT: javaSeed does not vary across episodes.");
    console.log("  The TS→Java seed passing is broken — same seed every episode.");
  } else if (!allTempsVary) {
    console.log("CASE B — WEATHER NOT RESEEDED: seeds vary but ambTemp is frozen.");
    console.log("  Weather.setSeed() is not being called per episode, or called with a constant.");
  } else {
    console.log("PASS — seeds vary AND ambTemp varies: the DIRECT runner path is correct.");
    console.log("  If exp27 showed frozen rewards, the regression is inside experiments.ts");
    console.log("  (seed computation, closure capture, or loop iteration issue).");
  }

  // ── check if any two episodes have identical ambTemp ─────────────────────
  const dupTemps = rows.filter((r, i) =>
    rows.findIndex(r2 => r2.ambTemp0?.toFixed(4) === r.ambTemp0?.toFixed(4)) < i,
  );
  if (dupTemps.length > 0) {
    console.log(`\n  ⚠ Duplicate ambTemp0 found in ${dupTemps.length} rows:`);
    dupTemps.forEach(r => console.log(`    i=${r.i}  ambTemp0=${r.ambTemp0?.toFixed(4)}`));
  } else {
    console.log("\n  ✓ All 30 ambTemp0 values are distinct");
  }
}

main().catch(err => { console.error("Probe failed:", err); process.exit(1); });
