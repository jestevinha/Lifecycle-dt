import type { Action } from "./types.js";

/**
 * Factored action space: 5 setpoint rates × 4 maintenance thresholds = 20 actions.
 *
 * The agent picks BOTH a rate and a wear-fraction threshold. Maintenance fires on
 * the most-worn workarea only when its wear fraction reaches that threshold —
 * so the agent can learn wear-conditional policies like "run at high rate, maintain
 * only when wear >= 0.85" instead of the previous "always maintain every shift".
 *
 * Thresholds:
 *   Infinity → never maintain (pure throughput policy)
 *   0.90     → only when close to failure
 *   0.75     → aggressive preventive
 *   0.60     → conservative preventive (wasteful unless wear climbs fast)
 */
const RATES = [
  { name: "very_low",  rate: 0.20 },
  { name: "low",       rate: 0.35 },
  { name: "medium",    rate: 0.50 },
  { name: "high",      rate: 0.65 },
  { name: "very_high", rate: 0.80 },
];

const THRESHOLDS = [
  { name: "no_maint", value: Infinity },
  { name: "t90",      value: 0.90 },
  { name: "t75",      value: 0.75 },
  { name: "t60",      value: 0.60 },
];

export const ACTIONS: Action[] = RATES.flatMap((r, ri) =>
  THRESHOLDS.map((t, ti) => ({
    id:                   ri * THRESHOLDS.length + ti,
    name:                 `${r.name}_${t.name}`,
    setpointRate:         r.rate,
    maintenanceThreshold: t.value,
  })),
);

/** Number of Java simulation steps per shift (8 × 60 min = 480 min) */
export const STEPS_PER_SHIFT = 8;

/** Whether this action can ever trigger maintenance (threshold != Infinity). */
export function isMaintenanceAction(actionId: number): boolean {
  return Number.isFinite(ACTIONS[actionId]?.maintenanceThreshold ?? Infinity);
}

/**
 * Evaluate the action's maintenance policy against current wear.
 * Returns true iff the shift's max wear fraction meets the action's threshold.
 */
export function shouldTriggerMaintenance(
  actionId: number,
  maxWearFraction: number,
): boolean {
  const threshold = ACTIONS[actionId]?.maintenanceThreshold;
  if (threshold === undefined || !Number.isFinite(threshold)) return false;
  return maxWearFraction >= threshold;
}
