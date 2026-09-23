import os from "node:os";
import path from "node:path";
import { Router } from "express";
import {
  getDb, runSimulation, runInteractiveSimulation, ACTIONS,
  MABAgent, LinUCBAgent, QLearningAgent,
  extractState, clockToMinutes,
  computeStepReward, aggregateShiftReward,
  resolveRewardWeights,
  STEPS_PER_SHIFT,
  WEAR_THRESHOLD, TOTAL_WORKAREAS,
  validateExperimentConfig,
} from "@dt/engine";
import type { ExperimentConfig, KpiStep, AgentConfig, Agent, State, StepRewardComponents, StepCommand } from "@dt/engine";
import { initSSE, sendSSE, endSSE } from "../sse.js";

export const experimentsRouter = Router();

/** List all experiments */
experimentsRouter.get("/", (_req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM experiments ORDER BY created_at DESC").all();
  res.json(rows);
});

/** Get single experiment with its runs */
experimentsRouter.get("/:id", (req, res) => {
  const db = getDb();
  const exp = db.prepare("SELECT * FROM experiments WHERE id = ?").get(req.params.id);
  if (!exp) return res.status(404).json({ error: "Not found" });

  const runs = db.prepare("SELECT * FROM runs WHERE experiment_id = ?").all(req.params.id);
  res.json({ ...exp as object, runs });
});

/** Get episodes for a run */
experimentsRouter.get("/runs/:runId/episodes", (req, res) => {
  const db = getDb();
  const episodes = db
    .prepare("SELECT * FROM episodes WHERE run_id = ? ORDER BY episode_num")
    .all(req.params.runId);
  res.json(episodes);
});

/** Get KPI steps for an episode */
experimentsRouter.get("/episodes/:episodeId/kpi", (req, res) => {
  const db = getDb();
  const steps = db
    .prepare("SELECT * FROM kpi_steps WHERE episode_id = ? ORDER BY step")
    .all(req.params.episodeId);
  res.json(steps);
});

/** Delete an experiment and all related data */
experimentsRouter.delete("/:id", (req, res) => {
  const db = getDb();
  const exp = db.prepare("SELECT id FROM experiments WHERE id = ?").get(req.params.id);
  if (!exp) return res.status(404).json({ error: "Not found" });

  const deleteAll = db.transaction(() => {
    const runIds = db
      .prepare("SELECT id FROM runs WHERE experiment_id = ?")
      .all(req.params.id)
      .map((r: any) => r.id);

    for (const runId of runIds) {
      const episodeIds = db
        .prepare("SELECT id FROM episodes WHERE run_id = ?")
        .all(runId)
        .map((e: any) => e.id);

      for (const epId of episodeIds) {
        db.prepare("DELETE FROM kpi_steps WHERE episode_id = ?").run(epId);
      }
      db.prepare("DELETE FROM episodes WHERE run_id = ?").run(runId);
    }
    db.prepare("DELETE FROM runs WHERE experiment_id = ?").run(req.params.id);
    db.prepare("DELETE FROM experiments WHERE id = ?").run(req.params.id);
  });

  deleteAll();
  res.json({ ok: true });
});

/** Create a new experiment */
experimentsRouter.post("/", (req, res) => {
  const config: ExperimentConfig = req.body;

  // ── Pre-flight, fail-fast config gate. Runs at the creation layer BEFORE any
  // experiment row is written and before the SSE stream (GET /:id/start) is ever
  // opened. An invalid config is rejected with a 4xx and never pollutes the
  // experiments table with a status='failed' row. runExperiment keeps its own
  // validateExperimentConfig call as defense-in-depth for direct callers that
  // bypass this route (scripts, tests). (added 2026-08-01) ──
  try {
    validateExperimentConfig(config);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(400).json({ error: message });
  }

  const db = getDb();
  const result = db
    .prepare("INSERT INTO experiments (config_json, status) VALUES (?, 'pending')")
    .run(JSON.stringify(config));
  res.status(201).json({ id: result.lastInsertRowid });
});

/**
 * `seed` (Known-Bugs-Fixed #12, fixed 2026-09-05): threads `config.simSeed`
 * into MAB's and Q-Learning's ε-greedy exploration RNG so their behavior is
 * reproducible given a seed, the same way the Java simulator and LinUCB
 * (which has no RNG dependency) already are. Optional/undefined-safe: a
 * caller that doesn't pass a seed keeps the prior unseeded (Math.random)
 * behavior.
 */
function createAgent(cfg: AgentConfig, seed?: number): Agent {
  const h = cfg.hyperparams;
  switch (cfg.type) {
    case "mab":
      return new MABAgent(h.epsilon, h.epsilonDecay, h.epsilonMin, !!h.useConstantAlpha, h.alpha ?? 0.1, seed);
    case "linucb":
      return new LinUCBAgent(h.alpha);
    case "qlearning":
      return new QLearningAgent(h.alpha, h.gamma, h.epsilon, h.epsilonDecay, h.epsilonMin, seed, !!h.useConstantAlpha);
  }
}

/**
 * Start experiment with SSE progress streaming.
 * GET /api/experiments/:id/start
 */
experimentsRouter.get("/:id/start", (req, res) => {
  const db = getDb();
  const exp = db.prepare("SELECT * FROM experiments WHERE id = ?").get(req.params.id) as
    | { id: number; config_json: string; status: string }
    | undefined;

  if (!exp) return res.status(404).json({ error: "Not found" });

  initSSE(res);

  // Mark as running
  db.prepare("UPDATE experiments SET status = 'running' WHERE id = ?").run(exp.id);
  sendSSE(res, "status", { status: "running", experimentId: exp.id });

  const config: ExperimentConfig = JSON.parse(exp.config_json);
  const useInteractive = config.interactive === true;

  console.log(`[experiment ${exp.id}] Starting — mode=${useInteractive ? "interactive" : "batch"}, steps=${config.simSteps}, episodes=${config.totalEpisodes}, agents=${config.agents.map(a => a.type).join(",")}`);

  // Batch mode does not support temporal credit assignment: every episode is
  // treated as terminal (done=true), so Q-Learning's γ·max Q[s'] bootstrap is
  // never exercised, and LinUCB only sees episode-level aggregated context.
  // Results from batch mode cannot be used to support the thesis comparative claim.
  if (!useInteractive) {
    const temporalAgents = config.agents.filter(a => a.type === "qlearning" || a.type === "linucb");
    if (temporalAgents.length > 0) {
      const names = temporalAgents.map(a => a.type).join(", ");
      console.warn(
        `[experiment ${exp.id}] WARNING: batch mode with temporal agent(s) [${names}]. ` +
        `Q-Learning bootstrap is suppressed (always terminal); LinUCB context is episode-level only. ` +
        `Batch results are NOT valid for the thesis comparative claim — use interactive mode.`
      );
      sendSSE(res, "warning", {
        message: `Batch mode with temporal agent(s) [${names}] — results not valid for thesis comparison. Use interactive mode.`,
      });
    }
  }

  // Run the experiment loop (async for interactive mode)
  runExperiment(db, exp.id, config, useInteractive, res)
    .then(() => {
      console.log(`[experiment ${exp.id}] Completed`);
      db.prepare("UPDATE experiments SET status = 'completed' WHERE id = ?").run(exp.id);
      sendSSE(res, "status", { status: "completed", experimentId: exp.id });
      endSSE(res);
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[experiment ${exp.id}] Failed: ${message}`);
      db.prepare("UPDATE experiments SET status = 'failed' WHERE id = ?").run(exp.id);
      sendSSE(res, "error", { status: "failed", error: message });
      endSSE(res);
    });
});

export async function runExperiment(
  db: ReturnType<typeof getDb>,
  expId: number,
  config: ExperimentConfig,
  useInteractive: boolean,
  res: import("express").Response,
) {
  // ── Pre-flight, fail-loud config validation. MUST be first: throws before any
  // run/episode is inserted or any simulation is spawned (added 2026-08-01). ──
  validateExperimentConfig(config);

  const insertRun = db.prepare(
    "INSERT INTO runs (experiment_id, agent_type, hyperparams_json, total_episodes, reward_profile) VALUES (?, ?, ?, ?, ?)"
  );
  const insertEpisode = db.prepare(
    `INSERT INTO episodes (run_id, episode_num, action, action_name, reward,
     avg_production_rate, total_accidents, avg_product_cost, energy_per_part, epsilon, q_table_size,
     max_wear_at_maint, unplanned_failures, unplanned_failure_free, execution_mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertKpiStep = db.prepare(
    `INSERT INTO kpi_steps (episode_id, step, total_rate, product_cost, num_accidents,
     amb_temperature, raw_material_quality, cum_production, cum_energy, cum_cost,
     curr_power, setpoint_rate, clock, wear_by_workarea)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const updateRunReward = db.prepare("UPDATE runs SET final_reward = ? WHERE id = ?");

  for (const agentCfg of config.agents) {
    const agent = createAgent(agentCfg, config.simSeed);
    const rewardProfile = agentCfg.rewardProfile ?? "balanced";
    const weights = resolveRewardWeights(agentCfg.rewardProfile);

    const epsInfo = agent.getEpsilon?.() != null
      ? ` ε=${agent.getEpsilon!()},decay=${agent.getEpsilonDecay!()}`
      : "";
    console.log(`[exp${expId}] ${agentCfg.type} profile=${rewardProfile} ${config.totalEpisodes}ep TW=${weights.throughputWeight} CW=${weights.costWeight}${epsInfo}`);

    const runResult = insertRun.run(
      expId, agentCfg.type, JSON.stringify(agentCfg.hyperparams), config.totalEpisodes, rewardProfile
    );
    const runId = runResult.lastInsertRowid;

    let bestReward = -Infinity;
    let worstReward = Infinity;
    let bestEpisodeIdx = 0;
    let worstEpisodeIdx = 0;
    const episodeData: { steps: KpiStep[]; episodeId: number }[] = [];

    // Rolling state from previous episode (init to defaults)
    let prevState: State = {
      ambTemperature: 20,
      rawMaterialQuality: 0.5,
      stepNorm: 0,
      shiftPhaseNorm: 0,
      numberAccidents: 0,
    };

    for (let i = 0; i < config.totalEpisodes; i++) {
      const ACTION_SEED_OFFSET = 500;

      let steps: KpiStep[];
      let dominantActionId: number;
      let stepRewards: StepRewardComponents[] = [];
      let avgWearAtMaint: number | null = null;
      const wearAtMaintValues: number[] = [];
      let episodeUnplannedFailures = 0;

      if (useInteractive && config.perWorkareaMode) {
        // ── Per-workarea interactive mode (2026-09-20) ──
        // Same shift-level cadence as the plant-wide mode below, but the
        // agent makes ONE selectAction/update decision PER WORKAREA per
        // shift (16 instead of 1), each seeing that workarea's own wear
        // fraction instead of the plant-wide max, and each workarea is sent
        // its own rate. All 16 decisions this shift are trained on the SAME
        // shift-level aggregate reward (the reward function stays plant-wide
        // and unchanged — only what each decision SEES and CONTROLS differs).
        // The preventive-maintenance slot stays capped at 1/shift plant-wide:
        // among workareas whose chosen action requests maintenance, only the
        // highest-wear one actually gets it — the others' rate still applies,
        // but their maintenance request goes unserved this shift, which they
        // then learn from via the normal reward signal (same capacity
        // contention already documented for the single-decision mode in
        // Reward-Function-Evolution.md). See Parameter-Sharing-Across-Actions.md
        // in the vault for the design rationale.
        const seed = config.simSeed + i;
        const actionCounts = new Map<number, number>(); // pooled across all 16 workareas' choices

        let decisionStates: State[] = new Array(TOTAL_WORKAREAS).fill(prevState);
        let currentActionIds: number[] = new Array(TOTAL_WORKAREAS).fill(0);
        let prevAccidents = 0;
        let prevWear: number[] = new Array(TOTAL_WORKAREAS).fill(0);
        let subStep = 0;
        // Every workarea whose own decision requests maintainNow this shift
        // gets it — no 1-per-shift arbitration (2026-09-21, see
        // Per-Workarea-Rate-Control.md: removed specifically to test whether
        // the shared-reward credit-assignment noise from workareas losing
        // that arbitration was driving Q-Learning's divergence in exp 71).
        let maintTargets: number[] = [];
        let shiftStepRewards: StepRewardComponents[] = [];
        let accidentsAtShiftStart = 0;

        // First decision of the run/episode has no per-workarea wear data yet
        // (prevWear is all zero) — every workarea starts from the same
        // plant-wide prevState, same convention the single-decision mode
        // already uses for its first-ever decision.
        for (let wa = 0; wa < TOTAL_WORKAREAS; wa++) {
          currentActionIds[wa] = agent.selectAction(prevState);
        }

        function resolveCommandPerWorkarea(): StepCommand {
          const rates = currentActionIds.map(aid => ACTIONS[aid].setpointRate);
          // Same eligibility rule as the plant-wide mode (exclude workareas
          // already at/above WEAR_THRESHOLD) — every eligible workarea whose
          // own action requests maintainNow gets it this shift, no cap.
          const targets: number[] = [];
          for (let wa = 0; wa < TOTAL_WORKAREAS; wa++) {
            if (!ACTIONS[currentActionIds[wa]].maintainNow) continue;
            if (prevWear[wa] <= 0 || prevWear[wa] >= WEAR_THRESHOLD) continue;
            targets.push(wa);
          }
          maintTargets = targets;
          for (const t of targets) wearAtMaintValues.push(prevWear[t]);
          return { rate: rates, maintainWorkarea: targets.length > 0 ? targets : undefined };
        }

        const initialCmd = resolveCommandPerWorkarea();

        steps = await runInteractiveSimulation(
          { steps: config.simSteps, seed, wearRateSpread: config.wearRateSpread },
          initialCmd,
          (kpiStep: KpiStep, stepIndex: number) => {
            subStep++;

            sendSSE(res, "step", {
              agentType: agentCfg.type,
              episode: i,
              stepIndex,
              kpiStep,
            });

            for (const aid of currentActionIds) {
              actionCounts.set(aid, (actionCounts.get(aid) ?? 0) + 1);
            }

            const accidentDelta = kpiStep.numberAccidents - prevAccidents;
            prevAccidents = kpiStep.numberAccidents;
            const reward = computeStepReward(kpiStep, accidentDelta, prevWear, maintTargets, weights);
            stepRewards.push(reward);       // full-episode accumulation, for the reported reward below
            shiftStepRewards.push(reward);  // resets each shift, for the agent's training signal
            episodeUnplannedFailures += reward.newFailures;
            prevWear = kpiStep.wearByWorkarea ? [...kpiStep.wearByWorkarea] : prevWear;

            if (subStep >= STEPS_PER_SHIFT || stepIndex === config.simSteps - 1) {
              const shiftReward = aggregateShiftReward(shiftStepRewards);

              if (i === 0) {
                const maxW = prevWear.length > 0 ? Math.max(...prevWear) / WEAR_THRESHOLD : 0;
                console.log(
                  `[trace ${agentCfg.type} ep0] step=${stepIndex} maxWear=${(maxW * 100).toFixed(1)}% ` +
                  `maint=${maintTargets.length > 0 ? maintTargets.map(t => `wa${t}`).join(",") : "no"} R=${shiftReward.toFixed(2)}`,
                );
              }

              const shiftAccidentCount = kpiStep.numberAccidents - accidentsAtShiftStart;
              accidentsAtShiftStart = kpiStep.numberAccidents;
              const done = stepIndex === config.simSteps - 1;

              // Update and re-select for every workarea, all on the same
              // shift-level reward — see the block comment above this branch.
              for (let wa = 0; wa < TOTAL_WORKAREAS; wa++) {
                const nextWorkareaState = extractState(
                  { ...kpiStep, numberAccidents: shiftAccidentCount },
                  config.simSteps,
                  wa,
                );
                agent.update(currentActionIds[wa], shiftReward, decisionStates[wa], nextWorkareaState, done);
                decisionStates[wa] = nextWorkareaState;
                currentActionIds[wa] = agent.selectAction(nextWorkareaState);
              }
              subStep = 0;
              shiftStepRewards = [];

              return resolveCommandPerWorkarea();
            }

            return { rate: currentActionIds.map(aid => ACTIONS[aid].setpointRate) };
          },
        );

        if (steps.length === 0) {
          console.warn(`[experiment] Episode ${i} produced no steps, skipping`);
          continue;
        }

        for (const aid of currentActionIds) {
          actionCounts.set(aid, (actionCounts.get(aid) ?? 0) + 1);
        }

        dominantActionId = 0;
        let maxCount = 0;
        for (const [aid, count] of actionCounts) {
          if (count > maxCount) { maxCount = count; dominantActionId = aid; }
        }

        if (wearAtMaintValues.length > 0) {
          avgWearAtMaint = wearAtMaintValues.reduce((s, v) => s + v, 0) / wearAtMaintValues.length;
        }
      } else if (useInteractive) {
        // ── Interactive mode: shift-level agent control ──
        // Agent decides once per shift (every STEPS_PER_SHIFT Java steps).
        // Within a shift, the setpoint and maintenance command are held constant.
        const seed = config.simSeed + i;
        const actionCounts = new Map<number, number>();
        stepRewards = [];

        // First action based on previous episode's final state.
        // decisionState tracks which state was given to selectAction for currentActionId
        // so that agent.update receives the DECISION-TIME context, not the next state.
        let decisionState: State = prevState;
        let currentActionId = agent.selectAction(prevState);
        let prevAccidents = 0;
        let prevWear: number[] = new Array(16).fill(0);

        // Track sub-step within the current shift
        let subStep = 0;
        // The rate from the current action (always present now)
        let shiftRate = ACTIONS[currentActionId].setpointRate;
        // Workareas being maintained this shift (empty = none). 2026-09-21:
        // ALL eligible workareas, not just the single most-worn one — see the
        // resolveCommand() comment below and Per-Workarea-Rate-Control.md.
        let maintTargets: number[] = [];
        // Accumulate per-step rewards within a shift for the agent update
        let shiftStepRewards: StepRewardComponents[] = [];
        // Cumulative accident count (Java's raw field) as of the start of the
        // current shift (Known-Bugs-Fixed #15, fixed 2026-09-11). Java's
        // `numberAccidents` is a running total for the whole episode, so
        // feeding it straight into State would give a signal that only ever
        // grows and saturates Q-Learning's top bin (≥3) within the first few
        // shifts of every ~100-shift episode — dead for ~90% of the episode.
        // Subtracting this tracker at each shift boundary turns it back into
        // a live, shift-scoped "did the last shift go badly" signal that
        // resets every shift instead of ratcheting upward, for both
        // Q-Learning's discretization and LinUCB's linear feature.
        let accidentsAtShiftStart = 0;

        // Resolve command from current action.
        // Maintenance fires this shift iff the chosen action's maintainNow flag
        // is set — a direct per-shift agent decision, not an environment-side
        // comparison of live wear to a static threshold. The agent must observe
        // wear (maxWearFraction, interactive-mode state) to time this well; an
        // agent that can't (MAB) has to pick one fixed maintain-now/no-maintain
        // choice for the whole run. See actions.ts for the full rationale.
        function resolveCommand(): number | StepCommand {
          shiftRate = ACTIONS[currentActionId].setpointRate;
          // Maintain EVERY eligible workarea when maintainNow fires, not just
          // the single most-worn one (2026-09-21 — João: the point is for the
          // agent to find the optimum wear at which to request maintenance
          // via the natural too-early/too-late trade-off, not to have the
          // environment additionally ration a scarce slot on top of that
          // decision — see Per-Workarea-Rate-Control.md). "Eligible" is
          // unchanged: 0 < wear < WEAR_THRESHOLD (has accumulated some wear,
          // not already failed/auto-maintaining).
          const maintTargetsThisShift = ACTIONS[currentActionId].maintainNow
            ? prevWear.reduce<number[]>((acc, w, idx) => {
                if (w > 0 && w < WEAR_THRESHOLD) acc.push(idx);
                return acc;
              }, [])
            : [];
          maintTargets = maintTargetsThisShift;
          if (maintTargetsThisShift.length > 0) {
            for (const idx of maintTargetsThisShift) wearAtMaintValues.push(prevWear[idx]);
            return { rate: shiftRate, maintainWorkarea: maintTargetsThisShift };
          }
          return shiftRate;
        }

        let initialCmd = resolveCommand();

        steps = await runInteractiveSimulation(
          { steps: config.simSteps, seed, wearRateSpread: config.wearRateSpread },
          initialCmd,
          (kpiStep: KpiStep, stepIndex: number) => {
            subStep++;

            // Stream live step to dashboard
            sendSSE(res, "step", {
              agentType: agentCfg.type,
              episode: i,
              stepIndex,
              kpiStep,
            });

            // Count action usage for dominant action
            actionCounts.set(currentActionId, (actionCounts.get(currentActionId) ?? 0) + 1);

            // Per-step reward with failure & wear penalties
            const accidentDelta = kpiStep.numberAccidents - prevAccidents;
            prevAccidents = kpiStep.numberAccidents;
            // maintTargets: this shift's deliberate MAINT workareas (empty if
            // none), set by resolveCommand() below and in scope for every step
            // of this shift — threading it here fixes Known-Bugs-Fixed #13 (a
            // deliberate late-threshold maintenance reset no longer miscounts
            // as a failure).
            const reward = computeStepReward(kpiStep, accidentDelta, prevWear, maintTargets, weights);
            stepRewards.push(reward);
            shiftStepRewards.push(reward);
            episodeUnplannedFailures += reward.newFailures;
            prevWear = kpiStep.wearByWorkarea ? [...kpiStep.wearByWorkarea] : prevWear;

            // At shift boundary: aggregate shift reward, update agent, select next action
            if (subStep >= STEPS_PER_SHIFT || stepIndex === config.simSteps - 1) {
              let shiftReward = aggregateShiftReward(shiftStepRewards);

              // No maintenance-timing penalty here (removed 2026-09-19, see
              // Known-Bugs-Fixed / Qlearning-Linear-Approximation in the vault):
              // maintenance's only cost is the natural production loss while the
              // targeted workarea is offline (Unit.java sets currRate=0 under
              // STATUS_MAINTENANCE, which the `throughput` term already reflects
              // for however many steps it stays offline). An explicit hand-tuned
              // penalty on top of that would bias the agent toward a modeler's
              // assumption about "ideal" wear timing instead of letting it learn
              // the tradeoff from the environment's actual, unbiased signal.

              // Episode-0 sanity trace: one line per shift, so you can eyeball
              // whether the agent's maintenance timing actually varies with wear.
              if (i === 0) {
                const maxW = prevWear.length > 0 ? Math.max(...prevWear) / WEAR_THRESHOLD : 0;
                const action = ACTIONS[currentActionId];
                console.log(
                  `[trace ${agentCfg.type} ep0] step=${stepIndex} ` +
                  `wear=${(maxW * 100).toFixed(1)}% ` +
                  `action=${action.name}(rate=${action.setpointRate},maintainNow=${action.maintainNow}) ` +
                  `maint=${maintTargets.length > 0 ? maintTargets.map(t => `wa${t}`).join(",") : "no"} ` +
                  `R=${shiftReward.toFixed(2)}`,
                );
              }

              // Shift-scoped accident count (Known-Bugs-Fixed #15): accidents
              // that occurred DURING this shift, not the episode-cumulative
              // total. Reset the tracker to the new cumulative baseline so
              // next shift's delta is computed against this shift's end.
              const shiftAccidentCount = kpiStep.numberAccidents - accidentsAtShiftStart;
              accidentsAtShiftStart = kpiStep.numberAccidents;
              const shiftState = extractState(
                { ...kpiStep, numberAccidents: shiftAccidentCount },
                config.simSteps,
              );
              // Terminal shift has no successor → Q-Learning uses reward only.
              const done = stepIndex === config.simSteps - 1;
              // prevState = decisionState (the state given to selectAction for this shift)
              // nextState = shiftState  (state after the shift, used by Q-Learning bootstrap)
              agent.update(currentActionId, shiftReward, decisionState, shiftState, done);

              // Select next action; update decisionState for the next shift's update call
              decisionState = shiftState;
              currentActionId = agent.selectAction(shiftState);
              subStep = 0;
              shiftStepRewards = [];

              // Resolve command for next shift
              const cmd = resolveCommand();
              return cmd;
            }

            // Within a shift: hold the same command
            // Only send MAINT on first sub-step; rest of shift just sends rate
            if (maintTargets.length > 0 && subStep === 1) {
              // First sub-step after shift boundary already sent MAINT via resolveCommand
              // Subsequent sub-steps just send the rate (wear already reset)
              return shiftRate;
            }
            return shiftRate;
          },
        );

        if (steps.length === 0) {
          console.warn(`[experiment] Episode ${i} produced no steps, skipping`);
          continue;
        }

        // Count the last step's action too
        actionCounts.set(currentActionId, (actionCounts.get(currentActionId) ?? 0) + 1);

        // Dominant action = most frequently chosen
        dominantActionId = 0;
        let maxCount = 0;
        for (const [aid, count] of actionCounts) {
          if (count > maxCount) { maxCount = count; dominantActionId = aid; }
        }

        // Average maxWear at maintenance triggers this episode
        if (wearAtMaintValues.length > 0) {
          avgWearAtMaint = wearAtMaintValues.reduce((s, v) => s + v, 0) / wearAtMaintValues.length;
        }
      } else {
        // ── Batch mode (unchanged) ──
        const actionId = agent.selectAction(prevState);
        dominantActionId = actionId;

        const seed = config.simSeed + (actionId * ACTION_SEED_OFFSET) + i;
        const action = ACTIONS[actionId];
        const outputDir = path.join(os.tmpdir(), "dt-sim", String(expId), agentCfg.type);

        steps = runSimulation({
          steps: config.simSteps,
          seed,
          setpointRate: action.setpointRate,
          outputDir,
        });
      }

      const firstStep = steps[0];
      const lastStep  = steps[steps.length - 1];

      // Extract state from this episode's outcome (used next iteration).
      // numberAccidents is now shift-scoped, not episode-cumulative
      // (Known-Bugs-Fixed #15). At a fresh episode's first decision there is
      // no "current shift" yet to have had accidents in, so carry 0 — the
      // same default the very first episode's prevState already uses —
      // rather than lastStep's raw episode-cumulative total, which would
      // otherwise immediately re-saturate next episode's first decision.
      // (This does not touch Known-Bugs-Fixed #16, the separate stale-carry
      // issue for the other 4 dimensions — out of scope for this fix.)
      prevState = extractState(
        useInteractive ? { ...lastStep, numberAccidents: 0 } : lastStep,
        config.simSteps,
      );

      // Compute episode reward
      let reward: number;
      const avgTotalRate   = steps.reduce((s, k) => s + k.totalRate,    0) / steps.length;
      const avgProductCost = steps.reduce((s, k) => s + k.productCost,  0) / steps.length;
      const newAccidents   = lastStep.numberAccidents - firstStep.numberAccidents;

      if (useInteractive && stepRewards.length > 0) {
        // Interactive: aggregate per-step rewards (preserves sharp failure signal).
        //
        // Recomputes aggregateShiftReward(stepRewards) from scratch, same as the
        // per-shift reward the agent trained on above — the two are now identical
        // (previously they diverged by the maintenance-timing penalty subtracted
        // from the training signal only; that penalty was removed 2026-09-19, so
        // there is nothing left for this recomputation to exclude).
        reward = aggregateShiftReward(stepRewards);
      } else {
        // Batch mode: original formula (no wear/failure data available)
        const lastClockMin = clockToMinutes(lastStep.clock);
        const numShifts    = Math.max(lastClockMin / 480, 1);
        reward = avgTotalRate - weights.costWeight * avgProductCost - weights.accidentPenalty * (newAccidents / numShifts);
      }

      // Energy efficiency: kWh per part (cumEnergy is in Wh)
      const energyPerPart  = lastStep.cumProduction > 0
        ? (lastStep.cumEnergy / 1000) / lastStep.cumProduction
        : null;

      // Agent learns from outcome (batch mode only — interactive already did per-step updates)
      // Batch is a single-decision episode: treat as terminal (no TD bootstrap).
      if (!useInteractive) {
        // Batch: prevState = decision-time context; done=true suppresses Q-Learning bootstrap.
        agent.update(dominantActionId, reward, prevState, prevState, true);
      }

      // Per-episode epsilon decay (moved out of per-update to avoid over-decaying)
      agent.decayEpsilon?.();
      // Advance LinUCB round-robin counter
      agent.advanceEpisode?.();

      const epsilon = agent.getEpsilon?.() ?? null;
      const qTableSize = agent.getStateSize?.() ?? null;

      const avgProductionRate = avgTotalRate;
      const actionName = ACTIONS[dominantActionId].name;

      // Log first, last, and every 25th episode
      if (i === 0 || i === config.totalEpisodes - 1 || (i + 1) % 25 === 0) {
        const mc = wearAtMaintValues.length;
        const mw = mc > 0 ? `${(wearAtMaintValues.reduce((a, b) => a + b, 0) / mc / WEAR_THRESHOLD * 100).toFixed(0)}%` : "-";
        const eps = epsilon != null ? ` e${epsilon.toFixed(2)}` : "";
        console.log(`  ${agentCfg.type} #${i} ${actionName} R=${reward.toFixed(1)} acc=${newAccidents} fail=${episodeUnplannedFailures} r=${avgTotalRate.toFixed(2)} m=${mc}@${mw}${eps}`);
      }

      const epResult = insertEpisode.run(
        runId, i, dominantActionId, actionName, reward,
        avgProductionRate, lastStep.numberAccidents, avgProductCost,
        energyPerPart, epsilon, qTableSize, avgWearAtMaint,
        episodeUnplannedFailures,
        episodeUnplannedFailures === 0 ? 1 : 0,
        useInteractive ? "interactive" : "batch",
      );
      const episodeId = Number(epResult.lastInsertRowid);
      episodeData.push({ steps, episodeId });

      if (reward > bestReward) { bestReward = reward; bestEpisodeIdx = i; }
      if (reward < worstReward) { worstReward = reward; worstEpisodeIdx = i; }

      sendSSE(res, "progress", {
        agentType: agentCfg.type,
        episode: i + 1,
        totalEpisodes: config.totalEpisodes,
        reward,
        status: "progress",
      });
    }

    // Write kpi_steps for first, last, best, worst episodes
    const kpiIndices = new Set([0, config.totalEpisodes - 1, bestEpisodeIdx, worstEpisodeIdx]);
    for (const idx of kpiIndices) {
      const ep = episodeData[idx];
      if (!ep) continue;
      for (const step of ep.steps) {
        insertKpiStep.run(
          ep.episodeId, step.step, step.totalRate, step.productCost, step.numberAccidents,
          step.ambTemperature, step.rawMaterialQuality, step.cumProduction, step.cumEnergy,
          step.cumCost, step.currPower, step.setpointRate, step.clock,
          step.wearByWorkarea ? JSON.stringify(step.wearByWorkarea) : null
        );
      }
    }

    updateRunReward.run(bestReward, runId);
  }
}
