'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { FileDown, FileUp, MessageSquare, Plus, Search, Send, UserRoundPlus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DataTable, type Selection } from '@/components/ui/data-table';
import { DateRangeInput, type DateRange } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Tooltip } from '@/components/ui/popover';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { RequireAccess } from '@/components/shell/require-access';
import { useCurrentUser } from '@/components/shell/me-context';
import { Link, useRouter } from '@/i18n/navigation';
import { fetchCandidateIds, useCandidates } from '@/lib/api/hooks/onboarding';
import {
  CANDIDATE_CHECKS, CANDIDATE_STATUSES, DOC_REQUEST_STATUSES, INVITATION_STATUSES, type CandidateCheck, type CandidateFilter,
  type CandidateListItem, type CandidateStatus, type DocRequestStatus, type InvitationStatus,
} from '@/lib/api/types-onboarding';
import { formatDate } from '@/lib/format';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { can } from '@/lib/permissions';
import { isApiError } from '@/lib/api/errors';
import { BulkImportDialog } from './bulk-import-dialog';
import { ExportDialog } from './export-dialog';
import { CheckPill, DocRequestPill, InvitationPill } from './pills';
import { RequestDocumentsDialog, type PickedCandidate } from './request-documents-dialog';
import { ResponsiblePicker } from './responsible-picker';
import { StatusMenu } from './status-menu';

const ANY = 'any';

export function CandidatesPage() {
  const t = useTranslations('onboarding.registry');
  const te = useTranslations('onboarding.enums');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const { can: canDo } = useCurrentUser();
  const canManage = canDo('candidate.manage');

  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string>(ANY);
  const [invitation, setInvitation] = useState<string>(ANY);
  const [docRequest, setDocRequest] = useState<string>(ANY);
  const [check, setCheck] = useState<string>(ANY);
  const [responsible, setResponsible] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const debouncedQ = useDebounced(q.trim(), 300);

  const filter: CandidateFilter = {
    q: debouncedQ || undefined,
    status: status === ANY ? undefined : (status as CandidateStatus),
    invitationStatus: invitation === ANY ? undefined : (invitation as InvitationStatus),
    docRequestStatus: docRequest === ANY ? undefined : (docRequest as DocRequestStatus),
    checkStatus: check === ANY ? undefined : (check as CandidateCheck),
    responsibleUserId: responsible ?? undefined,
    updatedFrom: range.from,
    updatedTo: range.to,
    page,
    pageSize,
  };
  const list = useCandidates(filter);
  const filtered = Boolean(filter.q || filter.status || filter.invitationStatus || filter.docRequestStatus || filter.checkStatus || filter.responsibleUserId || filter.updatedFrom || filter.updatedTo);

  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportIds, setExportIds] = useState<string[] | undefined>();
  const [requestOpen, setRequestOpen] = useState(false);
  const [picked, setPicked] = useState<PickedCandidate[]>([]);
  const [resolving, setResolving] = useState(false);
  const clearRef = useRef<(() => void) | null>(null);

  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  const resolveSelection = async (sel: Selection): Promise<PickedCandidate[]> => {
    if (!sel.allMatching) {
      const byId = new Map((list.data?.items ?? []).map((c) => [c.id, c]));
      return sel.ids.map((id) => ({ id, fullName: byId.get(id)?.fullName ?? id }));
    }
    setResolving(true);
    try {
      const rows = await fetchCandidateIds({ ...filter, page: undefined, pageSize: undefined });
      return rows.map((c) => ({ id: c.id, fullName: c.fullName }));
    } finally {
      setResolving(false);
    }
  };

  const enumOptions = <T extends string>(values: T[], ns: 'status' | 'invitation' | 'docRequest' | 'check') => [
    { value: ANY, label: t('any') },
    ...values.map((v) => ({ value: v, label: te(`${ns}.${v}` as `status.NEW`) })),
  ];

  const columns = useMemo<ColumnDef<CandidateListItem, unknown>[]>(
    () => [
      {
        id: 'fullName',
        header: t('colName'),
        meta: {
          label: t('colName'),
          hideable: false,
          className: 'min-w-[220px]',
          filter: (
            <Input
              type="search"
              inputSize="sm"
              aria-label={t('searchLabel')}
              placeholder={t('searchPlaceholder')}
              leftIcon={<Search />}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              className="min-w-[180px]"
            />
          ),
        },
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              href={`/candidates/${row.original.id}`}
              onClick={(e) => e.stopPropagation()}
              className="focus-ring block truncate rounded font-medium text-fg hover:text-primary"
            >
              {row.original.fullName}
            </Link>
            {row.original.tags.length > 0 && <div className="mt-0.5 truncate text-xs text-fg-subtle">{row.original.tags.join(' · ')}</div>}
          </div>
        ),
      },
      {
        id: 'comments',
        header: () => (
          <span className="inline-flex" title={t('colComments')}>
            <MessageSquare className="size-3.5" aria-hidden />
            <span className="sr-only">{t('colComments')}</span>
          </span>
        ),
        meta: { label: t('colComments'), className: 'w-12', headerClassName: 'w-12' },
        cell: ({ row }) =>
          row.original.commentsCount > 0 ? (
            <Tooltip content={t('commentsCount', { count: row.original.commentsCount })}>
              <Link
                href={`/candidates/${row.original.id}?tab=comments`}
                onClick={(e) => e.stopPropagation()}
                className="focus-ring inline-flex items-center gap-1 rounded text-xs font-medium text-primary"
                aria-label={t('commentsCount', { count: row.original.commentsCount })}
              >
                <MessageSquare className="size-3.5" aria-hidden />
                <span className="tabular">{row.original.commentsCount}</span>
              </Link>
            </Tooltip>
          ) : null,
      },
      {
        id: 'status',
        header: t('colStatus'),
        meta: {
          label: t('colStatus'),
          filter: <Select size="sm" aria-label={t('filterStatus')} value={status} onValueChange={resetPage(setStatus)} options={enumOptions(CANDIDATE_STATUSES, 'status')} className="min-w-[130px]" />,
        },
        cell: ({ row }) => <StatusMenu candidate={row.original} disabled={!canManage} />,
      },
      {
        id: 'invitation',
        header: t('colInvitation'),
        meta: {
          label: t('colInvitation'),
          className: 'whitespace-nowrap',
          filter: <Select size="sm" aria-label={t('filterInvitation')} value={invitation} onValueChange={resetPage(setInvitation)} options={enumOptions(INVITATION_STATUSES, 'invitation')} className="min-w-[120px]" />,
        },
        cell: ({ row }) => <InvitationPill value={row.original.invitationStatus} />,
      },
      {
        id: 'docRequest',
        header: t('colDocRequest'),
        meta: {
          label: t('colDocRequest'),
          filter: <Select size="sm" aria-label={t('filterDocRequest')} value={docRequest} onValueChange={resetPage(setDocRequest)} options={enumOptions(DOC_REQUEST_STATUSES, 'docRequest')} className="min-w-[150px]" />,
        },
        cell: ({ row }) => <DocRequestPill value={row.original.docRequestStatus} />,
      },
      {
        id: 'check',
        header: t('colCheck'),
        meta: {
          label: t('colCheck'),
          filter: <Select size="sm" aria-label={t('filterCheck')} value={check} onValueChange={resetPage(setCheck)} options={enumOptions(CANDIDATE_CHECKS, 'check')} className="min-w-[150px]" />,
        },
        cell: ({ row }) => <CheckPill value={row.original.checkStatus} />,
      },
      {
        id: 'responsible',
        header: t('colResponsible'),
        meta: {
          label: t('colResponsible'),
          className: 'whitespace-nowrap',
          filter: (
            <ResponsiblePicker
              size="sm"
              aria-label={t('filterResponsible')}
              placeholder={t('any')}
              value={responsible}
              onChange={resetPage(setResponsible)}
              className="min-w-[150px]"
            />
          ),
        },
        cell: ({ row }) =>
          row.original.responsible ? (
            <span title={row.original.responsible.fullName}>{row.original.responsible.shortName}</span>
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
      {
        id: 'legalEntity',
        header: t('colLegalEntity'),
        meta: { label: t('colLegalEntity'), className: 'whitespace-nowrap text-fg-muted' },
        cell: ({ row }) => row.original.legalEntity.name,
      },
      {
        id: 'updatedAt',
        header: t('colUpdated'),
        meta: {
          label: t('colUpdated'),
          className: 'whitespace-nowrap tabular text-fg-muted',
          filter: <DateRangeInput inputSize="sm" value={range} onChange={resetPage(setRange)} className="min-w-[260px]" labelFrom={t('updatedFrom')} labelTo={t('updatedTo')} />,
        },
        cell: ({ row }) => formatDate(row.original.updatedAt, locale),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, te, locale, q, status, invitation, docRequest, check, responsible, range, canManage],
  );

  return (
    <RequireAccess allow={(a) => can(a, 'candidate.read')}>
      <PageHeader
        title={t('title')}
        subtitle={list.data ? t('total', { count: list.data.total }) : t('subtitle')}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setExportIds(undefined);
                setExportOpen(true);
              }}
            >
              <FileDown />
              {t('export')}
            </Button>
            {canManage && (
              <>
                <Button variant="outline" onClick={() => setImportOpen(true)}>
                  <FileUp />
                  {t('bulkAdd')}
                </Button>
                <Button asChild>
                  <Link href="/candidates/new">
                    <Plus />
                    {t('newCandidate')}
                  </Link>
                </Button>
              </>
            )}
          </>
        }
      />
      <DataTable
        label={t('title')}
        columns={columns}
        data={list.data?.items}
        getRowId={(c) => c.id}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.error}
        onRetry={() => list.refetch()}
        columnVisibilityKey="candidates"
        initialHidden={['legalEntity']}
        onRowClick={(c) => router.push(`/candidates/${c.id}`)}
        pagination={
          list.data && {
            page,
            pageSize,
            total: list.data.total,
            onPageChange: setPage,
            onPageSizeChange: resetPage(setPageSize),
          }
        }
        toolbar={
          filtered ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQ('');
                setStatus(ANY);
                setInvitation(ANY);
                setDocRequest(ANY);
                setCheck(ANY);
                setResponsible(null);
                setRange({});
                setPage(1);
              }}
            >
              {tc('resetFilters')}
            </Button>
          ) : (
            <span className="text-[13px] text-fg-muted">{t('hint')}</span>
          )
        }
        bulkActions={(sel, clear) => (
          <>
            {canManage && (
              <Button
                size="sm"
                loading={resolving}
                onClick={async () => {
                  try {
                    setPicked(await resolveSelection(sel));
                    clearRef.current = clear;
                    setRequestOpen(true);
                  } catch (e) {
                    toast.error(isApiError(e) ? e.message : tc('error'));
                  }
                }}
              >
                {!resolving && <Send />}
                {t('requestDocuments')}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  const rows = await resolveSelection(sel);
                  setExportIds(rows.map((r) => r.id));
                  setExportOpen(true);
                } catch (e) {
                  toast.error(isApiError(e) ? e.message : tc('error'));
                }
              }}
            >
              <FileDown />
              {t('exportSelected')}
            </Button>
          </>
        )}
        empty={
          <EmptyState
            compact
            icon={<UserRoundPlus aria-hidden />}
            title={filtered ? tc('nothingFound') : t('empty')}
            description={filtered ? tc('tryOtherFilters') : t('emptyHint')}
            action={
              !filtered && canManage ? (
                <Button size="sm" asChild>
                  <Link href="/candidates/new">
                    <Plus />
                    {t('newCandidate')}
                  </Link>
                </Button>
              ) : undefined
            }
          />
        }
      />
      <BulkImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} candidateIds={exportIds} canMark={canManage} />
      <RequestDocumentsDialog open={requestOpen} onOpenChange={setRequestOpen} candidates={picked} onDone={() => clearRef.current?.()} />
    </RequireAccess>
  );
}
