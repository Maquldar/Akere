'use client';

import { CalendarRange, Copy, Filter, Inbox, Plus, Send, Settings2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { CountBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger, Tooltip } from '@/components/ui/popover';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { RequireAccess } from '@/components/shell/require-access';
import { Link } from '@/i18n/navigation';
import { isApiError } from '@/lib/api/errors';
import { useAllDepartments, useCopyWeek, usePublishShifts, useSaveShift, useSchedule, useShiftTemplates, useTimeRequests } from '@/lib/api/hooks/time';
import type { ScheduleRow } from '@/lib/api/types-time';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { can } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { PatternDialog } from './pattern-dialog';
import { PeriodNav, SectionLabel, ShiftChip } from './shared';
import { ShiftDialog, type ShiftDialogTarget } from './shift-dialog';
import { TemplatesDialog } from './templates-dialog';
import { addDays, monthEnd, shiftChipClass, todayStr, weekDays, weekStart, weekTitle } from './time-utils';
import { WeekGrid } from './week-grid';

const ALL = 'all';

/** "+" in an empty cell → "НАЗНАЧИТЬ СМЕНУ" popover with templates + "Создать смену". */
function AssignCell({ row, date, onCustom }: { row: ScheduleRow | null; date: string; onCustom: () => void }) {
  const t = useTranslations('time.planning');
  const templates = useShiftTemplates();
  const save = useSaveShift();
  const [open, setOpen] = useState(false);
  const who = row?.employee.shortName ?? t('openShift');
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('assignAria', { name: who, date })}
          className={cn(
            'focus-ring group/add flex h-11 w-full items-center justify-center rounded-md border border-dashed border-transparent text-fg-subtle transition-colors hover:border-border-strong hover:bg-surface-hover data-[state=open]:border-primary data-[state=open]:bg-primary-soft',
          )}
        >
          <span className="flex size-5 items-center justify-center rounded-full border border-border bg-surface opacity-60 transition-opacity group-hover/add:opacity-100 group-data-[state=open]/add:opacity-100">
            <Plus className="size-3" aria-hidden />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[290px] p-1.5" align="start">
        <SectionLabel className="px-2 pb-1 pt-1.5">{t('assignShift')}</SectionLabel>
        {templates.isLoading && <Skeleton className="mx-2 my-2 h-24" />}
        <ul role="menu" aria-label={t('assignShift')}>
          {templates.data?.map((tpl) => (
            <li key={tpl.id} role="none">
              <button
                type="button"
                role="menuitem"
                disabled={save.isPending}
                className="focus-ring flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm hover:bg-surface-hover disabled:opacity-50"
                onClick={() =>
                  save.mutate(
                    { input: { employeeId: row?.employee.employeeId ?? null, date, templateId: tpl.id } },
                    {
                      onSuccess: () => {
                        setOpen(false);
                        toast.success(t('assigned', { name: tpl.name }));
                      },
                      onError: (e) => toast.error(isApiError(e) && e.code === 'CONFLICT' ? t('alreadyHasShift') : isApiError(e) ? e.message : t('saveFailed')),
                    },
                  )
                }
              >
                <span className={cn('size-2 shrink-0 rounded-full', shiftChipClass[tpl.color].dot)} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-fg">{tpl.name}</span>
                <span className="shrink-0 text-xs text-fg-muted tabular">
                  {tpl.startTime}–{tpl.endTime}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="my-1 h-px bg-border" />
        <PopoverClose asChild>
          <button type="button" onClick={onCustom} className="focus-ring flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-fg-muted hover:bg-surface-hover hover:text-fg">
            <Plus className="size-4" aria-hidden />
            {t('createShift')}
          </button>
        </PopoverClose>
      </PopoverContent>
    </Popover>
  );
}

function PlanningInner() {
  const t = useTranslations('time.planning');
  const locale = useLocale();
  const [anchor, setAnchor] = useState(() => weekStart(todayStr()));
  const [q, setQ] = useState('');
  const [dept, setDept] = useState<string>(ALL);
  const dq = useDebounced(q.trim(), 300);
  const days = weekDays(anchor);
  const from = days[0]!;
  const to = days[6]!;
  const schedule = useSchedule({ from, to, scope: 'managed', q: dq || undefined, departmentId: dept === ALL ? undefined : dept });
  const departments = useAllDepartments();
  const pending = useTimeRequests({ scope: 'managed', status: 'PENDING', page: 1, pageSize: 1 });
  const publish = usePublishShifts();
  const copy = useCopyWeek();
  const [target, setTarget] = useState<ShiftDialogTarget | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [patternOpen, setPatternOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const data = schedule.data;
  const [y, m] = anchor.split('-').map(Number) as [number, number];

  const onPublish = () =>
    publish.mutate(
      { from, to },
      {
        onSuccess: (r) => toast.success(r.published ? t('published', { count: r.published }) : t('nothingToPublish')),
        onError: (e) => toast.error(isApiError(e) ? e.message : t('saveFailed')),
      },
    );

  const onCopy = () =>
    copy.mutate(
      { fromWeekStart: addDays(anchor, -7), toWeekStart: anchor },
      {
        onSuccess: (r) => {
          setCopyOpen(false);
          toast.success(t('copied', { count: r.created }));
        },
        onError: (e) => toast.error(isApiError(e) ? e.message : t('saveFailed')),
      },
    );

  const filterActive = dept !== ALL;

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.01em] text-fg sm:text-2xl">{weekTitle(anchor, locale)}</h1>
          <p className="mt-1 truncate text-sm text-fg-muted">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 xl:shrink-0 xl:flex-nowrap">
          {(pending.data?.total ?? 0) > 0 && (
            <Button variant="outline" asChild>
              <Link href="/time/timesheet?tab=requests">
                <Inbox />
                {t('requestsToDecide')}
                <CountBadge value={pending.data?.total ?? 0} tone="red" />
              </Link>
            </Button>
          )}
          <Popover>
            <Tooltip content={t('filter')}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon" aria-label={t('filter')} className={cn(filterActive && 'border-primary text-primary')}>
                  <Filter />
                </Button>
              </PopoverTrigger>
            </Tooltip>
            <PopoverContent className="w-72 p-3" align="end">
              <Label htmlFor="planning-dept">{t('department')}</Label>
              <Select
                id="planning-dept"
                className="mt-1.5"
                value={dept}
                onValueChange={setDept}
                options={[{ value: ALL, label: t('allDepartments') }, ...(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))]}
              />
            </PopoverContent>
          </Popover>
          <Tooltip content={t('templates')}>
            <Button variant="outline" size="icon" onClick={() => setTemplatesOpen(true)} aria-label={t('templates')}>
              <Settings2 />
            </Button>
          </Tooltip>
          <Tooltip content={t('copyWeek')}>
            <Button variant="outline" size="icon" onClick={() => setCopyOpen(true)} aria-label={t('copyWeek')}>
              <Copy />
            </Button>
          </Tooltip>
          <Tooltip content={t('addOpenShift')}>
            <Button
              variant="outline"
              size="icon"
              aria-label={t('addOpenShift')}
              onClick={() => setTarget({ kind: 'create', employeeId: null, employeeName: null, date: todayStr() > from && todayStr() <= to ? todayStr() : from })}
            >
              <Plus />
            </Button>
          </Tooltip>
          <Button variant="outline" onClick={() => setPatternOpen(true)} disabled={!data?.rows.length}>
            <CalendarRange />
            {t('applyPattern')}
          </Button>
          <Button onClick={onPublish} loading={publish.isPending} disabled={!data?.hasDrafts}>
            <Send />
            {t('publish')}
          </Button>
        </div>
      </div>

      {data?.hasDrafts && (
        <p className="mb-3 flex items-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary-soft px-3 py-2 text-[13px] text-primary">
          {t('draftsHint')}
        </p>
      )}

      {schedule.isError && !data ? (
        <Card>
          <ErrorState error={schedule.error} onRetry={() => schedule.refetch()} />
        </Card>
      ) : (
        <WeekGrid
          label={t('gridLabel')}
          data={data}
          loading={schedule.isLoading}
          days={days}
          search={q}
          onSearch={setQ}
          renderShift={(s, row) => <ShiftChip shift={s} onClick={() => setTarget({ kind: 'edit', shift: s, employeeName: row.employee.fullName })} />}
          renderEmpty={(row, d) => (
            <AssignCell row={row} date={d} onCustom={() => setTarget({ kind: 'create', employeeId: row.employee.employeeId, employeeName: row.employee.fullName, date: d })} />
          )}
          openShifts={{
            render: (d, shifts) => (
              <>
                {shifts.map((s) => {
                  const pendingClaims = s.claims.filter((c) => c.status === 'PENDING').length;
                  return (
                    <ShiftChip
                      key={s.id}
                      shift={s}
                      onClick={() => setTarget({ kind: 'edit', shift: s, employeeName: null })}
                      extra={pendingClaims ? <span className="mt-0.5 text-[11px] font-semibold text-primary">{t('claimsCount', { count: pendingClaims })}</span> : null}
                    />
                  );
                })}
                <AssignCell row={null} date={d} onCustom={() => setTarget({ kind: 'create', employeeId: null, employeeName: null, date: d })} />
              </>
            ),
          }}
        />
      )}

      <div className="pointer-events-none sticky bottom-4 z-30 mt-4 flex justify-center">
        <PeriodNav
          floating
          className="pointer-events-auto"
          onPrev={() => setAnchor(addDays(anchor, -7))}
          onNext={() => setAnchor(addDays(anchor, 7))}
          onToday={() => setAnchor(weekStart(todayStr()))}
        />
      </div>

      <ShiftDialog target={target} onOpenChange={(o) => !o && setTarget(null)} />
      <TemplatesDialog open={templatesOpen} onOpenChange={setTemplatesOpen} />
      <PatternDialog
        open={patternOpen}
        onOpenChange={setPatternOpen}
        rows={data?.rows ?? []}
        defaultFrom={from}
        defaultTo={monthEnd(y, m) > to ? monthEnd(y, m) : to}
      />
      <ConfirmDialog
        open={copyOpen}
        onOpenChange={setCopyOpen}
        tone="primary"
        title={t('copyTitle')}
        description={t('copyText', { from: weekTitle(addDays(anchor, -7), locale), to: weekTitle(anchor, locale) })}
        confirmLabel={t('copyConfirm')}
        loading={copy.isPending}
        onConfirm={onCopy}
      />
    </div>
  );
}

export function PlanningPage() {
  return (
    <RequireAccess allow={(a) => can(a, 'time.manage')}>
      <PlanningInner />
    </RequireAccess>
  );
}
