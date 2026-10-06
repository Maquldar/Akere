'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { FormField } from '@/components/ui/label';
import { toast } from '@/components/ui/toaster';
import { isApiError } from '@/lib/api/errors';
import { useApprovePlans, useSavePlan } from '@/lib/api/hooks/requests';
import type { CampaignView, PlanRow } from '@/lib/api/types-requests';
import { formatDays, PlanStatusPill, useBulkReasonText, useRequestErrorText } from '../shared';
import { PeriodsEditor, PlannedMeter, toEditable, usePeriodValidation, type EditablePeriod, type PeriodIssues } from './periods-editor';

export function PlanRules() {
  const t = useTranslations('vacation.rules');
  return (
    <Accordion type="single" collapsible className="rounded-lg border border-border">
      <AccordionItem value="rules">
        <AccordionTrigger>{t('title')}</AccordionTrigger>
        <AccordionContent>
          <ul className="flex list-disc flex-col gap-1 pl-4">
            <li>{t('r1')}</li>
            <li>{t('r2')}</li>
            <li>{t('r3')}</li>
            <li>{t('r4')}</li>
          </ul>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

/** Shared save/submit/approve logic for a plan (own card and the modal). */
export function usePlanActions(campaign: CampaignView, row: PlanRow) {
  const t = useTranslations('vacation.plan');
  const errorText = useRequestErrorText();
  const reasonText = useBulkReasonText();
  const save = useSavePlan(campaign.id);
  const approve = useApprovePlans(campaign.id);
  const validate = usePeriodValidation();
  const [issues, setIssues] = useState<PeriodIssues | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const persist = async (periods: EditablePeriod[], submit: boolean): Promise<boolean> => {
    setServerError(null);
    const res = validate(periods, row.periods, row.entitlement, campaign.year, submit);
    setIssues(res);
    if (!res.ok) return false;
    try {
      await save.mutateAsync({
        employeeId: row.employee.employeeId,
        input: {
          periods: periods.filter((p) => p.startDate && p.endDate).map((p) => ({ startDate: p.startDate, endDate: p.endDate })),
          submit,
        },
      });
      setIssues(null);
      toast.success(submit ? t('submittedToast') : t('savedToast'));
      return true;
    } catch (e) {
      const msg = isApiError(e) && e.code === 'VALIDATION_ERROR' ? [...e.formErrors, ...Object.values(e.fieldErrors).flat()].join(' ') || errorText(e) : errorText(e);
      setServerError(msg);
      toast.error(msg);
      return false;
    }
  };

  const approveOne = async (decision: 'APPROVE' | 'REJECT', comment?: string): Promise<boolean> => {
    try {
      const res = await approve.mutateAsync({ employeeIds: [row.employee.employeeId], decision, comment });
      if (res.failed.length) {
        toast.error(reasonText(res.failed[0]!.reason));
        return false;
      }
      toast.success(decision === 'APPROVE' ? t('approvedToast') : t('rejectedToast'));
      return true;
    } catch (e) {
      toast.error(errorText(e));
      return false;
    }
  };

  return { persist, approveOne, issues, setIssues, serverError, saving: save.isPending, approving: approve.isPending, validate };
}

/** "Планирование отпуска" modal (deck p31) — for managers/HR on any row, or the employee on their own row. */
export function PlanDialog({
  campaign,
  row,
  onOpenChange,
}: {
  campaign: CampaignView;
  row: PlanRow;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('vacation.plan');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [periods, setPeriods] = useState<EditablePeriod[]>(() => toEditable(row.periods));
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);
  const actions = usePlanActions(campaign, row);
  const editable = campaign.status === 'ACTIVE' && row.status !== 'APPROVED';
  const live = actions.validate(periods, row.periods, row.entitlement, campaign.year, false);
  const busy = actions.saving || actions.approving;
  const dirty = JSON.stringify(periods.map((p) => [p.startDate, p.endDate])) !== JSON.stringify(row.periods.map((p) => [p.startDate, p.endDate]));

  const showApprove = row.canApprove && row.status === 'SUBMITTED' && !dirty;
  const close = () => onOpenChange(false);

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={t('title')}
      size="lg"
      dismissible={!busy}
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={busy}>
            {tc('cancel')}
          </Button>
          {editable && (
            <Button variant="outline" onClick={async () => (await actions.persist(periods, false)) && close()} loading={actions.saving} disabled={busy}>
              {tc('save')}
            </Button>
          )}
          {editable && !showApprove && (
            <Button onClick={async () => (await actions.persist(periods, true)) && close()} loading={actions.saving} disabled={busy}>
              {t('submit')}
            </Button>
          )}
          {showApprove && (
            <>
              <Button
                variant={rejecting ? 'danger' : 'outline'}
                className={rejecting ? undefined : 'text-red-fg'}
                onClick={async () => {
                  if (!rejecting) {
                    setRejecting(true);
                    return;
                  }
                  if (!comment.trim()) {
                    setCommentError(t('commentRequired'));
                    return;
                  }
                  if (await actions.approveOne('REJECT', comment.trim())) close();
                }}
                disabled={busy}
              >
                {t('reject')}
              </Button>
              <Button onClick={async () => (await actions.approveOne('APPROVE')) && close()} loading={actions.approving} disabled={busy}>
                {t('approve')}
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <PlanRules />
        <dl className="grid gap-3 text-[13px] sm:grid-cols-[200px_1fr]">
          <dt className="font-medium text-primary">{t('employee')}</dt>
          <dd>
            <div className="font-medium text-fg">{row.employee.fullName}</div>
            <div className="text-xs text-fg-subtle">{[row.employee.department, row.employee.position].filter(Boolean).join(', ')}</div>
          </dd>
          <dt className="font-medium text-primary">{t('toPlan')}</dt>
          <dd className="flex flex-col gap-2">
            <div className="flex justify-between gap-2 sm:justify-start sm:gap-6">
              <span className="text-fg-muted">{t('mainLeave')}</span>
              <span className="font-medium text-fg tabular">{t('daysValue', { days: formatDays(row.entitlement, locale) })}</span>
            </div>
            <PlannedMeter planned={live.total} entitlement={row.entitlement} />
          </dd>
          <dt className="font-medium text-primary">{t('status')}</dt>
          <dd>
            <PlanStatusPill status={row.status} />
            {row.comment && <p className="mt-1 text-fg-muted">{row.comment}</p>}
          </dd>
        </dl>
        <div className="flex flex-col gap-2">
          <h3 className="text-[13px] font-medium text-primary">{t('dates')}</h3>
          <PeriodsEditor
            periods={periods}
            onChange={(p) => {
              setPeriods(p);
              actions.setIssues(null);
            }}
            server={row.periods}
            year={campaign.year}
            issues={actions.issues}
            disabled={!editable || busy}
          />
          {!editable && <p className="text-[13px] text-fg-muted">{campaign.status !== 'ACTIVE' ? t('campaignNotActive') : t('approvedLocked')}</p>}
          {actions.serverError && (
            <p role="alert" className="rounded-md border border-red-border bg-red-bg px-3 py-2 text-[13px] text-red-fg">
              {actions.serverError}
            </p>
          )}
        </div>
        {rejecting && (
          <FormField label={t('rejectComment')} required error={commentError}>
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} rows={2} autoFocus />
          </FormField>
        )}
      </div>
    </Dialog>
  );
}
