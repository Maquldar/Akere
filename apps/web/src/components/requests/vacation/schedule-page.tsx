'use client';

import { CalendarCheck2, CalendarRange, Check, Download, Lock, Play, Plus, Search, Send, Users, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { StatusPill, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { RequireAccess } from '@/components/shell/require-access';
import { useCurrentUser } from '@/components/shell/me-context';
import { usePositions } from '@/lib/api/hooks/org';
import {
  campaignExportUrl, searchEmployees, useAllDepartments, useCampaigns, useSaveCampaign, useVacationGrid,
} from '@/lib/api/hooks/requests';
import { PLAN_STATUSES, type CampaignStatus, type CampaignView, type PlanRow, type PlanStatus } from '@/lib/api/types-requests';
import { formatDate } from '@/lib/format';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { can } from '@/lib/permissions';
import { useRequestErrorText } from '../shared';
import { ApproveDialog } from './approve-dialog';
import { CampaignDialog } from './campaign-dialog';
import { GanttGrid, GanttLegend } from './gantt-grid';
import { MyPlanCard } from './my-plan-card';
import { PlanDialog } from './plan-dialog';

const ANY = 'any';
const campaignTone: Record<CampaignStatus, Tone> = { DRAFT: 'gray', ACTIVE: 'green', CLOSED: 'blue' };

function pickDefault(campaigns: CampaignView[]): CampaignView | undefined {
  const year = new Date().getFullYear();
  return (
    campaigns.find((c) => c.status === 'ACTIVE' && c.year >= year) ??
    campaigns.find((c) => c.status === 'ACTIVE') ??
    campaigns.slice().sort((a, b) => b.year - a.year)[0]
  );
}

function CampaignGrid({ campaign }: { campaign: CampaignView }) {
  const t = useTranslations('vacation');
  const tg = useTranslations('vacation.grid');
  const tp = useTranslations('vacation.planStatus');
  const tc = useTranslations('common');
  const { me, can: allowed } = useCurrentUser();
  const canApprove = allowed('vacation.approve');
  const canManagePlans = canApprove || allowed('vacation.manage');
  const [status, setStatus] = useState<string>(ANY);
  const [employee, setEmployee] = useState<ComboOption | null>(null);
  const [department, setDepartment] = useState<string>(ANY);
  const [position, setPosition] = useState<string>(ANY);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const debouncedQ = useDebounced(q.trim(), 300);
  const departments = useAllDepartments({ enabled: canManagePlans });
  const positions = usePositions();
  const grid = useVacationGrid(campaign.id, {
    status: status === ANY ? undefined : (status as PlanStatus),
    employeeId: employee?.value,
    departmentId: department === ANY ? undefined : department,
    positionId: position === ANY ? undefined : position,
    q: debouncedQ || undefined,
    page,
    pageSize,
  });
  const [selected, setSelected] = useState<Map<string, PlanRow>>(new Map());
  const [bulk, setBulk] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [openRow, setOpenRow] = useState<PlanRow | null>(null);
  const filtered = status !== ANY || employee !== null || department !== ANY || position !== ANY || Boolean(debouncedQ);

  // Keep the open row in sync with fresh grid data (after saving / approving).
  useEffect(() => {
    if (!openRow || !grid.data) return;
    const fresh = grid.data.items.find((r) => r.employee.employeeId === openRow.employee.employeeId);
    if (fresh && fresh !== openRow) setOpenRow(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid.data]);

  const reset = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };
  const toggle = (row: PlanRow, on: boolean) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (on) next.set(row.employee.employeeId, row);
      else next.delete(row.employee.employeeId);
      return next;
    });
  const togglePage = (on: boolean) =>
    setSelected((prev) => {
      const next = new Map(prev);
      for (const r of grid.data?.items ?? []) {
        if (on) next.set(r.employee.employeeId, r);
        else next.delete(r.employee.employeeId);
      }
      return next;
    });
  const selectedRows = [...selected.values()];
  const eligibleCount = selectedRows.filter((r) => r.canApprove && r.status === 'SUBMITTED').length;
  const isOwn = (r: PlanRow) => r.employee.employeeId === me.employee?.id;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-fg">{tg('title')}</h2>
        <GanttLegend />
      </div>

      {selected.size > 0 && canApprove ? (
        <div
          role="region"
          aria-label={tg('bulkBar')}
          className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-primary/20 bg-primary-soft px-3 py-1.5 text-[13px]"
        >
          <span className="font-semibold text-fg tabular" aria-live="polite">
            {tg('selected', { count: selected.size, eligible: eligibleCount })}
          </span>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setBulk('APPROVE')}>
              <Check aria-hidden />
              {tg('approve')}
            </Button>
            <Button size="sm" variant="outline" className="text-red-fg" onClick={() => setBulk('REJECT')}>
              <X aria-hidden />
              {tg('reject')}
            </Button>
          </div>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelected(new Map())}>
            {tg('clearSelection')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            aria-label={tg('search')}
            placeholder={tg('search')}
            leftIcon={<Search />}
            value={q}
            onChange={(e) => reset(setQ)(e.target.value)}
            className="w-full sm:w-56"
          />
          <Select
            aria-label={tg('filterStatus')}
            className="w-full sm:w-44"
            value={status}
            onValueChange={reset(setStatus)}
            options={[{ value: ANY, label: tg('allStatuses') }, ...PLAN_STATUSES.map((s) => ({ value: s, label: tp(s) }))]}
          />
          {canManagePlans && (
            <>
              <Combobox
                aria-label={tg('filterEmployee')}
                className="w-full sm:w-56"
                value={employee?.value ?? null}
                selectedOption={employee}
                onChange={(_v, o) => reset(setEmployee)(o)}
                loadOptions={searchEmployees}
                placeholder={tg('allEmployees')}
                clearable
              />
              <Select
                aria-label={tg('filterDepartment')}
                className="w-full sm:w-52"
                value={department}
                onValueChange={reset(setDepartment)}
                options={[{ value: ANY, label: tg('allDepartments') }, ...(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))]}
              />
              <Select
                aria-label={tg('filterPosition')}
                className="w-full sm:w-52"
                value={position}
                onValueChange={reset(setPosition)}
                options={[{ value: ANY, label: tg('allPositions') }, ...(positions.data ?? []).map((p) => ({ value: p.id, label: p.name }))]}
              />
            </>
          )}
        </div>
      )}

      <GanttGrid
        year={campaign.year}
        rows={grid.data?.items}
        isLoading={grid.isLoading}
        error={grid.error}
        onRetry={() => grid.refetch()}
        selectable={canApprove}
        selected={new Set(selected.keys())}
        onToggle={toggle}
        onTogglePage={togglePage}
        canOpen={(r) => canManagePlans || isOwn(r)}
        onOpen={setOpenRow}
        empty={
          <EmptyState
            compact
            icon={<CalendarRange aria-hidden />}
            title={filtered ? tc('nothingFound') : tg('empty')}
            description={filtered ? tc('tryOtherFilters') : tg('emptyHint')}
          />
        }
      />
      {grid.data && (grid.data.total > 0 || page > 1) && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={grid.data.total}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
        />
      )}
      <p className="text-xs text-fg-subtle">{t('reminderHint')}</p>

      {bulk && (
        <ApproveDialog
          campaignId={campaign.id}
          decision={bulk}
          selected={selectedRows}
          onOpenChange={(o) => !o && setBulk(null)}
          onDone={() => setSelected(new Map())}
        />
      )}
      {openRow && <PlanDialog campaign={campaign} row={openRow} onOpenChange={(o) => !o && setOpenRow(null)} />}
    </div>
  );
}

export function VacationSchedulePage() {
  const t = useTranslations('vacation');
  const tcs = useTranslations('vacation.campaignStatus');
  const locale = useLocale();
  const errorText = useRequestErrorText();
  const { me, can: allowed } = useCurrentUser();
  const manage = allowed('vacation.manage');
  const campaigns = useCampaigns();
  const save = useSaveCampaign();
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<'activate' | 'close' | null>(null);
  const list = campaigns.data ?? [];
  const campaign = list.find((c) => c.id === campaignId) ?? pickDefault(list);

  const changeStatus = (status: 'ACTIVE' | 'CLOSED') =>
    campaign &&
    save.mutate(
      { id: campaign.id, input: { status } },
      {
        onSuccess: () => {
          toast.success(status === 'ACTIVE' ? t('activated', { year: campaign.year }) : t('closed', { year: campaign.year }));
          setConfirm(null);
        },
        onError: (e) => toast.error(errorText(e)),
      },
    );

  const header = (
    <PageHeader
      title={t('title')}
      subtitle={
        campaign ? (
          <span className="flex flex-wrap items-center gap-2">
            {t('planningFor', { year: campaign.year })}
            <StatusPill tone={campaignTone[campaign.status]}>{tcs(campaign.status)}</StatusPill>
            {campaign.deadline && <span className="text-fg-subtle">· {t('deadline', { date: formatDate(campaign.deadline, locale) })}</span>}
          </span>
        ) : (
          t('subtitle')
        )
      }
      actions={
        <>
          {list.length > 0 && (
            <Select
              aria-label={t('campaignSelect')}
              className="w-[150px]"
              value={campaign?.id}
              onValueChange={setCampaignId}
              options={list
                .slice()
                .sort((a, b) => b.year - a.year)
                .map((c) => ({ value: c.id, label: t('campaignOption', { year: c.year }) }))}
            />
          )}
          {campaign && (
            <Button variant="outline" asChild>
              <a href={campaignExportUrl(campaign.id)} download>
                <Download aria-hidden />
                {t('export')}
              </a>
            </Button>
          )}
          {manage && campaign?.status === 'DRAFT' && (
            <Button variant="outline" onClick={() => setConfirm('activate')}>
              <Play aria-hidden />
              {t('activate')}
            </Button>
          )}
          {manage && campaign?.status === 'ACTIVE' && (
            <Button variant="outline" onClick={() => setConfirm('close')}>
              <Lock aria-hidden />
              {t('close')}
            </Button>
          )}
          {manage && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              {t('newCampaign')}
            </Button>
          )}
        </>
      }
    />
  );

  return (
    <RequireAccess allow={(a) => can(a, 'vacation.read')}>
      {header}
      {campaigns.isLoading ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Skeleton className="h-[92px] rounded-xl" />
            <Skeleton className="h-[92px] rounded-xl" />
            <Skeleton className="h-[92px] rounded-xl" />
          </div>
          <Skeleton className="h-[420px] rounded-xl" />
        </div>
      ) : campaigns.isError ? (
        <Card>
          <ErrorState error={campaigns.error} onRetry={() => campaigns.refetch()} />
        </Card>
      ) : !campaign ? (
        <Card>
          <EmptyState
            icon={<CalendarRange aria-hidden />}
            title={t('noCampaigns')}
            description={manage ? t('noCampaignsHr') : t('noCampaignsHint')}
            action={
              manage && (
                <Button onClick={() => setCreating(true)}>
                  <Plus aria-hidden />
                  {t('newCampaign')}
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <StatCard label={t('totals.employees')} value={campaign.totals.employees} icon={<Users aria-hidden />} />
            <StatCard
              label={t('totals.submitted')}
              value={campaign.totals.submitted}
              total={campaign.totals.employees}
              icon={<Send aria-hidden />}
              progress={campaign.totals.employees ? campaign.totals.submitted / campaign.totals.employees : 0}
            />
            <StatCard
              label={t('totals.approved')}
              value={campaign.totals.approved}
              total={campaign.totals.employees}
              icon={<CalendarCheck2 aria-hidden />}
              progress={campaign.totals.employees ? campaign.totals.approved / campaign.totals.employees : 0}
            />
          </div>
          {me.employee && campaign.status !== 'DRAFT' && <MyPlanCard key={`plan-${campaign.id}`} campaign={campaign} />}
          {campaign.status === 'DRAFT' && !manage ? (
            <Card>
              <EmptyState icon={<CalendarRange aria-hidden />} title={t('draftCampaign')} description={t('draftCampaignHint')} />
            </Card>
          ) : (
            <CampaignGrid key={`grid-${campaign.id}`} campaign={campaign} />
          )}
        </>
      )}

      {creating && (
        <CampaignDialog existingYears={list.map((c) => c.year)} onOpenChange={setCreating} onCreated={(c) => setCampaignId(c.id)} />
      )}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'activate' ? t('activateTitle') : t('closeTitle')}
        description={campaign ? (confirm === 'activate' ? t('activateText', { year: campaign.year }) : t('closeText', { year: campaign.year })) : undefined}
        confirmLabel={confirm === 'activate' ? t('activate') : t('close')}
        tone={confirm === 'activate' ? 'primary' : 'danger'}
        loading={save.isPending}
        onConfirm={() => changeStatus(confirm === 'activate' ? 'ACTIVE' : 'CLOSED')}
      />
    </RequireAccess>
  );
}
