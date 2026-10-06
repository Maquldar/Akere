'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Switch } from '@/components/ui/checkbox';
import { Input, Textarea } from '@/components/ui/input';
import { FormError, FormField } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { RequireAccess } from '@/components/shell/require-access';
import { Link, useRouter } from '@/i18n/navigation';
import { applyServerErrors } from '@/lib/api/form-errors';
import { isApiError } from '@/lib/api/errors';
import { useQuestionnaire, useSaveQuestionnaire } from '@/lib/api/hooks/onboarding';
import type { FormField as QField, FormFieldType, QuestionnaireView } from '@/lib/api/types-onboarding';
import { can } from '@/lib/permissions';
import { keyFromLabel } from './model';

/** Types the candidate portal can render (file answers have no upload endpoint in API.md §6). */
const BUILDER_TYPES: FormFieldType[] = ['text', 'textarea', 'number', 'date', 'select', 'checkbox'];
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,59}$/;

type Row = { label: string; labelKk: string; key: string; keyTouched: boolean; type: FormFieldType; required: boolean; options: string };

const toRow = (f: QField): Row => ({
  label: f.label,
  labelKk: f.labelKk ?? '',
  key: f.key,
  keyTouched: true,
  type: f.type,
  required: f.required,
  options: (f.options ?? []).join('\n'),
});

const emptyRow = (): Row => ({ label: '', labelKk: '', key: '', keyTouched: false, type: 'text', required: false, options: '' });

function uniqueKey(base: string, taken: string[]): string {
  let k = base;
  let i = 2;
  while (taken.includes(k)) k = `${base}${i++}`;
  return k;
}

export function QuestionnaireBuilder({ id }: { id?: string }) {
  const q = useQuestionnaire(id);
  if (id && q.isLoading) {
    return (
      <div className="mx-auto grid w-full max-w-4xl gap-3" aria-busy>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-9 w-full max-w-md" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (id && (q.error || !q.data)) {
    return (
      <Card className="mx-auto max-w-4xl">
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </Card>
    );
  }
  return <BuilderForm questionnaire={q.data ?? null} />;
}

function BuilderForm({ questionnaire }: { questionnaire: QuestionnaireView | null }) {
  const t = useTranslations('onboarding.questionnaires');
  const tc = useTranslations('common');
  const tn = useTranslations('nav.items');
  const router = useRouter();
  const save = useSaveQuestionnaire();

  const schema = z.object({
    name: z.string().trim().min(1, tc('requiredField')).max(200),
    fields: z
      .array(
        z
          .object({
            label: z.string().trim().min(1, tc('requiredField')).max(200),
            labelKk: z.string().trim().max(200),
            key: z.string().trim().regex(KEY_RE, t('keyInvalid')),
            keyTouched: z.boolean(),
            type: z.enum(['text', 'textarea', 'number', 'date', 'select', 'checkbox', 'file']),
            required: z.boolean(),
            options: z.string(),
          })
          .refine((f) => f.type !== 'select' || f.options.split('\n').some((o) => o.trim()), { path: ['options'], message: t('optionsRequired') }),
      )
      .min(1, t('fieldsRequired'))
      .refine((fs) => new Set(fs.map((f) => f.key)).size === fs.length, t('keysUnique')),
  });
  type FormIn = z.input<typeof schema>;
  type FormOut = z.output<typeof schema>;

  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema),
    defaultValues: { name: questionnaire?.name ?? '', fields: questionnaire ? questionnaire.fields.map(toRow) : [emptyRow()] },
  });
  const arr = useFieldArray({ control: form.control, name: 'fields' });
  const e = form.formState.errors;

  useEffect(() => {
    if (questionnaire) form.reset({ name: questionnaire.name, fields: questionnaire.fields.map(toRow) });
  }, [questionnaire, form]);

  const onLabel = (i: number, label: string) => {
    form.setValue(`fields.${i}.label`, label, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
    if (!form.getValues(`fields.${i}.keyTouched`)) {
      const taken = form.getValues('fields').filter((_, j) => j !== i).map((f) => f.key);
      form.setValue(`fields.${i}.key`, label.trim() ? uniqueKey(keyFromLabel(label), taken) : '', { shouldDirty: true });
    }
  };

  const onSubmit = form.handleSubmit(async (v) => {
    const input = {
      name: v.name,
      fields: v.fields.map((f): QField => ({
        key: f.key,
        label: f.label,
        ...(f.labelKk ? { labelKk: f.labelKk } : {}),
        type: f.type,
        required: f.required,
        ...(f.type === 'select' ? { options: [...new Set(f.options.split('\n').map((o) => o.trim()).filter(Boolean))] } : {}),
      })),
    };
    try {
      const saved = await save.mutateAsync({ id: questionnaire?.id, input });
      toast.success(questionnaire ? tc('saved') : t('created', { name: saved.name }));
      router.push('/onboarding/questionnaires');
    } catch (err) {
      if (applyServerErrors(err, form.setError, { fields: ['name', 'fields'] })) return;
      form.setError('root.server', { message: isApiError(err) ? err.message : tc('error') });
    }
  });

  const fieldsError = e.fields?.message ?? e.fields?.root?.message;

  return (
    <RequireAccess allow={(a) => can(a, 'candidate.manage')}>
      <div className="mx-auto w-full max-w-4xl">
        <PageHeader
          title={questionnaire ? questionnaire.name : t('newTitle')}
          breadcrumbs={[{ label: tn('questionnaires'), href: '/onboarding/questionnaires' }, { label: questionnaire ? t('editTitle') : t('newTitle') }]}
          actions={
            <>
              <Button variant="outline" asChild>
                <Link href="/onboarding/questionnaires">{tc('cancel')}</Link>
              </Button>
              <Button type="submit" form="questionnaire-form" loading={save.isPending}>
                {tc('save')}
              </Button>
            </>
          }
        />
        <form id="questionnaire-form" onSubmit={onSubmit} noValidate className="grid gap-5">
          <FormError message={e.root?.server?.message} />
          <FormField label={t('name')} required error={e.name?.message} className="max-w-md">
            <Input maxLength={200} placeholder={t('namePlaceholder')} {...form.register('name')} />
          </FormField>
          <div className="grid gap-3">
            <h2 className="section-label px-1">{t('fieldsTitle', { count: arr.fields.length })}</h2>
            {arr.fields.map((row, i) => {
              const fe = e.fields?.[i];
              const type = form.watch(`fields.${i}.type`);
              const typeOptions = (BUILDER_TYPES.includes(type) ? BUILDER_TYPES : [...BUILDER_TYPES, type]).map((ty) => ({ value: ty, label: t(`types.${ty}`) }));
              return (
                <Card key={row.id}>
                  <CardHeader
                    titleAs="h3"
                    title={form.watch(`fields.${i}.label`) || t('fieldN', { n: i + 1 })}
                    actions={
                      <>
                        <Button variant="ghost" size="icon-sm" aria-label={t('moveUp')} disabled={i === 0} onClick={() => arr.move(i, i - 1)}>
                          <ArrowUp />
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label={t('moveDown')} disabled={i === arr.fields.length - 1} onClick={() => arr.move(i, i + 1)}>
                          <ArrowDown />
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label={t('remove')} disabled={arr.fields.length === 1} onClick={() => arr.remove(i)}>
                          <Trash2 />
                        </Button>
                      </>
                    }
                  />
                  <CardBody className="grid gap-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField label={t('label')} required error={fe?.label?.message}>
                        <Input value={form.watch(`fields.${i}.label`)} onChange={(ev) => onLabel(i, ev.target.value)} maxLength={200} />
                      </FormField>
                      <FormField label={t('labelKk')} error={fe?.labelKk?.message}>
                        <Input maxLength={200} {...form.register(`fields.${i}.labelKk`)} />
                      </FormField>
                      <FormField label={t('type')}>
                        <Select value={type} onValueChange={(v) => form.setValue(`fields.${i}.type`, v as FormFieldType, { shouldDirty: true })} options={typeOptions} />
                      </FormField>
                      <FormField label={t('key')} required error={fe?.key?.message} hint={t('keyHint')}>
                        <Input
                          className="font-mono text-[13px]"
                          autoComplete="off"
                          {...form.register(`fields.${i}.key`, { onChange: () => form.setValue(`fields.${i}.keyTouched`, true) })}
                        />
                      </FormField>
                    </div>
                    {type === 'select' && (
                      <FormField label={t('options')} required error={fe?.options?.message} hint={t('optionsHint')}>
                        <Textarea rows={4} {...form.register(`fields.${i}.options`)} />
                      </FormField>
                    )}
                    <Switch
                      label={t('required')}
                      description={type === 'checkbox' ? t('requiredCheckboxHint') : undefined}
                      checked={form.watch(`fields.${i}.required`)}
                      onCheckedChange={(v) => form.setValue(`fields.${i}.required`, v, { shouldDirty: true })}
                    />
                  </CardBody>
                </Card>
              );
            })}
            {fieldsError && (
              <p role="alert" className="text-xs font-medium text-red-fg">
                {fieldsError}
              </p>
            )}
            <div>
              <Button variant="outline" onClick={() => arr.append(emptyRow())} disabled={arr.fields.length >= 100}>
                <Plus />
                {t('addField')}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </RequireAccess>
  );
}
