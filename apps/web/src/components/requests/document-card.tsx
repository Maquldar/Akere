'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, CheckCircle2, Circle, CornerUpLeft, ExternalLink, Eye, FileSignature, FileText, Loader2, XCircle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { StatusPill } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { FormField } from '@/components/ui/label';
import { toast } from '@/components/ui/toaster';
import { Link } from '@/i18n/navigation';
import { apiFetch } from '@/lib/api/client';
import { useDocumentDecision, type DocDecision } from '@/lib/api/hooks/requests';
import type { ReqDocument, ReqRouteStep } from '@/lib/api/types-requests';
import { formatDate, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { docStatusTone, stepStatusTone, useRequestErrorText } from './shared';

function StepIcon({ step }: { step: ReqRouteStep }) {
  const cls = 'size-4 shrink-0';
  if (step.status === 'DONE') return <CheckCircle2 className={cn(cls, 'text-green-solid')} aria-hidden />;
  if (step.status === 'REJECTED') return <XCircle className={cn(cls, 'text-red-solid')} aria-hidden />;
  if (step.status === 'RETURNED') return <CornerUpLeft className={cn(cls, 'text-orange-solid')} aria-hidden />;
  if (step.status === 'PENDING') return <Loader2 className={cn(cls, 'text-blue-solid')} aria-hidden />;
  return <Circle className={cn(cls, 'text-gray-solid')} aria-hidden />;
}

/** Route steps list: "Руководитель — Ожидается согласование • Просмотрено 17 сент. 14:32". */
export function RouteSteps({ steps }: { steps: ReqRouteStep[] }) {
  const t = useTranslations('requests.route');
  const locale = useLocale();
  const sorted = steps.slice().sort((a, b) => a.order - b.order);
  if (sorted.length === 0) return <p className="text-[13px] text-fg-subtle">{t('noSteps')}</p>;
  return (
    <ol className="flex flex-col">
      {sorted.map((s, i) => (
        <li key={s.id} className="relative flex gap-3 pb-4 last:pb-0">
          {i < sorted.length - 1 && <span className="absolute left-[7.5px] top-5 h-[calc(100%-16px)] w-px bg-border" aria-hidden />}
          <span className="mt-0.5">
            <StepIcon step={s} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Avatar name={s.assignee.fullName} size="xs" />
              <span className="text-[13px] font-medium text-fg">{s.assignee.fullName}</span>
              <StatusPill tone={stepStatusTone[s.status] ?? 'gray'} variant="dot">
                {s.status === 'PENDING' ? t(`pending.${s.action}`) : s.status === 'DONE' ? t(`done.${s.action}`) : t(`status.${s.status}`)}
              </StatusPill>
            </div>
            <div className="text-xs text-fg-subtle">
              {[s.assignee.position, t(`action.${s.action}`)].filter(Boolean).join(' · ')}
            </div>
            <div className="flex flex-wrap gap-x-3 text-xs text-fg-subtle tabular">
              {s.actedAt && <span>{formatDateTime(s.actedAt, locale)}</span>}
              {s.status === 'PENDING' && s.viewedAt && (
                <span className="inline-flex items-center gap-1">
                  <Eye className="size-3" aria-hidden />
                  {t('viewed', { at: formatDateTime(s.viewedAt, locale) })}
                </span>
              )}
              {s.status === 'PENDING' && s.dueAt && <span>{t('due', { at: formatDate(s.dueAt, locale) })}</span>}
              {s.actedBy && s.actedBy.id !== s.assignee.id && <span>{t('actedBy', { name: s.actedBy.fullName })}</span>}
            </div>
            {s.comment && <p className="mt-1 rounded-md bg-surface-hover px-2.5 py-1.5 text-[13px] text-fg">{s.comment}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function DecisionDialog({
  open,
  onOpenChange,
  decision,
  onConfirm,
  loading,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  decision: DocDecision;
  onConfirm: (comment: string) => void;
  loading: boolean;
}) {
  const t = useTranslations('requests.decision');
  const tc = useTranslations('common');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const needsComment = decision !== 'approve';
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setComment('');
          setError(null);
        }
        onOpenChange(o);
      }}
      title={t(`${decision}Title`)}
      description={t(`${decision}Text`)}
      size="sm"
      dismissible={!loading}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {tc('cancel')}
          </Button>
          <Button
            variant={decision === 'reject' ? 'danger' : 'primary'}
            loading={loading}
            onClick={() => {
              if (needsComment && !comment.trim()) {
                setError(t('commentRequired'));
                return;
              }
              onConfirm(comment.trim());
            }}
          >
            {t(decision)}
          </Button>
        </>
      }
    >
      <FormField label={needsComment ? t('comment') : t('commentOptional')} required={needsComment} error={error}>
        <Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} rows={3} />
      </FormField>
    </Dialog>
  );
}

/**
 * Application/order document with its route. Re-fetches /documents/:id (marks the viewer's pending step
 * as viewed) and offers inline Согласовать / Вернуть / Отклонить when the viewer has a pending APPROVE step.
 */
export function DocumentCard({ requestId, kind, initial }: { requestId: string; kind: 'application' | 'order'; initial: ReqDocument }) {
  const t = useTranslations('requests.docs');
  const td = useTranslations('requests.docStatus');
  const td2 = useTranslations('requests.decision');
  const locale = useLocale();
  const errorText = useRequestErrorText();
  const doc = useQuery({
    queryKey: ['documents', initial.id],
    queryFn: ({ signal }) => apiFetch<ReqDocument>(`/documents/${initial.id}`, { signal }),
    initialData: initial,
    initialDataUpdatedAt: 0,
    staleTime: 0,
    retry: false,
  });
  const d = doc.data ?? initial;
  const decide = useDocumentDecision(requestId);
  const [decision, setDecision] = useState<DocDecision | null>(null);
  const mine = d.myPendingAction;
  const pdfHref = d.signedPdfUrl ?? d.pdfUrl;

  const act = (dec: DocDecision, comment?: string) =>
    decide.mutate(
      { documentId: d.id, decision: dec, comment },
      {
        onSuccess: () => {
          toast.success(td2(`${dec}Done`));
          setDecision(null);
          void doc.refetch();
        },
        onError: (e) => toast.error(errorText(e)),
      },
    );

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <FileText className="size-4 text-fg-subtle" aria-hidden />
            {kind === 'application' ? t('application') : t('order')}
          </span>
        }
        titleAs="h3"
        actions={<StatusPill tone={docStatusTone[d.status] ?? 'gray'}>{td(d.status)}</StatusPill>}
      />
      <CardBody className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <div className="text-sm font-medium text-fg">
            {d.title}
            {d.number && <span className="text-fg-muted"> · {t('number', { number: d.number })}</span>}
          </div>
          <div className="text-xs text-fg-subtle tabular">
            {t('created', { date: formatDate(d.registeredAt ?? d.createdAt, locale) })}
            {d.currentStep && ` · ${t('waitingFor', { name: d.currentStep.assignee.fullName })}`}
          </div>
        </div>

        {mine && (
          <div className="flex flex-col gap-2 rounded-lg border border-primary/20 bg-primary-soft p-3">
            <p className="text-[13px] font-medium text-fg">{t(`yourTurn.${mine}`)}</p>
            <div className="flex flex-wrap gap-2">
              {mine === 'APPROVE' && (
                <>
                  <Button size="sm" onClick={() => setDecision('approve')} disabled={decide.isPending}>
                    <Check aria-hidden />
                    {td2('approve')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setDecision('return')} disabled={decide.isPending}>
                    <CornerUpLeft aria-hidden />
                    {td2('return')}
                  </Button>
                  <Button size="sm" variant="outline" className="text-red-fg" onClick={() => setDecision('reject')} disabled={decide.isPending}>
                    <XCircle aria-hidden />
                    {td2('reject')}
                  </Button>
                </>
              )}
              {mine === 'ACKNOWLEDGE' && (
                <Button size="sm" onClick={() => act('approve')} loading={decide.isPending}>
                  <Check aria-hidden />
                  {td2('acknowledge')}
                </Button>
              )}
              {(mine === 'SIGN' || mine === 'ACKNOWLEDGE') && (
                <Button size="sm" variant={mine === 'SIGN' ? 'primary' : 'outline'} asChild>
                  <Link href={`/documents/${d.id}`}>
                    <FileSignature aria-hidden />
                    {td2('sign')}
                  </Link>
                </Button>
              )}
            </div>
          </div>
        )}

        <RouteSteps steps={d.steps ?? []} />

        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <Button size="sm" variant="outline" asChild>
            <Link href={`/documents/${d.id}`}>
              <ExternalLink aria-hidden />
              {t('open')}
            </Link>
          </Button>
          {pdfHref && (
            <Button size="sm" variant="ghost" asChild>
              <a href={pdfHref} target="_blank" rel="noreferrer">
                <FileText aria-hidden />
                {d.signedPdfUrl ? t('signedPdf') : t('pdf')}
              </a>
            </Button>
          )}
        </div>
      </CardBody>
      {decision && decision !== 'approve' ? (
        <DecisionDialog
          open
          onOpenChange={(o) => !o && setDecision(null)}
          decision={decision}
          loading={decide.isPending}
          onConfirm={(c) => act(decision, c)}
        />
      ) : (
        <DecisionDialog
          open={decision === 'approve'}
          onOpenChange={(o) => !o && setDecision(null)}
          decision="approve"
          loading={decide.isPending}
          onConfirm={(c) => act('approve', c || undefined)}
        />
      )}
    </Card>
  );
}
