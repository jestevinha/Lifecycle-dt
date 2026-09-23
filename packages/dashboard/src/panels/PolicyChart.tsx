import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { fetchExperiment, fetchEpisodes, runKey, runLabel, runColor } from "../api";
import type { Episode, Run } from "../api";
import { RunLegend } from "./RunLegend";

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

interface DistPoint {
  rate: string;
  [run: string]: string | number;
}

export function PolicyChart({ experimentId }: { experimentId: number }) {
  const [data, setData] = useState<DistPoint[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const exp = await fetchExperiment(experimentId);
      const expRuns: Run[] = exp.runs ?? [];
      if (expRuns.length === 0) return;

      const distributions: Record<string, Record<string, number>> = {};

      await Promise.all(
        expRuns.map(async (run) => {
          const episodes: Episode[] = await fetchEpisodes(run.id);
          // Last 50% of episodes
          const cutoff = Math.floor(episodes.length * 0.5);
          const tail = episodes.slice(cutoff);

          // Count by rate group (merge maint/no-maint)
          const counts: Record<string, number> = {};
          for (const ep of tail) {
            const group = rateGroup(ep.action_name);
            counts[group] = (counts[group] ?? 0) + 1;
          }
          const total = tail.length || 1;
          for (const [k, v] of Object.entries(counts)) {
            counts[k] = Math.round((v / total) * 100);
          }
          distributions[runKey(run)] = counts;
        }),
      );

      if (cancelled) return;

      const points: DistPoint[] = RATE_ORDER.map((rate) => {
        const point: DistPoint = { rate };
        for (const run of expRuns) {
          point[runKey(run)] = distributions[runKey(run)]?.[rate] ?? 0;
        }
        return point;
      });

      setRuns(expRuns);
      setData(points);
    })();
    return () => { cancelled = true; };
  }, [experimentId]);

  if (data.length === 0) return null;

  return (
    <section className="rounded-2xl bg-gray-900 p-6">
      <h2 className="mb-2 text-lg font-semibold text-gray-100">
        Policy Distribution <span className="text-sm font-normal text-gray-400">(last 50% episodes, grouped by setpoint rate)</span>
      </h2>
      <RunLegend runs={runs} />
      <ResponsiveContainer width="100%" height={360}>
        <BarChart data={data} margin={{ top: 5, right: 20, bottom: 25, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="rate"
            stroke="#9CA3AF"
            tick={{ fontSize: 12 }}
          />
          <YAxis
            stroke="#9CA3AF"
            label={{ value: "%", angle: -90, position: "insideLeft", fill: "#9CA3AF" }}
          />
          <Tooltip
            contentStyle={{ backgroundColor: "#1F2937", border: "1px solid #374151", borderRadius: 8 }}
            labelStyle={{ color: "#D1D5DB" }}
            formatter={(value: number) => Number(value.toFixed(2))}
          />
          {runs.map((run) => (
            <Bar
              key={runKey(run)}
              dataKey={runKey(run)}
              name={runLabel(run)}
              fill={runColor(run)}
              radius={[4, 4, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}
