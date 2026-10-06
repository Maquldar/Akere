'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, ExternalLink, FileText, UserCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { FormError, FormField } from '@/components/ui/label';
import { Select, SELECT_NONE } from '@/components/ui/select';
import { toast } from '@/components/ui/toaster';
import { Link } from '@/i18n/navigation';
import { applyServerErrors } from '@/lib/api/form-errors';
import { isApiError } from '@/lib/api/errors';
import { useDepartments, useLegalEntities, useLocations, usePositions } from '@/lib/api/hooks/org';
import { searchEmployees, useHire } from '@/lib/api/hooks/onboarding';
import type { CandidateDetail, HireResult } from '@/lib/api/types-onboarding';

const today = () => new Date().toISOString().slice(0, 10);

/** "Оформить" (F-12): accepted candidate → employee (+ generated hire documents). */
export function HireDialog({ open, onOpenChange, candidate }: { open: boolean; onOpenChange: (o: boolean) => void; candidate: CandidateDetail }) {
  const t = useTranslations('onboarding.hire');
  const tc = useTranslations('common');
  const locale = useLocale();
  const hire = useHire(candidate.id);
  const entities = useLegalEntities({ enabled: open });
  const positions = usePositions();
  const locations = useLocations();
  const [result, setResult] = useState<HireResult | null>(null);

  const schema = z.object({
    legalEntityId: z.string().min(1, tc('requiredField')),
    departmentId: z.string().min(1, tc('requiredField')),
    positionId: z.string().min(1, tc('requiredField')),
    managerId: z.string().nullable(),
    locationId: z.string(),
    hireDate: z.string().min(1, tc('requiredField')),
    tabNumber: z
      .string()
      .trim()
      .refine((v) => v === '' || /^[0-9A-Za-zА-Яа-я-]{1,20}$/.test(v), t('tabInvalid')),
    salary: z
      .string()
      .trim()
      .min(1, tc('requiredField'))
      .refine((v) => Number(v.replace(/\s/g, '').replace(',', '.')) > 0, t('salaryInvalid')),
    probationMonths: z.string(),
    generateDocuments: z.boolean(),
  });
  type FormIn = z.input<typeof schema>;
  type FormOut = z.output<typeof schema>;

  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema),
    defaultValues: {
      legalEntityId: candidate.legalEntityId,
      departmentId: candidate.departmentId ?? '',
      positionId: candidate.positionId ?? '',
      managerId: null,
      locationId: '',
      hireDate: candidate.plannedHireDate ?? today(),
      tabNumber: '',
      salary: '',
      probationMonths: '3',
      generateDocuments: true,
    },
  });
  const e = form.formState.errors;
  const legalEntityId = form.watch('legalEntityId');
  const departments = useDepartments(legalEntityId || undefined);

  useEffect(() => {
    if (open) {
      setResult(null);
      hire.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const loadManagers = useCallback((q: string, signal: AbortSignal) => searchEmployees(q, legalEntityId || undefined, signal), [legalEntityId]);

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const res = await hire.mutateAsync({
        legalEntityId: v.legalEntityId,
        departmentId: v.departmentId,
        positionId: v.positionId,
        managerId: v.managerId,
        locationId: v.locationId || null,
        hireDate: v.hireDate,
        tabNumber: v.tabNumber || undefined,
        salary: Number(v.salary.replace(/\s/g, '').replace(',', '.')),
        probationMonths: v.probationMonths === SELECT_NONE ? undefined : Number(v.probationMonths),
        generateDocuments: v.generateDocuments,
      });
      setResult(res);
      toast.success(t('done', { name: candidate.fullName }));
    } catch (err) {
      if (applyServerErrors(err, form.setError, { fields: Object.keys(schema.shape) })) return;
      const field = isApiError(err) ? (err.details as { field?: string } | undefined)?.field : undefined;
      if (isApiError(err) && err.code === 'CONFLICT' && field === 'tabNumber') form.setError('tabNumber', { message: t('tabTaken') });
      else form.setError('root.server', { message: isApiError(err) ? err.message : tc('error') });
    }
  });

  const name = (i: { name: string; nameKk?: string | null }) => (locale === 'kk' && i.nameKk ? i.nameKk : i.name);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={result ? t('doneTitle') : t('title')}
      description={result ? undefined : t('description', { name: candidate.fullName })}
      dismissible={!hire.isPending}
      footer={
        result ? (
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {tc('close')}
            </Button>
            <Button asChild>
              <Link href={`/employees/${result.employeeId}`}>
                <UserCheck />
                {t('openEmployee')}
              </Link>
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={hire.isPending}>
              {tc('cancel')}
            </Button>
            <Button type="submit" form="hire-form" loading={hire.isPending}>
              {t('submit')}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="grid gap-4" aria-live="polite">
          <div className="flex items-start gap-3 rounded-lg border border-green-border bg-green-bg p-4 text-green-fg">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />
            <div>
              <p className="text-sm font-semibold">{t('doneText', { name: candidate.fullName })}</p>
              <p className="mt-0.5 text-[13px]">{t('accountHint')}</p>
            </div>
          </div>
          {result.documentIds.length > 0 ? (
            <div className="grid gap-2">
              <p className="text-[13px] font-medium text-fg">{t('documents', { count: result.documentIds.length })}</p>
              <ul className="grid gap-1.5">
                {result.documentIds.map((id, i) => (
                  <li key={id}>
                    <Link href={`/documents/${id}`} className="focus-ring flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-[13px] text-fg hover:bg-surface-hover">
                      <FileText className="size-4 text-fg-subtle" aria-hidden />
                      <span className="flex-1">{t('documentN', { n: i + 1 })}</span>
                      <ExternalLink className="size-3.5 text-fg-subtle" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-[13px] text-fg-muted">{t('noDocuments')}</p>
          )}
        </div>
      ) : (
        <form id="hire-form" onSubmit={onSubmit} noValidate className="grid gap-4">
          <FormError message={e.root?.server?.message} />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('legalEntity')} required error={e.legalEntityId?.message}>
              <Select
                value={legalEntityId || undefined}
                onValueChange={(v) => {
                  form.setValue('legalEntityId', v, { shouldValidate: true });
                  form.setValue('departmentId', '');
                  form.setValue('managerId', null);
                }}
                options={(entities.data ?? []).map((le) => ({ value: le.id, label: name(le) }))}
                placeholder={tc('select')}
              />
            </FormField>
            <FormField label={t('department')} required error={e.departmentId?.message}>
              <Select
                value={form.watch('departmentId') || undefined}
                onValueChange={(v) => form.setValue('departmentId', v, { shouldValidate: form.formState.isSubmitted })}
                options={(departments.data ?? []).map((d) => ({ value: d.id, label: name(d) }))}
                placeholder={departments.isLoading ? tc('loading') : tc('select')}
                disabled={!legalEntityId}
              />
            </FormField>
            <FormField label={t('position')} required error={e.positionId?.message}>
              <Select
                value={form.watch('positionId') || undefined}
                onValueChange={(v) => form.setValue('positionId', v, { shouldValidate: form.formState.isSubmitted })}
                options={(positions.data ?? []).map((p) => ({ value: p.id, label: name(p) }))}
                placeholder={tc('select')}
              />
            </FormField>
            <FormField label={t('manager')} error={e.managerId?.message}>
              <Combobox
                key={legalEntityId}
                value={form.watch('managerId')}
                onChange={(v) => form.setValue('managerId', v)}
                loadOptions={loadManagers}
                clearable
                placeholder={t('managerPlaceholder')}
              />
            </FormField>
            <FormField label={t('location')} error={e.locationId?.message}>
              <Select
                value={form.watch('locationId') || SELECT_NONE}
                onValueChange={(v) => form.setValue('locationId', v === SELECT_NONE ? '' : v)}
                options={[{ value: SELECT_NONE, label: t('notSet') }, ...(locations.data ?? []).map((l) => ({ value: l.id, label: l.name }))]}
              />
            </FormField>
            <FormField label={t('hireDate')} required error={e.hireDate?.message}>
              <DatePicker value={form.watch('hireDate')} onChange={(v) => form.setValue('hireDate', v, { shouldValidate: form.formState.isSubmitted })} />
            </FormField>
            <FormField label={t('salary')} required error={e.salary?.message} hint={t('salaryHint')}>
              <Input inputMode="decimal" autoComplete="off" placeholder="350 000" rightSlot={<span className="pr-1.5 text-sm text-fg-subtle">₸</span>} {...form.register('salary')} />
            </FormField>
            <FormField label={t('probation')} error={e.probationMonths?.message}>
              <Select
                value={form.watch('probationMonths')}
                onValueChange={(v) => form.setValue('probationMonths', v)}
                options={[{ value: SELECT_NONE, label: t('noProbation') }, ...[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: t('months', { count: n }) }))]}
              />
            </FormField>
            <FormField label={t('tabNumber')} error={e.tabNumber?.message} hint={t('tabHint')}>
              <Input autoComplete="off" {...form.register('tabNumber')} />
            </FormField>
          </div>
          <Checkbox
            label={t('generateDocuments')}
            description={t('generateHint')}
            checked={form.watch('generateDocuments')}
            onCheckedChange={(v) => form.setValue('generateDocuments', v === true)}
          />
        </form>
      )}
    </Dialog>
  );
}
