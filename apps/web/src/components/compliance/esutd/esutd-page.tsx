'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, Landmark, Search, Send, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { useCurrentUser } from '@/components/shell/me-context';
import { RequireAccess } from '@/components/shell/require-access';
import { Link } from '@/i18n/navigation';
import { isApiError } from '@/lib/api/errors';
import { useEsutd, useEsutdCount, useEsutdSubmit } from '@/lib/api/hooks/compliance';
import { useLegalEntities } from '@/lib/api/hooks/org';
import type { BulkResult, EsutdItem, EsutdStatus } from '@/lib/api/types-compliance';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { can } from '@/lib/permissions';
import { EsutdStatusCell } from '../status';

const ANY = 'any';
const STATUSES: EsutdStatus[] = ['NOT_SENT', 'QUEUED', 'SENT', 'ERROR'];

/** ЕСУТД registry (deck p23): contracts / supplementary agreements with status and bulk "Отправить в ЕСУТД". */
export function EsutdPage() {
  const t = useTranslations('esutd');
  const ts = useTranslations('esutd.status');
  const tc = useTranslations('common');
  const { access } = useCurrentUser();
  const canSubmit = can(access, 'esutd.submit');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string>(ANY);
  const [entity, setEntity] = useState(ANY);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const debouncedQ = useDebounced(q.trim(), 300);
  const entities = useLegalEntities();
  const counts = useEsutdCount();
  const submit = useEsutdSubmit();
  const list = useEsutd({
    q: debouncedQ || undefined,
    status: status === ANY ? undefined : (status as EsutdStatus),
    legalEntityId: entity === ANY ? undefined : entity,
    page,
    pageSize,
  });
  const filtered = Boolean(debouncedQ || status !== ANY || entity !== ANY);

  const send = (ids: string[], done?: () => void) =>
    submit.mutate(ids, {
      onSuccess: (r: BulkResult) => {
        done?.();
        if (r.succeeded.length) toast.success(t('queued', { count: r.succeeded.length }));
        if (r.failed.length) {
          toast.warning(t('failed', { count: r.failed.length }), {
            description: r.failed
              .slice(0, 3)
              .map((f) => {
                const item = list.data?.items.find((i) => i.documentId === f.id);
                return `${item?.number ?? item?.title ?? f.id}: ${f.reason}`;
              })
              .join('\n'),
          });
        }
      },
      onError: (e) => toast.error(isApiError(e) ? e.message : tc('error')),
    });

  const columns = useMemo<ColumnDef<EsutdItem, unknown>[]>(
    () => [
      {
        id: 'status',
        header: t('colStatus'),
        meta: { label: t('colStatus'), hideable: false },
        cell: ({ row }) => <EsutdStatusCell status={row.original.status} sentAt={row.original.sentAt} error={row.original.error} />,
      },
      {
        id: 'number',
        header: t('colNumber'),
        meta: { label: t('colNumber'), className: 'whitespace-nowrap tabular' },
        cell: ({ row }) => (
          <Link href={`/documents/${row.original.documentId}`} className="focus-ring rounded font-medium text-primary hover:underline">
            {row.original.number ?? t('noNumber')}
          </Link>
        ),
      },
      {
        id: 'type',
        header: t('colType'),
        meta: { label: t('colType') },
        cell: ({ row }) => (
          <div className="min-w-[200px] max-w-[360px]">
            <div className="truncate font-medium text-fg">{row.original.type.name}</div>
            <div className="truncate text-xs text-fg-subtle">{row.original.title}</div>
          </div>
        ),
      },
      {
        id: 'employee',
        header: t('colEmployee'),
        meta: { label: t('colEmployee') },
        cell: ({ row }) =>
          row.original.employee ? (
            <div className="min-w-[180px]">
              <div className="truncate font-medium text-fg">{row.original.employee.fullName}</div>
              {row.original.employee.position && <div className="truncate text-xs text-fg-subtle">{row.original.employee.position}</div>}
            </div>
          ) : (
            '—'
          ),
      },
      {
        id: 'signer',
        header: t('colSigner'),
        meta: { label: t('colSigner'), className: 'whitespace-nowrap text-fg-muted' },
        cell: ({ row }) => row.original.signer?.shortName ?? row.original.signer?.fullName ?? '—',
      },
      {
        id: 'externalId',
        header: t('colExternalId'),
        meta: { label: t('colExternalId'), className: 'whitespace-nowrap tabular text-fg-muted' },
        cell: ({ row }) => row.original.externalId ?? '—',
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{tc('actions')}</span>,
        meta: { hideable: false, className: 'w-px whitespace-nowrap text-right' },
        cell: ({ row }) =>
          canSubmit && (row.original.status === 'NOT_SENT' || row.original.status === 'ERROR') ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                send([row.original.documentId]);
              }}
              disabled={submit.isPending}
            >
              <Send aria-hidden />
              {row.original.status === 'ERROR' ? t('retry') : t('sendOne')}
            </Button>
          ) : null,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, tc, canSubmit, submit.isPending, list.data],
  );

  return (
    <RequireAccess allow={(a) => can(a, 'esutd.read')}>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            {t('title')}
            <Badge tone="purple">{t('sandbox')}</Badge>
          </span>
        }
        subtitle={t('subtitle')}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:max-w-xl">
        <StatCard
          label={t('notSent')}
          value={counts.data?.notSent ?? '—'}
          icon={<XCircle aria-hidden />}
          tone={counts.data?.notSent ? 'danger' : 'default'}
        />
        <StatCard label={t('errors')} value={counts.data?.errors ?? '—'} icon={<AlertTriangle aria-hidden />} tone={counts.data?.errors ? 'danger' : 'default'} />
      </div>
      <DataTable
        label={t('title')}
        columns={columns}
        data={list.data?.items}
        getRowId={(r) => r.documentId}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.error}
        onRetry={() => list.refetch()}
        columnVisibilityKey="esutd"
        allowSelectAllMatching={false}
        bulkActions={
          canSubmit
            ? (sel, clear) => {
                const ids = sel.ids.filter((id) => {
                  const s = list.data?.items.find((i) => i.documentId === id)?.status;
                  return s === 'NOT_SENT' || s === 'ERROR';
                });
                return (
                  <Button size="sm" onClick={() => send(ids, clear)} loading={submit.isPending} disabled={!ids.length}>
                    <Send />
                    {t('submit', { count: ids.length })}
                  </Button>
                );
              }
            : undefined
        }
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
            <Input
              type="search"
              aria-label={t('searchLabel')}
              placeholder={t('searchPlaceholder')}
              leftIcon={<Search />}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              className="w-full sm:w-64"
            />
            <Select
              aria-label={t('filterStatus')}
              className="w-full sm:w-48"
              value={status}
              onValueChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
              options={[{ value: ANY, label: t('allStatuses') }, ...STATUSES.map((s) => ({ value: s, label: ts(s) }))]}
            />
            <Select
              aria-label={t('filterEntity')}
              className="w-full sm:w-52"
              value={entity}
              onValueChange={(v) => {
                setEntity(v);
                setPage(1);
              }}
              options={[{ value: ANY, label: t('allEntities') }, ...(entities.data ?? []).map((e) => ({ value: e.id, label: e.name }))]}
            />
          </>
        }
        empty={
          <EmptyState
            compact
            icon={<Landmark aria-hidden />}
            title={filtered ? tc('nothingFound') : t('empty')}
            description={filtered ? tc('tryOtherFilters') : t('emptyHint')}
          />
        }
      />
    </RequireAccess>
  );
}
