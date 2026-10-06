'use client';

import { Check, ChevronsRight, Circle, Minus, RotateCcw, UserCheck, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { DocumentStatus, RouteStepView, SignMethod } from '@/lib/api/types-documents';
import { formatDate, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const methodLabel: Record<SignMethod, string> = {
  EGOV_MOBILE: 'eGov mobile',
  EGOV_BUSINESS: 'eGov mobile Business',
  NCALAYER: 'NCALayer',
  PAPER: '',
  CLICK: '',
};

function StepIcon({ step }: { step: RouteStepView }) {
  const base = 'relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full ring-4 ring-surface';
  switch (step.status) {
    case 'DONE':
      return (
        <span className={cn(base, 'bg-green-solid text-white')}>
          <Check className="size-3.5" strokeWidth={3} aria-hidden />
        </span>
      );
    case 'PENDING':
      return (
        <span className={cn(base, 'bg-primary-soft text-primary')}>
          <ChevronsRight className="size-4" strokeWidth={2.5} aria-hidden />
        </span>
      );
    case 'RETURNED':
      return (
        <span className={cn(base, 'bg-orange-bg text-orange-fg')}>
          <RotateCcw className="size-3.5" strokeWidth={2.5} aria-hidden />
        </span>
      );
    case 'REJECTED':
      return (
        <span className={cn(base, 'bg-red-bg text-red-fg')}>
          <X className="size-3.5" strokeWidth={3} aria-hidden />
        </span>
      );
    case 'SKIPPED':
      return (
        <span className={cn(base, 'bg-surface-hover text-fg-subtle')}>
          <Minus className="size-3.5" aria-hidden />
        </span>
      );
    default:
      return (
        <span className={cn(base, 'bg-surface text-border-strong')}>
          <Circle className="size-3.5" aria-hidden />
        </span>
      );
  }
}

function Chip({ children, tone = 'gray' }: { children: ReactNode; tone?: 'gray' | 'red' | 'blue' }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full flex-wrap items-center gap-x-1 rounded-md border px-2 py-0.5 text-xs',
        tone === 'gray' && 'border-border bg-surface-muted text-fg-muted',
        tone === 'red' && 'border-red-border bg-red-bg text-red-fg',
        tone === 'blue' && 'border-blue-border bg-blue-bg text-blue-fg',
      )}
    >
      {children}
    </span>
  );
}

function StepRow({ step, last }: { step: RouteStepView; last: boolean }) {
  const t = useTranslations('documents.route');
  const locale = useLocale();
  // Deputy case: the deputy acted; show them as the actor and the principal in the note (deck p22).
  const deputyActed = step.actedBy && step.actedBy.id !== step.assignee.id;
  const person = deputyActed ? step.actedBy! : step.assignee;
  const overdue = step.status === 'PENDING' && step.dueAt && new Date(step.dueAt) < new Date();
  const method = step.signatureMethod ? methodLabel[step.signatureMethod] : '';
  const sub = [person.position, person.department].filter(Boolean).join(', ');

  let chip: ReactNode = null;
  if (step.status === 'DONE' && step.actedAt) {
    chip = (
      <Chip>
        {t(`done_${step.action}`, { date: formatDateTime(step.actedAt, locale) })}
        {method && <span className="text-fg-subtle">· {method}</span>}
        {step.signatureMethod === 'PAPER' && <span className="text-fg-subtle">· {t('paper')}</span>}
      </Chip>
    );
  } else if (step.status === 'PENDING') {
    chip = (
      <Chip tone={overdue ? 'red' : 'blue'}>
        {t(`pending_${step.action}`)}
        {step.viewedAt && <span>• {t('viewed', { date: formatDateTime(step.viewedAt, locale) })}</span>}
        {step.dueAt && <span>• {t(overdue ? 'overdueSince' : 'due', { date: formatDate(step.dueAt, locale) })}</span>}
      </Chip>
    );
  } else if (step.status === 'RETURNED') {
    chip = <Chip>{t('returned', { date: step.actedAt ? formatDateTime(step.actedAt, locale) : '' })}</Chip>;
  } else if (step.status === 'REJECTED') {
    chip = <Chip tone="red">{t('rejected', { date: step.actedAt ? formatDateTime(step.actedAt, locale) : '' })}</Chip>;
  } else if (step.status === 'SKIPPED') {
    chip = <Chip>{t('skipped')}</Chip>;
  } else {
    chip = <Chip>{t(`waiting_${step.action}`)}</Chip>;
  }

  return (
    <li className="relative flex gap-3 pb-5 last:pb-0" data-testid="route-step" data-status={step.status}>
      {!last && <span className="absolute left-3 top-6 h-[calc(100%-12px)] w-px -translate-x-1/2 bg-border" aria-hidden />}
      <StepIcon step={step} />
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="text-sm font-medium text-fg">{person.fullName}</div>
        {sub && <div className="text-xs text-fg-subtle">{sub}</div>}
        <div className="mt-1.5 flex flex-col items-start gap-1.5">
          {chip}
          {deputyActed && (
            <span className="inline-flex items-start gap-1.5 text-xs text-orange-fg">
              <UserCheck className="mt-px size-3.5 shrink-0" aria-hidden />
              <span>
                {t('isDeputy')} <span className="font-medium">{(step.onBehalfOf ?? step.assignee).shortName}</span>
              </span>
            </span>
          )}
          {step.comment && (
            <blockquote className="max-w-prose border-l-2 border-border-strong pl-2 text-[13px] italic text-fg-muted">«{step.comment}»</blockquote>
          )}
        </div>
      </div>
      <span className="sr-only">{t(`status_${step.status}`)}</span>
    </li>
  );
}

/** Route of a document: signers/approvers with statuses (deck p22, p28). Same `order` = parallel. */
export function RouteTimeline({ steps, status, title }: { steps: RouteStepView[]; status: DocumentStatus; title: ReactNode }) {
  const t = useTranslations('documents.route');
  const groups = new Map<number, RouteStepView[]>();
  for (const s of [...steps].sort((a, b) => a.order - b.order)) groups.set(s.order, [...(groups.get(s.order) ?? []), s]);
  const ordered = [...groups.entries()];
  const headline =
    status === 'REWORK' ? { text: t('headRework'), cls: 'text-orange-fg' }
      : status === 'REJECTED' ? { text: t('headRejected'), cls: 'text-red-fg' }
        : status === 'COMPLETED' ? { text: t('headCompleted'), cls: 'text-green-fg' }
          : status === 'CANCELLED' ? { text: t('headCancelled'), cls: 'text-fg-subtle' }
            : status === 'DRAFT' ? { text: t('headDraft'), cls: 'text-fg-subtle' }
              : { text: t('headInRoute'), cls: 'text-blue-fg' };

  return (
    <section aria-label={t('label')}>
      <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
      <p className={cn('mt-0.5 text-[13px] font-medium', headline.cls)}>{headline.text}</p>
      {steps.length === 0 ? (
        <p className="mt-4 text-sm text-fg-subtle">{t('noRoute')}</p>
      ) : (
        <ol className="mt-4">
          {ordered.map(([order, group], gi) => (
            <li key={order} className="relative">
              {group.length > 1 && (
                <div className="mb-2 ml-9 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{t('parallel', { count: group.length })}</div>
              )}
              <ul className={cn(group.length > 1 && 'rounded-lg border border-dashed border-border p-2 pb-0 [&>li]:pb-3', gi < ordered.length - 1 && 'mb-0')}>
                {group.map((s, i) => (
                  <StepRow key={s.id} step={s} last={gi === ordered.length - 1 && i === group.length - 1} />
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
