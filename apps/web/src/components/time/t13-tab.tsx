'use client';

import { BadgeCheck, ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/popover';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { useCurrentUser } from '@/components/shell/me-context';
import { isApiError } from '@/lib/api/errors';
import { downloadT13, useAllDepartments, useConfirmT13, useT13 } from '@/lib/api/hooks/time';
import type { T13Cell, T13Code, T13Sheet } from '@/lib/api/types-time';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { cn } from '@/lib/utils';
import { compactHours, hoursNum, monthTitle, t13CodeClass, t13CodeKey, T13_CODE_LIST, todayStr, weekdayShort } from './time-utils';

const ALL = 'all';

function Codes({ codes, size = 'sm' }: { codes: T13Code[]; size?: 'sm' | 'md' }) {
  const shown = codes.filter((c) => c !== 'Я');
  if (!shown.length) return null;
  return (
    <span className={cn('flex justify-center gap-0.5 font-semibold leading-none', size === 'md' ? 'text-[12.5px]' : 'text-[10px]')}>
      {shown.map((c) => (
        <span key={c} className={t13CodeClass[c]}>
          {c}
        </span>
      ))}
    </span>
  );
}

function DayCell({ cell, tint, monday, label }: { cell: T13Cell; tint: string; monday: boolean; label: string }) {
  const locale = useLocale();
  const inner = (
    <div
      className={cn(
        'mx-auto flex h-10 w-9 flex-col items-center justify-center gap-0.5 rounded-md',
        cell.deviation && 'bg-red-bg/60 ring-1 ring-red-solid',
      )}
      tabIndex={cell.note ? 0 : undefined}
      aria-label={cell.note ? `${label}: ${cell.note}` : undefined}
    >
      {cell.hours !== null ? (
        <>
          <span className={cn('text-[13px] font-medium leading-none tabular', cell.deviation ? 'text-red-fg' : cell.codes.includes('С') ? 'text-orange-fg' : 'text-fg')}>
            {compactHours(cell.hours, locale)}
          </span>
          <Codes codes={cell.codes} />
        </>
      ) : cell.codes.length ? (
        <Codes codes={cell.codes} size="md" />
      ) : (
        <span className="text-fg-subtle">·</span>
      )}
    </div>
  );
  return (
    <td className={cn('border-b border-border px-0.5 py-1 text-center', tint, monday && 'border-l border-l-border-strong')}>
      {cell.note ? <Tooltip content={cell.note}>{inner}</Tooltip> : inner}
    </td>
  );
}

function Grid({ sheet, search, onSearch }: { sheet: T13Sheet; search: string; onSearch: (v: string) => void }) {
  const t = useTranslations('time.t13');
  const locale = useLocale();
  const mm = String(sheet.month).padStart(2, '0');
  const dayStr = (d: number) => `${sheet.year}-${mm}-${String(d).padStart(2, '0')}`;
  const tintOf = (d: T13Sheet['days'][number]) => (d.isHoliday ? 'bg-purple-bg/50' : d.isWeekend ? 'bg-surface-muted' : '');
  const isMonday = (d: number) => new Date(Date.UTC(sheet.year, sheet.month - 1, d)).getUTCDay() === 1;
  const num = 'border-b border-border px-2 py-2 text-right tabular whitespace-nowrap';
  const fmt = (v: number) => (v ? hoursNum(v, locale) : '—');

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      <div className="max-h-[calc(100dvh-260px)] min-h-[300px] overflow-auto" role="region" aria-label={t('tableLabel')} tabIndex={0}>
        <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]" aria-label={t('tableLabel')}>
          <thead className="sticky top-0 z-20 bg-surface">
            <tr>
              <th scope="col" className="sticky left-0 z-30 min-w-[250px] border-b border-r border-border bg-surface px-3 py-2 text-left font-normal">
                <Input inputSize="sm" leftIcon={<Search />} value={search} onChange={(e) => onSearch(e.target.value)} placeholder={t('search')} aria-label={t('search')} />
              </th>
              <th scope="col" className="border-b border-border bg-surface px-2 text-right text-xs font-medium text-fg-subtle">{t('plan')}</th>
              <th scope="col" className="border-b border-border bg-surface px-2 text-right text-xs font-medium text-fg-subtle">{t('fact')}</th>
              <th scope="col" className="border-b border-border bg-surface px-2 text-right text-xs font-medium text-fg">{t('norm')}</th>
              <th scope="col" className="border-b border-border bg-surface px-2 text-right text-xs font-medium text-orange-fg">1.5x</th>
              <th scope="col" className="border-b border-r border-border bg-surface px-2 text-right text-xs font-medium text-red-fg">2x</th>
              {sheet.days.map((d) => (
                <th
                  key={d.day}
                  scope="col"
                  className={cn('min-w-[40px] border-b border-border px-0.5 py-1.5 text-center font-normal', tintOf(d), isMonday(d.day) && 'border-l border-l-border-strong')}
                >
                  <div className={cn('text-[10.5px] font-medium uppercase', d.isHoliday ? 'text-purple-fg' : 'text-fg-subtle')}>{weekdayShort(dayStr(d.day), locale)}</div>
                  <div className={cn('text-[13px] font-semibold tabular', dayStr(d.day) === todayStr() ? 'text-primary' : 'text-fg')}>{d.day}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.length === 0 && (
              <tr>
                <td colSpan={6 + sheet.days.length} className="py-14">
                  <EmptyState compact title={t('emptyRows')} description={t('emptyRowsHint')} />
                </td>
              </tr>
            )}
            {sheet.rows.map((r) => {
              const diff = r.factHours - r.planHours;
              return (
                <tr key={r.employee.employeeId} className="hover:[&>td]:bg-surface-muted/60">
                  <th scope="row" className="sticky left-0 z-10 border-b border-r border-border bg-surface px-3 py-2 text-left font-normal">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={r.employee.fullName} size="md" className="text-[11px]" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-semibold text-fg" title={r.employee.fullName}>
                            {r.employee.shortName}
                          </span>
                          {r.deviations > 0 && (
                            <span
                              className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-solid px-1 text-[11px] font-semibold text-white"
                              aria-label={t('deviationsAria', { count: r.deviations })}
                              title={t('deviationsAria', { count: r.deviations })}
                            >
                              {r.deviations}
                            </span>
                          )}
                        </div>
                        {r.employee.position && <div className="max-w-[190px] truncate text-xs text-fg-subtle">{r.employee.position}</div>}
                      </div>
                    </div>
                  </th>
                  <td className={cn(num, 'text-fg-muted')}>{hoursNum(r.planHours, locale)}</td>
                  <td className={cn(num, 'font-semibold', Math.abs(diff) < 0.25 ? 'text-fg' : diff > 0 ? 'text-red-fg' : 'text-orange-fg')}>{hoursNum(r.factHours, locale)}</td>
                  <td className={cn(num, 'text-fg')}>{hoursNum(r.normHours, locale)}</td>
                  <td className={cn(num, r.overtime15 ? 'font-medium text-orange-fg' : 'text-fg-subtle')}>{fmt(r.overtime15)}</td>
                  <td className={cn(num, 'border-r', r.overtime2 ? 'font-medium text-red-fg' : 'text-fg-subtle')}>{fmt(r.overtime2)}</td>
                  {sheet.days.map((d) => {
                    const cell = r.cells.find((c) => c.day === d.day) ?? { day: d.day, hours: null, codes: [], deviation: false, note: null };
                    return <DayCell key={d.day} cell={cell} tint={tintOf(d)} monday={isMonday(d.day)} label={`${r.employee.shortName}, ${d.day}`} />;
                  })}
                </tr>
              );
            })}
          </tbody>
          {sheet.rows.length > 0 && (
            <tfoot className="sticky bottom-0 z-20 bg-surface">
              <tr className="[&>td]:border-t [&>td]:border-border-strong [&>td]:bg-surface">
                <th scope="row" className="sticky left-0 z-30 border-r border-t border-border border-t-border-strong bg-surface px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  {t('total')}
                </th>
                <td className="px-2 text-right font-medium text-fg-muted tabular">{hoursNum(sheet.totals.planHours, locale)}</td>
                <td className="px-2 text-right font-semibold text-fg tabular">{hoursNum(sheet.totals.factHours, locale)}</td>
                <td className="px-2 text-right font-medium text-fg tabular">{hoursNum(sheet.totals.normHours, locale)}</td>
                <td className={cn('px-2 text-right tabular', sheet.totals.overtime15 ? 'font-semibold text-orange-fg' : 'text-fg-subtle')}>{fmt(sheet.totals.overtime15)}</td>
                <td className={cn('border-r border-border px-2 text-right tabular', sheet.totals.overtime2 ? 'font-semibold text-red-fg' : 'text-fg-subtle')}>{fmt(sheet.totals.overtime2)}</td>
                {sheet.days.map((d, i) => (
                  <td key={d.day} className={cn('px-0.5 text-center text-xs text-fg-muted tabular', isMonday(d.day) && 'border-l border-l-border-strong')}>
                    {sheet.totals.perDay[i] ? compactHours(sheet.totals.perDay[i]!, locale) : ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

/** "Форма Т-13" (M4 1:42): monthly grid with codes, deviations, manager confirmation and Excel export. */
export function T13Tab() {
  const t = useTranslations('time.t13');
  const tcode = useTranslations('time.t13Codes');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { can } = useCurrentUser();
  const today = todayStr();
  const [ym, setYm] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }));
  const [q, setQ] = useState('');
  const [dept, setDept] = useState(ALL);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const dq = useDebounced(q.trim(), 300);
  const departments = useAllDepartments();
  const sheet = useT13({ ...ym, q: dq || undefined, departmentId: dept === ALL ? undefined : dept });
  const confirm = useConfirmT13();
  const data = sheet.data;

  const shift = (dir: -1 | 1) =>
    setYm(({ year, month }) => {
      const m = month + dir;
      return m < 1 ? { year: year - 1, month: 12 } : m > 12 ? { year: year + 1, month: 1 } : { year, month: m };
    });

  const download = async () => {
    setDownloading(true);
    try {
      const name = await downloadT13({ ...ym, departmentId: dept === ALL ? undefined : dept });
      toast.success(t('downloaded', { name }));
    } catch (e) {
      toast.error(isApiError(e) ? e.message : tc('error'));
    } finally {
      setDownloading(false);
    }
  };

  const onConfirm = () =>
    confirm.mutate(ym, {
      onSuccess: (r) => {
        setConfirmOpen(false);
        toast.success(t('confirmed', { confirmed: r.confirmed, total: r.total }));
      },
      onError: (e) => toast.error(isApiError(e) && e.rule === 'NO_SUBORDINATES' ? t('noSubordinates') : isApiError(e) ? e.message : tc('error')),
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="icon-sm" onClick={() => shift(-1)} aria-label={t('prevMonth')}>
            <ChevronLeft />
          </Button>
          <h2 className="min-w-[150px] text-center text-xl font-semibold tracking-tight text-fg">{monthTitle(ym.year, ym.month, locale)}</h2>
          <Button variant="ghost" size="icon-sm" onClick={() => shift(1)} aria-label={t('nextMonth')}>
            <ChevronRight />
          </Button>
          {data && (
            <>
              <span
                className={cn(
                  'ml-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-semibold',
                  data.deviationsTotal ? 'bg-red-bg text-red-fg' : 'bg-green-bg text-green-fg',
                )}
              >
                <span className={cn('size-1.5 rounded-full', data.deviationsTotal ? 'bg-red-solid' : 'bg-green-solid')} aria-hidden />
                {data.deviationsTotal ? t('deviations', { count: data.deviationsTotal }) : t('noDeviations')}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[13px] text-fg-muted">
                {t('confirmation')} <span className="font-semibold text-fg tabular">{data.confirmation.confirmed}</span>
                <span className="tabular">/{data.confirmation.total}</span>
              </span>
              {data.confirmation.mine === false && can('time.manage') && (
                <Button size="sm" onClick={() => setConfirmOpen(true)}>
                  <BadgeCheck />
                  {t('confirm')}
                </Button>
              )}
              {data.confirmation.mine === true && (
                <span className="inline-flex items-center gap-1 text-[13px] font-medium text-green-fg">
                  <BadgeCheck className="size-4" aria-hidden />
                  {t('confirmedByMe')}
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Select
            size="sm"
            className="w-52"
            value={dept}
            onValueChange={setDept}
            aria-label={t('department')}
            options={[{ value: ALL, label: t('allDepartments') }, ...(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))]}
          />
          {can('time.export') && (
            <Tooltip content={t('export')}>
              <Button variant="outline" size="icon" onClick={download} loading={downloading} aria-label={t('export')}>
                {!downloading && <Download />}
              </Button>
            </Tooltip>
          )}
        </div>
      </div>

      {sheet.isLoading && <Skeleton className="h-[420px] w-full rounded-xl" />}
      {sheet.isError && !data && (
        <Card>
          <ErrorState error={sheet.error} onRetry={() => sheet.refetch()} />
        </Card>
      )}
      {data && <Grid sheet={data} search={q} onSearch={setQ} />}

      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-fg-muted" aria-label={t('legend')}>
        {T13_CODE_LIST.filter((c) => c !== 'Я').map((c) => (
          <li key={c} className="flex items-center gap-1">
            <span className={cn('font-semibold', t13CodeClass[c])}>{c}</span>
            {tcode(t13CodeKey[c])}
          </li>
        ))}
        <li className="flex items-center gap-1">
          <span className="inline-block size-3 rounded-sm bg-red-bg ring-1 ring-red-solid" aria-hidden />
          {t('deviationLegend')}
        </li>
      </ul>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        tone="primary"
        title={t('confirmTitle')}
        description={t('confirmText', { month: monthTitle(ym.year, ym.month, locale) })}
        confirmLabel={t('confirm')}
        loading={confirm.isPending}
        onConfirm={onConfirm}
      />
    </div>
  );
}
