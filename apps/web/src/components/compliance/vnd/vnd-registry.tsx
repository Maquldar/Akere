'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { MessageSquare, Plus, ScrollText, Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { DateRangeInput } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/states';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCurrentUser } from '@/components/shell/me-context';
import { RequireAccess } from '@/components/shell/require-access';
import { useRouter } from '@/i18n/navigation';
import { useMyVnd, useVndList } from '@/lib/api/hooks/compliance';
import { useLegalEntities } from '@/lib/api/hooks/org';
import type { VndListItem, VndTab } from '@/lib/api/types-compliance';
import { formatDateTime } from '@/lib/format';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { can } from '@/lib/permissions';
import { AckProgress, VndStatusLabel } from '../status';
import { VndCreateDialog } from './vnd-create-dialog';
import { VndMyList } from './vnd-my-list';

const ANY = 'any';
type View = VndTab | 'my';

/** /vnd — registry for HR (tabs Все / В процессе / Завершенные + Мои ознакомления), "my acknowledgments" for others. */
export function VndRegistry({ initialView }: { initialView?: View }) {
  const t = useTranslations('vnd');
  const { me, access } = useCurrentUser();
  const canManage = can(access, 'vnd.manage');
  const hasEmployee = Boolean(me.employee);
  const [view, setView] = useState<View>(initialView ?? (canManage ? 'all' : 'my'));
  const [createOpen, setCreateOpen] = useState(false);
  const pending = useMyVnd('PENDING', { enabled: hasEmployee });
  const pendingCount = pending.data?.length ?? 0;

  return (
    <RequireAccess allow={(a) => can(a, 'vnd.read')}>
      <PageHeader
        title={t('title')}
        subtitle={canManage ? t('subtitle') : t('subtitleEmployee')}
        actions={
          canManage && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus />
              {t('new')}
            </Button>
          )
        }
      />
      {canManage ? (
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList aria-label={t('tabsLabel')}>
            <TabsTrigger value="all">{t('tabs.all')}</TabsTrigger>
            <TabsTrigger value="in_progress">{t('tabs.in_progress')}</TabsTrigger>
            <TabsTrigger value="completed">{t('tabs.completed')}</TabsTrigger>
            {hasEmployee && (
              <TabsTrigger value="my" count={pendingCount}>
                {t('tabs.my')}
              </TabsTrigger>
            )}
          </TabsList>
        </Tabs>
      ) : null}
      <div className={canManage ? 'mt-4' : undefined}>
        {view === 'my' ? <VndMyList /> : <VndTable tab={view} onCreate={canManage ? () => setCreateOpen(true) : undefined} />}
      </div>
      {canManage && <VndCreateDialog open={createOpen} onOpenChange={setCreateOpen} />}
    </RequireAccess>
  );
}

function VndTable({ tab, onCreate }: { tab: VndTab; onCreate?: () => void }) {
  const t = useTranslations('vnd');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [entity, setEntity] = useState(ANY);
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const debouncedQ = useDebounced(q.trim(), 300);
  const entities = useLegalEntities();
  const filter = {
    tab,
    q: debouncedQ || undefined,
    legalEntityId: entity === ANY ? undefined : entity,
    dateFrom: range.from || undefined,
    dateTo: range.to || undefined,
    page,
    pageSize,
  };
  const list = useVndList(filter);
  const filtered = Boolean(debouncedQ || entity !== ANY || range.from || range.to);

  const columns = useMemo<ColumnDef<VndListItem, unknown>[]>(
    () => [
      {
        id: 'number',
        header: t('colNumber'),
        meta: { label: t('colNumber'), className: 'whitespace-nowrap tabular font-medium' },
        cell: ({ row }) => (row.original.number ? `№${row.original.number}` : <span className="text-fg-subtle">—</span>),
      },
      {
        id: 'sentAt',
        header: t('colSentAt'),
        meta: { label: t('colSentAt'), className: 'whitespace-nowrap tabular text-fg-muted' },
        cell: ({ row }) => (row.original.sentAt ? formatDateTime(row.original.sentAt, locale) : '—'),
      },
      {
        id: 'title',
        header: t('colTitle'),
        meta: { label: t('colTitle'), hideable: false },
        cell: ({ row }) => (
          <div className="min-w-[220px] max-w-[420px]">
            <div className="truncate font-medium text-fg">{row.original.title}</div>
            <div className="truncate text-xs text-fg-subtle">{row.original.type.name}</div>
          </div>
        ),
      },
      {
        id: 'ack',
        header: t('colAck'),
        meta: { label: t('colAck') },
        cell: ({ row }) =>
          row.original.status === 'DRAFT' && !row.original.total ? (
            <span className="text-fg-subtle">—</span>
          ) : (
            <AckProgress acknowledged={row.original.acknowledged} total={row.original.total} />
          ),
      },
      {
        id: 'status',
        header: t('colStatus'),
        meta: { label: t('colStatus') },
        cell: ({ row }) => <VndStatusLabel status={row.original.status} />,
      },
      {
        id: 'comments',
        header: () => (
          <span className="inline-flex" title={t('colComments')}>
            <MessageSquare className="size-4" aria-hidden />
            <span className="sr-only">{t('colComments')}</span>
          </span>
        ),
        meta: { label: t('colComments'), className: 'whitespace-nowrap tabular text-fg-muted' },
        cell: ({ row }) =>
          row.original.commentsCount ? (
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="size-3.5" aria-hidden />
              {row.original.commentsCount}
            </span>
          ) : (
            '—'
          ),
      },
      {
        id: 'legalEntity',
        header: t('colLegalEntity'),
        meta: { label: t('colLegalEntity'), className: 'whitespace-nowrap text-fg-muted' },
        cell: ({ row }) => row.original.legalEntity.name,
      },
    ],
    [t, locale],
  );

  return (
    <DataTable
      label={t('title')}
      columns={columns}
      data={list.data?.items}
      getRowId={(r) => r.id}
      isLoading={list.isLoading}
      isFetching={list.isFetching}
      error={list.error}
      onRetry={() => list.refetch()}
      columnVisibilityKey="vnd-registry"
      onRowClick={(r) => router.push(`/vnd/${r.id}`)}
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
            aria-label={t('filterEntity')}
            className="w-full sm:w-52"
            value={entity}
            onValueChange={(v) => {
              setEntity(v);
              setPage(1);
            }}
            options={[{ value: ANY, label: t('allEntities') }, ...(entities.data ?? []).map((e) => ({ value: e.id, label: e.name }))]}
          />
          <DateRangeInput
            value={range}
            onChange={(r) => {
              setRange(r);
              setPage(1);
            }}
            className="w-full sm:w-auto"
          />
          <span className="text-[13px] text-fg-subtle tabular">{list.data ? t('total', { count: list.data.total }) : null}</span>
        </>
      }
      empty={
        <EmptyState
          compact
          icon={<ScrollText aria-hidden />}
          title={filtered ? tc('nothingFound') : t('empty')}
          description={filtered ? tc('tryOtherFilters') : t('emptyHint')}
          action={
            !filtered && onCreate ? (
              <Button size="sm" onClick={onCreate}>
                <Plus />
                {t('new')}
              </Button>
            ) : undefined
          }
        />
      }
    />
  );
}
