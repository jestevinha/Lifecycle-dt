import { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { fetchExperiment, fetchEpisodes, runKey, runLabel, runColor } from "../api";
import type { Episode, Run } from "../api";
import { RunLegend } from "./RunLegend";

interface ChartPoint {
  episode: number;
  [key: string]: number;
}

function rollingAvg(arr: number[], window: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = arr.slice(start, i + 1);
    result.push(slice.reduce((a, b) => a + b, 0) / slice.length);
  }
  return result;
}

export function LearningCurves({ experimentId }: { experimentId: number }) {
  const [data, setData] = useState<ChartPoint[]>([]);
  const [energyData, setEnergyData] = useState<ChartPoint[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const exp = await fetchExperiment(experimentId);
      const expRuns: Run[] = exp.runs ?? [];
      if (expRuns.length === 0) return;

      const episodesByRun: Record<string, Episode[]> = {};

      await Promise.all(
        expRuns.map(async (run) => {
          episodesByRun[runKey(run)] = await fetchEpisodes(run.id);
        }),
      );

      if (cancelled) return;

      const maxEp = Math.max(
        ...Object.values(episodesByRun).map((eps) => eps.length),
      );

      // Compute rolling averages for reward
      const avgByRun: Record<string, number[]> = {};
      const energyAvgByRun: Record<string, number[]> = {};
      for (const run of expRuns) {
        const key = runKey(run);
        const rewards = episodesByRun[key]?.map((e) => e.reward) ?? [];
        avgByRun[key] = rollingAvg(rewards, 5);
        const energies = episodesByRun[key]?.map((e) => e.energy_per_part ?? 0) ?? [];
        energyAvgByRun[key] = rollingAvg(energies, 5);
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
      setData(points);
      setEnergyData(ePoints);
    })();
    return () => { cancelled = true; };
  }, [experimentId]);

  if (data.length === 0) return null;

  return (
    <section className="rounded-2xl bg-gray-900 p-6">
      <h2 className="mb-2 text-lg font-semibold text-gray-100">Learning Curves</h2>
      <RunLegend runs={runs} />
      <ResponsiveContainer width="100%" height={360}>
        <LineChart data={data} margin={{ top: 5, right: 20, bottom: 25, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="episode"
            stroke="#9CA3AF"
            label={{ value: "Episode", position: "insideBottom", offset: -15, fill: "#9CA3AF" }}
          />
          <YAxis
            stroke="#9CA3AF"
            label={{ value: "Reward", angle: -90, position: "insideLeft", fill: "#9CA3AF" }}
          />
          <Tooltip
            contentStyle={{ backgroundColor: "#1F2937", border: "1px solid #374151", borderRadius: 8 }}
            labelStyle={{ color: "#D1D5DB" }}
            formatter={(value: number) => Number(value.toFixed(2))}
          />
          {runs.map((run) => (
            <Line
              key={runKey(run)}
              type="monotone"
              dataKey={runKey(run)}
              name={`${runLabel(run)} (raw)`}
              stroke={runColor(run)}
              strokeOpacity={0.25}
              dot={false}
              strokeWidth={1}
            />
          ))}
          {runs.map((run) => (
            <Line
              key={`${runKey(run)}_avg`}
              type="monotone"
              dataKey={`${runKey(run)}_avg`}
              name={`${runLabel(run)} (avg5)`}
              stroke={runColor(run)}
              dot={false}
              strokeWidth={2}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      {energyData.length > 0 && (
        <>
          <h2 className="mb-2 mt-8 text-lg font-semibold text-gray-100">
            Energy Efficiency (kWh/part)
          </h2>
          <ResponsiveContainer width="100%" height={360}>
            <LineChart data={energyData} margin={{ top: 5, right: 20, bottom: 25, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="episode"
                stroke="#9CA3AF"
                label={{ value: "Episode", position: "insideBottom", offset: -15, fill: "#9CA3AF" }}
              />
              <YAxis
                stroke="#9CA3AF"
                label={{ value: "kWh / part", angle: -90, position: "insideLeft", fill: "#9CA3AF" }}
              />
              <Tooltip
                contentStyle={{ backgroundColor: "#1F2937", border: "1px solid #374151", borderRadius: 8 }}
                labelStyle={{ color: "#D1D5DB" }}
                formatter={(value: number) => Number(value.toFixed(4))}
              />
              {runs.map((run) => (
                <Line
                  key={runKey(run)}
                  type="monotone"
                  dataKey={runKey(run)}
                  name={`${runLabel(run)} (raw)`}
                  stroke={runColor(run)}
                  strokeOpacity={0.25}
                  dot={false}
                  strokeWidth={1}
                />
              ))}
              {runs.map((run) => (
                <Line
                  key={`${runKey(run)}_avg`}
                  type="monotone"
                  dataKey={`${runKey(run)}_avg`}
                  name={`${runLabel(run)} (avg5)`}
                  stroke={runColor(run)}
                  dot={false}
                  strokeWidth={2}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
    </section>
  );
}
