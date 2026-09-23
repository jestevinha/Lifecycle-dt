import { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { fetchExperiment, fetchEpisodes, runKey, runLabel, runColor } from "../api";
import type { Episode, Run } from "../api";
import { RunLegend } from "./RunLegend";

// Must match engine reward.ts — Java's Const.NO_PARTS_WEAR_BREAKDOWN.
const WEAR_THRESHOLD = 4320;

interface WearPoint {
  episode: number;
  [run: string]: number | null;
}

export function MaintenanceWearChart({ experimentId }: { experimentId: number }) {
  const [data, setData] = useState<WearPoint[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const exp = await fetchExperiment(experimentId);
      const expRuns: Run[] = exp.runs ?? [];
      if (expRuns.length === 0) return;

      const runEpisodes: Record<string, Episode[]> = {};

      await Promise.all(
        expRuns.map(async (run) => {
          const episodes: Episode[] = await fetchEpisodes(run.id);
          runEpisodes[runKey(run)] = episodes;
        }),
      );

      if (cancelled) return;

      // Check if any episodes have wear data
      const hasWearData = Object.values(runEpisodes).some(
        (eps) => eps.some((ep) => ep.max_wear_at_maint != null),
      );
      if (!hasWearData) return;

      // Build data points — one per episode number
      const maxEpisodes = Math.max(...Object.values(runEpisodes).map((e) => e.length));
      const points: WearPoint[] = [];
      for (let i = 0; i < maxEpisodes; i++) {
        const point: WearPoint = { episode: i };
        for (const run of expRuns) {
          const key = runKey(run);
          const ep = runEpisodes[key]?.[i];
          if (ep?.max_wear_at_maint != null) {
            // Clamp to [0, 100] — values above 100% mean the workarea ran past
            // failure before the trigger fired (sim quirk; visualised as 100).
            const pct = (ep.max_wear_at_maint / WEAR_THRESHOLD) * 100;
            point[key] = Math.min(100, Math.max(0, pct));
          } else {
            point[key] = null;
          }
        }
        points.push(point);
      }

      setRuns(expRuns);
      setData(points);
    })();
    return () => { cancelled = true; };
  }, [experimentId]);

  if (data.length === 0) return null;

  return (
    <section className="rounded-2xl bg-gray-900 p-6">
      <h2 className="mb-2 text-lg font-semibold text-gray-100">
        Maintenance Trigger Wear{" "}
        <span className="text-sm font-normal text-gray-400">
          (avg max wear % when maintenance was triggered)
        </span>
      </h2>
      <RunLegend runs={runs} />
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 5, right: 20, bottom: 25, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="episode"
            stroke="#9CA3AF"
            label={{ value: "Episode", position: "insideBottom", offset: -15, fill: "#9CA3AF" }}
          />
          <YAxis
            stroke="#9CA3AF"
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 95, 100]}
            allowDataOverflow
            tickFormatter={(v: number) => `${v}%`}
            width={56}
            label={{ value: "Wear %", angle: -90, position: "insideLeft", fill: "#9CA3AF" }}
          />
          <ReferenceLine y={95} stroke="#EF4444" strokeDasharray="6 3" label={{ value: "Failure (95%)", fill: "#EF4444", fontSize: 11, position: "right" }} />
          <Tooltip
            contentStyle={{ backgroundColor: "#1F2937", border: "1px solid #374151", borderRadius: 8 }}
            labelStyle={{ color: "#D1D5DB" }}
            formatter={(value: unknown) => value != null ? `${Number(value).toFixed(1)}%` : "—"}
            labelFormatter={(label) => `Episode ${label}`}
          />
          {runs.map((run) => (
            <Line
              key={runKey(run)}
              type="monotone"
              dataKey={runKey(run)}
              name={runLabel(run)}
              stroke={runColor(run)}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
}
