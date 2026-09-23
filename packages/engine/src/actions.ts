import type { Action } from "./types.js";

/**
 * Factored action space: 5 setpoint rates × 2 maintenance choices = 10 actions.
 *
 * The agent picks BOTH a rate and whether to fire maintenance THIS shift, on the
 * most-worn eligible workarea. Maintenance timing is now a direct, per-shift agent
 * decision — the environment no longer auto-fires it by comparing live wear to a
 * static threshold baked into the chosen action (the previous 4-threshold design).
 *
 * Rationale (2026-09-19, see 04-Experiments/Maintenance-Timing-State-Redesign.md
 * in the vault): under the old threshold design, reactivity to wear lived in the
 * environment (`shouldTriggerMaintenance` compared *actual* live wear to the
 * action's threshold every shift, independent of what state the agent observed),
 * so a context-free bandit (MAB) got wear-reactive maintenance "for free" from a
 * single fixed action — exp 55 showed MAB (mean reward -130.7) beating Q-Learning
 * (-253.1) and LinUCB (-197.9) precisely because state-conditioning bought nothing.
 * With maintenance now a raw this-shift choice with no environment-side wear check,
 * an agent that cannot observe maxWearFraction (MAB) must pick ONE fixed
 * maintain-now/no-maintain choice for the entire run and pay for it every shift
 * (either constant wasted-maintenance penalties or eventual wear failures), while
 * Q-Learning/LinUCB can learn to condition on observed wear and fire maintenance
 * only when it's actually high — the thing state-conditioning is supposed to buy.
 */
const RATES = [
  { name: "very_low",  rate: 0.20 },
  { name: "low",       rate: 0.35 },
  { name: "medium",    rate: 0.50 },
  { name: "high",      rate: 0.65 },
  { name: "very_high", rate: 0.80 },
];

const MAINT_CHOICES = [
  { name: "no_maint",  maintainNow: false },
  { name: "maint_now", maintainNow: true },
];

export const ACTIONS: Action[] = RATES.flatMap((r, ri) =>
  MAINT_CHOICES.map((m, mi) => ({
    id:           ri * MAINT_CHOICES.length + mi,
    name:         `${r.name}_${m.name}`,
    setpointRate: r.rate,
    maintainNow:  m.maintainNow,
  })),
);

/** Number of Java simulation steps per shift (8 × 60 min = 480 min) */
export const STEPS_PER_SHIFT = 8;
