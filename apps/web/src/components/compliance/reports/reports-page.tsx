'use client';

import {
  Activity, AlertTriangle, CalendarOff, ClipboardList, Download, FileClock, FileText, Landmark, ScrollText, Table2, TrendingDown,
  UserMinus, UserPlus, Users,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { DateRangeInput } from '@/components/ui/date-picker';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { toast } from '@/components/ui/toaster';
import { RequireAccess } from '@/components/shell/require-access';
import { isApiError } from '@/lib/api/errors';
import { useDashboard, useHeadcount, useMovements } from '@/lib/api/hooks/compliance';
import { useLegalEntities } from '@/lib/api/hooks/org';
import type { CandidateStatus, ReportExport } from '@/lib/api/types-compliance';
import { toIntlLocale } from '@/lib/format';
import { can } from '@/lib/permissions';
import { downloadApiFile } from '../download';
import { GroupedBarChart, HorizontalBars, Legend, SERIES_COLORS } from './charts';

const ANY = 'any';
const CANDIDATE_STATUSES: CandidateStatus[] = ['NEW', 'IN_PROGRESS', 'ACCEPTED', 'EXPORTED', 'BLOCKED'];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function presetRange(p: 'month' | 'quarter' | 'year'): { from: string; to: string } {
  const now = new Date();
  const from =
    p === 'month'
      ? new Date(now.getFullYear(), now.getMonth(), 1)
      : p === 'quarter'
        ? new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
        : new Date(now.getFullYear(), 0, 1);
  return { from: iso(from), to: iso(now) };
}

/** /reports — HR analytics (F-35): KPIs, movements by month, headcount by department, xlsx exports. */
export function ReportsPage() {
  const t = useTranslations('reports');
  const tc = useTranslations('common');
  const locale = useLocale();
  const entities = useLegalEntities();
  const [entity, setEntity] = useState(ANY);
  const [range, setRange] = useState<{ from?: string; to?: string }>(() => presetRange('year'));
  const [exporting, setExporting] = useState<ReportExport | null>(null);
  const period = { legalEntityId: entity === ANY ? undefined : entity, from: range.from || undefined, to: range.to || undefined };
  const dashboard = useDashboard(period);
  const movements = useMovements(period);
  const headcount = useHeadcount({ legalEntityId: period.legalEntityId, date: period.to });
  const nf = useMemo(() => new Intl.NumberFormat(toIntlLocale(locale), { maximumFractionDigits: 1 }), [locale]);

  const exportReport = async (r: ReportExport) => {
    setExporting(r);
    try {
      await downloadApiFile(`/reports/${r}/export`, { ...period, date: r === 'headcount' ? period.to : undefined }, `${r}.xlsx`);
    } catch (e) {
      toast.error(isApiError(e) && e.status !== 0 ? e.message : t('exportFailed'));
    } finally {
      setExporting(null);
    }
  };

  const monthLabel = (m: string) => {
    const [y, mo] = m.split('-').map(Number);
    if (!y || !mo) return m;
    return new Intl.DateTimeFormat(toIntlLocale(locale), { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(y, mo - 1, 15)));
  };
  const seriesNames = [t('hired'), t('dismissed'), t('transferred')];
  const d = dashboard.data;

  return (
    <RequireAccess allow={(a) => can(a, 'report.read')}>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" loading={exporting !== null}>
                <Download aria-hidden />
                {t('export')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(['headcount', 'movements', 'documents', 'vnd'] as const).map((r) => (
                <DropdownMenuItem key={r} onSelect={() => void exportReport(r)}>
                  <Table2 aria-hidden />
                  {t(`exports.${r}`)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2" role="group" aria-label={t('filters')}>
        <Select
          aria-label={t('filterEntity')}
          className="w-full sm:w-56"
          value={entity}
          onValueChange={setEntity}
          options={[{ value: ANY, label: t('allEntities') }, ...(entities.data ?? []).map((e) => ({ value: e.id, label: e.name }))]}
        />
        <DateRangeInput value={range} onChange={setRange} className="w-full sm:w-auto" labelFrom={t('periodFrom')} labelTo={t('periodTo')} />
        <div className="flex gap-1">
          {(['month', 'quarter', 'year'] as const).map((p) => {
            const r = presetRange(p);
            const active = r.from === range.from && r.to === range.to;
            return (
              <Button key={p} size="sm" variant={active ? 'secondary' : 'ghost'} aria-pressed={active} onClick={() => setRange(r)}>
                {t(`presets.${p}`)}
              </Button>
            );
          })}
        </div>
      </div>

      {dashboard.error && !d ? (
        <Card>
          <ErrorState error={dashboard.error} onRetry={() => dashboard.refetch()} />
        </Card>
      ) : (
        <div className="grid gap-5">
          <section aria-label={t('kpi')} className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi loading={!d} label={t('headcount')} value={d?.headcount} icon={<Users />} />
            <Kpi loading={!d} label={t('hiredInPeriod')} value={d?.hiredInPeriod} icon={<UserPlus />} />
            <Kpi loading={!d} label={t('dismissedInPeriod')} value={d?.dismissedInPeriod} icon={<UserMinus />} />
            <Kpi loading={!d} label={t('turnover')} value={d ? `${nf.format(d.turnoverPct)}%` : undefined} icon={<TrendingDown />} />
            <Kpi
              loading={!d}
              label={t('vndCompletion')}
              value={d ? `${nf.format(d.vnd.completionPct)}%` : undefined}
              hint={d ? t('vndInProgress', { count: d.vnd.inProgress }) : undefined}
              progress={d ? d.vnd.completionPct / 100 : undefined}
              icon={<ScrollText />}
            />
            <Kpi
              loading={!d}
              label={t('esutd')}
              value={d ? d.esutd.notSent : undefined}
              hint={d ? t('esutdErrors', { count: d.esutd.errors }) : undefined}
              tone={d && d.esutd.notSent + d.esutd.errors > 0 ? 'danger' : 'default'}
              icon={<Landmark />}
            />
          </section>

          <section aria-label={t('documentsBlock')} className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi loading={!d} label={t('docsInRoute')} value={d?.documents.inRoute} icon={<FileText />} />
            <Kpi
              loading={!d}
              label={t('docsOverdue')}
              value={d?.documents.overdue}
              tone={d?.documents.overdue ? 'danger' : 'default'}
              icon={<AlertTriangle />}
            />
            <Kpi loading={!d} label={t('docsCompleted')} value={d?.documents.completedInPeriod} icon={<FileText />} />
            <Kpi
              loading={!d}
              label={t('avgCompletion')}
              value={d ? (d.documents.avgCompletionHours === null ? '—' : t('hours', { value: nf.format(d.documents.avgCompletionHours) })) : undefined}
              icon={<FileClock />}
            />
            <Kpi
              loading={!d}
              label={t('requestsPending')}
              value={d?.requests.pending}
              hint={d ? t('requestsCompleted', { count: d.requests.completedInPeriod }) : undefined}
              icon={<ClipboardList />}
            />
            <Kpi
              loading={!d}
              label={t('absencesToday')}
              value={d ? d.absencesToday.vacation + d.absencesToday.sick + d.absencesToday.businessTrip : undefined}
              hint={d ? t('absencesBreakdown', { vacation: d.absencesToday.vacation, sick: d.absencesToday.sick, trip: d.absencesToday.businessTrip }) : undefined}
              icon={<CalendarOff />}
            />
          </section>

          <div className="grid gap-5 xl:grid-cols-[3fr_2fr]">
            <ChartCard
              title={t('movementsTitle')}
              onExport={() => void exportReport('movements')}
              exporting={exporting === 'movements'}
              loading={movements.isLoading}
              error={movements.error}
              onRetry={() => movements.refetch()}
              empty={!movements.data?.months.length}
              legend={<Legend items={seriesNames.map((s, i) => ({ label: s, color: SERIES_COLORS[i]! }))} />}
              chart={
                movements.data && (
                  <GroupedBarChart
                    ariaLabel={t('movementsTitle')}
                    series={seriesNames}
                    data={movements.data.months.map((m) => ({ label: monthLabel(m.month), values: [m.hired, m.dismissed, m.transferred] }))}
                  />
                )
              }
              table={
                movements.data && (
                  <DataTableView
                    caption={t('movementsTitle')}
                    headers={[t('month'), ...seriesNames]}
                    rows={movements.data.months.map((m) => [monthLabel(m.month), m.hired, m.dismissed, m.transferred])}
                  />
                )
              }
            />
            <ChartCard
              title={t('headcountTitle')}
              subtitle={headcount.data ? t('headcountTotal', { count: headcount.data.total }) : undefined}
              onExport={() => void exportReport('headcount')}
              exporting={exporting === 'headcount'}
              loading={headcount.isLoading}
              error={headcount.error}
              onRetry={() => headcount.refetch()}
              empty={!headcount.data?.byDepartment.length}
              chart={
                headcount.data && (
                  <HorizontalBars
                    ariaLabel={t('headcountTitle')}
                    data={[...headcount.data.byDepartment].sort((a, b) => b.count - a.count).map((r) => ({ label: r.department.name, value: r.count }))}
                  />
                )
              }
              table={
                headcount.data && (
                  <DataTableView
                    caption={t('headcountTitle')}
                    headers={[t('department'), t('count')]}
                    rows={headcount.data.byDepartment.map((r) => [r.department.name, r.count])}
                  />
                )
              }
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <ChartCard
              title={t('candidatesTitle')}
              loading={!d}
              empty={d ? CANDIDATE_STATUSES.every((s) => !d.candidates[s]) : false}
              chart={
                d && (
                  <HorizontalBars
                    ariaLabel={t('candidatesTitle')}
                    color="var(--color-teal-solid)"
                    data={CANDIDATE_STATUSES.map((s) => ({ label: t(`candidate.${s}`), value: d.candidates[s] ?? 0 }))}
                  />
                )
              }
              table={
                d && (
                  <DataTableView
                    caption={t('candidatesTitle')}
                    headers={[t('status'), t('count')]}
                    rows={CANDIDATE_STATUSES.map((s) => [t(`candidate.${s}`), d.candidates[s] ?? 0])}
                  />
                )
              }
            />
            <ChartCard
              title={t('positionsTitle')}
              loading={headcount.isLoading}
              error={headcount.error}
              onRetry={() => headcount.refetch()}
              empty={!headcount.data?.byPosition.length}
              chart={
                headcount.data && (
                  <HorizontalBars
                    ariaLabel={t('positionsTitle')}
                    color="var(--color-orange-solid)"
                    data={[...headcount.data.byPosition].sort((a, b) => b.count - a.count).map((r) => ({ label: r.position.name, value: r.count }))}
                  />
                )
              }
              table={
                headcount.data && (
                  <DataTableView
                    caption={t('positionsTitle')}
                    headers={[t('position'), t('count')]}
                    rows={headcount.data.byPosition.map((r) => [r.position.name, r.count])}
                  />
                )
              }
            />
          </div>
          {dashboard.isFetching && d && <span className="sr-only" role="status">{tc('loading')}</span>}
        </div>
      )}
    </RequireAccess>
  );
}

function Kpi({
  loading,
  label,
  value,
  icon,
  hint,
  tone,
  progress,
}: {
  loading: boolean;
  label: string;
  value: ReactNode;
  icon: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'danger';
  progress?: number;
}) {
  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 shadow-card">
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="mt-3 h-6 w-1/3" />
      </div>
    );
  }
  return <StatCard label={label} value={value ?? '—'} icon={icon} hint={hint} tone={tone} progress={progress} />;
}

function ChartCard({
  title,
  subtitle,
  chart,
  table,
  legend,
  loading,
  error,
  onRetry,
  empty,
  onExport,
  exporting,
}: {
  title: string;
  subtitle?: string;
  chart: ReactNode;
  table: ReactNode;
  legend?: ReactNode;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: boolean;
  onExport?: () => void;
  exporting?: boolean;
}) {
  const t = useTranslations('reports');
  const [asTable, setAsTable] = useState(false);
  return (
    <Card className="min-w-0">
      <CardHeader
        title={title}
        actions={
          <>
            {subtitle && <span className="hidden text-xs text-fg-subtle sm:inline">{subtitle}</span>}
            <Button variant="ghost" size="sm" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
              {asTable ? <Activity aria-hidden /> : <Table2 aria-hidden />}
              {asTable ? t('showChart') : t('showTable')}
            </Button>
            {onExport && (
              <Button variant="ghost" size="icon-sm" onClick={onExport} loading={exporting} aria-label={t('exportNamed', { name: title })}>
                <Download />
              </Button>
            )}
          </>
        }
      />
      <CardBody className="grid gap-3">
        {loading ? (
          <Skeleton className="h-[240px] w-full" />
        ) : error ? (
          <ErrorState error={error} onRetry={onRetry} compact />
        ) : empty ? (
          <EmptyState compact title={t('noData')} description={t('noDataHint')} />
        ) : asTable ? (
          table
        ) : (
          <>
            {legend}
            {chart}
            {/* Accessible fallback for screen readers */}
            <div className="sr-only">{table}</div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function DataTableView({ caption, headers, rows }: { caption: string; headers: string[]; rows: (string | number)[][] }) {
  return (
    <TableContainer className="max-h-[320px] rounded-lg border border-border">
      <Table aria-label={caption}>
        <THead sticky>
          <TR>
            {headers.map((h, i) => (
              <TH key={h} className={i > 0 ? 'text-right' : undefined}>
                {h}
              </TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {rows.map((r, ri) => (
            <TR key={ri}>
              {r.map((c, ci) => (
                <TD key={ci} className={ci > 0 ? 'text-right tabular' : undefined}>
                  {c}
                </TD>
              ))}
            </TR>
          ))}
        </TBody>
      </Table>
    </TableContainer>
  );
}
