'use client';

import { Eye, Plus, Save, Send, Trash2, User, Users } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { ComboOption } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { FormError, FormField } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { useCurrentUser } from '@/components/shell/me-context';
import { RequireAccess } from '@/components/shell/require-access';
import { useRouter } from '@/i18n/navigation';
import { isApiError } from '@/lib/api/errors';
import { useBulkCreateDocuments, useCreateDocument, useDocumentTemplate, useDocumentTypes } from '@/lib/api/hooks/documents';
import { useLegalEntities } from '@/lib/api/hooks/org';
import { can } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { DataFieldsEditor } from './data-fields';
import { EmployeeMultiPicker, EmployeePicker } from './employee-picker';
import { TemplatePreviewDialog } from './template-preview';
import { extractDataFields, toDataPayload } from './template-fields';

type Mode = 'single' | 'bulk';
type ExtraRow = { key: string; value: string };
type Errors = Partial<Record<'type' | 'entity' | 'subject' | 'subjects' | 'title' | 'dueAt', string>> & { data?: Record<string, string> };

const today = () => new Date().toISOString().slice(0, 10);

export function NewDocumentForm() {
  const t = useTranslations('documents.new');
  const tc = useTranslations('common');
  const router = useRouter();
  const params = useSearchParams();
  const { me, access } = useCurrentUser();
  const manage = can(access, 'document.manage');
  const types = useDocumentTypes({ active: true });
  const entities = useLegalEntities();
  const create = useCreateDocument();
  const bulk = useBulkCreateDocuments();

  const [mode, setMode] = useState<Mode>('single');
  const [typeId, setTypeId] = useState<string>(params.get('typeId') ?? '');
  const [entityId, setEntityId] = useState<string>(params.get('legalEntityId') ?? me.employee?.legalEntityId ?? '');
  const [subject, setSubject] = useState<string | null>(params.get('employeeId'));
  const [subjectOption, setSubjectOption] = useState<ComboOption | null>(null);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState<ExtraRow[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  const typeOptions = useMemo(() => (types.data ?? []).filter((x) => x.kind !== 'ARCHIVE' && x.kind !== 'VND'), [types.data]);
  const type = typeOptions.find((x) => x.id === typeId);
  const template = useDocumentTemplate(type?.templateId, { enabled: manage });
  const fields = useMemo(() => extractDataFields(template.data?.body), [template.data]);
  const templateUnknown = Boolean(type?.templateId) && !manage; // template body not readable without document.manage

  useEffect(() => {
    if (!entityId && entities.data?.length === 1) setEntityId(entities.data[0]!.id);
  }, [entities.data, entityId]);

  const setValue = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));

  const buildData = () => {
    const extraData = Object.fromEntries(extra.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value.trim()]));
    return toDataPayload(fields, values, extraData);
  };

  const validate = (startRoute: boolean): boolean => {
    const e: Errors = {};
    if (!typeId) e.type = tc('requiredField');
    if (!entityId) e.entity = tc('requiredField');
    if (mode === 'bulk' && subjects.length === 0) e.subjects = t('pickEmployees');
    if (startRoute) {
      const data: Record<string, string> = {};
      for (const f of fields) if (!f.optional && !(values[f.key] ?? '').trim()) data[f.key] = tc('requiredField');
      if (Object.keys(data).length) e.data = data;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onError = (err: unknown) => {
    if (isApiError(err) && err.code === 'VALIDATION_ERROR') {
      const fe = err.fieldErrors;
      setErrors({
        type: fe.documentTypeId?.[0],
        entity: fe.legalEntityId?.[0],
        subject: fe.subjectEmployeeId?.[0],
        subjects: fe.subjectEmployeeIds?.[0],
        title: fe.title?.[0],
        dueAt: fe.dueAt?.[0],
      });
      setServerError(err.formErrors.join(' ') || null);
    } else if (isApiError(err) && err.rule === 'SUBJECT_LEGAL_ENTITY_MISMATCH') {
      setErrors({ subject: t('wrongEntity') });
    } else {
      setServerError(isApiError(err) ? err.message : tc('error'));
    }
  };

  const submit = (startRoute: boolean) => (e?: FormEvent) => {
    e?.preventDefault();
    setServerError(null);
    if (!validate(startRoute)) return;
    const dueAt = due ? new Date(`${due}T23:59:00`).toISOString() : undefined;
    const data = buildData();
    if (mode === 'bulk') {
      bulk.mutate(
        { documentTypeId: typeId, legalEntityId: entityId, subjectEmployeeIds: subjects, data, dueAt, startRoute },
        {
          onSuccess: (r) => {
            toast.success(t('bulkCreated', { count: r.documentIds.length }));
            router.push(startRoute ? '/documents/outgoing' : '/documents/drafts');
          },
          onError,
        },
      );
    } else {
      create.mutate(
        { documentTypeId: typeId, legalEntityId: entityId, subjectEmployeeId: subject, title: title.trim() || undefined, data, dueAt, startRoute },
        {
          onSuccess: (d) => {
            toast.success(startRoute ? t('createdSent', { number: d.number ?? '' }) : t('createdDraft'));
            router.push(`/documents/${d.id}`);
          },
          onError,
        },
      );
    }
  };

  const pending = create.isPending || bulk.isPending;

  return (
    <RequireAccess allow={(a) => can(a, 'document.create')}>
      <PageHeader title={t('title')} subtitle={t('subtitle')} breadcrumbs={[{ label: t('crumb'), href: '/documents' }, { label: t('title') }]} />
      <form onSubmit={submit(true)} noValidate className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="flex flex-col gap-5 p-4 sm:p-5">
          <div className="inline-flex self-start rounded-lg bg-surface-hover p-1" role="radiogroup" aria-label={t('mode')}>
            {(['single', 'bulk'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  'focus-ring inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium',
                  mode === m ? 'bg-surface text-fg shadow-[0_1px_2px_rgb(16_24_40/0.08)]' : 'text-fg-muted hover:text-fg',
                )}
              >
                {m === 'single' ? <User className="size-4" aria-hidden /> : <Users className="size-4" aria-hidden />}
                {m === 'single' ? t('modeSingle') : t('modeBulk')}
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('type')} required error={errors.type}>
              {types.isLoading ? (
                <Skeleton className="h-9" />
              ) : (
                <Select
                  value={typeId || undefined}
                  onValueChange={(v) => {
                    setTypeId(v);
                    setValues({});
                  }}
                  placeholder={t('typePlaceholder')}
                  options={typeOptions.map((x) => ({ value: x.id, label: x.name }))}
                />
              )}
            </FormField>
            <FormField label={t('legalEntity')} required error={errors.entity}>
              <Select
                value={entityId || undefined}
                onValueChange={(v) => {
                  setEntityId(v);
                  setSubject(null);
                  setSubjects([]);
                }}
                placeholder={t('entityPlaceholder')}
                options={(entities.data ?? []).map((x) => ({ value: x.id, label: x.name }))}
              />
            </FormField>
            {mode === 'single' ? (
              <FormField label={t('subject')} hint={t('subjectHint')} error={errors.subject} className="sm:col-span-2">
                <EmployeePicker
                  value={subject}
                  selectedOption={subjectOption}
                  onChange={(v, o) => {
                    setSubject(v);
                    setSubjectOption(o);
                  }}
                  legalEntityId={entityId || undefined}
                  placeholder={t('subjectPlaceholder')}
                />
              </FormField>
            ) : (
              <FormField label={t('subjects')} required hint={t('subjectsHint')} error={errors.subjects} className="sm:col-span-2">
                <EmployeeMultiPicker value={subjects} onChange={setSubjects} legalEntityId={entityId || undefined} placeholder={t('subjectsPlaceholder')} />
              </FormField>
            )}
            {mode === 'single' && (
              <FormField label={t('docTitle')} hint={t('titleHint')} error={errors.title}>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} placeholder={type ? type.name : undefined} />
              </FormField>
            )}
            <FormField label={t('dueAt')} hint={t('dueHint')} error={errors.dueAt}>
              <DatePicker value={due} min={today()} onChange={setDue} />
            </FormField>
          </div>

          {type && (
            <section aria-labelledby="data-heading" className="flex flex-col gap-4 border-t border-border pt-5">
              <div>
                <h2 id="data-heading" className="text-[15px] font-semibold text-fg">
                  {t('dataTitle')}
                </h2>
                <p className="text-[13px] text-fg-muted">
                  {type.templateId ? (templateUnknown ? t('dataNoAccess') : t('dataHint', { template: type.template?.name ?? '' })) : t('noTemplate')}
                </p>
              </div>
              {template.isLoading && manage && type.templateId ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Skeleton className="h-14" />
                  <Skeleton className="h-14" />
                </div>
              ) : (
                <DataFieldsEditor fields={fields} values={values} onChange={setValue} errors={errors.data} />
              )}
              {(templateUnknown || !type.templateId || extra.length > 0) && (
                <div className="flex flex-col gap-2">
                  {extra.map((r, i) => (
                    <div key={i} className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        aria-label={t('extraKey')}
                        placeholder={t('extraKey')}
                        value={r.key}
                        pattern="[A-Za-z][A-Za-z0-9_]*"
                        onChange={(e) => setExtra((s) => s.map((x, j) => (j === i ? { ...x, key: e.target.value.replace(/[^A-Za-z0-9_]/g, '') } : x)))}
                        className="sm:w-56"
                      />
                      <Input
                        aria-label={t('extraValue')}
                        placeholder={t('extraValue')}
                        value={r.value}
                        onChange={(e) => setExtra((s) => s.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                        className="flex-1"
                      />
                      <Button variant="ghost" size="icon" aria-label={tc('removeItem', { name: r.key || String(i + 1) })} onClick={() => setExtra((s) => s.filter((_, j) => j !== i))}>
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  ))}
                  <div>
                    <Button variant="ghost" size="sm" onClick={() => setExtra((s) => [...s, { key: '', value: '' }])}>
                      <Plus aria-hidden />
                      {t('addField')}
                    </Button>
                  </div>
                </div>
              )}
            </section>
          )}
          <FormError message={serverError} />
        </Card>

        <div className="flex flex-col gap-3 lg:sticky lg:top-4 lg:self-start">
          <Card className="flex flex-col gap-2 p-4">
            <p className="text-[13px] text-fg-muted">{mode === 'bulk' ? t('sideBulk', { count: subjects.length }) : t('sideSingle')}</p>
            <Button type="submit" loading={pending && (create.variables?.startRoute ?? bulk.variables?.startRoute) === true}>
              <Send aria-hidden />
              {t('createSend')}
            </Button>
            <Button variant="outline" onClick={() => submit(false)()} loading={pending && (create.variables?.startRoute ?? bulk.variables?.startRoute) === false}>
              <Save aria-hidden />
              {t('saveDraft')}
            </Button>
            {manage && type?.templateId && (
              <Button variant="ghost" onClick={() => (entityId ? setPreview(true) : setErrors((s) => ({ ...s, entity: tc('requiredField') })))}>
                <Eye aria-hidden />
                {t('preview')}
              </Button>
            )}
          </Card>
        </div>
      </form>
      {type?.templateId && entityId && (
        <TemplatePreviewDialog
          open={preview}
          onOpenChange={setPreview}
          templateId={type.templateId}
          title={type.name}
          body={{ data: buildData(), legalEntityId: entityId, subjectEmployeeId: mode === 'single' ? subject : (subjects[0] ?? null) }}
        />
      )}
    </RequireAccess>
  );
}
