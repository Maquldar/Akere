'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { CalendarClock, Clock, Plus, TrendingDown, TrendingUp } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Badge, StatusPill } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toaster';
import { useCurrentUser } from '@/components/shell/me-context';
import { isApiError } from '@/lib/api/errors';
import { useClaimShift, useMyWeek, useMyWeeks, useSchedule, useTimeRequests } from '@/lib/api/hooks/time';
import type { ApprovalStatus, MyWeek, ShiftView, TimeRequestView } from '@/lib/api/types-time';
import { formatDate, formatDateTime } from '@/lib/format';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { cn } from '@/lib/utils';
import { absenceIcon, requestIcon, WeekTiles } from './my-time-page';
import { TimeRequestDialog } from './request-dialog';
import { ApprovalPill, PeriodNav, ShiftChip, useDuration, useRequestSummary, useTabParam } from './shared';
import { absenceTone, addDays, dayNum, monthEnd, monthTitle, todayStr, weekDays, weekdayShort, weekStart, weekTitle } from './time-utils';
import { WeekGrid } from './week-grid';

const TABS = ['hours', 'team', 'requests'] as const;

// ───────────────────────── Мои часы ─────────────────────────

type Day = MyWeek['days'][number];

function DaysTable({ days }: { days: Day[] }) {
  const t = useTranslations('time.hours');
  const ta = useTranslations('time.absenceKind');
  const locale = useLocale();
  const dur = useDuration();
  const today = todayStr();
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      <TableContainer>
        <Table aria-label={t('tableLabel')}>
          <THead>
            <TR>
              <TH>{t('colDay')}</TH>
              <TH>{t('colKind')}</TH>
              <TH className="text-right">{t('colPlanned')}</TH>
              <TH className="text-right">{t('colWorked')}</TH>
              <TH className="text-right">{t('colDelta')}</TH>
            </TR>
          </THead>
          <TBody>
            {days.map((d) => {
              const delta = d.workedMinutes - d.plannedMinutes;
              const past = d.date < today;
              const Icon = d.absenceKind ? absenceIcon[d.absenceKind] : null;
              return (
                <TR key={d.date} className={cn(d.date === today && 'bg-primary-soft/40')}>
                  <TD className="whitespace-nowrap">
                    <span className="font-medium text-fg tabular">
                      {weekdayShort(d.date, locale)}, {formatDate(d.date, locale)}
                    </span>
                  </TD>
                  <TD>
                    {d.kind === 'ABSENCE' && d.absenceKind ? (
                      <StatusPill tone={absenceTone[d.absenceKind]} className="gap-1 [&>span:first-child]:hidden">
                        {Icon && <Icon className="size-3.5" aria-hidden />}
                        {ta(d.absenceKind)}
                      </StatusPill>
                    ) : d.kind === 'WORK' ? (
                      <Badge tone="blue">{t('kindWork')}</Badge>
                    ) : d.kind === 'HOLIDAY' ? (
                      <Badge tone="purple">{t('kindHoliday')}</Badge>
                    ) : (
                      <span className="text-fg-subtle">{t('kindOff')}</span>
                    )}
                  </TD>
                  <TD className="text-right tabular">{d.plannedMinutes ? dur(d.plannedMinutes) : '—'}</TD>
                  <TD className="text-right font-medium tabular">{d.workedMinutes ? dur(d.workedMinutes) : past && d.plannedMinutes ? <span className="text-red-fg">0</span> : '—'}</TD>
                  <TD className={cn('text-right tabular', Math.abs(delta) <= 15 ? 'text-fg-subtle' : delta > 0 ? 'text-purple-fg' : past ? 'text-orange-fg' : 'text-fg-subtle')}>
                    {(past || d.workedMinutes) && (d.plannedMinutes || d.workedMinutes) && Math.abs(delta) > 0 ? dur(delta, { sign: true }) : '—'}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </TableContainer>
    </div>
  );
}

function Summary({ worked, planned }: { worked: number; planned: number }) {
  const t = useTranslations('time.hours');
  const dur = useDuration();
  const delta = worked - planned;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <StatCard label={t('worked')} value={dur(worked)} icon={<Clock aria-hidden />} progress={planned ? worked / planned : undefined} />
      <StatCard label={t('planned')} value={dur(planned)} icon={<CalendarClock aria-hidden />} />
      <StatCard
        label={t('delta')}
        value={delta === 0 ? '—' : dur(delta, { sign: true })}
        icon={delta >= 0 ? <TrendingUp aria-hidden /> : <TrendingDown aria-hidden />}
        hint={t('deltaHint')}
      />
    </div>
  );
}

function HoursTab() {
  const t = useTranslations('time.hours');
  const locale = useLocale();
  const [mode, setMode] = useState<'week' | 'month'>('week');
  const [anchor, setAnchor] = useState(() => todayStr());
  const ws = weekStart(anchor);
  const week = useMyWeek(mode === 'week' ? ws : undefined);
  const [y, m] = anchor.split('-').map(Number) as [number, number];
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
  const mEnd = monthEnd(y, m);
  const weekStarts = useMemo(() => {
    if (mode !== 'month') return [];
    const out: string[] = [];
    for (let d = weekStart(monthStart); d <= mEnd; d = addDays(d, 7)) out.push(d);
    return out;
  }, [mode, monthStart, mEnd]);
  const weeks = useMyWeeks(weekStarts);
  const monthDays = weeks.every((w) => w.data) ? weeks.flatMap((w) => w.data!.days).filter((d) => d.date >= monthStart && d.date <= mEnd) : null;
  const monthLoading = weeks.some((w) => w.isLoading);
  const monthError = weeks.find((w) => w.isError)?.error;

  const shift = (dir: -1 | 1) => {
    if (mode === 'week') setAnchor(addDays(ws, dir * 7));
    else setAnchor(`${m + dir === 0 ? y - 1 : m + dir === 13 ? y + 1 : y}-${String(((m + dir + 11) % 12) + 1).padStart(2, '0')}-01`);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-fg tabular">{mode === 'week' ? weekTitle(ws, locale) : monthTitle(y, m, locale)}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            size="sm"
            className="w-32"
            value={mode}
            onValueChange={(v) => setMode(v as 'week' | 'month')}
            aria-label={t('period')}
            options={[
              { value: 'week', label: t('week') },
              { value: 'month', label: t('month') },
            ]}
          />
          <PeriodNav onPrev={() => shift(-1)} onNext={() => shift(1)} onToday={() => setAnchor(todayStr())} />
        </div>
      </div>
      {mode === 'week' && (
        <>
          {week.isLoading && <Skeleton className="h-64 w-full" />}
          {week.isError && (
            <Card>
              <ErrorState error={week.error} onRetry={() => week.refetch()} />
            </Card>
          )}
          {week.data && (
            <>
              <Summary worked={week.data.workedMinutes} planned={week.data.plannedMinutes} />
              <Card className="p-4">
                <WeekTiles week={week.data} size="lg" />
              </Card>
              <DaysTable days={week.data.days} />
            </>
          )}
        </>
      )}
      {mode === 'month' && (
        <>
          {monthLoading && <Skeleton className="h-64 w-full" />}
          {monthError ? (
            <Card>
              <ErrorState error={monthError} onRetry={() => weeks.forEach((w) => w.refetch())} />
            </Card>
          ) : null}
          {monthDays && (
            <>
              <Summary worked={monthDays.reduce((s, d) => s + d.workedMinutes, 0)} planned={monthDays.reduce((s, d) => s + d.plannedMinutes, 0)} />
              <DaysTable days={monthDays} />
            </>
          )}
        </>
      )}
    </div>
  );
}

// ───────────────────────── Мой график (команда) ─────────────────────────

function OpenShiftCell({ shift }: { shift: ShiftView }) {
  const t = useTranslations('time.my');
  const { me } = useCurrentUser();
  const claim = useClaimShift();
  const mine = shift.claims.find((c) => c.employee.id === me.id);
  return (
    <ShiftChip
      shift={shift}
      extra={
        <span className="mt-1">
          {mine ? (
            <ApprovalPill status={mine.status} />
          ) : (
            <Button
              size="sm"
              className="h-6 px-2 text-xs"
              loading={claim.isPending}
              onClick={() =>
                claim.mutate(shift.id, {
                  onSuccess: () => toast.success(t('claimed')),
                  onError: (e) =>
                    toast.error(isApiError(e) && e.rule === 'ALREADY_SCHEDULED' ? t('alreadyScheduled') : isApiError(e) ? e.message : t('claimFailed')),
                })
              }
            >
              {t('claim')}
            </Button>
          )}
        </span>
      }
    />
  );
}

function TeamTab() {
  const t = useTranslations('time.schedule');
  const locale = useLocale();
  const { me } = useCurrentUser();
  const [anchor, setAnchor] = useState(() => weekStart(todayStr()));
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const days = weekDays(anchor);
  const schedule = useSchedule({ from: days[0]!, to: days[6]!, scope: 'team', q: dq || undefined });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-fg tabular">{weekTitle(anchor, locale)}</h2>
        <PeriodNav onPrev={() => setAnchor(addDays(anchor, -7))} onNext={() => setAnchor(addDays(anchor, 7))} onToday={() => setAnchor(weekStart(todayStr()))} />
      </div>
      {schedule.isError && !schedule.data ? (
        <Card>
          <ErrorState error={schedule.error} onRetry={() => schedule.refetch()} />
        </Card>
      ) : (
        <WeekGrid
          label={t('gridLabel')}
          data={schedule.data}
          loading={schedule.isLoading}
          days={days}
          search={q}
          onSearch={setQ}
          highlightEmployeeId={me.employee?.id}
          renderShift={(s) => <ShiftChip shift={s} />}
          openShifts={{
            render: (_d, shifts) => shifts.map((s) => <OpenShiftCell key={s.id} shift={s} />),
          }}
        />
      )}
    </div>
  );
}

// ───────────────────────── Запросы ─────────────────────────

function RequestsTab() {
  const t = useTranslations('time.requests');
  const tk = useTranslations('time.requestKind');
  const ta = useTranslations('time.approval');
  const locale = useLocale();
  const summary = useRequestSummary();
  const [status, setStatus] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [creating, setCreating] = useState(false);
  const query = useTimeRequests({ scope: 'mine', status: status === 'all' ? undefined : (status as ApprovalStatus), page, pageSize });

  const columns = useMemo<ColumnDef<TimeRequestView, unknown>[]>(
    () => [
      {
        id: 'kind',
        header: t('colKind'),
        meta: { label: t('colKind'), hideable: false },
        cell: ({ row }) => {
          const Icon = requestIcon[row.original.kind];
          return (
            <span className="flex min-w-[200px] items-center gap-2 font-medium text-fg">
              <Icon className="size-4 shrink-0 text-purple-fg" aria-hidden />
              {tk(row.original.kind)}
            </span>
          );
        },
      },
      { id: 'date', header: t('colDate'), meta: { label: t('colDate'), className: 'whitespace-nowrap tabular' }, cell: ({ row }) => formatDate(row.original.date, locale) },
      {
        id: 'details',
        header: t('colDetails'),
        meta: { label: t('colDetails') },
        cell: ({ row }) => (
          <div className="min-w-[200px]">
            <div className="text-fg">{summary(row.original)}</div>
            {typeof row.original.data.reason === 'string' && <div className="line-clamp-2 text-xs text-fg-subtle">{row.original.data.reason}</div>}
          </div>
        ),
      },
      { id: 'status', header: t('colStatus'), meta: { label: t('colStatus') }, cell: ({ row }) => <ApprovalPill status={row.original.status} variant="pill" /> },
      {
        id: 'decision',
        header: t('colDecision'),
        meta: { label: t('colDecision') },
        cell: ({ row }) =>
          row.original.decidedBy ? (
            <div className="min-w-[160px] text-xs">
              <div className="font-medium text-fg">{row.original.decidedBy.shortName}</div>
              <div className="text-fg-subtle tabular">{formatDateTime(row.original.decidedAt, locale)}</div>
              {row.original.comment && <div className="mt-0.5 text-fg-muted">«{row.original.comment}»</div>}
            </div>
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
      {
        id: 'created',
        header: t('colCreated'),
        meta: { label: t('colCreated'), className: 'whitespace-nowrap tabular text-fg-muted' },
        cell: ({ row }) => formatDateTime(row.original.createdAt, locale),
      },
    ],
    [t, tk, locale, summary],
  );

  return (
    <>
      <DataTable
        label={t('mineLabel')}
        columns={columns}
        data={query.data?.items}
        getRowId={(r) => r.id}
        isLoading={query.isLoading}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={() => query.refetch()}
        columnVisibilityKey="time-my-requests"
        pagination={query.data ? { page, pageSize, total: query.data.total, onPageChange: setPage, onPageSizeChange: (s) => { setPageSize(s); setPage(1); } } : undefined}
        toolbar={
          <Select
            size="sm"
            className="w-44"
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            aria-label={t('colStatus')}
            options={[
              { value: 'all', label: t('allStatuses') },
              ...(['PENDING', 'APPROVED', 'REJECTED'] as const).map((s) => ({ value: s, label: ta(s) })),
            ]}
          />
        }
        toolbarRight={
          <Button onClick={() => setCreating(true)}>
            <Plus />
            {t('new')}
          </Button>
        }
        empty={
          <EmptyState
            compact
            title={t('emptyMine')}
            description={t('emptyMineHint')}
            action={
              <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
                <Plus />
                {t('new')}
              </Button>
            }
          />
        }
      />
      <TimeRequestDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

export function MySchedulePage() {
  const t = useTranslations('time.schedule');
  const { me } = useCurrentUser();
  const [tab, setTab] = useTabParam(TABS, 'team');

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      {!me.employee ? (
        <Card>
          <EmptyState icon={<Clock aria-hidden />} title={t('noEmployee')} />
        </Card>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList aria-label={t('title')}>
            <TabsTrigger value="hours">{t('tabHours')}</TabsTrigger>
            <TabsTrigger value="team">{t('tabTeam')}</TabsTrigger>
            <TabsTrigger value="requests">{t('tabRequests')}</TabsTrigger>
          </TabsList>
          <TabsContent value="hours">
            <HoursTab />
          </TabsContent>
          <TabsContent value="team">
            <TeamTab />
          </TabsContent>
          <TabsContent value="requests">
            <RequestsTab />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

export { dayNum };
