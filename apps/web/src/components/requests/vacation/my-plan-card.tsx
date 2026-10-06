'use client';

import { Info, Save, Send } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { isApiError } from '@/lib/api/errors';
import { useMyPlan } from '@/lib/api/hooks/requests';
import type { CampaignView, PlanRow } from '@/lib/api/types-requests';
import { formatDate } from '@/lib/format';
import { formatDays, PlanStatusPill } from '../shared';
import { usePlanActions } from './plan-dialog';
import { PeriodsEditor, PlannedMeter, toEditable, type EditablePeriod } from './periods-editor';

function MyPlanEditor({ campaign, row }: { campaign: CampaignView; row: PlanRow }) {
  const t = useTranslations('vacation.myPlan');
  const locale = useLocale();
  const [periods, setPeriods] = useState<EditablePeriod[]>(() => toEditable(row.periods));
  const key = JSON.stringify(row.periods);
  // Server data changed (saved / approved elsewhere) → reset the editor.
  useEffect(() => {
    setPeriods(toEditable(row.periods));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const actions = usePlanActions(campaign, row);
  const live = actions.validate(periods, row.periods, row.entitlement, campaign.year, false);
  const editable = campaign.status === 'ACTIVE' && row.status !== 'APPROVED';
  const busy = actions.saving;

  return (
    <CardBody className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <span className="text-[13px] text-fg-muted">{t('entitlement')}</span>
          <span className="text-xl font-semibold text-fg tabular">{t('daysValue', { days: formatDays(row.entitlement, locale) })}</span>
        </div>
        <div className="sm:col-span-2">
          <PlannedMeter planned={live.total} entitlement={row.entitlement} />
        </div>
      </div>
      {row.comment && (
        <p className="rounded-md border border-border bg-surface-muted px-3 py-2 text-[13px] text-fg-muted">
          {t('comment')}: <span className="text-fg">{row.comment}</span>
        </p>
      )}
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
      <p className="flex gap-2 text-xs text-fg-subtle">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {t('rule14')}
      </p>
      {actions.serverError && (
        <p role="alert" className="rounded-md border border-red-border bg-red-bg px-3 py-2 text-[13px] text-red-fg">
          {actions.serverError}
        </p>
      )}
      {editable ? (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => actions.persist(periods, false)} loading={busy} disabled={busy}>
            <Save aria-hidden />
            {t('save')}
          </Button>
          <Button onClick={() => actions.persist(periods, true)} loading={busy} disabled={busy}>
            <Send aria-hidden />
            {row.status === 'SUBMITTED' ? t('resubmit') : t('submit')}
          </Button>
        </div>
      ) : (
        <p className="text-[13px] text-fg-muted">{row.status === 'APPROVED' ? t('approvedLocked') : t('campaignNotActive')}</p>
      )}
    </CardBody>
  );
}

/** Employee's own plan for the selected campaign. */
export function MyPlanCard({ campaign }: { campaign: CampaignView }) {
  const t = useTranslations('vacation.myPlan');
  const locale = useLocale();
  const plan = useMyPlan(campaign.id);
  if (plan.isError && isApiError(plan.error) && (plan.error.code === 'NOT_FOUND' || plan.error.code === 'FORBIDDEN')) return null;
  return (
    <Card className="mb-5" data-testid="my-plan">
      <CardHeader
        title={t('title', { year: campaign.year })}
        actions={
          <div className="flex items-center gap-2">
            {campaign.deadline && <span className="hidden text-xs text-fg-subtle sm:inline">{t('deadline', { date: formatDate(campaign.deadline, locale) })}</span>}
            {plan.data && <PlanStatusPill status={plan.data.status} />}
          </div>
        }
      />
      {plan.isLoading ? (
        <CardBody className="flex flex-col gap-3">
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </CardBody>
      ) : plan.isError ? (
        <ErrorState error={plan.error} onRetry={() => plan.refetch()} compact />
      ) : plan.data ? (
        <MyPlanEditor campaign={campaign} row={plan.data} />
      ) : null}
    </Card>
  );
}
