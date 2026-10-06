'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Check, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { FormField } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { isApiError } from '@/lib/api/errors';
import { useDecideTimeRequest, useTimeRequests } from '@/lib/api/hooks/time';
import { TIME_REQUEST_KINDS, type ApprovalStatus, type TimeRequestKind, type TimeRequestView } from '@/lib/api/types-time';
import { formatDate, formatDateTime } from '@/lib/format';
import { requestIcon } from './my-time-page';
import { ApprovalPill, useRequestSummary } from './shared';

type Decision = { request: TimeRequestView; decision: 'APPROVE' | 'REJECT' };

/** "Запросы": requests of managed employees with approve/reject + comment (F-39). */
export function ManagedRequestsTab() {
  const t = useTranslations('time.requests');
  const tk = useTranslations('time.requestKind');
  const ta = useTranslations('time.approval');
  const tc = useTranslations('common');
  const locale = useLocale();
  const summary = useRequestSummary();
  const [status, setStatus] = useState<string>('PENDING');
  const [kind, setKind] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [comment, setComment] = useState('');
  const decide = useDecideTimeRequest();
  const query = useTimeRequests({
    scope: 'managed',
    status: status === 'all' ? undefined : (status as ApprovalStatus),
    kind: kind === 'all' ? undefined : (kind as TimeRequestKind),
    page,
    pageSize,
  });

  const openDecision = (d: Decision) => {
    setComment('');
    setDecision(d);
  };

  const submit = () => {
    if (!decision) return;
    decide.mutate(
      { id: decision.request.id, decision: decision.decision, comment: comment.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(decision.decision === 'APPROVE' ? t('approved') : t('rejected'));
          setDecision(null);
        },
        onError: (e) => {
          const msg =
            isApiError(e) && e.rule === 'ALREADY_SCHEDULED'
              ? t('errAlreadyScheduled')
              : isApiError(e) && e.code === 'CONFLICT'
                ? t('errDecided')
                : isApiError(e)
                  ? e.message
                  : tc('error');
          toast.error(msg);
        },
      },
    );
  };

  const columns = useMemo<ColumnDef<TimeRequestView, unknown>[]>(
    () => [
      {
        id: 'employee',
        header: t('colEmployee'),
        meta: { label: t('colEmployee'), hideable: false },
        cell: ({ row }) => (
          <div className="flex min-w-[190px] items-center gap-2.5">
            <Avatar name={row.original.employee.fullName} />
            <div className="min-w-0">
              <div className="truncate font-medium text-fg">{row.original.employee.shortName}</div>
              {row.original.employee.position && <div className="truncate text-xs text-fg-subtle">{row.original.employee.position}</div>}
            </div>
          </div>
        ),
      },
      {
        id: 'kind',
        header: t('colKind'),
        meta: { label: t('colKind') },
        cell: ({ row }) => {
          const Icon = requestIcon[row.original.kind];
          return (
            <span className="flex min-w-[170px] items-center gap-2 text-fg">
              <Icon className="size-4 shrink-0 text-purple-fg" aria-hidden />
              {tk(row.original.kind)}
            </span>
          );
        },
      },
      { id: 'date', header: t('colDate'), meta: { label: t('colDate'), className: 'whitespace-nowrap tabular' }, cell: ({ row }) => formatDate(row.original.date, locale) },
      {
        id: 'details',
        header: t('colDetails'),
        meta: { label: t('colDetails') },
        cell: ({ row }) => (
          <div className="min-w-[200px] max-w-[320px]">
            <div className="text-fg">{summary(row.original)}</div>
            {typeof row.original.data.reason === 'string' && <div className="line-clamp-2 text-xs text-fg-subtle">{row.original.data.reason}</div>}
          </div>
        ),
      },
      {
        id: 'status',
        header: t('colStatus'),
        meta: { label: t('colStatus') },
        cell: ({ row }) => (
          <div className="min-w-[120px]">
            <ApprovalPill status={row.original.status} variant="pill" />
            {row.original.decidedBy && (
              <div className="mt-0.5 text-xs text-fg-subtle">
                {row.original.decidedBy.shortName} · {formatDateTime(row.original.decidedAt, locale)}
              </div>
            )}
            {row.original.comment && <div className="text-xs text-fg-muted">«{row.original.comment}»</div>}
          </div>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{tc('actions')}</span>,
        meta: { hideable: false, className: 'text-right' },
        cell: ({ row }) =>
          row.original.status === 'PENDING' ? (
            <div className="flex justify-end gap-1.5">
              <Button size="sm" variant="outline" onClick={() => openDecision({ request: row.original, decision: 'REJECT' })} aria-label={t('rejectFor', { name: row.original.employee.fullName })}>
                <X />
                <span className="hidden xl:inline">{t('reject')}</span>
              </Button>
              <Button size="sm" onClick={() => openDecision({ request: row.original, decision: 'APPROVE' })} aria-label={t('approveFor', { name: row.original.employee.fullName })}>
                <Check />
                <span className="hidden xl:inline">{t('approve')}</span>
              </Button>
            </div>
          ) : null,
      },
    ],
    [t, tk, tc, locale, summary],
  );

  const d = decision;
  return (
    <>
      <DataTable
        label={t('managedLabel')}
        columns={columns}
        data={query.data?.items}
        getRowId={(r) => r.id}
        isLoading={query.isLoading}
        isFetching={query.isFetching}
        error={query.error}
        onRetry={() => query.refetch()}
        columnVisibilityKey="time-managed-requests"
        pagination={query.data ? { page, pageSize, total: query.data.total, onPageChange: setPage, onPageSizeChange: (s) => { setPageSize(s); setPage(1); } } : undefined}
        toolbar={
          <>
            <Select
              size="sm"
              className="w-44"
              value={status}
              onValueChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
              aria-label={t('colStatus')}
              options={[{ value: 'all', label: t('allStatuses') }, ...(['PENDING', 'APPROVED', 'REJECTED'] as const).map((s) => ({ value: s, label: ta(s) }))]}
            />
            <Select
              size="sm"
              className="w-56"
              value={kind}
              onValueChange={(v) => {
                setKind(v);
                setPage(1);
              }}
              aria-label={t('colKind')}
              options={[{ value: 'all', label: t('allKinds') }, ...TIME_REQUEST_KINDS.map((k) => ({ value: k, label: tk(k) }))]}
            />
          </>
        }
        empty={<EmptyState compact title={status === 'PENDING' ? t('emptyPending') : t('emptyManaged')} description={t('emptyManagedHint')} />}
      />
      <Dialog
        open={Boolean(d)}
        onOpenChange={(o) => !o && setDecision(null)}
        size="sm"
        title={d?.decision === 'APPROVE' ? t('approveTitle') : t('rejectTitle')}
        description={d ? `${d.request.employee.fullName} · ${tk(d.request.kind)} · ${formatDate(d.request.date, locale)}` : undefined}
        dismissible={!decide.isPending}
        footer={
          <>
            <Button variant="outline" onClick={() => setDecision(null)} disabled={decide.isPending}>
              {tc('cancel')}
            </Button>
            <Button variant={d?.decision === 'REJECT' ? 'danger' : 'primary'} onClick={submit} loading={decide.isPending}>
              {d?.decision === 'APPROVE' ? t('approve') : t('reject')}
            </Button>
          </>
        }
      >
        {d && (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg bg-surface-muted px-3 py-2 text-[13px]">
              <div className="font-medium text-fg">{summary(d.request)}</div>
              {typeof d.request.data.reason === 'string' && <div className="mt-0.5 text-fg-muted">{d.request.data.reason}</div>}
            </div>
            {d.decision === 'APPROVE' && <p className="text-xs text-fg-muted">{t(`applyHint_${d.request.kind}`)}</p>}
            <FormField label={t('comment')}>
              <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} placeholder={t('commentPlaceholder')} />
            </FormField>
          </div>
        )}
      </Dialog>
    </>
  );
}
