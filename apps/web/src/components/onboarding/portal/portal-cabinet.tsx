'use client';

import { AlertTriangle, CheckCircle2, Circle, CircleAlert, ClipboardList, Lock, PartyPopper, Send, Wand2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { isApiError } from '@/lib/api/errors';
import {
  usePortalAutofillConsent, usePortalAutofillReply, usePortalDeleteFile, usePortalRequest, usePortalSaveDoc, usePortalSaveQuestionnaire,
  usePortalSubmit, usePortalUploadFile,
} from '@/lib/api/hooks/onboarding';
import type { CandidateDocumentView, DocumentRequestView, MissingItem, PortalMe } from '@/lib/api/types-onboarding';
import { cn } from '@/lib/utils';
import { DocFiles } from '../doc-files';
import { DynamicFields } from '../dynamic-fields';
import { docComplete, docFields, docTypeName, fromDraft, isDraftDirty, omitKey, OPEN_REQUEST, toDraft } from '../model';
import { AutofillDialog, type AutofillStage } from './autofill-dialog';

type Drafts = Record<string, Record<string, unknown>>;
type Errs = Record<string, Record<string, string>>;
const Q = '__questionnaire__';

function fieldErrorsOf(e: unknown, prefix: string): Record<string, string> | null {
  if (!isApiError(e) || e.code !== 'VALIDATION_ERROR') return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(e.fieldErrors)) if (v?.[0]) out[k.replace(new RegExp(`^${prefix}\\.`), '')] = v[0];
  return out;
}

/** Candidate cabinet (M1 p9): welcome, digital personal file autofill, documents accordion, questionnaire, submit. */
export function PortalCabinet({ me }: { me: PortalMe }) {
  const t = useTranslations('onboarding.portal');
  const tc = useTranslations('common');
  const request = usePortalRequest(true);
  const r = request.data;

  return (
    <div className="flex flex-col gap-5">
      <div className="text-center">
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.01em] text-fg sm:text-2xl">{t('welcome', { name: me.fullName })}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-fg-muted">{t('welcomeText', { company: me.legalEntity })}</p>
      </div>
      {request.isLoading ? (
        <div className="grid gap-3" aria-busy>
          <Skeleton className="h-44 w-full" />
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : request.error ? (
        isApiError(request.error) && request.error.code === 'NOT_FOUND' ? (
          <Card>
            <EmptyState icon={<ClipboardList aria-hidden />} title={t('noRequest')} description={t('noRequestHint')} />
          </Card>
        ) : (
          <Card>
            <ErrorState error={request.error} onRetry={() => request.refetch()} />
          </Card>
        )
      ) : r ? (
        <RequestView r={r} />
      ) : (
        <p className="text-center text-sm text-fg-muted">{tc('loading')}</p>
      )}
    </div>
  );
}

function RequestView({ r }: { r: DocumentRequestView }) {
  const t = useTranslations('onboarding.portal');
  const tc = useTranslations('common');
  const locale = useLocale();
  const saveDoc = usePortalSaveDoc();
  const upload = usePortalUploadFile();
  const delFile = usePortalDeleteFile();
  const saveQ = usePortalSaveQuestionnaire();
  const consent = usePortalAutofillConsent();
  const replyMut = usePortalAutofillReply();
  const submit = usePortalSubmit();

  const [drafts, setDrafts] = useState<Drafts>({});
  const [errors, setErrors] = useState<Errs>({});
  const [missing, setMissing] = useState<MissingItem[]>([]);
  const [open, setOpen] = useState<string[]>([]);
  const [stage, setStage] = useState<AutofillStage | null>(null);
  const [autofillError, setAutofillError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const editable = OPEN_REQUEST.includes(r.status);
  const returned = r.status === 'RETURNED';
  const docEditable = (d: CandidateDocumentView) => editable && d.status !== 'ACCEPTED' && (!returned || d.status === 'RETURNED');
  const qFields = useMemo(() => (r.questionnaire?.fields ?? []).filter((f) => f.type !== 'file'), [r.questionnaire]);
  const missingIds = new Set(missing.map((m) => (m.type === 'questionnaire' ? Q : m.id)));

  const completeCount = r.documents.filter(docComplete).length;
  const requiredLeft = r.documents.filter((d) => d.required && !docComplete(d)).length;
  const canAutofill = editable && r.documents.some((d) => d.docType.autoFillable && docEditable(d));
  const dirtyDocs = r.documents.filter((d) => docEditable(d) && isDraftDirty(docFields(d), drafts[d.id], d.values));
  const qDirty = editable && Boolean(r.questionnaire) && isDraftDirty(qFields, drafts[Q], r.questionnaireAnswers);

  const clearMissing = (id: string) => setMissing((m) => m.filter((x) => (x.type === 'questionnaire' ? Q : x.id) !== id));

  const saveOne = async (d: CandidateDocumentView, silent = false) => {
    const fields = docFields(d);
    const values = fromDraft(fields, drafts[d.id] ?? toDraft(fields, d.values), d.values);
    if (!Object.keys(values).length) return true;
    try {
      await saveDoc.mutateAsync({ docId: d.id, values });
      setDrafts((cur) => omitKey(cur, d.id));
      setErrors((cur) => omitKey(cur, d.id));
      clearMissing(d.id);
      if (!silent) toast.success(t('docSaved'));
      return true;
    } catch (e) {
      const fe = fieldErrorsOf(e, 'values');
      if (fe) setErrors((cur) => ({ ...cur, [d.id]: fe }));
      setOpen((o) => (o.includes(d.id) ? o : [...o, d.id]));
      toast.error(fe ? t('fixFields', { name: docTypeName(d.docType, locale) }) : isApiError(e) ? e.message : tc('error'));
      return false;
    }
  };

  const saveQuestionnaire = async (silent = false) => {
    const answers = fromDraft(qFields, drafts[Q] ?? toDraft(qFields, r.questionnaireAnswers), r.questionnaireAnswers);
    if (!Object.keys(answers).length) return true;
    try {
      await saveQ.mutateAsync(answers);
      setDrafts((cur) => omitKey(cur, Q));
      setErrors((cur) => omitKey(cur, Q));
      clearMissing(Q);
      if (!silent) toast.success(t('questionnaireSaved'));
      return true;
    } catch (e) {
      const fe = fieldErrorsOf(e, 'answers');
      if (fe) setErrors((cur) => ({ ...cur, [Q]: fe }));
      toast.error(fe ? t('fixQuestionnaire') : isApiError(e) ? e.message : tc('error'));
      return false;
    }
  };

  const startAutofill = async () => {
    setAutofillError(null);
    try {
      const res = await consent.mutateAsync();
      setStage({ kind: 'sms', smsPreview: res.smsPreview });
    } catch (e) {
      toast.error(
        isApiError(e) && e.rule === 'NO_IIN' ? t('autofill.noIin') : isApiError(e) && e.rule === 'NOTHING_TO_AUTOFILL' ? t('autofill.nothing') : isApiError(e) ? e.message : tc('error'),
      );
    }
  };

  const reply = async (value: '511' | '512') => {
    if (!stage) return;
    setAutofillError(null);
    const sms = stage.smsPreview;
    setStage({ kind: 'loading', smsPreview: sms, reply: value });
    try {
      const res = await replyMut.mutateAsync(value);
      if (value === '511') {
        const filled = res.documents.filter((d) => d.autoFilledKeys.length > 0 || (d.docType.autoFillable && d.files.length > 0)).length;
        setDrafts({});
        setErrors({});
        setMissing([]);
        setStage({ kind: 'granted', smsPreview: sms, filled });
      } else setStage({ kind: 'denied', smsPreview: sms });
    } catch (e) {
      setStage({ kind: 'sms', smsPreview: sms });
      setAutofillError(isApiError(e) ? e.message : tc('error'));
    }
  };

  const confirmReady = async () => {
    setSubmitting(true);
    try {
      let ok = true;
      for (const d of dirtyDocs) ok = (await saveOne(d, true)) && ok;
      if (qDirty) ok = (await saveQuestionnaire(true)) && ok;
      if (!ok) return;
      await submit.mutateAsync();
      setMissing([]);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      toast.success(t('submitted'));
    } catch (e) {
      if (isApiError(e) && e.rule === 'REQUIRED_MISSING') {
        const list = ((e.details as { missing?: MissingItem[] } | undefined)?.missing ?? []) as MissingItem[];
        setMissing(list);
        // Field-level hints for missing required fields.
        const next: Errs = {};
        for (const m of list) {
          const key = m.type === 'questionnaire' ? Q : m.id;
          for (const f of m.fields) if (f !== 'file') next[key] = { ...(next[key] ?? {}), [f]: tc('requiredField') };
        }
        setErrors((cur) => ({ ...cur, ...next }));
        const ids = list.filter((m) => m.type === 'document').map((m) => m.id);
        setOpen((o) => [...new Set([...o, ...ids])]);
        toast.error(t('missingToast', { count: list.length }));
        const first = list[0];
        if (first) {
          setTimeout(() => document.getElementById(first.type === 'questionnaire' ? 'portal-questionnaire' : `pdoc-${first.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
        }
      } else toast.error(isApiError(e) ? e.message : tc('error'));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Read-only states after submit ──
  if (!editable) {
    const accepted = r.status === 'COMPLETED';
    return (
      <div className="flex flex-col gap-4">
        <Card className={cn('p-5 text-center', accepted ? 'border-green-border bg-green-bg' : 'border-primary/20 bg-primary-soft')}>
          <div className={cn('mx-auto mb-3 flex size-12 items-center justify-center rounded-full', accepted ? 'bg-green-solid text-white' : 'bg-primary text-white')}>
            {accepted ? <PartyPopper className="size-6" aria-hidden /> : <CheckCircle2 className="size-6" aria-hidden />}
          </div>
          <h2 className="text-lg font-semibold text-fg">{accepted ? t('acceptedTitle') : t('submittedTitle')}</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-fg-muted">{accepted ? t('acceptedText') : t('submittedText')}</p>
        </Card>
        <Card>
          <CardHeader title={t('yourDocuments')} count={r.documents.length} />
          <ul className="divide-y divide-border">
            {r.documents.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3 text-sm sm:px-5">
                <Lock className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-fg">{docTypeName(d.docType, locale)}</span>
                {docComplete(d) ? <CheckCircle2 className="size-4 text-green-fg" aria-label={t('docReady')} /> : <Circle className="size-4 text-fg-subtle" aria-label={t('docEmpty')} />}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 pb-24">
      {returned && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-orange-border bg-orange-bg p-4 text-orange-fg">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-semibold">{t('returnedTitle')}</p>
            {r.reviewComment && <p className="mt-1 break-words text-[13px] text-fg">{r.reviewComment}</p>}
            <p className="mt-1 text-[13px]">{t('returnedText')}</p>
          </div>
        </div>
      )}

      {canAutofill && (
        <section aria-labelledby="dpf-title" className="rounded-xl border border-blue-border bg-blue-bg p-4 sm:p-5">
          <h2 id="dpf-title" className="flex items-center gap-2 text-[15px] font-semibold text-fg">
            <Wand2 className="size-4 text-primary" aria-hidden />
            {t('dpfTitle')}
          </h2>
          <p className="mt-2 text-[13px] text-fg-muted">{t('dpfText')}</p>
          <p className="mt-3 text-[13px] font-medium text-fg">{t('dpfHow')}</p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-[13px] text-fg-muted">
            <li>{t('dpfStep1')}</li>
            <li>{t('dpfStep2')}</li>
            <li>{t('dpfStep3')}</li>
          </ol>
          {r.consentStatus === 'GRANTED' && (
            <p className="mt-3 flex items-center gap-1.5 text-[13px] font-medium text-green-fg">
              <CheckCircle2 className="size-4" aria-hidden />
              {t('dpfGranted')}
            </p>
          )}
          {r.consentStatus === 'DENIED' && <p className="mt-3 text-[13px] text-fg-muted">{t('dpfDenied')}</p>}
          <Button className="mt-4 w-full sm:w-auto" size="lg" onClick={() => void startAutofill()} loading={consent.isPending}>
            {!consent.isPending && <Wand2 />}
            {r.consentStatus === 'GRANTED' ? t('dpfAgain') : t('dpfButton')}
          </Button>
        </section>
      )}

      <section aria-labelledby="docs-title" className="flex flex-col gap-2.5">
        <div className="flex items-end justify-between gap-3 px-1">
          <h2 id="docs-title" className="text-[15px] font-semibold text-fg">
            {t('docsTitle')}
          </h2>
          <span className="text-xs text-fg-muted tabular">{t('progress', { done: completeCount, total: r.documents.length })}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-active" role="progressbar" aria-label={t('docsTitle')} aria-valuemin={0} aria-valuemax={r.documents.length} aria-valuenow={completeCount}>
          <div className="h-full rounded-full bg-green-solid transition-[width]" style={{ width: `${r.documents.length ? (completeCount / r.documents.length) * 100 : 0}%` }} />
        </div>
        {missing.length > 0 && (
          <div role="alert" className="rounded-xl border border-red-border bg-red-bg p-3 text-[13px] text-red-fg">
            <p className="font-semibold">{t('missingTitle')}</p>
            <ul className="mt-1 list-disc pl-5">
              {missing.map((m, i) => (
                <li key={`${m.id}-${m.code}-${i}`}>{m.type === 'document' ? (r.documents.find((d) => d.id === m.id) ? docTypeName(r.documents.find((d) => d.id === m.id)!.docType, locale) : m.name) : t('missingQuestion', { name: m.name })}</li>
              ))}
            </ul>
          </div>
        )}
        <Accordion type="multiple" value={open} onValueChange={setOpen} className="flex flex-col gap-2">
          {r.documents.map((d) => {
            const fields = docFields(d);
            const can = docEditable(d);
            const draft = drafts[d.id] ?? toDraft(fields, d.values);
            const dirty = can && isDraftDirty(fields, drafts[d.id], d.values);
            const complete = docComplete(d);
            const isMissing = missingIds.has(d.id);
            const isReturned = d.status === 'RETURNED';
            const fileMissing = missing.some((m) => m.id === d.id && m.fields.includes('file'));
            return (
              <AccordionItem
                key={d.id}
                value={d.id}
                id={`pdoc-${d.id}`}
                className={cn(
                  'scroll-mt-20 overflow-hidden rounded-xl border bg-surface shadow-card last:border-b',
                  isMissing ? 'border-red-solid ring-2 ring-red-solid/15' : isReturned ? 'border-orange-solid ring-2 ring-orange-solid/15' : 'border-border',
                  !can && 'opacity-80',
                )}
              >
                <AccordionTrigger
                  className="min-h-14 gap-2 px-3.5 sm:px-4"
                  extra={
                    <span className="flex shrink-0 items-center gap-2">
                      {d.autoFilledKeys.length > 0 && <Wand2 className="size-4 text-purple-fg" aria-label={t('autoFilledDoc')} />}
                      {isReturned ? (
                        <CircleAlert className="size-5 text-orange-fg" aria-label={t('docReturned')} />
                      ) : complete ? (
                        <CheckCircle2 className="size-5 text-green-fg" aria-label={t('docReady')} />
                      ) : (
                        <Circle className={cn('size-5', isMissing ? 'text-red-fg' : 'text-fg-subtle')} aria-label={t('docEmpty')} />
                      )}
                    </span>
                  }
                >
                  <span className="flex min-w-0 items-start gap-1">
                    <span className="line-clamp-2 text-left">{docTypeName(d.docType, locale)}</span>
                    {d.required && (
                      <span className="text-red-fg" aria-label={t('required')}>
                        *
                      </span>
                    )}
                    {dirty && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-orange-solid" aria-label={t('unsaved')} />}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="border-t border-border px-3.5 pt-4 text-fg sm:px-4">
                  {isReturned && d.returnComment && (
                    <p className="mb-4 rounded-lg border border-orange-border bg-orange-bg px-3 py-2 text-[13px] text-orange-fg">{t('hrComment', { comment: d.returnComment })}</p>
                  )}
                  {!can && <p className="mb-3 flex items-center gap-1.5 text-[13px] text-fg-subtle"><Lock className="size-3.5" aria-hidden />{t('docLocked')}</p>}
                  {fileMissing && <p role="alert" className="mb-3 text-[13px] font-medium text-red-fg">{fields.length ? t('fileOrFields') : t('fileNeeded')}</p>}
                  <div className="flex flex-col gap-5">
                    <div className="flex flex-col gap-2">
                      <h3 className="text-sm font-semibold text-fg">{t('uploadTitle')}</h3>
                      <DocFiles
                        files={d.files}
                        canUpload={can}
                        disabled={!can}
                        defaultPreview={false}
                        onUpload={can ? async (file, onProgress) => { await upload.mutateAsync({ docId: d.id, file, onProgress }); clearMissing(d.id); } : undefined}
                        onDelete={can ? (file) => delFile.mutateAsync({ docId: d.id, fileId: file.id }) : undefined}
                      />
                    </div>
                    {fields.length > 0 && (
                      <div className="flex flex-col gap-3">
                        <h3 className="text-sm font-semibold text-fg">{t('fieldsTitle')}</h3>
                        <DynamicFields
                          idPrefix={`pd-${d.id}`}
                          fields={fields}
                          values={draft}
                          autoFilledKeys={d.autoFilledKeys}
                          errors={errors[d.id]}
                          disabled={!can}
                          onChange={(key, value) => {
                            setDrafts((cur) => ({ ...cur, [d.id]: { ...(cur[d.id] ?? toDraft(fields, d.values)), [key]: value } }));
                            if (errors[d.id]?.[key]) setErrors((cur) => ({ ...cur, [d.id]: omitKey(cur[d.id] ?? {}, key) }));
                          }}
                        />
                        {can && (
                          <Button variant="outline" className="self-stretch sm:self-end" disabled={!dirty} loading={saveDoc.isPending && saveDoc.variables?.docId === d.id} onClick={() => void saveOne(d)}>
                            {t('saveDoc')}
                          </Button>
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

      {r.questionnaire && qFields.length > 0 && (
        <Card id="portal-questionnaire" className={cn('scroll-mt-20', missingIds.has(Q) && 'border-red-solid ring-2 ring-red-solid/15')}>
          <CardHeader title={r.questionnaire.name} />
          <CardBody className="flex flex-col gap-4">
            <DynamicFields
              idPrefix="pq"
              fields={qFields}
              values={drafts[Q] ?? toDraft(qFields, r.questionnaireAnswers)}
              errors={errors[Q]}
              disabled={returned}
              onChange={(key, value) => {
                setDrafts((cur) => ({ ...cur, [Q]: { ...(cur[Q] ?? toDraft(qFields, r.questionnaireAnswers)), [key]: value } }));
                if (errors[Q]?.[key]) setErrors((cur) => ({ ...cur, [Q]: omitKey(cur[Q] ?? {}, key) }));
              }}
            />
            {!returned && (
              <Button variant="outline" className="self-stretch sm:self-end" disabled={!qDirty} loading={saveQ.isPending} onClick={() => void saveQuestionnaire()}>
                {t('saveQuestionnaire')}
              </Button>
            )}
          </CardBody>
        </Card>
      )}

      {/* Sticky confirm bar */}
      <div className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-3">
          <p className="hidden min-w-0 flex-1 text-[13px] text-fg-muted sm:block">
            {requiredLeft > 0 ? t('requiredLeft', { count: requiredLeft }) : t('allRequiredReady')}
          </p>
          <Button size="lg" className="w-full sm:w-auto" onClick={() => void confirmReady()} loading={submitting}>
            {!submitting && <Send />}
            {t('confirm')}
          </Button>
        </div>
      </div>

      <AutofillDialog stage={stage} onReply={(v) => void reply(v)} onClose={() => setStage(null)} error={autofillError} />
    </div>
  );
}
