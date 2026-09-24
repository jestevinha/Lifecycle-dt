import { runKey, runLabel, runColor } from "../api";
import type { Run } from "../api";
import { Swatch } from "../ui";

/**
 * Shared legend row for panels comparing multiple runs. Recharts' built-in
 * <Legend> lives INSIDE the chart's reserved vertical space, so once an
 * experiment has more runs than fit on one line (e.g. 3 agents × 2 reward
 * profiles = 6), the wrapped legend text overflows that space and overlaps
 * the plotted data. Rendering the legend as normal block content instead
 * means it just pushes the chart down when it wraps, never overlaps it.
 */
export function RunLegend({ runs }: { runs: Run[] }) {
  if (runs.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {runs.map((run) => (
        <span key={runKey(run)} className="flex items-center gap-1.5 text-xs font-medium text-ink-2">
          <Swatch color={runColor(run)} />
          {runLabel(run)}
        </span>
      ))}
    </div>
  );
}
