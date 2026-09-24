import { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { fetchExperiment, fetchEpisodes, runKey, runLabel, runColor } from "../api";
import type { Episode, Run } from "../api";
import { RunLegend } from "./RunLegend";
import { Card, CardMessage } from "../ui";
import { CHART, T, niceAxis } from "../theme";

// Must match engine reward.ts — Java's Const.NO_PARTS_WEAR_BREAKDOWN.
const WEAR_THRESHOLD = 4320;

interface WearPoint {
  episode: number;
  [run: string]: number | null;
}

export function MaintenanceWearChart({ experimentId, className }: { experimentId: number; className?: string }) {
  const [data, setData] = useState<WearPoint[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const exp = await fetchExperiment(experimentId);
      const expRuns: Run[] = exp.runs ?? [];
      if (expRuns.length === 0) { if (!cancelled) { setData([]); setLoading(false); } return; }

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
      if (!hasWearData) { setData([]); setLoading(false); return; }

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
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [experimentId]);

  // Fit the axis to the data: agents typically service at a few percent wear,
  // which a fixed 0–100% axis squashes into a flat line along the bottom.
  // The 95% failure line is drawn only when the data actually reaches it.
  let maxPct = 0;
  for (const p of data) {
    for (const run of runs) {
      const v = p[runKey(run)];
      if (v != null && v > maxPct) maxPct = v;
    }
  }
  const showFailure = maxPct >= 60;
  const y = showFailure
    ? { ticks: [0, 25, 50, 75, 95], domain: [0, 100] as [number, number] }
    : niceAxis(0, Math.max(maxPct * 1.1, 1), 4);
  const x = niceAxis(0, Math.max(data.length - 1, 1), 4);

  return (
    <Card
      className={className}
      title="Maintenance trigger wear"
      subtitle={showFailure ? "max wear % when service fired" : `max wear % when service fired · failure at 95% (off scale)`}
    >
      {loading ? (
        <CardMessage>Loading episodes…</CardMessage>
      ) : data.length === 0 ? (
        <CardMessage>No wear data — run in interactive mode to record it.</CardMessage>
      ) : (
        <>
          <RunLegend runs={runs} />
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data} margin={{ top: 6, right: 8, bottom: 14, left: 0 }}>
              <CartesianGrid {...CHART.grid} />
              <XAxis
                dataKey="episode"
                {...CHART.axis}
                type="number"
                domain={[0, Math.max(data.length - 1, 1)]}
                ticks={x.ticks.filter((t) => t <= data.length - 1)}
                label={{ value: "Episode", position: "insideBottom", offset: -8, ...CHART.axisLabel }}
              />
              <YAxis
                {...CHART.axis}
                domain={y.domain}
                ticks={y.ticks}
                allowDataOverflow
                tickFormatter={(v: number) => `${v}%`}
                width={44}
              />
              {showFailure && (
                <ReferenceLine
                  y={95}
                  stroke={T.crit}
                  strokeDasharray="5 4"
                  label={{ value: "Failure", fill: T.crit, fontSize: 11, fontWeight: 600, position: "insideTopRight" }}
                />
              )}
              <Tooltip
                {...CHART.tooltip}
                formatter={(value: unknown) => (value != null ? `${Number(value).toFixed(1)}%` : "—")}
                labelFormatter={(label) => `Episode ${label}`}
              />
              {runs.map((run) => (
                <Line
                  key={runKey(run)}
                  type="monotone"
                  dataKey={runKey(run)}
                  name={runLabel(run)}
                  stroke={runColor(run)}
                  strokeWidth={1.75}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
    </Card>
  );
}
