'use client';

import { CheckCircle2, CircleAlert, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { MultiSelect, type ComboOption } from '@/components/ui/combobox';
import { Dialog } from '@/components/ui/dialog';
import { FormError, FormField } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/toaster';
import { Link } from '@/i18n/navigation';
import { isApiError } from '@/lib/api/errors';
import { searchCandidates, useRequestDocuments, useRequestTemplates } from '@/lib/api/hooks/onboarding';
import type { RequestDocumentsResult } from '@/lib/api/types-onboarding';

export type PickedCandidate = { id: string; fullName: string };

/** "Запросить документы" (M1 p8): candidate chips + request template → sent / skipped report. */
export function RequestDocumentsDialog({
  open,
  onOpenChange,
  candidates,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  candidates: PickedCandidate[];
  onDone?: () => void;
}) {
  const t = useTranslations('onboarding.requestDocs');
  const tc = useTranslations('common');
  const templates = useRequestTemplates({ enabled: open });
  const send = useRequestDocuments();
  const [ids, setIds] = useState<string[]>([]);
  const [known, setKnown] = useState<ComboOption[]>([]);
  const [templateId, setTemplateId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RequestDocumentsResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setIds(candidates.map((c) => c.id));
    setKnown(candidates.map((c) => ({ value: c.id, label: c.fullName })));
    setTemplateId(undefined);
    setError(null);
    setResult(null);
    send.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const names = useMemo(() => new Map(known.map((o) => [o.value, o.label])), [known]);

  const submit = async () => {
    setError(null);
    if (!ids.length) return setError(t('pickCandidates'));
    if (!templateId) return setError(t('pickTemplate'));
    try {
      const res = await send.mutateAsync({ candidateIds: ids, requestTemplateId: templateId });
      setResult(res);
      if (res.sent > 0) toast.success(t('sentToast', { count: res.sent }));
      onDone?.();
    } catch (e) {
      setError(isApiError(e) ? e.message : tc('error'));
    }
  };

  const reasonLabel = (r: string) => {
    switch (r) {
      case 'NOT_FOUND':
      case 'HIRED':
      case 'BLOCKED':
      case 'ALREADY_ACCEPTED':
      case 'REQUEST_IN_PROGRESS':
        return t(`reasons.${r}`);
      default:
        return r;
    }
  };

  const noTemplates = templates.data && templates.data.length === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('title')}
      description={result ? undefined : t('description')}
      dismissible={!send.isPending}
      footer={
        result ? (
          <Button onClick={() => onOpenChange(false)}>{tc('close')}</Button>
        ) : (
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={send.isPending}>
              {tc('cancel')}
            </Button>
            <Button onClick={submit} loading={send.isPending} disabled={noTemplates}>
              {t('send')}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="flex flex-col gap-4" aria-live="polite">
          <div className="flex items-start gap-3 rounded-lg border border-green-border bg-green-bg p-3 text-green-fg">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />
            <p className="text-sm font-medium">{t('sentResult', { count: result.sent })}</p>
          </div>
          {result.skipped.length > 0 && (
            <div className="rounded-lg border border-orange-border bg-orange-bg p-3">
              <p className="flex items-center gap-2 text-sm font-medium text-orange-fg">
                <CircleAlert className="size-4" aria-hidden />
                {t('skippedResult', { count: result.skipped.length })}
              </p>
              <ul className="mt-2 flex flex-col gap-1 text-[13px] text-fg">
                {result.skipped.map((s) => (
                  <li key={s.candidateId} className="flex flex-wrap gap-x-2">
                    <span className="font-medium">{names.get(s.candidateId) ?? s.candidateId}</span>
                    <span className="text-fg-muted">— {reasonLabel(s.reason)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-4">
          <FormError message={error} />
          <FormField label={t('candidates')} required>
            <MultiSelect
              value={ids}
              onChange={(v, opts) => {
                setIds(v);
                setKnown((k) => [...k, ...opts.filter((o) => !k.some((x) => x.value === o.value))]);
              }}
              selectedOptions={known}
              loadOptions={(q, signal) => searchCandidates(q, signal)}
              placeholder={t('candidatesPlaceholder')}
              maxChips={6}
            />
          </FormField>
          <FormField label={t('template')} required hint={noTemplates ? undefined : t('templateHint')}>
            <Select
              value={templateId}
              onValueChange={setTemplateId}
              placeholder={templates.isLoading ? tc('loading') : t('templatePlaceholder')}
              disabled={!templates.data?.length}
              options={(templates.data ?? []).map((tpl) => ({ value: tpl.id, label: `${tpl.name} · ${t('docsCount', { count: tpl.items.length })}` }))}
            />
          </FormField>
          {noTemplates && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-muted p-3 text-[13px] text-fg-muted">
              {t('noTemplates')}
              <Button size="sm" variant="outline" asChild>
                <Link href="/onboarding/request-templates/new">
                  <Plus />
                  {t('createTemplate')}
                </Link>
              </Button>
            </div>
          )}
          {templates.error ? <p className="text-xs text-red-fg">{tc('loadFailed')}</p> : null}
        </div>
      )}
    </Dialog>
  );
}
