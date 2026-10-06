'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { AlertCircle, CheckCheck, FilePlus2, FileText, PenLine, Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/checkbox';
import { DataTable } from '@/components/ui/data-table';
import { DateRangeInput, type DateRange } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { useCurrentUser } from '@/components/shell/me-context';
import { RequireAccess } from '@/components/shell/require-access';
import { Link, useRouter } from '@/i18n/navigation';
import { isApiError } from '@/lib/api/errors';
import { useBulkApprove, useDocuments, useDocumentTypes } from '@/lib/api/hooks/documents';
import { useLegalEntities } from '@/lib/api/hooks/org';
import { DOCUMENT_STATUSES, type DocumentBox, type DocumentListItem, type DocumentStatus } from '@/lib/api/types-documents';
import { formatDate, formatDateTime } from '@/lib/format';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { can } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { DocStatusPill, MyActionBadge } from './labels';
import { SigningDialog } from './signing-dialog';

const ANY = 'any';

export const boxHref: Record<DocumentBox, string> = {
  inbox: '/inbox',
  outbox: '/documents/outgoing',
  drafts: '/documents/drafts',
  all: '/documents',
  archive: '/documents/archive',
};

/** Segmented links between the registry boxes (Входящие / Исходящие / Черновики / Все / Архив). */
function BoxTabs({ box }: { box: DocumentBox }) {
  const t = useTranslations('documents.boxes');
  const { access } = useCurrentUser();
  const boxes: DocumentBox[] = ['inbox', 'outbox', 'drafts', 'all', 'archive'].filter(
    (b) => (b !== 'drafts' || can(access, 'document.create')) && (b !== 'archive' || can(access, 'document.manage')),
  ) as DocumentBox[];
  return (
    <nav aria-label={t('label')} className="-mx-1 mb-4 max-w-full overflow-x-auto px-1 py-0.5">
      <ul className="inline-flex items-center gap-0.5 rounded-lg bg-surface-hover p-1">
        {boxes.map((b) => (
          <li key={b}>
            <Link
              href={boxHref[b]}
              aria-current={b === box ? 'page' : undefined}
              className={cn(
                'focus-ring inline-flex h-7 items-center whitespace-nowrap rounded-md px-3 text-[13px] font-medium text-fg-muted transition-colors hover:text-fg',
                b === box && 'bg-surface text-fg shadow-[0_1px_2px_rgb(16_24_40/0.08)]',
              )}
            >
              {t(b)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function DocumentRegistry({ box }: { box: DocumentBox }) {
  const t = useTranslations('documents.registry');
  const tb = useTranslations('documents.boxes');
  const ts = useTranslations('documents.status');
  const ta = useTranslations('documents.action');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const { access } = useCurrentUser();
  const [q, setQ] = useState('');
  const [typeId, setTypeId] = useState(ANY);
  const [status, setStatus] = useState(ANY);
  const [entity, setEntity] = useState(ANY);
  const [range, setRange] = useState<DateRange>({});
  const [overdue, setOverdue] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [signIds, setSignIds] = useState<string[] | null>(null);
  const debouncedQ = useDebounced(q.trim(), 300);

  const filter = {
    box,
    q: debouncedQ || undefined,
    documentTypeId: typeId === ANY ? undefined : typeId,
    status: status === ANY ? undefined : (status as DocumentStatus),
    legalEntityId: entity === ANY ? undefined : entity,
    dateFrom: range.from,
    dateTo: range.to,
    overdue: overdue || undefined,
    page,
    pageSize,
  };
  const docs = useDocuments(filter);
  const types = useDocumentTypes();
  const entities = useLegalEntities();
  const bulkApprove = useBulkApprove();
  const filtered = Boolean(debouncedQ || typeId !== ANY || status !== ANY || entity !== ANY || range.from || range.to || overdue);

  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };
  const resetFilters = () => {
    setQ('');
    setTypeId(ANY);
    setStatus(ANY);
    setEntity(ANY);
    setRange({});
    setOverdue(false);
    setPage(1);
  };

  const columns = useMemo<ColumnDef<DocumentListItem, unknown>[]>(
    () => [
      {
        id: 'number',
        header: t('colNumber'),
        meta: { label: t('colNumber'), className: 'whitespace-nowrap tabular font-medium' },
        cell: ({ row }) => row.original.number ?? <span className="text-fg-subtle">{t('noNumber')}</span>,
      },
      {
        id: 'title',
        header: t('colTitle'),
        meta: { label: t('colTitle'), hideable: false },
        cell: ({ row }) => (
          <div className="min-w-[220px] max-w-[360px]">
            <Link
              href={`/documents/${row.original.id}`}
              onClick={(e) => e.stopPropagation()}
              className="focus-ring block truncate rounded font-medium text-fg hover:text-primary"
            >
              {row.original.title}
            </Link>
            <div className="truncate text-xs text-fg-subtle">{row.original.type.name}</div>
          </div>
        ),
      },
      {
        id: 'status',
        header: t('colStatus'),
        meta: { label: t('colStatus') },
        cell: ({ row }) => (
          <div className="flex flex-col items-start gap-1">
            <DocStatusPill status={row.original.status} />
            {row.original.myPendingAction && <MyActionBadge action={row.original.myPendingAction} />}
          </div>
        ),
      },
      {
        id: 'subject',
        header: t('colSubject'),
        meta: { label: t('colSubject') },
        cell: ({ row }) =>
          row.original.subject ? (
            <div className="flex min-w-[160px] items-center gap-2">
              <Avatar name={row.original.subject.fullName} size="xs" />
              <div className="min-w-0">
                <div className="truncate">{row.original.subject.shortName}</div>
                {row.original.subject.position && <div className="truncate text-xs text-fg-subtle">{row.original.subject.position}</div>}
              </div>
            </div>
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
      {
        id: 'step',
        header: t('colStep'),
        meta: { label: t('colStep') },
        cell: ({ row }) => {
          const s = row.original.currentStep;
          if (!s) return <span className="text-fg-subtle">—</span>;
          return (
            <div className="min-w-[160px]">
              <div className="truncate">{s.assignee.shortName}</div>
              <div className={cn('text-xs', row.original.overdue ? 'font-medium text-red-fg' : 'text-fg-subtle')}>
                {ta(s.action)}
                {s.dueAt && ` · ${t('dueShort', { date: formatDate(s.dueAt, locale) })}`}
              </div>
            </div>
          );
        },
      },
      {
        id: 'overdue',
        header: t('colDue'),
        meta: { label: t('colDue'), className: 'whitespace-nowrap' },
        cell: ({ row }) =>
          row.original.overdue ? (
            <span className="inline-flex items-center gap-1 text-[13px] font-medium text-red-fg">
              <AlertCircle className="size-3.5" aria-hidden />
              {t('overdue')}
            </span>
          ) : row.original.dueAt ? (
            <span className="tabular text-fg-muted">{formatDate(row.original.dueAt, locale)}</span>
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
      {
        id: 'legalEntity',
        header: t('colEntity'),
        meta: { label: t('colEntity'), className: 'max-w-[200px] truncate text-fg-muted' },
        cell: ({ row }) => row.original.legalEntity.name,
      },
      {
        id: 'author',
        header: t('colAuthor'),
        meta: { label: t('colAuthor'), className: 'whitespace-nowrap text-fg-muted' },
        cell: ({ row }) => row.original.author.shortName,
      },
      {
        id: 'createdAt',
        header: t('colCreated'),
        meta: { label: t('colCreated'), className: 'whitespace-nowrap tabular text-fg-muted' },
        cell: ({ row }) => formatDateTime(row.original.createdAt, locale),
      },
    ],
    [t, ta, locale],
  );

  const byId = useMemo(() => new Map((docs.data?.items ?? []).map((d) => [d.id, d])), [docs.data]);

  const runBulkApprove = (ids: string[], clear: () => void) =>
    bulkApprove.mutate(ids, {
      onSuccess: (r) => {
        if (r.succeeded.length) toast.success(t('bulkApproved', { count: r.succeeded.length }));
        if (r.failed.length) toast.error(t('bulkFailed', { count: r.failed.length }));
        clear();
      },
      onError: (e) => toast.error(isApiError(e) ? e.message : tc('error')),
    });

  const canBulk = box === 'inbox' || box === 'all';

  return (
    <RequireAccess allow={(a) => can(a, 'document.read')}>
      <PageHeader
        title={tb(box)}
        subtitle={docs.data ? t('total', { count: docs.data.total }) : t(`subtitle_${box}`)}
        actions={
          can(access, 'document.create') && (
            <Button asChild>
              <Link href="/documents/new">
                <FilePlus2 aria-hidden />
                {t('new')}
              </Link>
            </Button>
          )
        }
      />
      <BoxTabs box={box} />
      <DataTable
        label={tb(box)}
        columns={columns}
        data={docs.data?.items}
        getRowId={(d) => d.id}
        isLoading={docs.isLoading}
        isFetching={docs.isFetching}
        error={docs.error}
        onRetry={() => docs.refetch()}
        onRowClick={(d) => router.push(`/documents/${d.id}`)}
        columnVisibilityKey="documents-registry"
        initialHidden={['author', 'legalEntity']}
        allowSelectAllMatching={false}
        bulkActions={
          canBulk
            ? (sel, clear) => {
                const rows = sel.ids.map((id) => byId.get(id)).filter(Boolean) as DocumentListItem[];
                const approvable = rows.filter((r) => r.myPendingAction === 'APPROVE' || r.myPendingAction === 'ACKNOWLEDGE').map((r) => r.id);
                const signable = rows.filter((r) => r.myPendingAction === 'SIGN' || r.myPendingAction === 'ACKNOWLEDGE').map((r) => r.id);
                return (
                  <>
                    <Button size="sm" variant="outline" disabled={!approvable.length} loading={bulkApprove.isPending} onClick={() => runBulkApprove(approvable, clear)}>
                      <CheckCheck aria-hidden />
                      {t('bulkApprove', { count: approvable.length })}
                    </Button>
                    <Button size="sm" disabled={!signable.length} onClick={() => setSignIds(signable)}>
                      <PenLine aria-hidden />
                      {t('bulkSign', { count: signable.length })}
                    </Button>
                  </>
                );
              }
            : undefined
        }
        pagination={
          docs.data && { page, pageSize, total: docs.data.total, onPageChange: setPage, onPageSizeChange: resetPage(setPageSize) }
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
              aria-label={t('filterType')}
              className="w-full sm:w-52"
              value={typeId}
              onValueChange={resetPage(setTypeId)}
              options={[{ value: ANY, label: t('allTypes') }, ...(types.data ?? []).map((x) => ({ value: x.id, label: x.name }))]}
            />
            <Select
              aria-label={t('filterStatus')}
              className="w-full sm:w-44"
              value={status}
              onValueChange={resetPage(setStatus)}
              options={[{ value: ANY, label: t('allStatuses') }, ...DOCUMENT_STATUSES.map((s) => ({ value: s, label: ts(s) }))]}
            />
            {(entities.data?.length ?? 0) > 1 && (
              <Select
                aria-label={t('filterEntity')}
                className="w-full sm:w-52"
                value={entity}
                onValueChange={resetPage(setEntity)}
                options={[{ value: ANY, label: t('allEntities') }, ...(entities.data ?? []).map((x) => ({ value: x.id, label: x.name }))]}
              />
            )}
            <DateRangeInput value={range} onChange={resetPage(setRange)} className="w-full sm:w-72" labelFrom={t('createdFrom')} labelTo={t('createdTo')} />
            <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3">
              <Switch id="docs-overdue" checked={overdue} onCheckedChange={(v) => resetPage(setOverdue)(v)} aria-label={t('onlyOverdue')} />
              <label htmlFor="docs-overdue" className="cursor-pointer whitespace-nowrap text-[13px] text-fg">
                {t('onlyOverdue')}
              </label>
            </div>
            {filtered && (
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                {tc('resetFilters')}
              </Button>
            )}
          </>
        }
        empty={
          <EmptyState
            compact
            icon={<FileText aria-hidden />}
            title={filtered ? tc('nothingFound') : t(`empty_${box}`)}
            description={filtered ? tc('tryOtherFilters') : t('emptyHint')}
          />
        }
      />
      <SigningDialog
        open={signIds !== null}
        onOpenChange={(o) => !o && setSignIds(null)}
        documentIds={signIds ?? []}
      />
    </RequireAccess>
  );
}
