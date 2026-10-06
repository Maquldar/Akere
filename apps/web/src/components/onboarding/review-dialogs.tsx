'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { FormError, FormField } from '@/components/ui/label';
import { Select, SELECT_NONE } from '@/components/ui/select';
import type { CandidateCheck, CandidateDocumentView, ReviewInput } from '@/lib/api/types-onboarding';
import { docTypeName } from './model';

type Decision = ReviewInput['decision'];

const CHECK_OPTIONS: Record<Decision, CandidateCheck[]> = {
  ACCEPT: ['RECOMMENDED', 'CONDITIONAL', 'NOT_RECOMMENDED'],
  RETURN: ['ON_REVIEW', 'RECOMMENDED', 'CONDITIONAL', 'NOT_RECOMMENDED'],
  REJECT: ['NOT_RECOMMENDED', 'CONDITIONAL', 'RECOMMENDED'],
};
const DEFAULT_CHECK: Record<Decision, string> = { ACCEPT: 'RECOMMENDED', RETURN: SELECT_NONE, REJECT: 'NOT_RECOMMENDED' };

/** One dialog for the three review decisions (Принять / На доработку / Отклонить). */
export function ReviewDialog({
  decision,
  onClose,
  documents,
  onSubmit,
  pending,
  serverError,
}: {
  decision: Decision | null;
  onClose: () => void;
  documents: CandidateDocumentView[];
  onSubmit: (input: ReviewInput) => void;
  pending: boolean;
  serverError: string | null;
}) {
  const t = useTranslations('onboarding.review');
  const te = useTranslations('onboarding.enums.check');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [comment, setComment] = useState('');
  const [check, setCheck] = useState<string>(SELECT_NONE);
  const [docIds, setDocIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<{ comment?: string; docs?: string }>({});

  useEffect(() => {
    if (!decision) return;
    setComment('');
    setCheck(DEFAULT_CHECK[decision]);
    setDocIds([]);
    setErrors({});
  }, [decision]);

  if (!decision) return null;

  const submit = () => {
    const errs: typeof errors = {};
    if (decision === 'RETURN') {
      if (!comment.trim()) errs.comment = t('commentRequired');
      if (!docIds.length) errs.docs = t('docsRequired');
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    onSubmit({
      decision,
      comment: comment.trim() || undefined,
      checkStatus: check === SELECT_NONE ? undefined : (check as CandidateCheck),
      returnDocIds: decision === 'RETURN' ? docIds : undefined,
    });
  };

  const title = decision === 'ACCEPT' ? t('acceptTitle') : decision === 'RETURN' ? t('returnTitle') : t('rejectTitle');
  const description = decision === 'ACCEPT' ? t('acceptText') : decision === 'RETURN' ? t('returnText') : t('rejectText');
  const confirm = decision === 'ACCEPT' ? t('accept') : decision === 'RETURN' ? t('return') : t('reject');

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={description}
      dismissible={!pending}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {tc('cancel')}
          </Button>
          <Button variant={decision === 'REJECT' ? 'danger' : 'primary'} onClick={submit} loading={pending}>
            {confirm}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <FormError message={serverError} />
        {decision === 'RETURN' && (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-[13px] font-medium text-fg">
              {t('docsToReturn')}
              <span className="ml-0.5 text-red-fg" aria-hidden>
                *
              </span>
            </legend>
            <div className="grid max-h-56 gap-2 overflow-y-auto rounded-lg border border-border p-3">
              {documents.map((d) => (
                <Checkbox
                  key={d.id}
                  label={docTypeName(d.docType, locale)}
                  checked={docIds.includes(d.id)}
                  onCheckedChange={(v) => setDocIds((cur) => (v === true ? [...cur, d.id] : cur.filter((x) => x !== d.id)))}
                />
              ))}
            </div>
            {errors.docs && (
              <p role="alert" className="text-xs font-medium text-red-fg">
                {errors.docs}
              </p>
            )}
          </fieldset>
        )}
        <FormField label={t('comment')} required={decision === 'RETURN'} error={errors.comment} hint={decision === 'RETURN' ? t('commentHint') : undefined}>
          <Textarea value={comment} maxLength={2000} onChange={(e) => setComment(e.target.value)} rows={3} />
        </FormField>
        <FormField label={t('checkStatus')}>
          <Select
            value={check}
            onValueChange={setCheck}
            options={[
              ...(decision === 'RETURN' ? [{ value: SELECT_NONE, label: t('keepCheck') }] : []),
              ...CHECK_OPTIONS[decision].map((c) => ({ value: c, label: te(c) })),
            ]}
          />
        </FormField>
      </div>
    </Dialog>
  );
}
