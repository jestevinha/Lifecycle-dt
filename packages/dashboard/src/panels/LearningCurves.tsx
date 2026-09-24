import { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { fetchExperiment, fetchEpisodes, runKey, runLabel, runColor } from "../api";
import type { Episode, Run } from "../api";
import { RunLegend } from "./RunLegend";
import { Card, CardMessage, Segmented } from "../ui";
import { CHART, niceAxis } from "../theme";

interface ChartPoint {
  episode: number;
  [key: string]: number;
}

type Metric = "reward" | "energy";

function rollingAvg(arr: number[], window: number): number[] {
  const result: number[] = [];
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= window) sum -= arr[i - window];
    result.push(sum / Math.min(i + 1, window));
  }
  return result;
}

/**
 * Smoothing window scaled to run length: a fixed 5-episode window is fine for
 * a 100-episode run but leaves a 2000-episode curve as noisy as the raw data.
 * ~1/40th of the run keeps the trend readable at any length.
 */
function smoothingWindow(episodes: number): number {
  return Math.max(5, Math.round(episodes / 40));
}

/**
 * Y range fitted to the smoothed lines rather than the raw points: a handful
 * of early exploration episodes can sit 10× below the converged reward, and
 * letting them set the axis flattens every curve. The first `skip` points are
 * ignored too, since the rolling mean there still averages only a few
 * episodes. Raw points outside the range are clipped (allowDataOverflow).
 */
function fittedRange(data: ChartPoint[], keys: string[], skip: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of data.slice(Math.min(skip, Math.floor(data.length / 2)))) {
    for (const k of keys) {
      const v = p[k];
      if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
  }
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.1;
  return [lo - pad, hi + pad];
}

export function LearningCurves({ experimentId, className }: { experimentId: number; className?: string }) {
  const [rewardData, setRewardData] = useState<ChartPoint[]>([]);
  const [energyData, setEnergyData] = useState<ChartPoint[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [smoothWin, setSmoothWin] = useState(5);
  const [metric, setMetric] = useState<Metric>("reward");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const exp = await fetchExperiment(experimentId);
      const expRuns: Run[] = exp.runs ?? [];
      if (expRuns.length === 0) { if (!cancelled) setLoading(false); return; }

      const episodesByRun: Record<string, Episode[]> = {};
      await Promise.all(
        expRuns.map(async (run) => {
          episodesByRun[runKey(run)] = await fetchEpisodes(run.id);
        }),
      );
      if (cancelled) return;

      const maxEp = Math.max(0, ...Object.values(episodesByRun).map((eps) => eps.length));
      const w = smoothingWindow(maxEp);

      const avgByRun: Record<string, number[]> = {};
      const energyAvgByRun: Record<string, number[]> = {};
      for (const run of expRuns) {
        const key = runKey(run);
        avgByRun[key] = rollingAvg(episodesByRun[key]?.map((e) => e.reward) ?? [], w);
        energyAvgByRun[key] = rollingAvg(episodesByRun[key]?.map((e) => e.energy_per_part ?? 0) ?? [], w);
      }

      const points: ChartPoint[] = [];
      const ePoints: ChartPoint[] = [];
      for (let i = 0; i < maxEp; i++) {
        const point: ChartPoint = { episode: i };
        const ePoint: ChartPoint = { episode: i };
        for (const run of expRuns) {
          const key = runKey(run);
          point[key] = episodesByRun[key]?.[i]?.reward ?? 0;
          point[`${key}_avg`] = avgByRun[key]?.[i] ?? 0;
          ePoint[key] = episodesByRun[key]?.[i]?.energy_per_part ?? 0;
          ePoint[`${key}_avg`] = energyAvgByRun[key]?.[i] ?? 0;
        }
        points.push(point);
        ePoints.push(ePoint);
      }

      setRuns(expRuns);
      setSmoothWin(w);
      setRewardData(points);
      setEnergyData(ePoints);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [experimentId]);

  const data = metric === "reward" ? rewardData : energyData;
  const digits = metric === "reward" ? 2 : 4;
  const y = niceAxis(...fittedRange(data, runs.map((r) => `${runKey(r)}_avg`), smoothWin));
  const x = niceAxis(0, Math.max(data.length - 1, 1), 6);

  return (
    <Card
      className={className}
      title="Learning curve"
      subtitle={`faint = per episode · bold = rolling mean (${smoothWin} ep)`}
      actions={
        <Segmented
          label="Learning curve metric"
          value={metric}
          onChange={setMetric}
          options={[
            { value: "reward", label: "Reward" },
            { value: "energy", label: "kWh / part" },
          ]}
        />
      }
    >
      {loading ? (
        <CardMessage>Loading episodes…</CardMessage>
      ) : data.length === 0 ? (
        <CardMessage>No episodes recorded for this experiment.</CardMessage>
      ) : (
        <>
          <RunLegend runs={runs} />
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 18, left: 4 }}>
              <CartesianGrid {...CHART.grid} />
              <XAxis
                dataKey="episode"
                {...CHART.axis}
                label={{ value: "Episode", position: "insideBottom", offset: -10, ...CHART.axisLabel }}
                type="number"
                domain={[0, Math.max(data.length - 1, 1)]}
                ticks={x.ticks.filter((t) => t <= data.length - 1)}
              />
              <YAxis
                {...CHART.axis}
                width={52}
                domain={y.domain}
                ticks={y.ticks}
                allowDataOverflow
                tickFormatter={(v: number) => (metric === "reward" ? v.toFixed(0) : v.toFixed(2))}
              />
              <Tooltip
                {...CHART.tooltip}
                labelFormatter={(v) => `Episode ${v}`}
                formatter={(value: number) => Number(value.toFixed(digits))}
              />
              {runs.map((run) => (
                <Line
                  key={runKey(run)}
                  type="monotone"
                  dataKey={runKey(run)}
                  name={`${runLabel(run)} (raw)`}
                  stroke={runColor(run)}
                  strokeOpacity={0.12}
                  dot={false}
                  strokeWidth={1}
                  isAnimationActive={false}
                />
              ))}
              {runs.map((run) => (
                <Line
                  key={`${runKey(run)}_avg`}
                  type="monotone"
                  dataKey={`${runKey(run)}_avg`}
                  name={`${runLabel(run)} (mean)`}
                  stroke={runColor(run)}
                  dot={false}
                  strokeWidth={2.25}
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
