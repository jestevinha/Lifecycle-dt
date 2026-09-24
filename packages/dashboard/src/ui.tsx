import type { ReactNode } from "react";

/**
 * Shared layout primitives. Pages are laid out on a 12-column grid
 * (`grid grid-cols-12 gap-5`); a Card takes its width from `className`
 * (e.g. "col-span-12 xl:col-span-7") so panels sit side by side on wide
 * screens and stack on narrow ones.
 */

export function Card({
  title,
  subtitle,
  actions,
  className = "",
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface px-5 py-4 ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          {subtitle && <span className="text-xs text-ink-3">{subtitle}</span>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** A card placeholder used while a panel's data is loading or absent. */
export function CardMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center rounded-lg bg-canvas px-4 py-10 text-center text-sm text-ink-3">
      {children}
    </div>
  );
}

export function SectionLabel({ title, detail, right }: { title: string; detail?: ReactNode; right?: ReactNode }) {
  return (
    <div className="col-span-12 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 pt-1">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-2">{title}</h2>
        {detail && <span className="text-xs text-ink-3">{detail}</span>}
      </div>
      {right}
    </div>
  );
}

export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-[26px] items-center rounded-full border border-line bg-surface px-2.5 text-xs text-ink-2">
      {children}
    </span>
  );
}

const PILL_STYLES = {
  completed: { box: "bg-ok-soft text-ok", dot: "bg-ok", label: "Completed" },
  running: { box: "bg-warn-soft text-warn", dot: "bg-warn animate-pulse", label: "Running" },
  pending: { box: "bg-canvas text-ink-2", dot: "bg-ink-3", label: "Pending" },
  failed: { box: "bg-crit-soft text-crit", dot: "bg-crit", label: "Failed" },
} as const;

export function StatusPill({ status }: { status: keyof typeof PILL_STYLES }) {
  const s = PILL_STYLES[status] ?? PILL_STYLES.pending;
  return (
    <span className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold ${s.box}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

export function Swatch({ color, round = false }: { color: string; round?: boolean }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 shrink-0 ${round ? "rounded-full" : "rounded-[3px]"}`}
      style={{ backgroundColor: color }}
    />
  );
}

/** Label + big mono number, used for KPI tiles. */
export function StatTile({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  tone?: "crit" | "ok" | "warn";
}) {
  const color = tone === "crit" ? "text-crit" : tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-line px-3.5 py-3">
      <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-ink-3">{label}</span>
      <span className="flex items-baseline gap-1.5">
        <span className={`tabular font-mono text-[22px] font-semibold leading-none ${color}`}>{value}</span>
        {unit && <span className="truncate text-[11px] text-ink-3">{unit}</span>}
      </span>
    </div>
  );
}

/** Segmented control for switching a card between views. */
export function Segmented<V extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: V;
  options: { value: V; label: string }[];
  onChange: (v: V) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-line bg-canvas p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-7 rounded-md px-3 text-xs font-medium transition-colors ${
            value === o.value ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const inputClass =
  "h-10 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 disabled:opacity-50";
export const selectSmClass =
  "h-8 rounded-md border border-line-strong bg-surface px-2 text-xs text-ink focus:border-accent focus:outline-none";
export const btnPrimary =
  "inline-flex h-10 items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50";
export const btnSecondary =
  "inline-flex h-10 items-center justify-center rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium text-ink transition-colors hover:border-ink-3";
export const btnDanger =
  "inline-flex h-10 items-center justify-center rounded-lg border border-transparent px-3 text-sm font-medium text-crit transition-colors hover:border-crit/30 hover:bg-crit-soft";
