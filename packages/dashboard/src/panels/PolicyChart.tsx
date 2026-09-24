import { useEffect, useState } from "react";
import { fetchExperiment, fetchEpisodes, runKey, runLabel, runColor } from "../api";
import type { Episode, Run } from "../api";
import { Card, CardMessage, Swatch } from "../ui";

/**
 * Extract the rate-group label from an action name.
 *
 * Supports both the legacy "{rate}" / "{rate}+maint" and the current
 * factored "{rate}_{threshold}" naming (e.g. "very_low_no_maint", "high_t75").
 * Rates are matched as prefixes (longest-first to disambiguate
 * "very_low" / "very_high" from "low" / "high").
 */
const RATE_PREFIXES: { prefix: string; label: string }[] = [
  { prefix: "very_low",  label: "very_low (0.20)"  },
  { prefix: "very_high", label: "very_high (0.80)" },
  { prefix: "low",       label: "low (0.35)"       },
  { prefix: "medium",    label: "medium (0.50)"    },
  { prefix: "high",      label: "high (0.65)"      },
];

function rateGroup(actionName: string): string {
  for (const { prefix, label } of RATE_PREFIXES) {
    if (actionName === prefix ||
        actionName.startsWith(`${prefix}_`) ||
        actionName.startsWith(`${prefix}+`)) {
      return label;
    }
  }
  return actionName;
}

const RATE_ORDER = [
  "very_low (0.20)",
  "low (0.35)",
  "medium (0.50)",
  "high (0.65)",
  "very_high (0.80)",
];

/** Sequential teal ramp, light → dark as the set-point rate rises. */
const RATE_COLORS = ["#BFD6D2", "#8DB6B0", "#5E9C95", "#2F6F68", "#143F3B"];
const RATE_SHORT = ["Very low", "Low", "Medium", "High", "Very high"];

/**
 * Whether an action requested maintenance. Covers the factored
 * "{rate}_maint_now" / "{rate}_no_maint" naming and legacy "{rate}+maint".
 * Returns null for naming schemes with no maintenance flag (e.g. "high_t75").
 */
function maintFlag(actionName: string): boolean | null {
  if (actionName.endsWith("_maint_now") || actionName.endsWith("+maint")) return true;
  if (actionName.endsWith("_no_maint")) return false;
  return null;
}

interface RunPolicy {
  run: Run;
  /** Share (0–100) of last-half episodes per RATE_ORDER group. */
  shares: number[];
  /** Share (0–100) of last-half episodes that requested maintenance, or null if the action set has no maintenance flag. */
  maintShare: number | null;
}

export function PolicyChart({ experimentId, className }: { experimentId: number; className?: string }) {
  const [policies, setPolicies] = useState<RunPolicy[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const exp = await fetchExperiment(experimentId);
      const expRuns: Run[] = exp.runs ?? [];

      const result = await Promise.all(
        expRuns.map(async (run): Promise<RunPolicy> => {
          const episodes: Episode[] = await fetchEpisodes(run.id);
          // Last 50% of episodes
          const tail = episodes.slice(Math.floor(episodes.length * 0.5));
          const total = tail.length || 1;

          // Count by rate group (merge maint/no-maint)
          const counts = RATE_ORDER.map(() => 0);
          let maintKnown = 0;
          let maintYes = 0;
          for (const ep of tail) {
            const idx = RATE_ORDER.indexOf(rateGroup(ep.action_name));
            if (idx >= 0) counts[idx]++;
            const flag = maintFlag(ep.action_name);
            if (flag !== null) {
              maintKnown++;
              if (flag) maintYes++;
            }
          }
          return {
            run,
            shares: counts.map((c) => (c / total) * 100),
            maintShare: maintKnown > 0 ? (maintYes / maintKnown) * 100 : null,
          };
        }),
      );

      if (cancelled) return;
      setPolicies(result);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [experimentId]);

  return (
    <Card className={className} title="Policy mix" subtitle="last 50% of episodes">
      {loading ? (
        <CardMessage>Loading episodes…</CardMessage>
      ) : policies.length === 0 ? (
        <CardMessage>No runs in this experiment.</CardMessage>
      ) : (
        <>
          <ul className="flex flex-col gap-4">
            {policies.map(({ run, shares, maintShare }) => (
              <li key={runKey(run)} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                    <Swatch color={runColor(run)} />
                    {runLabel(run)}
                  </span>
                  {maintShare !== null && (
                    <span className="text-xs text-ink-2">
                      maintains in{" "}
                      <b className="tabular font-mono font-semibold text-ink">{maintShare.toFixed(0)}%</b>
                    </span>
                  )}
                </div>
                <div
                  className="flex h-[18px] gap-px overflow-hidden rounded bg-surface"
                  role="img"
                  aria-label={RATE_SHORT.map((r, i) => `${r} ${shares[i].toFixed(0)}%`).join(", ")}
                >
                  {shares.map((pct, i) =>
                    pct > 0 ? (
                      <div
                        key={i}
                        title={`${RATE_ORDER[i]}: ${pct.toFixed(1)}%`}
                        style={{ width: `${pct}%`, backgroundColor: RATE_COLORS[i] }}
                      />
                    ) : null,
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1">
            <span className="text-[11px] text-ink-3">Rate set-point:</span>
            {RATE_SHORT.map((label, i) => (
              <span key={label} className="inline-flex items-center gap-1.5 text-[11px] text-ink-2">
                <Swatch color={RATE_COLORS[i]} />
                {label}
              </span>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
