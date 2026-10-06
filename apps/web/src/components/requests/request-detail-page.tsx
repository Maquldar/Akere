'use client';

import { Ban, CalendarDays, Check, Clock, FileSignature, Paperclip, Pencil, Send, Stamp, UserRound } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { useCurrentUser } from '@/components/shell/me-context';
import { Link } from '@/i18n/navigation';
import { useCancelRequest, useRequest, useRequestTypes, useSubmitRequest } from '@/lib/api/hooks/requests';
import type { RequestDetail, RequestStatus } from '@/lib/api/types-requests';
import { formatDateTime } from '@/lib/format';
import { cn, formatBytes } from '@/lib/utils';
import { DocumentCard } from './document-card';
import { formatDays, RequestStatusPill, typeIcon, useFieldLabel, usePeriodText, useRequestErrorText } from './shared';

const STAGES = ['submitted', 'approval', 'order', 'done'] as const;

function stageIndex(status: RequestStatus): number {
  switch (status) {
    case 'DRAFT':
      return -1;
    case 'IN_APPROVAL':
    case 'REWORK':
      return 1;
    case 'ORDER_SIGNING':
      return 2;
    case 'COMPLETED':
      return 4;
    default:
      return 1;
  }
}

/** "Заявка → Руководитель и HR → Приказ → Исполнено" progress (deck p30 route). */
function Progress({ r }: { r: RequestDetail }) {
  const t = useTranslations('requests.stages');
  const current = stageIndex(r.status);
  const failed = r.status === 'REJECTED' || r.status === 'CANCELLED';
  const stages = r.orderDocument || r.type.code !== 'CERTIFICATE' ? STAGES : (['submitted', 'approval', 'done'] as const);
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-[13px]" aria-label={t('label')}>
      {stages.map((s, i) => {
        const idx = s === 'done' ? 3 : STAGES.indexOf(s);
        const done = !failed && (current > idx || (s === 'submitted' && current >= 0));
        const active = !failed && current === idx;
        return (
          <li key={s} className="flex items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium',
                done && 'border-green-border bg-green-bg text-green-fg',
                active && 'border-blue-border bg-blue-bg text-blue-fg',
                !done && !active && 'border-border bg-surface text-fg-subtle',
              )}
              aria-current={active ? 'step' : undefined}
            >
              {done ? <Check className="size-3.5" aria-hidden /> : <span className="tabular">{i + 1}</span>}
              {t(s)}
            </span>
            {i < stages.length - 1 && <span className="hidden h-px w-5 bg-border sm:block" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

function DataCard({ r }: { r: RequestDetail }) {
  const t = useTranslations('requests.detail');
  const locale = useLocale();
  const period = usePeriodText();
  const fieldLabel = useFieldLabel();
  const types = useRequestTypes();
  const type = types.data?.find((ty) => ty.id === r.type.id);
  const rows: [string, React.ReactNode][] = [
    [t('employee'), (
      <span key="e" className="inline-flex items-center gap-2">
        <Avatar name={r.employee.fullName} size="xs" />
        <span>
          {r.employee.fullName}
          {r.employee.position && <span className="block text-xs font-normal text-fg-subtle">{r.employee.position}</span>}
        </span>
      </span>
    )],
    [t('type'), r.type.name],
  ];
  if (r.startDate || r.endDate) rows.push([t('period'), period(r.startDate, r.endDate)]);
  if (r.days !== null) rows.push([t('days'), String(r.days)]);
  if (r.vacationBalance !== undefined && r.vacationBalance !== null) rows.push([t('balance'), formatDays(r.vacationBalance, locale)]);
  for (const [key, value] of Object.entries(r.data ?? {})) {
    if (value === null || value === undefined || value === '' || ['startDate', 'endDate', 'days', 'requestId'].includes(key)) continue;
    const field = type?.fields.find((f) => f.key === key);
    const shown = typeof value === 'boolean' ? (value ? t('yes') : t('no')) : String(value);
    rows.push([field ? fieldLabel(field) : key, shown]);
  }
  rows.push([t('created'), formatDateTime(r.createdAt, locale)]);
  if (r.submittedAt) rows.push([t('submitted'), formatDateTime(r.submittedAt, locale)]);
  if (r.completedAt) rows.push([t('completed'), formatDateTime(r.completedAt, locale)]);

  return (
    <Card>
      <CardHeader title={t('dataTitle')} titleAs="h3" />
      <CardBody>
        <dl className="grid gap-3 text-[13px]">
          {rows.map(([k, v], i) => (
            <div key={i} className="grid gap-1 sm:grid-cols-[180px_1fr] sm:gap-3">
              <dt className="text-fg-subtle">{k}</dt>
              <dd className="min-w-0 whitespace-pre-line break-words font-medium text-fg">{v}</dd>
            </div>
          ))}
        </dl>
      </CardBody>
    </Card>
  );
}

function AttachmentsCard({ r }: { r: RequestDetail }) {
  const t = useTranslations('requests.detail');
  return (
    <Card>
      <CardHeader title={t('attachments')} count={r.attachments.length || undefined} titleAs="h3" />
      <CardBody className="p-2 sm:p-2">
        {r.attachments.length === 0 ? (
          <EmptyState compact icon={<Paperclip aria-hidden />} title={t('noAttachments')} />
        ) : (
          <ul className="flex flex-col">
            {r.attachments.map((a) => (
              <li key={a.id}>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="focus-ring flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] hover:bg-surface-hover"
                >
                  <Paperclip className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium text-fg">{a.filename}</span>
                  <span className="shrink-0 text-xs text-fg-subtle tabular">{formatBytes(a.size)}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function TimelineCard({ r }: { r: RequestDetail }) {
  const t = useTranslations('requests.detail');
  const locale = useLocale();
  const items = r.timeline.slice().reverse();
  return (
    <Card>
      <CardHeader title={t('timeline')} titleAs="h3" />
      <CardBody>
        {items.length === 0 ? (
          <p className="text-[13px] text-fg-subtle">{t('noTimeline')}</p>
        ) : (
          <ol className="flex flex-col">
            {items.map((e, i) => (
              <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
                {i < items.length - 1 && <span className="absolute left-[5px] top-4 h-[calc(100%-10px)] w-px bg-border" aria-hidden />}
                <span className={cn('mt-1.5 size-[11px] shrink-0 rounded-full border-2', i === 0 ? 'border-primary bg-primary-soft' : 'border-border-strong bg-surface')} aria-hidden />
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-fg">{e.label}</p>
                  <p className="text-xs text-fg-subtle tabular">
                    {formatDateTime(e.at, locale)}
                    {e.actor && ` · ${e.actor.shortName || e.actor.fullName}`}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}

export function RequestDetailPage({ id }: { id: string }) {
  const t = useTranslations('requests.detail');
  const tm = useTranslations('requests.my');
  const tt = useTranslations('requests.team');
  const { me } = useCurrentUser();
  const req = useRequest(id);
  const cancel = useCancelRequest();
  const submit = useSubmitRequest();
  const errorText = useRequestErrorText();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const r = req.data;
  const own = Boolean(r && me.employee && (r.employee.employeeId === me.employee.id || r.employee.id === me.id));
  const canEdit = r ? (r.canEdit ?? (own && ['DRAFT', 'REWORK'].includes(r.status))) : false;
  const canSubmit = r ? (r.canSubmit ?? canEdit) : false;
  const canCancel = r ? (r.canCancel ?? (own && !['COMPLETED', 'REJECTED', 'CANCELLED'].includes(r.status))) : false;

  const crumbs = own || !r ? [{ label: tm('title'), href: '/requests' }] : [{ label: tt('title'), href: '/requests/team' }];
  const Icon = typeIcon(r?.type.code);

  if (req.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-9 w-full max-w-lg" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-80 rounded-xl lg:col-span-2" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    );
  }
  if (req.isError || !r) {
    return (
      <>
        <PageHeader title={t('title')} breadcrumbs={crumbs} />
        <Card>
          <ErrorState error={req.error} onRetry={() => req.refetch()} />
        </Card>
      </>
    );
  }

  const pendingMine = [r.applicationDocument, r.orderDocument].some((d) => d?.myPendingAction);

  return (
    <>
      <PageHeader
        breadcrumbs={[...crumbs, { label: r.type.name }]}
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Icon className="size-5 text-fg-subtle" aria-hidden />
            <span>{r.type.name}</span>
            <RequestStatusPill status={r.status} />
          </span>
        }
        subtitle={
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            {!own && (
              <span className="inline-flex items-center gap-1.5">
                <UserRound className="size-3.5" aria-hidden />
                {r.employee.fullName}
              </span>
            )}
            {(r.startDate || r.endDate) && (
              <span className="inline-flex items-center gap-1.5 tabular">
                <CalendarDays className="size-3.5" aria-hidden />
                <PeriodText start={r.startDate} end={r.endDate} days={r.days} />
              </span>
            )}
          </span>
        }
        actions={
          <>
            {canEdit && (
              <Button variant="outline" asChild>
                <Link href={`/requests/${r.id}/edit`}>
                  <Pencil aria-hidden />
                  {t('edit')}
                </Link>
              </Button>
            )}
            {canSubmit && (
              <Button
                onClick={() =>
                  submit.mutate(r.id, {
                    onSuccess: () => toast.success(t('submittedToast')),
                    onError: (e) => toast.error(errorText(e)),
                  })
                }
                loading={submit.isPending}
              >
                <Send aria-hidden />
                {r.status === 'REWORK' ? t('resubmit') : t('submit')}
              </Button>
            )}
            {canCancel && (
              <Button variant="outline" className="text-red-fg" onClick={() => setConfirmCancel(true)}>
                <Ban aria-hidden />
                {t('cancel')}
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-3">
        {r.status !== 'DRAFT' && <Progress r={r} />}
        {r.status === 'REWORK' && own && (
          <div role="status" className="rounded-lg border border-orange-border bg-orange-bg px-3 py-2 text-[13px] text-orange-fg">
            {t('reworkHint')}
          </div>
        )}
        {r.status === 'ORDER_SIGNING' && (
          <div role="status" className="flex items-center gap-2 rounded-lg border border-purple-border bg-purple-bg px-3 py-2 text-[13px] text-purple-fg">
            <Stamp className="size-4 shrink-0" aria-hidden />
            {t('orderSigningHint')}
          </div>
        )}
        {r.status === 'DRAFT' && (
          <div role="status" className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-fg-muted">
            <Clock className="size-4 shrink-0" aria-hidden />
            {t('draftHint')}
          </div>
        )}
        {pendingMine && (
          <div role="status" className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary-soft px-3 py-2 text-[13px] font-medium text-fg">
            <FileSignature className="size-4 shrink-0 text-primary" aria-hidden />
            {t('yourActionHint')}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <DataCard r={r} />
          {r.applicationDocument && <DocumentCard requestId={r.id} kind="application" initial={r.applicationDocument} />}
          {r.orderDocument && <DocumentCard requestId={r.id} kind="order" initial={r.orderDocument} />}
          <AttachmentsCard r={r} />
        </div>
        <div className="flex flex-col gap-4">
          <TimelineCard r={r} />
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={t('cancelTitle')}
        description={t('cancelText')}
        confirmLabel={t('cancelConfirm')}
        loading={cancel.isPending}
        onConfirm={() =>
          cancel.mutate(r.id, {
            onSuccess: () => {
              toast.success(t('cancelledToast'));
              setConfirmCancel(false);
            },
            onError: (e) => toast.error(errorText(e)),
          })
        }
      />
    </>
  );
}

function PeriodText({ start, end, days }: { start: string | null; end: string | null; days: number | null }) {
  const t = useTranslations('requests.list');
  const period = usePeriodText();
  return (
    <>
      {period(start, end)}
      {days !== null && ` · ${t('daysShort', { days })}`}
    </>
  );
}
