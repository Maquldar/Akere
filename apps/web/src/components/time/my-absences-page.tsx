'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { CalendarDays, FileText } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { StatusPill } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/states';
import { useCurrentUser } from '@/components/shell/me-context';
import { Link } from '@/i18n/navigation';
import { useAbsences, useSickLeaves } from '@/lib/api/hooks/time';
import { ABSENCE_KINDS, type AbsenceKind, type AbsenceView, type SickLeaveView } from '@/lib/api/types-time';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { absenceIcon } from './my-time-page';
import { absenceTone, diffDays, todayStr } from './time-utils';

type Row = AbsenceView & { days: number; sickLeave: SickLeaveView | null };

/** "Мои отсутствия": vacations, sick leaves, unpaid days, business trips of the current user (F-36). */
export function MyAbsencesPage() {
  const t = useTranslations('absences.my');
  const ta = useTranslations('time.absenceKind');
  const locale = useLocale();
  const { me, can } = useCurrentUser();
  const employeeId = me.employee?.id;
  const thisYear = Number(todayStr().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [kind, setKind] = useState<string>('all');
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const absences = useAbsences({ employeeId, from, to }, { enabled: Boolean(employeeId) });
  const sick = useSickLeaves({ employeeId, from, to, page: 1, pageSize: 100 }, { enabled: Boolean(employeeId) && can('sickleave.read') });
  const today = todayStr();

  const rows = useMemo<Row[]>(() => {
    const leaves = sick.data?.items ?? [];
    return (absences.data ?? [])
      .map((a) => ({
        ...a,
        days: diffDays(a.startDate, a.endDate) + 1,
        sickLeave: a.kind === 'SICK' ? (leaves.find((s) => s.startDate === a.startDate && s.endDate === a.endDate) ?? null) : null,
      }))
      .sort((x, y) => y.startDate.localeCompare(x.startDate));
  }, [absences.data, sick.data]);
  const filtered = kind === 'all' ? rows : rows.filter((r) => r.kind === kind);
  const daysOf = (k: AbsenceKind) => rows.filter((r) => r.kind === k).reduce((s, r) => s + r.days, 0);

  const columns = useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      {
        id: 'kind',
        header: t('colKind'),
        meta: { label: t('colKind'), hideable: false },
        cell: ({ row }) => {
          const Icon = absenceIcon[row.original.kind];
          return (
            <StatusPill tone={absenceTone[row.original.kind]} className="gap-1 [&>span:first-child]:hidden">
              <Icon className="size-3.5" aria-hidden />
              {ta(row.original.kind)}
            </StatusPill>
          );
        },
      },
      {
        id: 'period',
        header: t('colPeriod'),
        meta: { label: t('colPeriod'), className: 'whitespace-nowrap tabular' },
        cell: ({ row }) => (
          <span className="font-medium text-fg">
            {formatDate(row.original.startDate, locale)}
            {row.original.endDate !== row.original.startDate && ` — ${formatDate(row.original.endDate, locale)}`}
          </span>
        ),
      },
      { id: 'days', header: t('colDays'), meta: { label: t('colDays'), className: 'tabular' }, cell: ({ row }) => t('days', { count: row.original.days }) },
      {
        id: 'state',
        header: t('colState'),
        meta: { label: t('colState') },
        cell: ({ row }) => {
          const r = row.original;
          if (r.endDate < today) return <span className="text-fg-subtle">{t('past')}</span>;
          if (r.startDate > today) return <StatusPill tone="blue" variant="dot">{t('upcoming')}</StatusPill>;
          return <StatusPill tone="green" variant="dot">{t('current')}</StatusPill>;
        },
      },
      {
        id: 'source',
        header: t('colSource'),
        meta: { label: t('colSource') },
        cell: ({ row }) => {
          const r = row.original;
          if (r.sickLeave) {
            return (
              <div className="min-w-[180px]">
                <div className="text-fg">{t('sickLeaveNumber', { number: r.sickLeave.number })}</div>
                {r.sickLeave.file && (
                  <a href={r.sickLeave.file.url} target="_blank" rel="noreferrer" className="focus-ring inline-flex items-center gap-1 rounded text-xs font-medium text-primary hover:underline">
                    <FileText className="size-3.5" aria-hidden />
                    {r.sickLeave.file.filename}
                  </a>
                )}
              </div>
            );
          }
          return <span className="text-fg-muted">{t(`source_${r.source}`)}</span>;
        },
      },
      {
        id: 'note',
        header: t('colNote'),
        meta: { label: t('colNote') },
        cell: ({ row }) => <span className="line-clamp-2 min-w-[160px] text-fg-muted">{row.original.note ?? '—'}</span>,
      },
    ],
    [t, ta, locale, today],
  );

  const years = [thisYear + 1, thisYear, thisYear - 1, thisYear - 2];

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          can('request.create') ? (
            <Button variant="outline" asChild>
              <Link href="/time/schedule?tab=requests">{t('timeRequests')}</Link>
            </Button>
          ) : undefined
        }
      />
      {!employeeId ? (
        <Card>
          <EmptyState icon={<CalendarDays aria-hidden />} title={t('noEmployee')} />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {(['VACATION', 'SICK', 'UNPAID', 'BUSINESS_TRIP'] as const).map((k) => {
              const Icon = absenceIcon[k];
              return <StatCard key={k} label={ta(k)} value={t('days', { count: daysOf(k) })} icon={<Icon aria-hidden />} hint={t('inYear', { year })} />;
            })}
          </div>
          <DataTable
            label={t('tableLabel')}
            columns={columns}
            data={absences.data ? filtered : undefined}
            getRowId={(r) => r.id}
            isLoading={absences.isLoading}
            isFetching={absences.isFetching || sick.isFetching}
            error={absences.error}
            onRetry={() => absences.refetch()}
            columnVisibilityKey="my-absences"
            toolbar={
              <>
                <Select
                  size="sm"
                  className="w-28"
                  value={String(year)}
                  onValueChange={(v) => setYear(Number(v))}
                  aria-label={t('year')}
                  options={years.map((y) => ({ value: String(y), label: String(y) }))}
                />
                <Select
                  size="sm"
                  className={cn('w-52')}
                  value={kind}
                  onValueChange={setKind}
                  aria-label={t('colKind')}
                  options={[{ value: 'all', label: t('allKinds') }, ...ABSENCE_KINDS.map((k) => ({ value: k, label: ta(k) }))]}
                />
              </>
            }
            empty={<EmptyState compact icon={<CalendarDays aria-hidden />} title={t('empty')} description={t('emptyHint')} />}
          />
        </div>
      )}
    </div>
  );
}
