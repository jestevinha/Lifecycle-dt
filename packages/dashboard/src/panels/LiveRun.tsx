import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { AGENT_COLORS, AGENT_LABELS } from "../api";
import type { SimKpiStep } from "../api";
import { PlantVisualPanel } from "./PlantVisualPanel";
import { Card, CardMessage, StatTile, Swatch } from "../ui";
import { CHART, T } from "../theme";

export interface RunProgress {
  episode: number;
  totalEpisodes: number;
}

/**
 * Live view of a running experiment: plant floor and this episode's
 * production rate on the left (8 columns), run progress, step KPIs and
 * plant environment on the right (4 columns).
 */
export function LiveRun({
  steps,
  agent,
  episode,
  progress,
}: {
  steps: SimKpiStep[];
  agent: string;
  episode: number;
  progress: Record<string, RunProgress>;
}) {
  const last = steps[steps.length - 1];
  const agentColor = AGENT_COLORS[agent] ?? T.accent;
  const entries = Object.entries(progress);
  const done = entries.filter(([, p]) => p.totalEpisodes > 0 && p.episode >= p.totalEpisodes).length;

  return (
    <div className="grid grid-cols-12 gap-5">
      <div className="col-span-12 flex min-w-0 flex-col gap-5 xl:col-span-8">
        <Card title="Plant floor" subtitle="16 workareas · live wear and unit activity">
          {last ? (
            <PlantVisualPanel kpiData={steps} agentName={agent} episode={episode + 1} live showStats={false} />
          ) : (
            <CardMessage>
              Waiting for step data… Live plant data streams in interactive mode only.
            </CardMessage>
          )}
        </Card>
        <Card title="Production rate this episode" subtitle="units per step, max 16">
          {steps.length > 1 ? (
            <ResponsiveContainer width="100%" height={170}>
              <LineChart data={steps} margin={{ top: 6, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid {...CHART.grid} />
                <XAxis dataKey="step" {...CHART.axis} minTickGap={40} />
                <YAxis {...CHART.axis} width={36} domain={[0, "auto"]} />
                <Tooltip
                  {...CHART.tooltip}
                  labelFormatter={(v) => `Step ${v}`}
                  formatter={(value: number) => [value.toFixed(2), "Rate"]}
                />
                <Line type="stepAfter" dataKey="totalRate" stroke={agentColor} strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <CardMessage>No steps yet.</CardMessage>
          )}
        </Card>
      </div>

      <div className="col-span-12 flex min-w-0 flex-col gap-5 xl:col-span-4">
        <Card
          title="Run progress"
          subtitle={entries.length > 0 ? `${done} of ${entries.length} complete` : undefined}
        >
          {entries.length === 0 ? (
            <CardMessage>Waiting for first progress event…</CardMessage>
          ) : (
            <ul className="flex flex-col gap-3">
              {entries.map(([a, p]) => {
                const pct = p.totalEpisodes > 0 ? (p.episode / p.totalEpisodes) * 100 : 0;
                const finished = pct >= 100;
                const color = AGENT_COLORS[a] ?? "#888";
                return (
                  <li key={a} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2 font-semibold text-ink">
                        <Swatch color={color} />
                        {AGENT_LABELS[a] ?? a}
                        {a === agent && !finished && <span className="font-normal text-ink-3">· streaming</span>}
                      </span>
                      <span className="tabular font-mono text-ink-2">
                        {finished ? "Done" : `${p.episode.toLocaleString()} / ${p.totalEpisodes.toLocaleString()}`}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-grid">
                      <div
                        className="h-full rounded-full transition-[width] duration-200"
                        style={{ width: `${pct}%`, backgroundColor: color, opacity: finished ? 0.5 : 1 }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Live KPIs" subtitle={last ? `episode ${episode + 1} · step ${last.step}` : undefined}>
          {last ? (
            <div className="grid grid-cols-2 gap-2.5">
              <StatTile label="Production" value={Math.round(last.cumProduction).toLocaleString()} unit="parts" />
              <StatTile label="Rate" value={last.totalRate.toFixed(1)} unit="/ 16" />
              <StatTile label="Unit cost" value={last.productCost.toFixed(2)} unit="EUR/part" />
              <StatTile label="Shift cost" value={Math.round(last.cumCost).toLocaleString()} unit="EUR" />
              <StatTile label="Accidents" value={last.numberAccidents} unit="this ep." tone={last.numberAccidents > 0 ? "crit" : "ok"} />
              <StatTile label="Set-point" value={last.setpointRate.toFixed(2)} unit="rate" />
            </div>
          ) : (
            <CardMessage>No steps yet.</CardMessage>
          )}
        </Card>

        <Card title="Environment">
          {last ? (
            <dl className="flex flex-col gap-2.5 text-[13px]">
              {[
                ["Ambient temperature", `${last.ambTemperature.toFixed(1)} °C`],
                ["Raw material quality", last.rawMaterialQuality.toFixed(2)],
                ["Power draw", `${(last.currPower / 1000).toFixed(0)} kW`],
                ["Sim clock", last.clock],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-ink-2">{k}</dt>
                  <dd className="tabular font-mono font-semibold text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <CardMessage>No steps yet.</CardMessage>
          )}
        </Card>
      </div>
    </div>
  );
}
