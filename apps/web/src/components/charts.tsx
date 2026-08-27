'use client';

/**
 * Small SVG chart set.
 *
 * Hand-rolled rather than pulled from a chart library: these are four fixed
 * forms, and a library would add a dependency plus its own theming layer to
 * fight with. Colours come from the validated palette below.
 */

import { useState, type ReactNode } from 'react';

/**
 * Categorical slots 1 and 2 from the reference palette, validated against this
 * app's own surfaces (#ffffff light, #18181b dark) rather than the defaults.
 * Both modes pass every gate: worst adjacent CVD dE 24.7 light / 26.8 dark
 * against a target of 8, so the two series stay distinguishable to a
 * colourblind reader without relying on hue alone.
 */
export const SERIES = {
  one: 'var(--viz-1)',
  two: 'var(--viz-2)',
} as const;

/** Status colours are reserved and never reused as a series. */
export const STATUS_FILL: Record<string, string> = {
  ALLOCATED: 'var(--viz-good)',
  IN_STOCK: 'var(--viz-1)',
  IN_REPAIR: 'var(--viz-warn)',
  RESERVED: 'var(--viz-1)',
  IN_TRANSIT: 'var(--viz-1)',
  LOST: 'var(--viz-critical)',
  STOLEN: 'var(--viz-critical)',
  SCRAPPED: 'var(--viz-critical)',
  RETIRED: 'var(--viz-muted)',
  DISPOSED: 'var(--viz-muted)',
};

export function ChartCard({
  title, subtitle, children, action,
}: { title: string; subtitle?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="card p-3">
      <div className="mb-2.5 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[12px] font-semibold leading-tight">{title}</h2>
          {subtitle && (
            <p className="mt-0.5 text-[11px] text-[rgb(var(--muted))]">{subtitle}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * Horizontal bars for magnitude across a handful of named things.
 *
 * Horizontal because the labels are words: a vertical bar chart would either
 * rotate them or truncate them, and neither reads.
 */
export function BarList({
  data, fill = SERIES.one, max, format = (n: number) => n.toLocaleString(),
}: {
  data: Array<{ label: string; value: number; hint?: string }>;
  fill?: string;
  max?: number;
  format?: (n: number) => string;
}) {
  const ceiling = max ?? Math.max(1, ...data.map((d) => d.value));
  if (data.length === 0) {
    return <p className="py-6 text-center text-[12px] text-[rgb(var(--muted))]">No data yet.</p>;
  }

  return (
    <ul className="space-y-1.5">
      {data.map((d) => (
        <li key={d.label}>
          <div className="mb-0.5 flex items-baseline justify-between gap-2 text-[11px]">
            <span className="truncate text-[rgb(var(--text-2))]" title={d.label}>{d.label}</span>
            {/* Direct label: the number is never left to the axis alone. */}
            <span className="shrink-0 tabular-nums font-medium text-[rgb(var(--text))]">
              {format(d.value)}
              {d.hint && <span className="ml-1 text-[rgb(var(--muted))]">{d.hint}</span>}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-sm bg-[rgb(var(--surface-3))]">
            <div
              className="h-full rounded-sm transition-[width] duration-300"
              style={{ width: `${Math.max(1.5, (d.value / ceiling) * 100)}%`, background: fill }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * One bar split into two parts, per row. Used for "complete vs short of
 * something" by wing.
 *
 * A 2px surface gap separates the segments so the boundary is visible without
 * relying on the colour difference alone, and both series are direct-labelled.
 */
export function StackedBars({
  data, labels,
}: {
  data: Array<{ label: string; a: number; b: number }>;
  labels: [string, string];
}) {
  const [hover, setHover] = useState<string | null>(null);

  if (data.length === 0) {
    return <p className="py-6 text-center text-[12px] text-[rgb(var(--muted))]">No data yet.</p>;
  }

  return (
    <div>
      <Legend items={[{ label: labels[0], fill: SERIES.one }, { label: labels[1], fill: SERIES.two }]} />
      <ul className="mt-2 space-y-1.5">
        {data.map((d) => {
          const total = d.a + d.b || 1;
          const aPct = (d.a / total) * 100;
          const active = hover === d.label;
          return (
            <li
              key={d.label}
              onMouseEnter={() => setHover(d.label)}
              onMouseLeave={() => setHover(null)}
            >
              <div className="mb-0.5 flex items-baseline justify-between gap-2 text-[11px]">
                <span className="text-[rgb(var(--text-2))]">{d.label}</span>
                <span className="tabular-nums text-[rgb(var(--muted))]">
                  <span className="font-medium text-[rgb(var(--text))]">{d.a}</span>
                  {' / '}
                  {total}
                  {d.b > 0 && (
                    <span className="ml-1.5" style={{ color: 'var(--viz-2)' }}>
                      {d.b} short
                    </span>
                  )}
                </span>
              </div>
              <div
                className="flex h-2 w-full overflow-hidden rounded-sm bg-[rgb(var(--surface-3))]"
                style={{ opacity: active || !hover ? 1 : 0.55 }}
              >
                <div style={{ width: `${aPct}%`, background: SERIES.one }} />
                {/* 2px surface gap between segments. */}
                {d.a > 0 && d.b > 0 && (
                  <div style={{ width: '2px', background: 'rgb(var(--surface))' }} />
                )}
                <div style={{ width: `${100 - aPct}%`, background: SERIES.two }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Legend({ items }: { items: Array<{ label: string; fill: string }> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5 text-[11px] text-[rgb(var(--text-2))]">
          <span className="h-2 w-2 rounded-[2px]" style={{ background: i.fill }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/**
 * A single proportion, shown as a meter with the figure spelled out.
 *
 * Deliberately not a donut: for one number, a bar plus the number is read
 * faster and does not ask anyone to compare angles.
 */
export function Meter({
  label, value, total, suffix, tone = 'default',
}: {
  label: string;
  value: number;
  total: number;
  suffix?: string;
  tone?: 'default' | 'good' | 'warn';
}) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  const fill = tone === 'good' ? 'var(--viz-good)' : tone === 'warn' ? 'var(--viz-warn)' : SERIES.one;

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[11px] text-[rgb(var(--text-2))]">{label}</span>
        <span className="text-[11px] tabular-nums text-[rgb(var(--muted))]">
          <span className="text-[13px] font-semibold text-[rgb(var(--text))]">{pct}%</span>
          <span className="ml-1.5">{value} of {total}{suffix ? ` ${suffix}` : ''}</span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-sm bg-[rgb(var(--surface-3))]">
        <div
          className="h-full rounded-sm transition-[width] duration-300"
          style={{ width: `${Math.max(1.5, pct)}%`, background: fill }}
        />
      </div>
    </div>
  );
}

/**
 * Status breakdown as one full-width segmented bar.
 *
 * Each segment carries its own reserved status colour, and every segment is
 * named in the legend beneath - status is never carried by colour alone.
 */
export function StatusBar({
  data,
}: { data: Array<{ status: string; count: number }> }) {
  const total = data.reduce((n, d) => n + d.count, 0) || 1;
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-sm bg-[rgb(var(--surface-3))]">
        {data.map((d, i) => (
          <div key={d.status} className="flex h-full">
            {i > 0 && <div style={{ width: '2px', background: 'rgb(var(--surface))' }} />}
            <div
              title={`${d.status}: ${d.count}`}
              style={{
                width: `${(d.count / total) * 100}%`,
                minWidth: '3px',
                background: STATUS_FILL[d.status] ?? 'var(--viz-muted)',
              }}
            />
          </div>
        ))}
      </div>
      <ul className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {data.map((d) => (
          <li key={d.status} className="flex items-center justify-between gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1.5 text-[rgb(var(--text-2))]">
              <span
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={{ background: STATUS_FILL[d.status] ?? 'var(--viz-muted)' }}
              />
              {d.status.replace(/_/g, ' ').toLowerCase()}
            </span>
            <span className="tabular-nums font-medium text-[rgb(var(--text))]">
              {d.count.toLocaleString()}
              <span className="ml-1 font-normal text-[rgb(var(--muted))]">
                {Math.round((d.count / total) * 100)}%
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
