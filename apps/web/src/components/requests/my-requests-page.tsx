'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { ChevronRight, ClipboardList, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Skeleton, SkeletonList } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { RequireAccess } from '@/components/shell/require-access';
import { useCurrentUser } from '@/components/shell/me-context';
import { Link, useRouter } from '@/i18n/navigation';
import { useRequests, useRequestTypes, useVacationBalance } from '@/lib/api/hooks/requests';
import { REQUEST_STATUSES, type RequestListItem, type RequestStatus } from '@/lib/api/types-requests';
import { formatDate } from '@/lib/format';
import { can } from '@/lib/permissions';
import { formatDays, RequestStatusPill, typeIcon, usePeriodText } from './shared';

const ANY = 'any';

function NewRequestTiles() {
  const t = useTranslations('requests.my');
  const locale = useLocale();
  const { me } = useCurrentUser();
  const types = useRequestTypes();
  const balance = useVacationBalance(me.employee?.id);
  const typeName = (ty: { name: string; nameKk: string | null }) => (locale === 'kk' && ty.nameKk ? ty.nameKk : ty.name);

  return (
    <Card className="mb-5">
      <CardHeader title={t('newRequest')} />
      {types.isError ? (
        <ErrorState error={types.error} onRetry={() => types.refetch()} compact />
      ) : (
        <ul className="grid gap-2 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-3 xl:grid-cols-5">
          {types.isLoading &&
            Array.from({ length: 5 }, (_, i) => (
              <li key={i}>
                <Skeleton className="h-[76px] rounded-xl" />
              </li>
            ))}
          {types.data?.map((ty) => {
            const Icon = typeIcon(ty.code);
            return (
              <li key={ty.id}>
                <Link
                  href={`/requests/new?type=${encodeURIComponent(ty.code)}`}
                  className="focus-ring group flex h-full items-start gap-3 rounded-xl border border-border bg-surface-muted p-3 transition-colors hover:border-primary/30 hover:bg-primary-soft"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface text-primary shadow-card">
                    <Icon className="size-[18px]" aria-hidden />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[13px] font-semibold leading-snug text-fg">{typeName(ty)}</span>
                    {ty.usesVacationBalance && balance.data && (
                      <span className="mt-0.5 text-xs text-fg-muted tabular">
                        {t('balance', { days: formatDays(balance.data.available, locale) })}
                      </span>
                    )}
                    {ty.requiresAttachment && <span className="mt-0.5 text-xs text-fg-subtle">{t('needsAttachment')}</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Mobile list (cards) for requests; the desktop uses the DataTable. */
export function RequestCards({ items, showEmployee }: { items: RequestListItem[]; showEmployee?: boolean }) {
  const t = useTranslations('requests.list');
  const locale = useLocale();
  const period = usePeriodText();
  return (
    <ul className="flex flex-col gap-2">
      {items.map((r) => {
        const Icon = typeIcon(r.type.code);
        return (
          <li key={r.id}>
            <Link
              href={`/requests/${r.id}`}
              className="focus-ring flex items-start gap-3 rounded-xl border border-border bg-surface p-3 shadow-card hover:bg-surface-muted"
            >
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-fg-muted">
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-sm font-semibold text-fg">{r.type.name}</span>
                {showEmployee && <span className="truncate text-[13px] text-fg-muted">{r.employee.fullName}</span>}
                <span className="text-[13px] text-fg-muted tabular">
                  {period(r.startDate, r.endDate)}
                  {r.days !== null && ` · ${t('daysShort', { days: r.days })}`}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <RequestStatusPill status={r.status} />
                  <span className="text-xs text-fg-subtle tabular">{formatDate(r.createdAt, locale)}</span>
                </span>
              </span>
              <ChevronRight className="mt-2 size-4 shrink-0 text-fg-subtle" aria-hidden />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function useRequestColumns(showEmployee: boolean) {
  const t = useTranslations('requests.list');
  const locale = useLocale();
  const period = usePeriodText();
  return useMemo<ColumnDef<RequestListItem, unknown>[]>(() => {
    const cols: ColumnDef<RequestListItem, unknown>[] = [];
    if (showEmployee) {
      cols.push({
        id: 'employee',
        header: t('colEmployee'),
        meta: { label: t('colEmployee'), hideable: false },
        cell: ({ row }) => (
          <div className="min-w-[180px]">
            <div className="truncate font-medium text-fg">{row.original.employee.fullName}</div>
            {row.original.employee.position && (
              <div className="truncate text-xs text-fg-subtle">{row.original.employee.position}</div>
            )}
          </div>
        ),
      });
    }
    cols.push(
      {
        id: 'type',
        header: t('colType'),
        meta: { label: t('colType'), hideable: false },
        cell: ({ row }) => {
          const Icon = typeIcon(row.original.type.code);
          return (
            <Link href={`/requests/${row.original.id}`} className="focus-ring flex min-w-[200px] items-center gap-2 rounded font-medium text-fg hover:underline" onClick={(e) => e.stopPropagation()}>
              <Icon className="size-4 shrink-0 text-fg-subtle" aria-hidden />
              <span className="truncate">{row.original.type.name}</span>
            </Link>
          );
        },
      },
      {
        id: 'period',
        header: t('colPeriod'),
        meta: { label: t('colPeriod'), className: 'whitespace-nowrap tabular' },
        cell: ({ row }) => period(row.original.startDate, row.original.endDate),
      },
      {
        id: 'days',
        header: t('colDays'),
        meta: { label: t('colDays'), className: 'tabular text-right', headerClassName: 'text-right' },
        cell: ({ row }) => (row.original.days ?? '—'),
      },
      {
        id: 'status',
        header: t('colStatus'),
        meta: { label: t('colStatus') },
        cell: ({ row }) => <RequestStatusPill status={row.original.status} />,
      },
      {
        id: 'created',
        header: showEmployee ? t('colSubmitted') : t('colCreated'),
        meta: { label: showEmployee ? t('colSubmitted') : t('colCreated'), className: 'whitespace-nowrap tabular text-fg-muted' },
        cell: ({ row }) => formatDate(showEmployee ? (row.original.submittedAt ?? row.original.createdAt) : row.original.createdAt, locale),
      },
    );
    return cols;
  }, [t, locale, period, showEmployee]);
}

export function MyRequestsPage() {
  const t = useTranslations('requests.my');
  const ts = useTranslations('requests.status');
  const tc = useTranslations('common');
  const router = useRouter();
  const [status, setStatus] = useState<string>(ANY);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const filter = {
    scope: 'mine' as const,
    status: status === ANY ? undefined : (status as RequestStatus),
    page,
    pageSize,
  };
  const list = useRequests(filter);
  const columns = useRequestColumns(false);
  const items = list.data?.items;

  const statusSelect = (
    <Select
      aria-label={t('filterStatus')}
      className="w-full sm:w-56"
      value={status}
      onValueChange={(v) => {
        setStatus(v);
        setPage(1);
      }}
      options={[{ value: ANY, label: t('allStatuses') }, ...REQUEST_STATUSES.map((s) => ({ value: s, label: ts(s) }))]}
    />
  );
  const empty = (
    <EmptyState
      compact
      icon={<ClipboardList aria-hidden />}
      title={status !== ANY ? tc('nothingFound') : t('empty')}
      description={status !== ANY ? tc('tryOtherFilters') : t('emptyHint')}
    />
  );

  return (
    <RequireAccess allow={(a) => can(a, 'request.create', 'request.read')}>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Button asChild>
            <Link href="/requests/new">
              <Plus aria-hidden />
              {t('create')}
            </Link>
          </Button>
        }
      />
      <NewRequestTiles />

      <h2 className="mb-3 text-[15px] font-semibold text-fg">{t('listTitle')}</h2>
      {/* Desktop */}
      <div className="hidden md:block">
        <DataTable
          label={t('listTitle')}
          columns={columns}
          data={items}
          getRowId={(r) => r.id}
          isLoading={list.isLoading}
          isFetching={list.isFetching}
          error={list.error}
          onRetry={() => list.refetch()}
          onRowClick={(r) => router.push(`/requests/${r.id}`)}
          columnVisibilityKey="requests-mine"
          toolbar={statusSelect}
          pagination={
            list.data && { page, pageSize, total: list.data.total, onPageChange: setPage, onPageSizeChange: (s) => { setPageSize(s); setPage(1); } }
          }
          empty={empty}
        />
      </div>
      {/* Mobile */}
      <div className="flex flex-col gap-3 md:hidden">
        {statusSelect}
        {list.isLoading && <SkeletonList rows={4} className="rounded-xl border border-border bg-surface p-4" />}
        {list.isError && !items && <ErrorState error={list.error} onRetry={() => list.refetch()} compact />}
        {items && items.length === 0 && <div className="rounded-xl border border-border bg-surface">{empty}</div>}
        {items && items.length > 0 && <RequestCards items={items} />}
        {list.data && list.data.total > pageSize && (
          <Pagination page={page} pageSize={pageSize} total={list.data.total} onPageChange={setPage} />
        )}
      </div>
    </RequireAccess>
  );
}
