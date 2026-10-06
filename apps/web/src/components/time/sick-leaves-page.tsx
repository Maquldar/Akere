'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { FileText, MoreHorizontal, Pencil, Plus, RefreshCw, Stethoscope, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { DataTable } from '@/components/ui/data-table';
import { DateRangeInput, type DateRange } from '@/components/ui/date-picker';
import { ConfirmDialog } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { PageHeader } from '@/components/ui/page-header';
import { Tooltip } from '@/components/ui/popover';
import { EmptyState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { RequireAccess } from '@/components/shell/require-access';
import { useCurrentUser } from '@/components/shell/me-context';
import { isApiError } from '@/lib/api/errors';
import { searchEmployeeOptions, useDeleteSickLeave, useSickLeaves, useSyncSickLeaves } from '@/lib/api/hooks/time';
import type { SickLeaveView } from '@/lib/api/types-time';
import { formatDate, formatDateTime } from '@/lib/format';
import { can, hasRole } from '@/lib/permissions';
import { SickLeaveDialog } from './sick-leave-dialog';
import { todayStr } from './time-utils';

function SickLeavesInner() {
  const t = useTranslations('absences.sick');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { can: canDo } = useCurrentUser();
  const manage = canDo('sickleave.manage');
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [editing, setEditing] = useState<SickLeaveView | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toDelete, setToDelete] = useState<SickLeaveView | null>(null);
  const list = useSickLeaves({ employeeId: employeeId ?? undefined, from: range.from, to: range.to, page, pageSize });
  const del = useDeleteSickLeave();
  const sync = useSyncSickLeaves();
  const today = todayStr();

  const onSync = () =>
    sync.mutate(undefined, {
      onSuccess: (r) => toast.success(r.imported ? t('synced', { count: r.imported }) : t('syncedNone')),
      onError: (e) => toast.error(isApiError(e) ? e.message : tc('error')),
    });

  const columns = useMemo<ColumnDef<SickLeaveView, unknown>[]>(
    () => [
      {
        id: 'employee',
        header: t('colEmployee'),
        meta: { label: t('colEmployee'), hideable: false },
        cell: ({ row }) => (
          <div className="flex min-w-[200px] items-center gap-2.5">
            <Avatar name={row.original.employee.fullName} />
            <div className="min-w-0">
              <div className="truncate font-medium text-fg">{row.original.employee.fullName}</div>
              <div className="truncate text-xs text-fg-subtle">{[row.original.employee.position, row.original.employee.department].filter(Boolean).join(' · ')}</div>
            </div>
          </div>
        ),
      },
      { id: 'number', header: t('colNumber'), meta: { label: t('colNumber'), className: 'whitespace-nowrap tabular font-medium' }, cell: ({ row }) => row.original.number },
      {
        id: 'period',
        header: t('colPeriod'),
        meta: { label: t('colPeriod'), className: 'whitespace-nowrap tabular' },
        cell: ({ row }) => {
          const r = row.original;
          const active = r.startDate <= today && r.endDate >= today;
          return (
            <span className="flex items-center gap-2">
              {formatDate(r.startDate, locale)} — {formatDate(r.endDate, locale)}
              {active && <Badge tone="red">{t('active')}</Badge>}
            </span>
          );
        },
      },
      { id: 'days', header: t('colDays'), meta: { label: t('colDays'), className: 'tabular' }, cell: ({ row }) => t('daysCount', { count: row.original.days }) },
      {
        id: 'source',
        header: t('colSource'),
        meta: { label: t('colSource') },
        cell: ({ row }) =>
          row.original.source === 'ELECTRONIC' ? <Badge tone="blue">{t('sourceElectronic')}</Badge> : <Badge tone="gray">{t('sourceManual')}</Badge>,
      },
      {
        id: 'file',
        header: t('colFile'),
        meta: { label: t('colFile') },
        cell: ({ row }) =>
          row.original.file ? (
            <a
              href={row.original.file.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="focus-ring inline-flex max-w-[180px] items-center gap-1 rounded text-[13px] font-medium text-primary hover:underline"
            >
              <FileText className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{row.original.file.filename}</span>
            </a>
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
      {
        id: 'note',
        header: t('colNote'),
        meta: { label: t('colNote') },
        cell: ({ row }) => <span className="line-clamp-2 min-w-[160px] text-fg-muted">{row.original.note ?? '—'}</span>,
      },
      {
        id: 'created',
        header: t('colCreated'),
        meta: { label: t('colCreated'), className: 'whitespace-nowrap tabular text-fg-muted' },
        cell: ({ row }) => formatDateTime(row.original.createdAt, locale),
      },
      ...(manage
        ? [
            {
              id: 'actions',
              header: () => <span className="sr-only">{tc('actions')}</span>,
              meta: { hideable: false, className: 'w-12 text-right' },
              cell: ({ row }) => (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={tc('actionsFor', { name: row.original.number })} onClick={(e) => e.stopPropagation()}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => {
                        setEditing(row.original);
                        setDialogOpen(true);
                      }}
                    >
                      <Pencil />
                      {tc('edit')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-red-fg" onSelect={() => setToDelete(row.original)}>
                      <Trash2 />
                      {tc('delete')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ),
            } satisfies ColumnDef<SickLeaveView, unknown>,
          ]
        : []),
    ],
    [t, tc, locale, manage, today],
  );

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          manage ? (
            <>
              <Tooltip content={t('syncHint')}>
                <Button variant="outline" onClick={onSync} loading={sync.isPending}>
                  {!sync.isPending && <RefreshCw />}
                  {t('sync')}
                  <Badge tone="orange" className="ml-0.5">
                    {t('sandbox')}
                  </Badge>
                </Button>
              </Tooltip>
              <Button
                onClick={() => {
                  setEditing(null);
                  setDialogOpen(true);
                }}
              >
                <Plus />
                {t('new')}
              </Button>
            </>
          ) : undefined
        }
      />
      <DataTable
        label={t('tableLabel')}
        columns={columns}
        data={list.data?.items}
        getRowId={(r) => r.id}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.error}
        onRetry={() => list.refetch()}
        onRowClick={
          manage
            ? (r) => {
                setEditing(r);
                setDialogOpen(true);
              }
            : undefined
        }
        columnVisibilityKey="sick-leaves"
        initialHidden={['created']}
        pagination={list.data ? { page, pageSize, total: list.data.total, onPageChange: setPage, onPageSizeChange: (s) => { setPageSize(s); setPage(1); } } : undefined}
        toolbar={
          <>
            <Combobox
              size="sm"
              className="w-64"
              aria-label={t('employee')}
              placeholder={t('allEmployees')}
              value={employeeId}
              clearable
              loadOptions={searchEmployeeOptions}
              onChange={(v) => {
                setEmployeeId(v);
                setPage(1);
              }}
            />
            <DateRangeInput
              inputSize="sm"
              className="w-full sm:w-72"
              value={range}
              onChange={(r) => {
                setRange(r);
                setPage(1);
              }}
            />
          </>
        }
        empty={
          <EmptyState
            compact
            icon={<Stethoscope aria-hidden />}
            title={t('empty')}
            description={t('emptyHint')}
            action={
              manage ? (
                <Button variant="outline" size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>
                  <Plus />
                  {t('new')}
                </Button>
              ) : undefined
            }
          />
        }
      />
      <SickLeaveDialog open={dialogOpen} onOpenChange={setDialogOpen} item={editing} />
      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t('deleteTitle')}
        description={t('deleteText', { number: toDelete?.number ?? '', name: toDelete?.employee.fullName ?? '' })}
        confirmLabel={tc('delete')}
        loading={del.isPending}
        onConfirm={() =>
          toDelete &&
          del.mutate(toDelete.id, {
            onSuccess: () => {
              toast.success(t('deleted'));
              setToDelete(null);
            },
            onError: (e) => toast.error(isApiError(e) ? e.message : tc('error')),
          })
        }
      />
    </div>
  );
}

export function SickLeavesPage() {
  return (
    <RequireAccess allow={(a) => can(a, 'sickleave.read') && (hasRole(a, 'ADMIN', 'HR') || a.isManager)}>
      <SickLeavesInner />
    </RequireAccess>
  );
}
