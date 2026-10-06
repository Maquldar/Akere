'use client';

import { AlertTriangle, CalendarDays, FileText, Info, Paperclip, Save, Send, Wallet, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Controller, get, useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import { FileDropzone } from '@/components/ui/file-dropzone';
import { Input, Textarea } from '@/components/ui/input';
import { FormError, FormField, Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toaster';
import { RequireAccess } from '@/components/shell/require-access';
import { useCurrentUser } from '@/components/shell/me-context';
import { useRouter } from '@/i18n/navigation';
import { isApiError } from '@/lib/api/errors';
import { applyServerErrors } from '@/lib/api/form-errors';
import {
  uploadAttachment, useRequest, useRequestPreview, useRequestTypes, useSaveRequest, useSubmitRequest, useVacationBalance,
} from '@/lib/api/hooks/requests';
import type { FileRef } from '@/lib/api/types';
import type { DynamicField, RequestDetail, RequestInput, RequestTypeView } from '@/lib/api/types-requests';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { can, hasRole } from '@/lib/permissions';
import { cn, formatBytes } from '@/lib/utils';
import { PdfFrame } from './pdf-frame';
import { calendarDays, formatDays, isDateStr, todayStr, typeIcon, useFieldLabel, useRequestErrorText, useTypeName } from './shared';

const ACCEPT = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.heic'];

type FormValues = { startDate: string; endDate: string; data: Record<string, unknown> };

function initialData(type: RequestTypeView, data: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of type.fields) {
    const v = data?.[f.key];
    if (f.type === 'checkbox') out[f.key] = v === true;
    else out[f.key] = v === undefined || v === null ? '' : String(v);
  }
  return out;
}

/** Converts form strings to API values (numbers for number fields, drops empties). */
function apiData(type: RequestTypeView, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of type.fields) {
    const v = data[f.key];
    if (f.type === 'checkbox') {
      out[f.key] = v === true;
      continue;
    }
    if (typeof v !== 'string' || v.trim() === '') continue;
    out[f.key] = f.type === 'number' ? Number(v) : v.trim();
  }
  return out;
}

// ─────────────────────────── Dynamic field ───────────────────────────

function DynamicFieldInput({ field, control, error }: { field: DynamicField; control: ReturnType<typeof useForm<FormValues>>['control']; error?: string }) {
  const fieldLabel = useFieldLabel();
  const tc = useTranslations('common');
  const label = fieldLabel(field);
  const name = `data.${field.key}` as const;
  if (field.type === 'checkbox') {
    return (
      <Controller
        control={control}
        name={name}
        render={({ field: f }) => (
          <div className="flex flex-col gap-1">
            <Checkbox label={label} checked={f.value === true} onCheckedChange={(v) => f.onChange(v === true)} />
            {error && <p role="alert" className="text-xs font-medium text-red-fg">{error}</p>}
          </div>
        )}
      />
    );
  }
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: f }) => {
        const value = typeof f.value === 'string' ? f.value : '';
        let input;
        switch (field.type) {
          case 'textarea':
            input = <Textarea value={value} onChange={(e) => f.onChange(e.target.value)} onBlur={f.onBlur} maxLength={2000} />;
            break;
          case 'number':
            input = <Input type="number" inputMode="numeric" min={0} value={value} onChange={(e) => f.onChange(e.target.value)} onBlur={f.onBlur} className="sm:max-w-[200px]" />;
            break;
          case 'date':
            input = <DatePicker value={value} onChange={f.onChange} className="sm:max-w-[220px]" />;
            break;
          case 'select':
            input = (
              <Select
                value={value || undefined}
                onValueChange={f.onChange}
                placeholder={tc('select')}
                options={(field.options ?? []).map((o) => ({ value: o, label: o }))}
              />
            );
            break;
          default:
            input = <Input value={value} onChange={(e) => f.onChange(e.target.value)} onBlur={f.onBlur} maxLength={500} />;
        }
        return (
          <FormField label={label} required={field.required} error={error}>
            {input}
          </FormField>
        );
      }}
    />
  );
}

// ─────────────────────────── Summary (balance / days) ───────────────────────────

function SummaryCard({
  type,
  calDays,
  serverDays,
  balanceAfter,
  warnings,
  previewing,
}: {
  type: RequestTypeView;
  calDays: number;
  serverDays: number | null;
  balanceAfter: number | null;
  warnings: string[];
  previewing: boolean;
}) {
  const t = useTranslations('requests.form');
  const locale = useLocale();
  const { me } = useCurrentUser();
  const balance = useVacationBalance(type.usesVacationBalance ? me.employee?.id : null);
  const days = serverDays ?? calDays;
  const available = balance.data?.available ?? null;
  const after = balanceAfter ?? (available !== null ? available - days : null);
  const over = after !== null && after < 0;

  return (
    <Card>
      <CardHeader title={t('summary')} titleAs="h3" />
      <CardBody className="flex flex-col gap-4">
        {type.hasDates && (
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-fg-muted">
              <CalendarDays className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="text-[13px] text-fg-muted">{t('daysCount')}</div>
              <div className="text-xl font-semibold text-fg tabular" aria-live="polite" data-testid="request-days">
                {days}
                {previewing && <span className="sr-only">…</span>}
              </div>
              {serverDays !== null && serverDays < calDays && (
                <div className="text-xs text-fg-subtle">{t('holidaysExcluded', { count: calDays - serverDays })}</div>
              )}
            </div>
          </div>
        )}
        {type.usesVacationBalance && (
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
              <Wallet className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] text-fg-muted">{t('accrued')}</div>
              {balance.isLoading ? (
                <Skeleton className="mt-1 h-6 w-12" />
              ) : balance.isError ? (
                <div className="text-sm text-red-fg">{t('balanceFailed')}</div>
              ) : (
                <div className="text-xl font-semibold text-fg tabular" data-testid="request-balance">
                  {formatDays(available ?? 0, locale)}
                </div>
              )}
              {after !== null && days > 0 && (
                <div className={cn('mt-1 text-[13px] tabular', over ? 'font-medium text-red-fg' : 'text-fg-muted')}>
                  {t('remainingAfter', { days: formatDays(after, locale) })}
                </div>
              )}
            </div>
          </div>
        )}
        {!type.hasDates && !type.usesVacationBalance && <p className="text-[13px] text-fg-muted">{t('noDatesHint')}</p>}
        {warnings.length > 0 && (
          <ul className="flex flex-col gap-1.5 rounded-lg border border-orange-border bg-orange-bg p-3 text-[13px] text-orange-fg" aria-live="polite">
            {warnings.map((w, i) => (
              <li key={i} className="flex gap-2">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        )}
        {type.usesVacationBalance && (
          <p className="flex gap-2 text-xs text-fg-subtle">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {t('rule14')}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

// ─────────────────────────── Editor ───────────────────────────

function RequestEditor({ type, existing }: { type: RequestTypeView; existing: RequestDetail | null }) {
  const t = useTranslations('requests.form');
  const tc = useTranslations('common');
  const router = useRouter();
  const { access } = useCurrentUser();
  const typeName = useTypeName();
  const fieldLabel = useFieldLabel();
  const errorText = useRequestErrorText();
  const save = useSaveRequest();
  const submitReq = useSubmitRequest();
  const [tab, setTab] = useState('fill');
  const [attachments, setAttachments] = useState<FileRef[]>(existing?.attachments ?? []);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null);
  const isHr = hasRole(access, 'HR', 'ADMIN');

  const form = useForm<FormValues>({
    defaultValues: {
      startDate: existing?.startDate ?? '',
      endDate: existing?.endDate ?? '',
      data: initialData(type, existing?.data),
    },
  });
  const { errors } = form.formState;
  const values = form.watch();
  const calDays = type.hasDates ? calendarDays(values.startDate, values.endDate) : 0;

  const input: RequestInput = {
    requestTypeId: type.id,
    startDate: type.hasDates && isDateStr(values.startDate) ? values.startDate : null,
    endDate: type.hasDates && isDateStr(values.endDate) ? values.endDate : null,
    data: apiData(type, values.data),
    attachmentFileIds: attachments.map((a) => a.id),
    submit: false,
  };
  const inputKey = JSON.stringify(input);
  const debouncedKey = useDebounced(inputKey, 600);
  const previewInput = useMemo<RequestInput | null>(() => {
    const parsed = JSON.parse(debouncedKey) as RequestInput;
    if (type.hasDates && (!parsed.startDate || !parsed.endDate || parsed.endDate < parsed.startDate)) return null;
    return parsed;
  }, [debouncedKey, type.hasDates]);
  const preview = useRequestPreview(previewInput, existing?.id);
  const fresh = previewInput !== null && debouncedKey === inputKey && !preview.isPlaceholderData && preview.data !== undefined;

  const validate = (forSubmit: boolean): boolean => {
    form.clearErrors();
    let ok = true;
    const fail = (name: 'startDate' | 'endDate' | `data.${string}`, message: string) => {
      form.setError(name, { type: 'client', message }, { shouldFocus: ok });
      ok = false;
    };
    const v = form.getValues();
    if (type.hasDates) {
      if (forSubmit && !v.startDate) fail('startDate', tc('requiredField'));
      if (forSubmit && !v.endDate) fail('endDate', tc('requiredField'));
      if (v.startDate && v.endDate && v.endDate < v.startDate) fail('endDate', t('endBeforeStart'));
      if (forSubmit && v.startDate && v.startDate < todayStr() && !isHr) fail('startDate', t('pastStart'));
    }
    if (forSubmit) {
      for (const f of type.fields) {
        const val = v.data[f.key];
        if (f.required && (val === undefined || val === '' || val === false)) fail(`data.${f.key}`, tc('requiredField'));
      }
      if (type.requiresAttachment && attachments.length === 0) {
        setAttachmentError(t('attachmentRequired'));
        ok = false;
      }
    }
    return ok;
  };

  const onUpload = async (files: File[]) => {
    setAttachmentError(null);
    for (const file of files) {
      try {
        setUploadProgress(0);
        const ref = await uploadAttachment(file, setUploadProgress);
        setAttachments((prev) => [...prev, ref]);
      } catch (e) {
        toast.error(errorText(e));
      } finally {
        setUploadProgress(null);
      }
    }
  };

  const run = async (mode: 'draft' | 'submit') => {
    if (!validate(mode === 'submit')) {
      setTab('fill');
      return;
    }
    setBusy(mode);
    const body: RequestInput = { ...input, submit: mode === 'submit' && !existing };
    try {
      let saved = await save.mutateAsync({ id: existing?.id, input: body });
      if (mode === 'submit' && existing) saved = await submitReq.mutateAsync(saved.id);
      toast.success(mode === 'submit' ? t('submitted') : t('draftSaved'));
      router.push(`/requests/${saved.id}`);
    } catch (e) {
      setTab('fill');
      const mapped = applyServerErrors(e, form.setError, { fields: ['startDate', 'endDate', 'data'] });
      if (isApiError(e) && e.code === 'BUSINESS_RULE') {
        const msg = errorText(e);
        form.setError('root.server', { type: 'server', message: msg });
        if (e.rule === 'ATTACHMENT_REQUIRED') setAttachmentError(msg);
        toast.error(msg);
      } else if (!mapped) {
        toast.error(errorText(e));
      }
    } finally {
      setBusy(null);
    }
  };

  const Icon = typeIcon(type.code);
  const warnings = fresh ? (preview.data?.warnings ?? []) : [];

  const actions = (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button variant="outline" onClick={() => run('draft')} loading={busy === 'draft'} disabled={busy !== null || uploadProgress !== null}>
        <Save aria-hidden />
        {t('saveDraft')}
      </Button>
      <Button onClick={() => run('submit')} loading={busy === 'submit'} disabled={busy !== null || uploadProgress !== null}>
        <Send aria-hidden />
        {existing?.status === 'REWORK' ? t('resubmit') : t('submit')}
      </Button>
    </div>
  );

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList aria-label={t('tabsLabel')}>
        <TabsTrigger value="fill">{t('tabFill')}</TabsTrigger>
        <TabsTrigger value="preview">{t('tabPreview')}</TabsTrigger>
      </TabsList>

      <TabsContent value="fill">
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
            <Card>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    <Icon className="size-4 text-fg-subtle" aria-hidden />
                    {typeName(type)}
                  </span>
                }
              />
              <CardBody>
                <form
                  className="flex flex-col gap-4"
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run('submit');
                  }}
                >
                  <FormError message={errors.root?.server?.message} />
                  {type.hasDates && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Controller
                        control={form.control}
                        name="startDate"
                        render={({ field }) => (
                          <FormField label={t('startDate')} required error={errors.startDate?.message}>
                            <DatePicker
                              value={field.value}
                              onChange={field.onChange}
                              min={isHr ? undefined : todayStr()}
                              max={values.endDate || undefined}
                            />
                          </FormField>
                        )}
                      />
                      <Controller
                        control={form.control}
                        name="endDate"
                        render={({ field }) => (
                          <FormField label={t('endDate')} required error={errors.endDate?.message}>
                            <DatePicker value={field.value} onChange={field.onChange} min={values.startDate || undefined} />
                          </FormField>
                        )}
                      />
                    </div>
                  )}
                  {type.fields
                    .filter((f) => f.type !== 'file')
                    .map((f) => (
                      <DynamicFieldInput
                        key={f.key}
                        field={f}
                        control={form.control}
                        error={(get(errors, `data.${f.key}`) as { message?: string } | undefined)?.message}
                      />
                    ))}

                  <div className="flex flex-col gap-1.5">
                    <Label required={type.requiresAttachment} htmlFor="request-attachment">
                      {type.requiresAttachment ? t('attachmentRequiredLabel') : t('attachments')}
                    </Label>
                    <FileDropzone
                      id="request-attachment"
                      accept={ACCEPT}
                      multiple
                      onFiles={onUpload}
                      progress={uploadProgress}
                      disabled={uploadProgress !== null || attachments.length >= 20}
                    />
                    {attachments.length > 0 && (
                      <ul className="flex flex-col gap-1.5">
                        {attachments.map((a) => (
                          <li key={a.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-[13px]">
                            <Paperclip className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                            <a href={a.url} target="_blank" rel="noreferrer" className="focus-ring min-w-0 flex-1 truncate rounded text-fg hover:underline">
                              {a.filename}
                            </a>
                            <span className="shrink-0 text-xs text-fg-subtle tabular">{formatBytes(a.size)}</span>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                              aria-label={tc('removeItem', { name: a.filename })}
                            >
                              <X />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {attachmentError && (
                      <p role="alert" className="text-xs font-medium text-red-fg">
                        {attachmentError}
                      </p>
                    )}
                  </div>
                  <button type="submit" className="sr-only" tabIndex={-1}>
                    {t('submit')}
                  </button>
                </form>
              </CardBody>
            </Card>
            <div className="hidden lg:block">{actions}</div>
          </div>
          <div className="flex flex-col gap-4">
            <SummaryCard
              type={type}
              calDays={calDays}
              serverDays={fresh && type.hasDates ? (preview.data?.days ?? null) : null}
              balanceAfter={fresh ? (preview.data?.balanceAfter ?? null) : null}
              warnings={warnings}
              previewing={preview.isFetching}
            />
            <div className="lg:hidden">{actions}</div>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="preview">
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2">
            {previewInput === null ? (
              <Card>
                <EmptyState icon={<FileText aria-hidden />} title={t('previewNeedsDates')} description={t('previewNeedsDatesHint')} />
              </Card>
            ) : preview.isLoading ? (
              <Skeleton className="h-[min(75dvh,880px)] min-h-[420px] rounded-xl" />
            ) : preview.isError && !preview.data ? (
              <Card>
                <ErrorState error={preview.error} onRetry={() => preview.refetch()} title={errorText(preview.error)} />
              </Card>
            ) : preview.data ? (
              <PdfFrame src={preview.data.pdfDataUrl} title={typeName(type)} fileName={`${typeName(type)}.pdf`} />
            ) : null}
          </div>
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader title={t('checkTitle')} titleAs="h3" />
              <CardBody className="flex flex-col gap-3 text-[13px]">
                <dl className="grid gap-2">
                  {type.hasDates && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-fg-muted">{t('daysCount')}</dt>
                      <dd className="font-semibold text-fg tabular">{preview.data?.days ?? calDays}</dd>
                    </div>
                  )}
                  {type.usesVacationBalance && preview.data?.balanceAfter !== null && preview.data?.balanceAfter !== undefined && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-fg-muted">{t('remainingAfterLabel')}</dt>
                      <dd className={cn('font-semibold tabular', preview.data.balanceAfter < 0 ? 'text-red-fg' : 'text-fg')}>
                        {preview.data.balanceAfter}
                      </dd>
                    </div>
                  )}
                  {type.fields
                    .filter((f) => values.data[f.key] !== '' && values.data[f.key] !== undefined && f.type !== 'checkbox')
                    .map((f) => (
                      <div key={f.key} className="flex justify-between gap-3">
                        <dt className="text-fg-muted">{fieldLabel(f)}</dt>
                        <dd className="min-w-0 break-words text-right text-fg">{String(values.data[f.key])}</dd>
                      </div>
                    ))}
                  <div className="flex justify-between gap-3">
                    <dt className="text-fg-muted">{t('attachments')}</dt>
                    <dd className="text-fg tabular">{attachments.length}</dd>
                  </div>
                </dl>
                {preview.data && preview.data.warnings.length > 0 ? (
                  <ul className="flex flex-col gap-1.5 rounded-lg border border-orange-border bg-orange-bg p-3 text-orange-fg">
                    {preview.data.warnings.map((w, i) => (
                      <li key={i} className="flex gap-2">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  preview.data && <p className="rounded-lg border border-green-border bg-green-bg p-3 text-green-fg">{t('noWarnings')}</p>
                )}
              </CardBody>
            </Card>
            {actions}
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
}

// ─────────────────────────── Pages ───────────────────────────

function TypeSelect({ types, value, onChange, disabled }: { types: RequestTypeView[]; value: string | undefined; onChange: (code: string) => void; disabled?: boolean }) {
  const t = useTranslations('requests.form');
  const typeName = useTypeName();
  return (
    <FormField label={t('type')} required className="mb-4 max-w-xl">
      <Select
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        placeholder={t('typePlaceholder')}
        options={types.map((ty) => ({ value: ty.code, label: typeName(ty) }))}
      />
    </FormField>
  );
}

export function NewRequestPage() {
  const t = useTranslations('requests.form');
  const tm = useTranslations('requests.my');
  const router = useRouter();
  const params = useSearchParams();
  const { me } = useCurrentUser();
  const types = useRequestTypes();
  const code = params.get('type') ?? undefined;
  const type = types.data?.find((ty) => ty.code === code) ?? (code ? undefined : types.data?.[0]);

  return (
    <RequireAccess allow={(a) => can(a, 'request.create')}>
      <PageHeader title={t('newTitle')} breadcrumbs={[{ label: tm('title'), href: '/requests' }, { label: t('newTitle') }]} />
      {!me.employee ? (
        <Card>
          <EmptyState title={t('noEmployee')} description={t('noEmployeeHint')} />
        </Card>
      ) : types.isLoading ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-9 w-full max-w-xl" />
          <Skeleton className="h-[420px] rounded-xl" />
        </div>
      ) : types.isError ? (
        <Card>
          <ErrorState error={types.error} onRetry={() => types.refetch()} />
        </Card>
      ) : (
        <>
          <TypeSelect types={types.data ?? []} value={type?.code} onChange={(c) => router.replace(`/requests/new?type=${encodeURIComponent(c)}`)} />
          {type ? (
            <RequestEditor key={type.id} type={type} existing={null} />
          ) : (
            <Card>
              <EmptyState title={t('unknownType')} description={t('unknownTypeHint')} />
            </Card>
          )}
        </>
      )}
    </RequireAccess>
  );
}

export function EditRequestPage({ id }: { id: string }) {
  const t = useTranslations('requests.form');
  const tm = useTranslations('requests.my');
  const req = useRequest(id);
  const types = useRequestTypes();
  const type = types.data?.find((ty) => ty.id === req.data?.type.id);
  const editable = req.data && (req.data.canEdit ?? ['DRAFT', 'REWORK'].includes(req.data.status));

  return (
    <RequireAccess allow={(a) => can(a, 'request.create')}>
      <PageHeader
        title={t('editTitle')}
        breadcrumbs={[
          { label: tm('title'), href: '/requests' },
          { label: req.data?.type.name ?? '…', href: `/requests/${id}` },
          { label: t('editTitle') },
        ]}
      />
      {req.isLoading || types.isLoading ? (
        <Skeleton className="h-[420px] rounded-xl" />
      ) : req.isError || types.isError ? (
        <Card>
          <ErrorState error={req.error ?? types.error} onRetry={() => (req.isError ? req.refetch() : types.refetch())} />
        </Card>
      ) : !editable ? (
        <Card>
          <EmptyState title={t('notEditable')} description={t('notEditableHint')} />
        </Card>
      ) : type && req.data ? (
        <>
          <TypeSelect types={types.data ?? []} value={type.code} onChange={() => undefined} disabled />
          <RequestEditor key={type.id} type={type} existing={req.data} />
        </>
      ) : (
        <Card>
          <EmptyState title={t('unknownType')} description={t('unknownTypeHint')} />
        </Card>
      )}
    </RequireAccess>
  );
}
