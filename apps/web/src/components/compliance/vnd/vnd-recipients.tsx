'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Download, Plus, Search, Trash2, UsersRound } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { isApiError } from '@/lib/api/errors';
import { useRemoveVndRecipient, useVndRecipients } from '@/lib/api/hooks/compliance';
import { useDepartments } from '@/lib/api/hooks/org';
import type { VndDetail, VndRecipientStatus, VndRecipientView } from '@/lib/api/types-compliance';
import { formatDateTime } from '@/lib/format';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { DownloadButton, RecipientStatusPill } from '../status';
import { VndAddRecipientsDialog } from './vnd-add-recipients-dialog';

const ANY = 'any';

/** "Ознакомление N" tab: acknowledgment sheet with filters, add/remove recipients and xlsx export. */
export function VndRecipients({ vnd }: { vnd: VndDetail }) {
  const t = useTranslations('vnd.recipients');
  const td = useTranslations('vnd.detail');
  const tc = useTranslations('common');
  const tr = useTranslations('vnd.recipientStatus');
  const locale = useLocale();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(ANY);
  const [dept, setDept] = useState(ANY);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [addOpen, setAddOpen] = useState(false);
  const [toRemove, setToRemove] = useState<VndRecipientView | null>(null);
  const debouncedQ = useDebounced(q.trim(), 300);
  const departments = useDepartments(vnd.legalEntity.id);
  const remove = useRemoveVndRecipient(vnd.id);
  const list = useVndRecipients(vnd.id, {
    q: debouncedQ || undefined,
    status: status === ANY ? undefined : (status as VndRecipientStatus),
    departmentId: dept === ANY ? undefined : dept,
    page,
    pageSize,
  });
  const filtered = Boolean(debouncedQ || status !== ANY || dept !== ANY);
  const canManage = Boolean(vnd.canManage);

  const columns = useMemo<ColumnDef<VndRecipientView, unknown>[]>(
    () => [
      {
        id: 'employee',
        header: t('colRecipient'),
        meta: { label: t('colRecipient'), hideable: false },
        cell: ({ row }) => (
          <div className="flex min-w-[200px] items-center gap-2.5">
            <Avatar name={row.original.employee.fullName} />
            <span className="truncate font-medium text-fg">{row.original.employee.fullName}</span>
          </div>
        ),
      },
      {
        id: 'department',
        header: t('colDepartment'),
        meta: { label: t('colDepartment'), className: 'text-fg-muted' },
        cell: ({ row }) => row.original.employee.department ?? '—',
      },
      {
        id: 'position',
        header: t('colPosition'),
        meta: { label: t('colPosition'), className: 'text-fg-muted' },
        cell: ({ row }) => row.original.employee.position ?? '—',
      },
      {
        id: 'status',
        header: t('colStatus'),
        meta: { label: t('colStatus') },
        cell: ({ row }) => <RecipientStatusPill status={row.original.status} />,
      },
      {
        id: 'ackAt',
        header: t('colAckAt'),
        meta: { label: t('colAckAt'), className: 'whitespace-nowrap tabular text-fg-muted' },
        cell: ({ row }) => (row.original.acknowledgedAt ? formatDateTime(row.original.acknowledgedAt, locale) : '—'),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{tc('actions')}</span>,
        meta: { hideable: false, className: 'w-12 text-right' },
        cell: ({ row }) =>
          canManage && row.original.status === 'PENDING' ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('removeNamed', { name: row.original.employee.fullName })}
              onClick={() => setToRemove(row.original)}
            >
              <Trash2 />
            </Button>
          ) : null,
      },
    ],
    [t, tc, locale, canManage],
  );

  const doRemove = () =>
    toRemove &&
    remove.mutate(toRemove.id, {
      onSuccess: () => {
        toast.success(t('removed'));
        setToRemove(null);
      },
      onError: (e) => {
        setToRemove(null);
        toast.error(isApiError(e) && e.rule === 'LAST_RECIPIENT' ? t('lastRecipient') : isApiError(e) ? e.message : tc('error'));
      },
    });

  return (
    <>
      <DataTable
        label={t('label')}
        columns={columns}
        data={list.data?.items}
        getRowId={(r) => r.id}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.error}
        onRetry={() => list.refetch()}
        columnVisibilityKey="vnd-recipients"
        pagination={
          list.data && {
            page,
            pageSize,
            total: list.data.total,
            onPageChange: setPage,
            onPageSizeChange: (s) => {
              setPageSize(s);
              setPage(1);
            },
          }
        }
        toolbar={
          <>
            {canManage && (
              <Button variant="outline" onClick={() => setAddOpen(true)}>
                <Plus />
                {t('add')}
              </Button>
            )}
            <DownloadButton path={`/vnd/${vnd.id}/sheet`} filename={`${td('sheetFile')}_${vnd.number ?? vnd.title}.xlsx`} disabled={!vnd.total}>
              <Download aria-hidden />
              {td('sheet')}
            </DownloadButton>
          </>
        }
        toolbarRight={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="search"
              aria-label={t('search')}
              placeholder={t('search')}
              leftIcon={<Search />}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              className="w-full sm:w-56"
            />
            <Select
              aria-label={t('filterDepartment')}
              className="w-full sm:w-48"
              value={dept}
              onValueChange={(v) => {
                setDept(v);
                setPage(1);
              }}
              options={[{ value: ANY, label: t('allDepartments') }, ...(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))]}
            />
            <Select
              aria-label={t('filterStatus')}
              className="w-full sm:w-44"
              value={status}
              onValueChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
              options={[
                { value: ANY, label: t('allStatuses') },
                { value: 'PENDING', label: tr('PENDING') },
                { value: 'ACKNOWLEDGED', label: tr('ACKNOWLEDGED') },
              ]}
            />
          </div>
        }
        empty={
          <EmptyState
            compact
            icon={<UsersRound aria-hidden />}
            title={filtered ? tc('nothingFound') : t('empty')}
            description={filtered ? tc('tryOtherFilters') : t('emptyHint')}
            action={
              !filtered && canManage ? (
                <Button size="sm" onClick={() => setAddOpen(true)}>
                  <Plus />
                  {t('add')}
                </Button>
              ) : undefined
            }
          />
        }
      />
      {canManage && <VndAddRecipientsDialog open={addOpen} onOpenChange={setAddOpen} vnd={vnd} />}
      <ConfirmDialog
        open={toRemove !== null}
        onOpenChange={(o) => !o && setToRemove(null)}
        title={t('removeTitle')}
        description={toRemove ? t('removeText', { name: toRemove.employee.fullName }) : undefined}
        confirmLabel={t('remove')}
        onConfirm={doRemove}
        loading={remove.isPending}
      />
    </>
  );
}
