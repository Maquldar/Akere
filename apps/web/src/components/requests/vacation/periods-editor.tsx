'use client';

import { Plus, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Label } from '@/components/ui/label';
import type { PlanPeriod } from '@/lib/api/types-requests';
import { cn } from '@/lib/utils';
import { calendarDays, formatDays, isDateStr } from '../shared';

export type EditablePeriod = { key: string; startDate: string; endDate: string };

let seq = 0;
export const newPeriod = (startDate = '', endDate = ''): EditablePeriod => ({ key: `p${++seq}`, startDate, endDate });
export const toEditable = (periods: PlanPeriod[]): EditablePeriod[] => periods.map((p) => newPeriod(p.startDate, p.endDate));

/** Days of a period: the server's figure (holidays excluded) for unchanged periods, else calendar days. */
export function periodDays(p: EditablePeriod, server: PlanPeriod[]): number {
  const same = server.find((s) => s.startDate === p.startDate && s.endDate === p.endDate);
  return same ? same.days : calendarDays(p.startDate, p.endDate);
}

export type PeriodIssues = { rows: Record<string, string>; general: string[]; total: number; ok: boolean };

/** Client-side checks mirroring API.md §9 rules (the server re-validates). */
export function usePeriodValidation() {
  const t = useTranslations('vacation.editor');
  const locale = useLocale();
  return (periods: EditablePeriod[], server: PlanPeriod[], entitlement: number, year: number, forSubmit: boolean): PeriodIssues => {
    const rows: Record<string, string> = {};
    const general: string[] = [];
    const min = `${year}-01-01`;
    const max = `${year}-12-31`;
    const filled = periods.filter((p) => p.startDate || p.endDate);
    for (const p of filled) {
      if (!isDateStr(p.startDate) || !isDateStr(p.endDate)) rows[p.key] = t('bothDates');
      else if (p.endDate < p.startDate) rows[p.key] = t('endBeforeStart');
      else if (p.startDate < min || p.endDate > max) rows[p.key] = t('outsideYear', { year });
    }
    const valid = filled.filter((p) => !rows[p.key]).sort((a, b) => a.startDate.localeCompare(b.startDate));
    for (let i = 1; i < valid.length; i++) {
      if (valid[i]!.startDate <= valid[i - 1]!.endDate) rows[valid[i]!.key] = t('overlap');
    }
    const days = valid.map((p) => periodDays(p, server));
    const total = days.reduce((a, b) => a + b, 0);
    if (total > entitlement) general.push(t('overEntitlement', { total, entitlement: formatDays(entitlement, locale) }));
    if (total >= 14 && Math.max(0, ...days) < 14) general.push(t('rule14Broken'));
    if (forSubmit && valid.length === 0) general.push(t('nothingPlanned'));
    return { rows, general, total, ok: Object.keys(rows).length === 0 && general.length === 0 };
  };
}

export function PeriodsEditor({
  periods,
  onChange,
  server,
  year,
  issues,
  disabled,
}: {
  periods: EditablePeriod[];
  onChange: (periods: EditablePeriod[]) => void;
  server: PlanPeriod[];
  year: number;
  issues: PeriodIssues | null;
  disabled?: boolean;
}) {
  const t = useTranslations('vacation.editor');
  const tc = useTranslations('common');
  const min = `${year}-01-01`;
  const max = `${year}-12-31`;
  const update = (key: string, patch: Partial<EditablePeriod>) => onChange(periods.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  return (
    <div className="flex flex-col gap-3">
      <div className="hidden grid-cols-[1fr_1fr_72px_36px] gap-2 text-xs font-medium text-fg-muted sm:grid">
        <span>{t('start')}</span>
        <span>{t('end')}</span>
        <span>{t('days')}</span>
        <span className="sr-only">{tc('actions')}</span>
      </div>
      <ul className="flex flex-col gap-3 sm:gap-2">
        {periods.map((p, i) => {
          const err = issues?.rows[p.key];
          const days = periodDays(p, server);
          return (
            <li key={p.key} className="flex flex-col gap-1">
              <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 sm:grid-cols-[1fr_1fr_72px_36px] sm:items-center">
                <div className="flex min-w-0 flex-col gap-1">
                  <Label htmlFor={`${p.key}-s`} className="text-xs text-fg-muted sm:sr-only" required>
                    {t('startN', { n: i + 1 })}
                  </Label>
                  <DatePicker
                    id={`${p.key}-s`}
                    value={p.startDate}
                    min={min}
                    max={p.endDate || max}
                    onChange={(v) => update(p.key, { startDate: v })}
                    disabled={disabled}
                    aria-invalid={err ? true : undefined}
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <Label htmlFor={`${p.key}-e`} className="text-xs text-fg-muted sm:sr-only" required>
                    {t('endN', { n: i + 1 })}
                  </Label>
                  <DatePicker
                    id={`${p.key}-e`}
                    value={p.endDate}
                    min={p.startDate || min}
                    max={max}
                    onChange={(v) => update(p.key, { endDate: v })}
                    disabled={disabled}
                    aria-invalid={err ? true : undefined}
                  />
                </div>
                <span className="col-span-2 text-[13px] text-fg-muted tabular sm:col-span-1 sm:text-sm sm:font-medium sm:text-fg" aria-live="polite">
                  <span className="sm:hidden">{t('days')}: </span>
                  {days}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="row-start-1 col-start-3 self-end sm:col-start-auto sm:row-start-auto"
                  onClick={() => onChange(periods.filter((x) => x.key !== p.key))}
                  disabled={disabled}
                  aria-label={t('removePeriod', { n: i + 1 })}
                >
                  <X />
                </Button>
              </div>
              {err && (
                <p role="alert" className="text-xs font-medium text-red-fg">
                  {err}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {periods.length === 0 && <p className="text-[13px] text-fg-subtle">{t('empty')}</p>}
      <div>
        <Button variant="outline" size="sm" onClick={() => onChange([...periods, newPeriod()])} disabled={disabled || periods.length >= 12}>
          <Plus aria-hidden />
          {t('addPeriod')}
        </Button>
      </div>
      {issues && issues.general.length > 0 && (
        <ul role="alert" className={cn('flex flex-col gap-1 rounded-lg border border-red-border bg-red-bg p-3 text-[13px] text-red-fg')}>
          {issues.general.map((g, i) => (
            <li key={i}>{g}</li>
          ))}
        </ul>
      )}
      <p className="text-xs text-fg-subtle">{t('daysHint')}</p>
    </div>
  );
}

/** "Запланировано 0 / 24 дн." with a progress bar. */
export function PlannedMeter({ planned, entitlement }: { planned: number; entitlement: number }) {
  const t = useTranslations('vacation.editor');
  const locale = useLocale();
  const ratio = entitlement > 0 ? Math.min(1, planned / entitlement) : 0;
  const over = planned > entitlement;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        <span className="text-fg-muted">{t('planned')}</span>
        <span className={cn('font-semibold tabular', over ? 'text-red-fg' : 'text-fg')} data-testid="planned-meter">
          {t('plannedOf', { planned: formatDays(planned, locale), entitlement: formatDays(entitlement, locale) })}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-active" role="presentation">
        <div className={cn('h-full rounded-full', over ? 'bg-red-solid' : ratio >= 1 ? 'bg-green-solid' : 'bg-primary')} style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
    </div>
  );
}
