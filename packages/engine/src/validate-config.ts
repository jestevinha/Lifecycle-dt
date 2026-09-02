import type { ExperimentConfig } from "./types.js";

/**
 * Pre-flight configuration validation for the experiment runner.
 *
 * Fail-loud gate: THROWS (does not warn or log) on under-specified or degenerate
 * configs that would otherwise run to completion and silently produce invalid results.
 *
 * Added 2026-08-01 after Experiment 29 silently ran with:
 *   - wearRateSpread=0 → lockstep wear across all 16 workareas (a known simulator
 *     degeneracy that collapses every maintenance-timing tier into one reward band), and
 *   - empty MAB hyperparams ({}) → constructor defaults ε₀=1.0 / decay=0.91 instead of
 *     the confirmed F=50 / decay=0.91201.
 * Neither condition raised any signal; both invalidated the results post-hoc.
 *
 * Call ONCE at the start of the runner, before any episode executes.
 */
export function validateExperimentConfig(config: ExperimentConfig): void {
  // ── Check 1: lockstep-wear degeneracy ──
  // wearRateSpread=0 (or unset) makes all workareas wear in lockstep — a known
  // degenerate condition, not a valid experimental setting. Must be a nonzero spread
  // in (0,1], unless the run DELIBERATELY opts into it via allowDegenerateWear.
  const spread = config.wearRateSpread;
  if (!config.allowDegenerateWear && (spread === undefined || spread === 0)) {
    const received = spread === undefined ? "undefined (unset)" : String(spread);
    throw new Error(
      `[validateExperimentConfig] wearRateSpread=${received} — lockstep wear across all 16 ` +
      `workareas is a known degenerate simulator condition, not a valid experimental setting. ` +
      `Set wearRateSpread to a nonzero value in (0,1], or set allowDegenerateWear:true to ` +
      `deliberately opt into a lockstep ablation.`,
    );
  }

  // ── Check 2: MAB hyperparams must be fully specified (no silent constructor defaults) ──
  // createAgent() calls `new MABAgent(h.epsilon, h.epsilonDecay, ...)`; any missing key
  // falls through to a constructor default. Require the two that define the ε schedule so
  // an empty/partial hyperparams object can never silently reach those defaults.
  const MAB_DEFAULTS: Record<string, string> = {
    epsilon:      "1.0 (ε₀ start)",
    epsilonDecay: "0.91 (per-episode decay — NOT the confirmed F=50 / 0.91201)",
  };
  for (const agent of config.agents) {
    if (agent.type !== "mab") continue;
    const h = agent.hyperparams ?? {};
    const missing = Object.keys(MAB_DEFAULTS).filter((k) => h[k] === undefined);
    if (missing.length > 0) {
      const detail = missing
        .map((k) => `${k} (would silently default to ${MAB_DEFAULTS[k]})`)
        .join(", ");
      throw new Error(
        `[validateExperimentConfig] MAB agent has under-specified hyperparams — missing: ${detail}. ` +
        `An empty or partial hyperparams object must not reach the MABAgent constructor defaults. ` +
        `Specify epsilon and epsilonDecay explicitly in the agent config.`,
      );
    }
  }
}
