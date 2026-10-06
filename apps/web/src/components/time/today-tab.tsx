'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { CircleCheck, CircleAlert, Search, TrendingUp, Users } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { StatusPill } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/popover';
import { Select } from '@/components/ui/select';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/states';
import { useBoard } from '@/lib/api/hooks/time';
import { BOARD_STATUSES, type BoardRow, type BoardStatus, type TodayBoard } from '@/lib/api/types-time';
import { formatLongDate } from '@/lib/format';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { cn } from '@/lib/utils';
import { PeriodNav, ShiftChip, useDuration } from './shared';
import { addDays, boardTone, minutesOfDay, timeOf, todayStr } from './time-utils';

/** Common axis (minutes of the day) so bars line up across rows like M4. */
function axisOf(board: TodayBoard): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of board.rows) {
    const pts: string[] = [];
    if (r.shift) pts.push(r.shift.startAt, r.shift.endAt);
    for (const s of r.segments) pts.push(s.from, s.to);
    for (const p of pts) {
      const v = minutesOfDay(p, board.date);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  if (!Number.isFinite(lo)) return [8 * 60, 20 * 60];
  return [Math.floor(lo / 60) * 60 - 30, Math.ceil(hi / 60) * 60 + 30];
}

function Timeline({ row, axis, date }: { row: BoardRow; axis: [number, number]; date: string }) {
  const t = useTranslations('time.today');
  const locale = useLocale();
  const [lo, hi] = axis;
  const span = Math.max(1, hi - lo);
  const pos = (iso: string) => ((minutesOfDay(iso, date) - lo) / span) * 100;
  const label = [
    row.shift ? t('timelinePlan', { from: timeOf(row.shift.startAt, locale), to: timeOf(row.shift.endAt, locale) }) : null,
    ...row.segments.map((s) => `${t(`seg_${s.kind}`)} ${timeOf(s.from, locale)}–${timeOf(s.to, locale)}`),
  ]
    .filter(Boolean)
    .join('; ');
  return (
    <Tooltip content={label || t('noData')}>
      <div className="relative h-5 w-[200px] rounded-full" role="img" aria-label={label || t('noData')} tabIndex={0}>
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
        {row.shift && (
          <div
            className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full bg-surface-active"
            style={{ left: `${pos(row.shift.startAt)}%`, width: `${Math.max(1, pos(row.shift.endAt) - pos(row.shift.startAt))}%` }}
          />
        )}
        {row.segments
          .filter((s) => s.kind !== 'break')
          .map((s, i) => (
            <div
              key={`w${i}`}
              className={cn('absolute top-1/2 h-3 -translate-y-1/2 rounded-full', s.kind === 'overtime' ? 'bg-timeline-overtime' : 'bg-timeline-work')}
              style={{ left: `${pos(s.from)}%`, width: `${Math.max(1.5, pos(s.to) - pos(s.from))}%` }}
            />
          ))}
        {row.segments
          .filter((s) => s.kind === 'break')
          .map((s, i) => {
            const w = pos(s.to) - pos(s.from);
            return (
              <div
                key={`b${i}`}
                className="absolute top-1/2 h-3.5 -translate-y-1/2 rounded-full border-2 border-surface bg-timeline-break"
                style={{ left: `${pos(s.from)}%`, width: `max(14px, ${w}%)` }}
              />
            );
          })}
        {row.inAt && (
          <div className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-surface bg-orange-solid" style={{ left: `${pos(row.inAt)}%` }} />
        )}
      </div>
    </Tooltip>
  );
}

export function TodayTab() {
  const t = useTranslations('time.today');
  const tb = useTranslations('time.boardStatus');
  const locale = useLocale();
  const dur = useDuration();
  const [date, setDate] = useState(() => todayStr());
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string>('all');
  const dq = useDebounced(q.trim(), 300);
  const board = useBoard({ date, q: dq || undefined, status: status === 'all' ? undefined : (status as BoardStatus) });
  const data = board.data;
  const axis = useMemo<[number, number]>(() => (data ? axisOf(data) : [480, 1200]), [data]);
  const k = data?.kpi;

  const columns = useMemo<ColumnDef<BoardRow, unknown>[]>(
    () => [
      {
        id: 'employee',
        header: t('colEmployee'),
        meta: { label: t('colEmployee'), hideable: false },
        cell: ({ row }) => (
          <div className="flex min-w-[200px] items-center gap-2.5">
            <Avatar name={row.original.employee.fullName} />
            <div className="min-w-0">
              <div className="truncate font-medium text-fg">{row.original.employee.shortName}</div>
              {row.original.employee.position && <div className="truncate text-xs text-fg-subtle">{row.original.employee.position}</div>}
            </div>
          </div>
        ),
      },
      {
        id: 'shift',
        header: t('colShift'),
        meta: { label: t('colShift') },
        cell: ({ row }) =>
          row.original.shift ? (
            <div className="w-[150px]">
              <ShiftChip shift={row.original.shift} compact className="py-0.5" />
            </div>
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
      {
        id: 'status',
        header: t('colStatus'),
        meta: { label: t('colStatus'), className: 'whitespace-nowrap' },
        cell: ({ row }) => (
          <StatusPill tone={boardTone[row.original.status]} variant="dot">
            {tb(row.original.status)}
          </StatusPill>
        ),
      },
      {
        id: 'in',
        header: t('colIn'),
        meta: { label: t('colIn'), className: 'tabular font-medium' },
        cell: ({ row }) => (row.original.inAt ? timeOf(row.original.inAt, locale) : <span className="text-fg-subtle">—</span>),
      },
      {
        id: 'out',
        header: t('colOut'),
        meta: { label: t('colOut'), className: 'tabular font-medium' },
        cell: ({ row }) =>
          row.original.outAt ? (
            timeOf(row.original.outAt, locale)
          ) : (
            <span className={row.original.status === 'NO_OUT' ? 'font-semibold text-red-fg' : 'text-fg-subtle'}>—</span>
          ),
      },
      {
        id: 'timeline',
        header: t('colTimeline'),
        meta: { label: t('colTimeline') },
        cell: ({ row }) => <Timeline row={row.original} axis={axis} date={data?.date ?? date} />,
      },
      {
        id: 'worked',
        header: t('colWorked'),
        meta: { label: t('colWorked'), className: 'whitespace-nowrap tabular' },
        cell: ({ row }) => (
          <span>
            <span className="font-semibold text-fg">{dur(row.original.workedMinutes)}</span>
            <span className="text-fg-subtle"> / {dur(row.original.plannedMinutes)}</span>
          </span>
        ),
      },
      {
        id: 'deviation',
        header: t('colDeviation'),
        meta: { label: t('colDeviation'), className: 'whitespace-nowrap tabular' },
        cell: ({ row }) => {
          const d = row.original.deviationMinutes;
          if (Math.abs(d) <= 15) return <span className="text-fg-subtle">—</span>;
          return <span className={d > 0 ? 'font-medium text-purple-fg' : 'font-medium text-orange-fg'}>{dur(d, { sign: true })}</span>;
        },
      },
    ],
    [t, tb, locale, dur, axis, data?.date, date],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-fg">{formatLongDate(date, locale)}</h2>
        <PeriodNav onPrev={() => setDate(addDays(date, -1))} onNext={() => setDate(addDays(date, 1))} onToday={() => setDate(todayStr())} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('kpiOnShift')}
          value={k ? k.onShiftNow : '—'}
          total={k ? k.scheduledToday : undefined}
          progress={k && k.scheduledToday ? k.onShiftNow / k.scheduledToday : k ? 0 : undefined}
          icon={<Users aria-hidden />}
        />
        <StatCard
          label={t('kpiAttention')}
          value={k ? k.needAttention : '—'}
          tone={k && k.needAttention > 0 ? 'danger' : 'default'}
          icon={<CircleAlert aria-hidden />}
          hint={k ? (k.noMarks ? t('kpiNoMarks', { count: k.noMarks }) : t('kpiAllGood')) : undefined}
        />
        <StatCard label={t('kpiOvertime')} value={k ? (k.overtimeMinutes ? dur(k.overtimeMinutes) : '—') : '—'} icon={<TrendingUp aria-hidden />} />
        <StatCard
          label={t('kpiClosed')}
          value={k ? k.closedShifts : '—'}
          total={k ? k.totalShifts : undefined}
          progress={k && k.totalShifts ? k.closedShifts / k.totalShifts : k ? 0 : undefined}
          icon={<CircleCheck aria-hidden />}
          hint={k ? t('kpiFact', { fact: dur(k.factMinutes), delta: dur(k.deltaToPlanMinutes, { sign: true, zero: '0' }) }) : undefined}
        />
      </div>
      <DataTable
        label={t('tableLabel')}
        columns={columns}
        data={data?.rows}
        getRowId={(r) => r.employee.employeeId}
        isLoading={board.isLoading}
        isFetching={board.isFetching}
        error={board.error}
        onRetry={() => board.refetch()}
        columnVisibilityKey="time-board"
        toolbar={
          <>
            <Input
              inputSize="sm"
              leftIcon={<Search />}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('search')}
              aria-label={t('search')}
              className="w-full sm:w-64"
            />
            <Select
              size="sm"
              className="w-48"
              value={status}
              onValueChange={setStatus}
              aria-label={t('colStatus')}
              options={[{ value: 'all', label: t('allStatuses') }, ...BOARD_STATUSES.map((s) => ({ value: s, label: tb(s) }))]}
            />
          </>
        }
        empty={<EmptyState compact title={t('empty')} description={t('emptyHint')} />}
      />
      <p className="text-xs text-fg-subtle">{t('autoRefresh')}</p>
    </div>
  );
}
