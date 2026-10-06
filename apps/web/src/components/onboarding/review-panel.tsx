'use client';

import { Check, CircleAlert, FileSearch, Paperclip, RotateCcw, Save, ShieldCheck, Wand2, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { StatusPill } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { isApiError } from '@/lib/api/errors';
import { useCandidateRequest, useReview, useSaveCandidateDoc, useUploadCandidateDocFile } from '@/lib/api/hooks/onboarding';
import type { CandidateDetail, CandidateDocumentView, ReviewInput } from '@/lib/api/types-onboarding';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DocFiles } from './doc-files';
import { AnswersList, DynamicFields } from './dynamic-fields';
import { docFields, docStatusTone, docTypeName, fromDraft, isDraftDirty, omitKey, toDraft } from './model';
import { DocRequestPill } from './pills';
import { ReviewDialog } from './review-dialogs';

type Drafts = Record<string, Record<string, unknown>>;
type DocErrors = Record<string, Record<string, string>>;

function errorsFrom(e: unknown): Record<string, string> | null {
  if (!isApiError(e) || e.code !== 'VALIDATION_ERROR') return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(e.fieldErrors)) if (v?.[0]) out[k.replace(/^values\./, '')] = v[0];
  return out;
}

/** "Запрос документов" tab (M1 p10–14): HR review of the candidate package. */
export function ReviewPanel({ candidate, canManage, onRequestDocuments }: { candidate: CandidateDetail; canManage: boolean; onRequestDocuments?: () => void }) {
  const t = useTranslations('onboarding.review');
  const td = useTranslations('onboarding.enums.docStatus');
  const tcs = useTranslations('onboarding.enums.consent');
  const tc = useTranslations('common');
  const locale = useLocale();
  const request = useCandidateRequest(candidate.id);
  const saveDoc = useSaveCandidateDoc(candidate.id);
  const upload = useUploadCandidateDocFile(candidate.id);
  const review = useReview(candidate.id);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [docErrors, setDocErrors] = useState<DocErrors>({});
  const [savingAll, setSavingAll] = useState(false);
  const [decision, setDecision] = useState<ReviewInput['decision'] | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const r = request.data;
  const editable = canManage && !candidate.employeeId;
  const docs = useMemo(() => r?.documents ?? [], [r]);
  const dirtyDocs = docs.filter((d) => isDraftDirty(docFields(d), drafts[d.id], d.values));

  const saveOne = async (d: CandidateDocumentView, opts: { silent?: boolean } = {}) => {
    const fields = docFields(d);
    const values = fromDraft(fields, drafts[d.id] ?? toDraft(fields, d.values), d.values);
    if (!Object.keys(values).length) return true;
    try {
      await saveDoc.mutateAsync({ docId: d.id, values });
      setDrafts((cur) => omitKey(cur, d.id));
      setDocErrors((cur) => omitKey(cur, d.id));
      if (!opts.silent) toast.success(t('docSaved', { name: docTypeName(d.docType, locale) }));
      return true;
    } catch (e) {
      const errs = errorsFrom(e);
      if (errs) setDocErrors((cur) => ({ ...cur, [d.id]: errs }));
      toast.error(errs ? t('fixErrors', { name: docTypeName(d.docType, locale) }) : isApiError(e) ? e.message : tc('error'));
      return false;
    }
  };

  const saveAll = async () => {
    if (!dirtyDocs.length) {
      toast.info(t('nothingToSave'));
      return true;
    }
    setSavingAll(true);
    try {
      let okAll = true;
      for (const d of dirtyDocs) okAll = (await saveOne(d, { silent: true })) && okAll;
      if (okAll) toast.success(t('allSaved', { count: dirtyDocs.length }));
      return okAll;
    } finally {
      setSavingAll(false);
    }
  };

  const submitReview = async (input: ReviewInput) => {
    setReviewError(null);
    if (dirtyDocs.length && !(await saveAll())) {
      setReviewError(t('saveFirst'));
      return;
    }
    try {
      await review.mutateAsync(input);
      toast.success(input.decision === 'ACCEPT' ? t('acceptedToast') : input.decision === 'RETURN' ? t('returnedToast') : t('rejectedToast'));
      setDecision(null);
    } catch (e) {
      setReviewError(isApiError(e) ? e.message : tc('error'));
    }
  };

  if (request.isLoading) {
    return (
      <div className="grid gap-3" aria-busy>
        <Skeleton className="h-16 w-full" />
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (request.error) {
    if (isApiError(request.error) && request.error.code === 'NOT_FOUND') {
      return (
        <Card>
          <EmptyState
            icon={<FileSearch aria-hidden />}
            title={t('noRequest')}
            description={t('noRequestHint')}
            action={
              canManage && onRequestDocuments && !candidate.employeeId && candidate.status !== 'BLOCKED' ? (
                <Button size="sm" onClick={onRequestDocuments}>
                  {t('requestNow')}
                </Button>
              ) : undefined
            }
          />
        </Card>
      );
    }
    return (
      <Card>
        <ErrorState error={request.error} onRetry={() => request.refetch()} />
      </Card>
    );
  }
  if (!r) return null;

  const canDecide = editable && r.status === 'UPLOADED';
  const canReject = editable && candidate.status !== 'BLOCKED';
  const consentTone = r.consentStatus === 'GRANTED' ? 'green' : r.consentStatus === 'DENIED' ? 'red' : r.consentStatus === 'REQUESTED' ? 'orange' : 'gray';

  return (
    <div className="grid gap-4">
      {/* Summary + actions */}
      <Card>
        <div className="flex flex-col gap-3 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid min-w-0 gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-semibold text-fg">{r.template.name}</h2>
              <DocRequestPill value={r.status} />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-fg-muted">
              <span>{t('sentAt', { date: formatDateTime(r.createdAt, locale) })}</span>
              {r.readyAt && <span>{t('readyAt', { date: formatDateTime(r.readyAt, locale) })}</span>}
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="size-3.5" aria-hidden />
                {t('consent')}:
                <StatusPill variant="dot" tone={consentTone}>
                  {tcs(r.consentStatus)}
                </StatusPill>
              </span>
            </div>
          </div>
          {editable && (
            <div className="flex flex-wrap gap-2 lg:shrink-0 lg:flex-nowrap">
              <Button
                variant="outline"
                className="border-red-border text-red-fg hover:bg-red-bg"
                disabled={!canReject}
                onClick={() => {
                  setReviewError(null);
                  setDecision('REJECT');
                }}
              >
                <X />
                {t('reject')}
              </Button>
              <Button
                variant="outline"
                disabled={!canDecide}
                onClick={() => {
                  setReviewError(null);
                  setDecision('RETURN');
                }}
              >
                <RotateCcw />
                {t('return')}
              </Button>
              <Button
                disabled={!canDecide}
                onClick={() => {
                  setReviewError(null);
                  setDecision('ACCEPT');
                }}
              >
                <Check />
                {t('accept')}
              </Button>
              <Button variant="secondary" onClick={() => void saveAll()} loading={savingAll} disabled={!dirtyDocs.length}>
                {!savingAll && <Save />}
                {t('save')}
                {dirtyDocs.length > 0 && <span className="tabular">({dirtyDocs.length})</span>}
              </Button>
            </div>
          )}
        </div>
        {editable && !canDecide && r.status !== 'COMPLETED' && (
          <p className="border-t border-border px-4 py-2.5 text-[13px] text-fg-muted sm:px-5">{t('waitingCandidate')}</p>
        )}
        {r.reviewComment && (
          <div className="flex items-start gap-2 border-t border-border px-4 py-2.5 text-[13px] sm:px-5">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-orange-fg" aria-hidden />
            <p className="text-fg">
              <span className="font-medium">{t('lastComment')}:</span> {r.reviewComment}
            </p>
          </div>
        )}
      </Card>

      {/* Documents */}
      <section aria-labelledby="docs-heading" className="grid gap-2">
        <h2 id="docs-heading" className="section-label px-1">
          {t('documents', { count: docs.length })}
        </h2>
        <Accordion type="multiple" className="grid gap-2">
          {docs.map((d) => {
            const fields = docFields(d);
            const draft = drafts[d.id] ?? toDraft(fields, d.values);
            const dirty = isDraftDirty(fields, drafts[d.id], d.values);
            return (
              <AccordionItem key={d.id} value={d.id} className="overflow-hidden rounded-xl border border-border bg-surface shadow-card last:border-b">
                <AccordionTrigger
                  className="min-h-[52px] gap-2"
                  extra={
                    <span className="flex shrink-0 items-center gap-2">
                      {d.files.length > 0 && (
                        <span className="hidden items-center gap-0.5 text-xs text-fg-subtle sm:inline-flex" aria-label={t('filesCount', { count: d.files.length })}>
                          <Paperclip className="size-3.5" aria-hidden />
                          {d.files.length}
                        </span>
                      )}
                      {d.autoFilledKeys.length > 0 && (
                        <span className="inline-flex text-purple-fg" title={t('autoFilledDoc')}>
                          <Wand2 className="size-4" aria-label={t('autoFilledDoc')} />
                        </span>
                      )}
                      <StatusPill tone={docStatusTone[d.status]} className="hidden sm:inline-flex">
                        {td(d.status)}
                      </StatusPill>
                    </span>
                  }
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate">{docTypeName(d.docType, locale)}</span>
                    {d.required && (
                      <span className="text-red-fg" aria-label={t('required')}>
                        *
                      </span>
                    )}
                    {dirty && <span className="size-1.5 shrink-0 rounded-full bg-orange-solid" aria-label={t('unsaved')} />}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="border-t border-border pt-4 text-fg">
                  {d.returnComment && d.status === 'RETURNED' && (
                    <p className="mb-4 rounded-lg border border-red-border bg-red-bg px-3 py-2 text-[13px] text-red-fg">
                      {t('returnedWith', { comment: d.returnComment })}
                    </p>
                  )}
                  <div className={cn('grid gap-6', fields.length > 0 && 'lg:grid-cols-2')}>
                    <div className="grid min-w-0 content-start gap-2">
                      <h3 className="text-sm font-semibold text-fg">{t('uploadTitle')}</h3>
                      <DocFiles
                        files={d.files}
                        canUpload={editable}
                        onUpload={editable ? (file, onProgress) => upload.mutateAsync({ docId: d.id, file, onProgress }) : undefined}
                      />
                    </div>
                    {fields.length > 0 && (
                      <div className="grid min-w-0 content-start gap-3">
                        <h3 className="text-sm font-semibold text-fg">{t('fieldsTitle')}</h3>
                        <DynamicFields
                          idPrefix={`doc-${d.id}`}
                          fields={fields}
                          values={draft}
                          autoFilledKeys={d.autoFilledKeys}
                          errors={docErrors[d.id]}
                          disabled={!editable}
                          onChange={(key, value) => setDrafts((cur) => ({ ...cur, [d.id]: { ...(cur[d.id] ?? toDraft(fields, d.values)), [key]: value } }))}
                        />
                        {editable && (
                          <div className="flex justify-end gap-2 pt-1">
                            {dirty && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setDrafts((cur) => omitKey(cur, d.id));
                                  setDocErrors((cur) => omitKey(cur, d.id));
                                }}
                              >
                                {t('discard')}
                              </Button>
                            )}
                            <Button size="sm" variant="outline" disabled={!dirty} loading={saveDoc.isPending && saveDoc.variables?.docId === d.id} onClick={() => void saveOne(d)}>
                              {t('saveDoc')}
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </section>

      {r.questionnaire && (
        <Card>
          <CardHeader title={t('questionnaire', { name: r.questionnaire.name })} />
          <CardBody>
            {Object.keys(r.questionnaireAnswers).length ? (
              <AnswersList fields={r.questionnaire.fields} values={r.questionnaireAnswers} />
            ) : (
              <p className="text-[13px] text-fg-subtle">{t('noAnswers')}</p>
            )}
          </CardBody>
        </Card>
      )}

      <ReviewDialog
        decision={decision}
        onClose={() => setDecision(null)}
        documents={docs}
        onSubmit={(input) => void submitReview(input)}
        pending={review.isPending || savingAll}
        serverError={reviewError}
      />
    </div>
  );
}
