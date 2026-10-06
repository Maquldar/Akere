'use client';

import { CalendarRange } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Tooltip } from '@/components/ui/popover';
import type { PlanRow, PlanStatus } from '@/lib/api/types-requests';
import { formatDate, parseApiDate, toIntlLocale } from '@/lib/format';
import { cn } from '@/lib/utils';
import { formatDays, PlanStatusPill, todayStr } from '../shared';

const BAR: Record<PlanStatus, string> = {
  NONE: 'bg-shift-gray border-gray-border text-gray-fg',
  DRAFT: 'bg-shift-gray border-border-strong text-gray-fg',
  SUBMITTED: 'bg-shift-orange border-orange-border text-orange-fg',
  APPROVED: 'bg-shift-green border-green-border text-green-fg',
  REJECTED: 'bg-shift-red border-red-border text-red-fg',
};

const DAY_MS = 86_400_000;

function yearSpan(year: number) {
  const start = Date.UTC(year, 0, 1, 12);
  const days = Math.round((Date.UTC(year + 1, 0, 1, 12) - start) / DAY_MS);
  return { start, days };
}

function position(year: number, startDate: string, endDate: string) {
  const { start, days } = yearSpan(year);
  const s = Math.max(0, Math.round((parseApiDate(startDate).getTime() - start) / DAY_MS));
  const e = Math.min(days - 1, Math.round((parseApiDate(endDate).getTime() - start) / DAY_MS));
  if (e < 0 || s > days - 1 || e < s) return null;
  return { left: (s / days) * 100, width: ((e - s + 1) / days) * 100 };
}

export function GanttLegend() {
  const t = useTranslations('vacation.planStatus');
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-fg-muted">
      {(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const).map((s) => (
        <li key={s} className="flex items-center gap-1.5">
          <span className={cn('h-3 w-5 rounded-sm border', BAR[s])} aria-hidden />
          {t(s)}
        </li>
      ))}
    </ul>
  );
}

export function GanttGrid({
  year,
  rows,
  isLoading,
  error,
  onRetry,
  selectable,
  selected,
  onToggle,
  onTogglePage,
  canOpen,
  onOpen,
  empty,
}: {
  year: number;
  rows: PlanRow[] | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  selectable: boolean;
  selected: Set<string>;
  onToggle: (row: PlanRow, on: boolean) => void;
  onTogglePage: (on: boolean) => void;
  canOpen: (row: PlanRow) => boolean;
  onOpen: (row: PlanRow) => void;
  empty?: React.ReactNode;
}) {
  const t = useTranslations('vacation.grid');
  const locale = useLocale();
  const months = useMemo(
    () =>
      Array.from({ length: 12 }, (_, m) =>
        new Intl.DateTimeFormat(toIntlLocale(locale), { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(year, m, 15))),
      ),
    [locale, year],
  );
  const today = todayStr();
  const todayPos = today.startsWith(String(year)) ? position(year, today, today) : null;
  const allOnPage = Boolean(rows?.length) && rows!.every((r) => selected.has(r.employee.employeeId));
  const someOnPage = rows?.some((r) => selected.has(r.employee.employeeId)) ?? false;

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      <div className="overflow-x-auto" style={{ maxHeight: 'min(72dvh, 760px)' }}>
        <table className="w-full min-w-[1080px] border-separate border-spacing-0 text-[13px]" aria-label={t('label', { year })}>
          <thead className="sticky top-0 z-20 bg-surface">
            <tr>
              {selectable && (
                <th className="sticky left-0 z-30 w-10 border-b border-border bg-surface px-3 py-2.5 text-left">
                  <Checkbox
                    aria-label={t('selectPage')}
                    checked={allOnPage ? true : someOnPage ? 'indeterminate' : false}
                    onCheckedChange={(v) => onTogglePage(v === true)}
                  />
                </th>
              )}
              <th
                className={cn(
                  'sticky z-30 w-[240px] min-w-[240px] border-b border-r border-border bg-surface px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-fg-subtle',
                  selectable ? 'left-10' : 'left-0',
                )}
              >
                {t('employee')}
              </th>
              <th className="w-[132px] min-w-[132px] border-b border-border px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-fg-subtle">{t('planned')}</th>
              {months.map((m, i) => (
                <th
                  key={i}
                  className="min-w-[56px] border-b border-l border-border px-1 py-2.5 text-center text-xs font-medium uppercase tracking-wide text-fg-subtle"
                >
                  {m.replace('.', '')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              (!rows || rows.length === 0) &&
              Array.from({ length: 6 }, (_, i) => (
                <tr key={`s${i}`}>
                  {selectable && <td className="border-b border-border px-3 py-3" />}
                  <td className="border-b border-r border-border px-3 py-3">
                    <Skeleton className="h-3.5 w-3/4" />
                  </td>
                  <td className="border-b border-border px-3 py-3">
                    <Skeleton className="h-3.5 w-10" />
                  </td>
                  <td colSpan={12} className="border-b border-border px-3 py-3">
                    <Skeleton className="h-4" style={{ width: `${20 + ((i * 37) % 50)}%`, marginLeft: `${(i * 13) % 40}%` }} />
                  </td>
                </tr>
              ))}
            {rows?.map((r) => {
              const id = r.employee.employeeId;
              const isSel = selected.has(id);
              const openable = canOpen(r);
              return (
                <tr key={id} className={cn('group', isSel && 'bg-primary-soft/60')} data-testid={`plan-row-${id}`}>
                  {selectable && (
                    <td className={cn('sticky left-0 z-10 border-b border-border px-3 py-2', isSel ? 'bg-primary-soft' : 'bg-surface group-hover:bg-surface-muted')}>
                      <Checkbox aria-label={t('selectRow', { name: r.employee.fullName })} checked={isSel} onCheckedChange={(v) => onToggle(r, v === true)} />
                    </td>
                  )}
                  <td
                    className={cn(
                      'sticky z-10 border-b border-r border-border px-3 py-2',
                      selectable ? 'left-10' : 'left-0',
                      isSel ? 'bg-primary-soft' : 'bg-surface group-hover:bg-surface-muted',
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Avatar name={r.employee.fullName} />
                      <div className="min-w-0 flex-1">
                        {openable ? (
                          <button
                            type="button"
                            onClick={() => onOpen(r)}
                            className="focus-ring block max-w-full truncate rounded text-left font-medium text-fg hover:text-primary hover:underline"
                          >
                            {r.employee.shortName || r.employee.fullName}
                          </button>
                        ) : (
                          <div className="truncate font-medium text-fg">{r.employee.shortName || r.employee.fullName}</div>
                        )}
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-xs text-fg-subtle">{r.employee.position ?? r.employee.department ?? ''}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="border-b border-border px-3 py-2">
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-fg tabular">
                        {formatDays(r.planned, locale)}/{formatDays(r.entitlement, locale)}
                      </span>
                      <PlanStatusPill status={r.status} variant="dot" className="whitespace-nowrap" />
                    </div>
                  </td>
                  <td colSpan={12} className="relative border-b border-border p-0">
                    <div
                      className="relative h-[52px]"
                      style={{
                        backgroundImage: 'linear-gradient(to right, var(--color-border) 1px, transparent 1px)',
                        backgroundSize: `${100 / 12}% 100%`,
                      }}
                    >
                      {todayPos && <span className="absolute inset-y-0 w-px bg-red-solid/60" style={{ left: `${todayPos.left}%` }} aria-hidden />}
                      {r.periods.map((p) => {
                        const pos = position(year, p.startDate, p.endDate);
                        if (!pos) return null;
                        const label = `${formatDate(p.startDate, locale)} – ${formatDate(p.endDate, locale)} · ${t('days', { days: p.days })}`;
                        return (
                          <Tooltip key={p.id} content={label}>
                            <button
                              type="button"
                              onClick={openable ? () => onOpen(r) : undefined}
                              aria-label={`${r.employee.fullName}: ${label}`}
                              className={cn(
                                'focus-ring absolute top-1/2 flex h-6 -translate-y-1/2 items-center justify-center overflow-hidden rounded-md border px-1 text-[11px] font-semibold tabular',
                                BAR[r.status],
                                !openable && 'cursor-default',
                              )}
                              style={{ left: `${pos.left}%`, width: `max(${pos.width}%, 6px)` }}
                            >
                              {pos.width > 2.5 ? p.days : ''}
                            </button>
                          </Tooltip>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {Boolean(error) && (!rows || rows.length === 0) && !isLoading && <ErrorState error={error} onRetry={onRetry} compact />}
        {!isLoading && !error && rows && rows.length === 0 && (empty ?? <EmptyState compact icon={<CalendarRange aria-hidden />} title={t('empty')} />)}
      </div>
    </div>
  );
}
