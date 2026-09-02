import { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { fetchExperiment, fetchEpisodes } from "../api";
import type { Episode, Run } from "../api";

const AGENT_COLORS: Record<string, string> = {
  mab: "#0D9488",
  linucb: "#7C3AED",
  qlearning: "#E11D48",
};

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
  const [agents, setAgents] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const exp = await fetchExperiment(experimentId);
      const runs: Run[] = exp.runs ?? [];
      if (runs.length === 0) return;

      const agentNames = runs.map((r) => r.agent_type);
      const episodesByAgent: Record<string, Episode[]> = {};

      await Promise.all(
        runs.map(async (run) => {
          episodesByAgent[run.agent_type] = await fetchEpisodes(run.id);
        }),
      );

      if (cancelled) return;

      const maxEp = Math.max(
        ...Object.values(episodesByAgent).map((eps) => eps.length),
      );

      // Compute rolling averages for reward
      const avgByAgent: Record<string, number[]> = {};
      const energyAvgByAgent: Record<string, number[]> = {};
      for (const agent of agentNames) {
        const rewards = episodesByAgent[agent]?.map((e) => e.reward) ?? [];
        avgByAgent[agent] = rollingAvg(rewards, 5);
        const energies = episodesByAgent[agent]?.map((e) => e.energy_per_part ?? 0) ?? [];
        energyAvgByAgent[agent] = rollingAvg(energies, 5);
      }

      const points: ChartPoint[] = [];
      const ePoints: ChartPoint[] = [];
      for (let i = 0; i < maxEp; i++) {
        const point: ChartPoint = { episode: i };
        const ePoint: ChartPoint = { episode: i };
        for (const agent of agentNames) {
          point[agent] = episodesByAgent[agent]?.[i]?.reward ?? 0;
          point[`${agent}_avg`] = avgByAgent[agent]?.[i] ?? 0;
          ePoint[agent] = episodesByAgent[agent]?.[i]?.energy_per_part ?? 0;
          ePoint[`${agent}_avg`] = energyAvgByAgent[agent]?.[i] ?? 0;
        }
        points.push(point);
        ePoints.push(ePoint);
      }

      setAgents(agentNames);
      setData(points);
      setEnergyData(ePoints);
    })();
    return () => { cancelled = true; };
  }, [experimentId]);

  if (data.length === 0) return null;

  return (
    <section className="rounded-2xl bg-gray-900 p-6">
      <h2 className="mb-4 text-lg font-semibold text-gray-100">Learning Curves</h2>
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
          <Legend verticalAlign="top" height={36} />
          {agents.map((agent) => (
            <Line
              key={agent}
              type="monotone"
              dataKey={agent}
              name={`${agent} (raw)`}
              stroke={AGENT_COLORS[agent] ?? "#888"}
              strokeOpacity={0.25}
              dot={false}
              strokeWidth={1}
            />
          ))}
          {agents.map((agent) => (
            <Line
              key={`${agent}_avg`}
              type="monotone"
              dataKey={`${agent}_avg`}
              name={`${agent} (avg5)`}
              stroke={AGENT_COLORS[agent] ?? "#888"}
              dot={false}
              strokeWidth={2}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      {energyData.length > 0 && (
        <>
          <h2 className="mb-4 mt-8 text-lg font-semibold text-gray-100">
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
              <Legend verticalAlign="top" height={36} />
              {agents.map((agent) => (
                <Line
                  key={agent}
                  type="monotone"
                  dataKey={agent}
                  name={`${agent} (raw)`}
                  stroke={AGENT_COLORS[agent] ?? "#888"}
                  strokeOpacity={0.25}
                  dot={false}
                  strokeWidth={1}
                />
              ))}
              {agents.map((agent) => (
                <Line
                  key={`${agent}_avg`}
                  type="monotone"
                  dataKey={`${agent}_avg`}
                  name={`${agent} (avg5)`}
                  stroke={AGENT_COLORS[agent] ?? "#888"}
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
