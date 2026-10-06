'use client';

import { Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { CSSProperties, ReactNode } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/popover';
import type { Holiday, ScheduleRow, ScheduleView, ShiftView } from '@/lib/api/types-time';
import { cn } from '@/lib/utils';
import { AbsenceChip } from './shared';
import { compactHours, dayNum, isWeekendStr, todayStr, weekdayShort } from './time-utils';

const TEMPLATE = '232px repeat(7, minmax(128px, 1fr))';
const gridStyle: CSSProperties = { gridTemplateColumns: TEMPLATE };

function dayTint(date: string, holidays: Map<string, Holiday>) {
  if (holidays.has(date)) return 'bg-purple-bg/60';
  if (isWeekendStr(date)) return 'bg-surface-muted [background-image:repeating-linear-gradient(135deg,transparent_0_6px,rgb(0_0_0/0.025)_6px_12px)]';
  return '';
}

/**
 * Week grid of people × days (M4 "Мой график" / "Планирование"): sticky name column with planned/target
 * hours, absence spans on top lanes, shift chips per day, optional open-shifts row.
 */
export function WeekGrid({
  data,
  days,
  loading,
  search,
  onSearch,
  renderShift,
  renderEmpty,
  openShifts,
  highlightEmployeeId,
  label,
}: {
  data: ScheduleView | undefined;
  days: string[];
  loading?: boolean;
  search: string;
  onSearch: (v: string) => void;
  renderShift: (shift: ShiftView, row: ScheduleRow) => ReactNode;
  renderEmpty?: (row: ScheduleRow, date: string) => ReactNode;
  /** Open shifts row: render a cell's content for a day (null → row hidden). */
  openShifts?: { render: (date: string, shifts: ShiftView[]) => ReactNode; emptyText?: string } | null;
  highlightEmployeeId?: string | null;
  label: string;
}) {
  const t = useTranslations('time.grid');
  const locale = useLocale();
  const today = todayStr();
  const holidays = new Map((data?.holidays ?? []).map((h) => [h.date, h]));

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      <div className="max-h-[calc(100dvh-230px)] min-h-[320px] overflow-auto" role="region" aria-label={label} tabIndex={0}>
        <div className="min-w-[1128px]" role="table" aria-label={label}>
          {/* Header */}
          <div className="sticky top-0 z-30 grid border-b border-border bg-surface" style={gridStyle} role="row">
            <div className="sticky left-0 z-10 flex items-center border-r border-border bg-surface px-3 py-2" role="columnheader">
              <Input
                inputSize="sm"
                leftIcon={<Search />}
                value={search}
                onChange={(e) => onSearch(e.target.value)}
                placeholder={t('search')}
                aria-label={t('search')}
                className="w-full"
              />
            </div>
            {days.map((d) => {
              const h = holidays.get(d);
              return (
                <div key={d} role="columnheader" className={cn('flex flex-col items-center justify-center px-2 py-1.5 text-center', dayTint(d, holidays))}>
                  <span className={cn('text-[11px] font-medium uppercase tracking-wide', d === today ? 'text-primary' : 'text-fg-subtle')}>{weekdayShort(d, locale)}</span>
                  <span
                    className={cn(
                      'mt-0.5 inline-flex size-6 items-center justify-center rounded-full text-[13px] font-semibold tabular',
                      d === today ? 'bg-primary text-white' : 'text-fg',
                    )}
                  >
                    {dayNum(d)}
                  </span>
                  {h && (
                    <Tooltip content={h.name}>
                      <span className="mt-0.5 max-w-full truncate text-[10.5px] font-medium text-purple-fg" tabIndex={0}>
                        {h.name}
                      </span>
                    </Tooltip>
                  )}
                </div>
              );
            })}
          </div>

          {loading && !data &&
            Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="grid border-b border-border" style={gridStyle}>
                <div className="flex items-center gap-2 border-r border-border px-3 py-3">
                  <Skeleton className="size-8 rounded-full" />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-2.5 w-1/2" />
                  </div>
                </div>
                {days.map((d) => (
                  <div key={d} className="p-1.5">
                    <Skeleton className="h-10 w-full" />
                  </div>
                ))}
              </div>
            ))}

          {data && data.rows.length === 0 && (
            <div className="px-6 py-14 text-center">
              <p className="text-sm font-semibold text-fg">{t('empty')}</p>
              <p className="mt-1 text-[13px] text-fg-muted">{t('emptyHint')}</p>
            </div>
          )}

          {data?.rows.map((row) => {
            const absences = row.absences
              .map((a) => {
                const startIdx = days.findIndex((d) => d >= a.startDate);
                let endIdx = -1;
                for (let i = days.length - 1; i >= 0; i--) if (days[i]! <= a.endDate) { endIdx = i; break; }
                return { a, startIdx, endIdx };
              })
              .filter((x) => x.startIdx >= 0 && x.endIdx >= x.startIdx);
            const lanes = absences.length;
            const over = row.plannedHours > row.targetHours + 0.05;
            const mine = highlightEmployeeId && row.employee.employeeId === highlightEmployeeId;
            return (
              <div
                key={row.employee.employeeId}
                role="row"
                className={cn('group/row grid border-b border-border last:border-b-0', mine && 'bg-primary-soft/30')}
                style={{ ...gridStyle, gridTemplateRows: `repeat(${lanes}, auto) minmax(56px, auto)` }}
              >
                <div
                  role="rowheader"
                  className={cn('sticky left-0 z-20 flex items-center gap-2.5 border-r border-border px-3 py-2', mine ? 'bg-[#f6f7fe]' : 'bg-surface')}
                  style={{ gridRow: `1 / span ${lanes + 1}`, gridColumn: 1 }}
                >
                  <Avatar name={row.employee.fullName} size="md" className="text-[11px]" />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-fg" title={row.employee.fullName}>
                      {row.employee.shortName}
                    </div>
                    {row.employee.position && <div className="truncate text-xs text-fg-subtle">{row.employee.position}</div>}
                    <div className="text-xs tabular" aria-label={t('hoursAria', { planned: row.plannedHours, target: row.targetHours })}>
                      <span className={cn('font-semibold', over ? 'text-orange-fg' : 'text-fg')}>{compactHours(row.plannedHours, locale)}</span>
                      <span className="text-fg-subtle"> / {t('hours', { value: compactHours(row.targetHours, locale) })}</span>
                    </div>
                  </div>
                </div>
                {/* Day backgrounds */}
                {days.map((d, i) => (
                  <div key={`bg-${d}`} aria-hidden className={cn('pointer-events-none', dayTint(d, holidays))} style={{ gridColumn: i + 2, gridRow: `1 / span ${lanes + 1}` }} />
                ))}
                {absences.map(({ a, startIdx, endIdx }, lane) => (
                  <div key={a.id} className="relative z-10 px-1 pt-1.5" style={{ gridColumn: `${startIdx + 2} / ${endIdx + 3}`, gridRow: lane + 1 }}>
                    <AbsenceChip absence={a} />
                  </div>
                ))}
                {days.map((d, i) => {
                  const shifts = row.shifts.filter((s) => s.date === d);
                  return (
                    <div key={d} role="cell" className="relative z-10 flex min-w-0 flex-col gap-1 p-1.5" style={{ gridColumn: i + 2, gridRow: lanes + 1 }}>
                      {shifts.map((s) => (
                        <div key={s.id}>{renderShift(s, row)}</div>
                      ))}
                      {shifts.length === 0 && renderEmpty?.(row, d)}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {data && openShifts && (
            <div className="grid border-t border-border bg-surface-muted/60" style={gridStyle} role="row">
              <div className="sticky left-0 z-20 flex items-center border-r border-border bg-surface-muted px-3 py-3" role="rowheader">
                <div>
                  <div className="text-[13px] font-semibold text-fg">{t('openShifts')}</div>
                  <div className="text-xs text-fg-subtle">{data.openShifts.length ? t('openCount', { count: data.openShifts.length }) : (openShifts.emptyText ?? t('noOpen'))}</div>
                </div>
              </div>
              {days.map((d) => (
                <div key={d} role="cell" className="flex min-w-0 flex-col gap-1 p-1.5">
                  {openShifts.render(
                    d,
                    data.openShifts.filter((s) => s.date === d),
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
