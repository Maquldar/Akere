'use client';

import { CheckCircle2, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { FormField } from '@/components/ui/label';
import { toast } from '@/components/ui/toaster';
import { useApprovePlans } from '@/lib/api/hooks/requests';
import type { PlanRow, VacationBulkResult } from '@/lib/api/types-requests';
import { useRequestErrorText } from '../shared';

/** "Согласование: Выбрано для согласования: 8, Из них можно согласовать: 7" (deck p31), then the results. */
export function ApproveDialog({
  campaignId,
  decision,
  selected,
  onOpenChange,
  onDone,
}: {
  campaignId: string;
  decision: 'APPROVE' | 'REJECT';
  selected: PlanRow[];
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const t = useTranslations('vacation.approve');
  const tc = useTranslations('common');
  const errorText = useRequestErrorText();
  const approve = useApprovePlans(campaignId);
  const [comment, setComment] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);
  const [result, setResult] = useState<VacationBulkResult | null>(null);
  const eligible = selected.filter((r) => r.canApprove && r.status === 'SUBMITTED');
  const names = new Map(selected.map((r) => [r.employee.employeeId, r.employee.fullName]));

  const run = () => {
    if (decision === 'REJECT' && !comment.trim()) {
      setCommentError(t('commentRequired'));
      return;
    }
    approve.mutate(
      { employeeIds: eligible.map((r) => r.employee.employeeId), decision, comment: comment.trim() || undefined },
      {
        onSuccess: (res) => {
          setResult(res);
          onDone();
          if (res.succeeded.length) toast.success(t(decision === 'APPROVE' ? 'approvedToast' : 'rejectedToast', { count: res.succeeded.length }));
        },
        onError: (e) => toast.error(errorText(e)),
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={decision === 'APPROVE' ? t('titleApprove') : t('titleReject')}
      size="sm"
      dismissible={!approve.isPending}
      footer={
        result ? (
          <Button onClick={() => onOpenChange(false)}>{tc('close')}</Button>
        ) : (
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={approve.isPending}>
              {tc('cancel')}
            </Button>
            <Button variant={decision === 'REJECT' ? 'danger' : 'primary'} onClick={run} loading={approve.isPending} disabled={eligible.length === 0}>
              {decision === 'APPROVE' ? t('approve') : t('reject')}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="flex flex-col gap-3 text-[13px]" data-testid="approve-result">
          <p className="flex items-center gap-2 font-medium text-green-fg">
            <CheckCircle2 className="size-4" aria-hidden />
            {t('succeeded', { count: result.succeeded.length })}
          </p>
          {result.failed.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="flex items-center gap-2 font-medium text-red-fg">
                <XCircle className="size-4" aria-hidden />
                {t('failed', { count: result.failed.length })}
              </p>
              <ul className="flex flex-col gap-1 rounded-lg border border-border bg-surface-muted p-2.5">
                {result.failed.map((f, i) => {
                  const id = f.employeeId ?? f.id ?? '';
                  return (
                    <li key={i}>
                      <span className="font-medium text-fg">{names.get(id) ?? id}</span>: <span className="text-fg-muted">{f.reason}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <dl className="grid gap-2 text-sm" data-testid="approve-summary">
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">{t('selected')}</dt>
              <dd className="font-semibold text-fg tabular">{selected.length}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">{decision === 'APPROVE' ? t('canApprove') : t('canReject')}</dt>
              <dd className="font-semibold text-fg tabular">{eligible.length}</dd>
            </div>
          </dl>
          {eligible.length < selected.length && <p className="text-[13px] text-fg-subtle">{t('skippedHint')}</p>}
          <FormField label={decision === 'REJECT' ? t('comment') : t('commentOptional')} required={decision === 'REJECT'} error={commentError}>
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} rows={2} />
          </FormField>
        </div>
      )}
    </Dialog>
  );
}
