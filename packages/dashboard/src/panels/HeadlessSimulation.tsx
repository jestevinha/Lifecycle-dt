import { useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { runHeadlessSimulation } from "../api";
import type { SimKpiStep } from "../api";
import { PlantVisualPanel } from "./PlantVisualPanel";

const METRICS = [
  { key: "totalRate",       label: "Production Rate",   color: "#0D9488" },
  { key: "productCost",     label: "Product Cost",      color: "#7C3AED" },
  { key: "numberAccidents", label: "Accidents",         color: "#E11D48" },
  { key: "cumProduction",   label: "Cum. Production",   color: "#F59E0B" },
  { key: "cumEnergy",       label: "Cum. Energy",       color: "#3B82F6" },
  { key: "currPower",       label: "Current Power",     color: "#EC4899" },
] as const;

type MetricKey = (typeof METRICS)[number]["key"];

export function HeadlessSimulation() {
  const [steps, setSteps] = useState(200);
  const [seed, setSeed] = useState(42);
  const [setpointRate, setSetpointRate] = useState(0.5);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kpiData, setKpiData] = useState<SimKpiStep[] | null>(null);
  const [visibleMetrics, setVisibleMetrics] = useState<Set<MetricKey>>(
    new Set(["totalRate", "productCost", "numberAccidents"]),
  );

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    try {
      const result = await runHeadlessSimulation({ steps, seed, setpointRate });
      setKpiData(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setKpiData(null);
    } finally {
      setRunning(false);
    }
  };

  const toggleMetric = (key: MetricKey) => {
    setVisibleMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Summary stats from last run
  const summary = kpiData && kpiData.length > 0
    ? {
        avgRate: (kpiData.reduce((s, k) => s + k.totalRate, 0) / kpiData.length).toFixed(3),
        avgCost: (kpiData.reduce((s, k) => s + k.productCost, 0) / kpiData.length).toFixed(3),
        totalAccidents: kpiData[kpiData.length - 1].numberAccidents,
        totalProduction: kpiData[kpiData.length - 1].cumProduction.toFixed(1),
        totalEnergy: kpiData[kpiData.length - 1].cumEnergy.toFixed(1),
      }
    : null;

  return (
    <section className="rounded-2xl bg-gray-900 p-6">
      <h2 className="mb-4 text-lg font-semibold text-gray-100">
        Headless Simulation
      </h2>

      {/* Controls */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Setpoint Rate — prominent slider */}
        <div className="sm:col-span-2 lg:col-span-2">
          <label className="mb-1 block text-sm font-medium text-gray-300">
            Setpoint Rate
          </label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={setpointRate}
              onChange={(e) => setSetpointRate(Number(e.target.value))}
              className="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-gray-700 accent-teal-500"
              disabled={running}
            />
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={setpointRate}
              onChange={(e) => setSetpointRate(Math.min(1, Math.max(0, Number(e.target.value))))}
              className="w-20 rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-center text-sm text-gray-200 focus:border-teal-500 focus:outline-none"
              disabled={running}
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">Steps</label>
          <input
            type="number"
            min={1}
            value={steps}
            onChange={(e) => setSteps(Number(e.target.value))}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 focus:border-teal-500 focus:outline-none"
            disabled={running}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">Seed</label>
          <div className="flex gap-2">
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value))}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 focus:border-teal-500 focus:outline-none"
              disabled={running}
            />
            <button
              type="button"
              onClick={handleRun}
              disabled={running}
              className="whitespace-nowrap rounded-lg bg-teal-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
            >
              {running ? "Running..." : "Run"}
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-800 bg-red-900/30 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Summary Stats */}
      {summary && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatCard label="Avg Production Rate" value={summary.avgRate} color="#0D9488" />
          <StatCard label="Avg Product Cost" value={summary.avgCost} color="#7C3AED" />
          <StatCard label="Total Accidents" value={String(summary.totalAccidents)} color="#E11D48" />
          <StatCard label="Total Production" value={summary.totalProduction} color="#F59E0B" />
          <StatCard label="Total Energy" value={summary.totalEnergy} color="#3B82F6" />
        </div>
      )}

      {/* Plant Visual */}
      {kpiData && kpiData.length > 0 && (
        <div className="mb-6">
          <PlantVisualPanel kpiData={kpiData} />
        </div>
      )}

      {/* Metric toggles */}
      {kpiData && (
        <div className="mb-4 flex flex-wrap gap-3">
          {METRICS.map((m) => (
            <label
              key={m.key}
              className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-300"
            >
              <input
                type="checkbox"
                checked={visibleMetrics.has(m.key)}
                onChange={() => toggleMetric(m.key)}
                className="rounded border-gray-600 bg-gray-800 accent-teal-500"
              />
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: m.color }}
              />
              {m.label}
            </label>
          ))}
        </div>
      )}

      {/* Charts */}
      {kpiData && kpiData.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-3">
          {METRICS.filter((m) => visibleMetrics.has(m.key)).map((m) => (
            <div key={m.key}>
              <h3 className="mb-2 text-sm font-medium text-gray-300">{m.label}</h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart
                  data={kpiData}
                  margin={{ top: 5, right: 10, bottom: 20, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis
                    dataKey="step"
                    stroke="#9CA3AF"
                    interval={19}
                    label={{
                      value: "Step",
                      position: "insideBottom",
                      offset: -10,
                      fill: "#9CA3AF",
                      fontSize: 11,
                    }}
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis stroke="#9CA3AF" tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1F2937",
                      border: "1px solid #374151",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: "#D1D5DB" }}
                    labelFormatter={(v) => `Step ${v}`}
                    formatter={(value: number) => [Number(value.toFixed(4)), m.label]}
                  />
                  <Line
                    type="monotone"
                    dataKey={m.key}
                    stroke={m.color}
                    dot={false}
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!kpiData && !running && !error && (
        <div className="rounded-xl bg-gray-800/50 p-8 text-center">
          <p className="text-sm text-gray-400">
            Set a <span className="font-medium text-teal-400">setpoint rate</span>, configure steps
            &amp; seed, then click <span className="font-medium text-white">Run</span> to execute a
            headless simulation.
          </p>
        </div>
      )}
    </section>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl bg-gray-800 px-3 py-2">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="mt-0.5 text-base font-semibold" style={{ color }}>{value}</p>
    </div>
  );
}
