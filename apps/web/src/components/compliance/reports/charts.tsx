'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Plain-SVG charts (no chart library). Categorical palette validated with the dataviz validator against the
 * light surface (all checks pass; contrast < 3:1 for orange/teal is relieved by the legend + table view).
 */
export const SERIES_COLORS = ['var(--color-primary)', 'var(--color-orange-solid)', 'var(--color-teal-solid)'] as const;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceMax(v: number): number {
  if (v <= 0) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return Math.max(4, step * pow);
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: i.color }} aria-hidden />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

export type GroupedBarDatum = { label: string; values: number[] };

/** Vertical grouped bars (e.g. hired / dismissed / transferred per month). */
export function GroupedBarChart({
  data,
  series,
  height = 240,
  ariaLabel,
}: {
  data: GroupedBarDatum[];
  series: string[];
  height?: number;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ g: number; s: number } | null>(null);
  const pad = { top: 12, right: 8, bottom: 28, left: 32 };
  const max = niceMax(Math.max(0, ...data.flatMap((d) => d.values)));
  const ticks = [0, max / 4, max / 2, (3 * max) / 4, max];
  const innerW = Math.max(0, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const groupW = data.length ? innerW / data.length : 0;
  const gap = 2;
  const barW = Math.max(3, Math.min(18, (groupW * 0.7 - gap * (series.length - 1)) / series.length));
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const labelEvery = groupW < 34 ? Math.ceil(34 / Math.max(groupW, 1)) : 1;

  return (
    <div ref={ref} className="relative w-full">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block overflow-visible">
          {ticks.map((tk) => (
            <g key={tk}>
              <line x1={pad.left} x2={width - pad.right} y1={y(tk)} y2={y(tk)} stroke="var(--color-border)" strokeDasharray={tk === 0 ? undefined : '2 3'} />
              <text x={pad.left - 6} y={y(tk)} dy="0.32em" textAnchor="end" className="fill-fg-subtle text-[10px] tabular">
                {Number.isInteger(tk) ? tk : tk.toFixed(1)}
              </text>
            </g>
          ))}
          {data.map((d, gi) => {
            const gx = pad.left + gi * groupW + (groupW - (barW * series.length + gap * (series.length - 1))) / 2;
            return (
              <g key={d.label}>
                {d.values.map((v, si) => {
                  const h = Math.max(v > 0 ? 2 : 0, y(0) - y(v));
                  const x = gx + si * (barW + gap);
                  const active = hover?.g === gi && hover.s === si;
                  return (
                    <g key={si} onMouseEnter={() => setHover({ g: gi, s: si })} onMouseLeave={() => setHover(null)}>
                      {/* larger invisible hit target */}
                      <rect x={x - 1} y={pad.top} width={barW + 2} height={innerH} fill="transparent" />
                      <path
                        d={roundedTop(x, y(0) - h, barW, h, Math.min(4, barW / 2))}
                        fill={SERIES_COLORS[si % SERIES_COLORS.length]}
                        opacity={hover && !active ? 0.45 : 1}
                      >
                        <title>{`${d.label} · ${series[si]}: ${v}`}</title>
                      </path>
                    </g>
                  );
                })}
                {gi % labelEvery === 0 && (
                  <text x={pad.left + gi * groupW + groupW / 2} y={height - 10} textAnchor="middle" className="fill-fg-subtle text-[10px]">
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hover && data[hover.g] && (
        <div
          className="pointer-events-none absolute z-10 rounded-md bg-fg px-2 py-1 text-xs font-medium text-white shadow-pop"
          style={{ left: Math.min(width - 140, Math.max(0, pad.left + hover.g * groupW)), top: 0 }}
          aria-hidden
        >
          {data[hover.g]!.label}: {series[hover.s]} — {data[hover.g]!.values[hover.s]}
        </div>
      )}
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return '';
  const rr = Math.min(r, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/** Horizontal bars with direct value labels (headcount by department, candidates by status). */
export function HorizontalBars({
  data,
  color = 'var(--color-primary)',
  ariaLabel,
  max: maxRows = 12,
  className,
  formatValue = (v) => String(v),
}: {
  data: { label: string; value: number }[];
  color?: string;
  ariaLabel: string;
  max?: number;
  className?: string;
  formatValue?: (v: number) => ReactNode;
}) {
  const rows = data.slice(0, maxRows);
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className={cn('grid gap-2', className)} aria-label={ariaLabel}>
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,40%)_1fr_auto] items-center gap-3 text-[13px]" title={`${r.label}: ${r.value}`}>
          <span className="truncate text-fg-muted">{r.label}</span>
          <span className="h-2.5 w-full overflow-hidden rounded-r bg-surface-hover" aria-hidden>
            <span className="block h-full rounded-r" style={{ width: `${(r.value / max) * 100}%`, background: color, minWidth: r.value ? 2 : 0 }} />
          </span>
          <span className="w-8 text-right font-medium tabular text-fg">{formatValue(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}
