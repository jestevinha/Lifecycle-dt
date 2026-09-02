/**
 * Queries the dt.sqlite database for experiment 27 config and
 * samples episode rewards to understand the variance pattern.
 * Run: npx tsx packages/engine/src/probe-exp27-query.ts
 */
import Database from "better-sqlite3";
import path from "node:path";

const DB_PATH = path.resolve(__dirname, "../../api/dt.sqlite");
const db = new Database(DB_PATH, { readonly: true });

// ── Experiment config ────────────────────────────────────────────────────────
const exp = db.prepare("SELECT id, config_json, status FROM experiments WHERE id = 27").get() as
  | { id: number; config_json: string; status: string }
  | undefined;

if (!exp) {
  console.log("Experiment 27 not found in database.");
  process.exit(0);
}

console.log("═══════════════════════════════════════════════════════");
console.log("Experiment 27 config:");
console.log("═══════════════════════════════════════════════════════");
const config = JSON.parse(exp.config_json);
console.log(JSON.stringify(config, null, 2));
console.log();

// Compute what seeds would be used per episode
console.log("─── Seed computation (config.simSeed + i) ───");
console.log(`config.simSeed = ${config.simSeed} (type: ${typeof config.simSeed})`);
for (let i = 0; i < 5; i++) {
  const seed = config.simSeed + i;
  console.log(`  i=${i}: seed = ${config.simSeed} + ${i} = ${seed}  (String: "${String(seed)}")`);
}
console.log();

// ── Episode rewards from runs ────────────────────────────────────────────────
const runs = db.prepare("SELECT id, agent_type FROM runs WHERE experiment_id = 27").all() as
  { id: number; agent_type: string }[];

console.log(`─── Runs (${runs.length} total) ───`);
for (const run of runs) {
  const episodes = db.prepare(
    "SELECT episode_num, action, action_name, reward FROM episodes WHERE run_id = ? ORDER BY episode_num"
  ).all(run.id) as { episode_num: number; action: number; action_name: string; reward: number }[];

  const rewardsByAction = new Map<string, number[]>();
  for (const ep of episodes) {
    const key = ep.action_name;
    if (!rewardsByAction.has(key)) rewardsByAction.set(key, []);
    rewardsByAction.get(key)!.push(ep.reward);
  }

  console.log(`\nRun ${run.id} — ${run.agent_type} (${episodes.length} episodes):`);
  for (const [action, rewards] of rewardsByAction) {
    const distinctValues = new Set(rewards.map(r => r.toFixed(4)));
    const min = Math.min(...rewards);
    const max = Math.max(...rewards);
    const mean = rewards.reduce((a, b) => a + b, 0) / rewards.length;
    console.log(`  action=${action.padEnd(20)} n=${rewards.length.toString().padStart(3)}  distinct=${distinctValues.size.toString().padStart(3)}  min=${min.toFixed(4)}  max=${max.toFixed(4)}  mean=${mean.toFixed(4)}`);
    if (distinctValues.size <= 6) {
      console.log(`    values: ${[...distinctValues].join(", ")}`);
    }
  }
}

// ── KPI step sample for first episode ────────────────────────────────────────
console.log("\n─── KPI steps sample (first episode, run 1) ───");
const firstRun = runs[0];
if (firstRun) {
  const firstEp = db.prepare(
    "SELECT id, episode_num FROM episodes WHERE run_id = ? ORDER BY episode_num LIMIT 1"
  ).get(firstRun.id) as { id: number; episode_num: number } | undefined;

  if (firstEp) {
    const kpiSteps = db.prepare(
      "SELECT step, total_rate, product_cost, num_accidents, amb_temperature, raw_material_quality, wear_by_workarea FROM kpi_steps WHERE episode_id = ? ORDER BY step"
    ).all(firstEp.id) as {
      step: number; total_rate: number; product_cost: number;
      num_accidents: number; amb_temperature: number; raw_material_quality: number;
      wear_by_workarea: string | null;
    }[];

    console.log(`Episode ${firstEp.episode_num}: ${kpiSteps.length} KPI steps`);
    if (kpiSteps.length > 0) {
      console.log(`  step | totalRate | productCost | accidents | ambTemp | rawMat`);
      for (const s of kpiSteps.slice(0, 8)) {
        console.log(`  ${String(s.step).padStart(4)} | ${s.total_rate.toFixed(4).padStart(9)} | ${s.product_cost.toFixed(4).padStart(11)} | ${String(s.num_accidents).padStart(9)} | ${s.amb_temperature.toFixed(4).padStart(7)} | ${s.raw_material_quality.toFixed(4)}`);
      }
    }
  }
}

// ── Check if ambTemperature varies across first episodes ────────────────────
console.log("\n─── ambTemperature at step 0 across first 10 episodes (run 1) ───");
if (firstRun) {
  const first10Eps = db.prepare(
    "SELECT id, episode_num FROM episodes WHERE run_id = ? ORDER BY episode_num LIMIT 10"
  ).all(firstRun.id) as { id: number; episode_num: number }[];

  for (const ep of first10Eps) {
    const step0 = db.prepare(
      "SELECT amb_temperature, raw_material_quality FROM kpi_steps WHERE episode_id = ? AND step = 0"
    ).get(ep.id) as { amb_temperature: number; raw_material_quality: number } | undefined;
    const epReward = db.prepare("SELECT reward FROM episodes WHERE id = ?").get(ep.id) as { reward: number } | undefined;
    console.log(`  ep${ep.episode_num.toString().padStart(3)}: ambTemp=${step0?.amb_temperature?.toFixed(4) ?? "null"} rawMat=${step0?.raw_material_quality?.toFixed(4) ?? "null"} reward=${epReward?.reward?.toFixed(4) ?? "null"}`);
  }
}

db.close();
