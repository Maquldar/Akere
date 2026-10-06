'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Checkbox, RadioGroup } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import { Input, Textarea } from '@/components/ui/input';
import { FormError, FormField, Label } from '@/components/ui/label';
import { Select, SELECT_NONE } from '@/components/ui/select';
import { toast } from '@/components/ui/toaster';
import { applyServerErrors } from '@/lib/api/form-errors';
import { isApiError } from '@/lib/api/errors';
import { useDepartments, useLegalEntities, usePositions } from '@/lib/api/hooks/org';
import { useSaveCandidate } from '@/lib/api/hooks/onboarding';
import { useCurrentUser } from '@/components/shell/me-context';
import type { ContactChannel } from '@/lib/api/types';
import { CONTACT_CHANNELS, type CandidateDetail, type CandidateInput } from '@/lib/api/types-onboarding';
import { normalizePhone } from '@/lib/validation';
import { decodeIin, isValidIin } from './model';
import { ResponsiblePicker } from './responsible-picker';
import { TagInput } from './tag-input';

const PHONE_RE = /^\+\d{8,15}$/;

/** Candidate card form (F-02, M3 0:16): create and edit. */
export function CandidateForm({
  candidate,
  formId,
  onSaved,
  readOnly,
}: {
  candidate: CandidateDetail | null;
  formId: string;
  onSaved: (c: CandidateDetail) => void;
  readOnly?: boolean;
}) {
  const t = useTranslations('onboarding.form');
  const tc = useTranslations('common');
  const tch = useTranslations('channels');
  const locale = useLocale();
  const { me } = useCurrentUser();
  const save = useSaveCandidate();
  const entities = useLegalEntities();
  const positions = usePositions();

  const schema = z
    .object({
      legalEntityId: z.string().min(1, tc('requiredField')),
      lastName: z.string().trim().min(1, tc('requiredField')).max(100),
      firstName: z.string().trim().min(1, tc('requiredField')).max(100),
      middleName: z.string().trim().max(100),
      iin: z.string().trim(),
      noIin: z.boolean(),
      birthDate: z.string(),
      gender: z.enum(['MALE', 'FEMALE', '']),
      channels: z.array(z.enum(['EMAIL', 'SMS', 'WHATSAPP'])).min(1, t('channelsRequired')),
      email: z.string().trim().max(200),
      phone: z
        .string()
        .trim()
        .transform((v) => (v ? normalizePhone(v) : '')),
      comment: z.string().trim().max(2000),
      tags: z.array(z.string()).max(20),
      responsibleUserId: z.string().nullable(),
      departmentId: z.string(),
      positionId: z.string(),
      plannedHireDate: z.string(),
    })
    .superRefine((v, ctx) => {
      if (!v.noIin) {
        if (!v.iin) ctx.addIssue({ code: 'custom', path: ['iin'], message: t('iinRequired') });
        else if (!/^\d{12}$/.test(v.iin)) ctx.addIssue({ code: 'custom', path: ['iin'], message: t('iinDigits') });
        else if (!isValidIin(v.iin)) ctx.addIssue({ code: 'custom', path: ['iin'], message: t('iinChecksum') });
      }
      if (v.channels.includes('EMAIL') && !v.email) ctx.addIssue({ code: 'custom', path: ['email'], message: t('emailRequired') });
      if (v.email && !z.email().safeParse(v.email).success) ctx.addIssue({ code: 'custom', path: ['email'], message: t('emailInvalid') });
      if ((v.channels.includes('SMS') || v.channels.includes('WHATSAPP')) && !v.phone) ctx.addIssue({ code: 'custom', path: ['phone'], message: t('phoneRequired') });
      if (v.phone && !PHONE_RE.test(v.phone)) ctx.addIssue({ code: 'custom', path: ['phone'], message: t('phoneInvalid') });
    });
  type FormIn = z.input<typeof schema>;
  type FormOut = z.output<typeof schema>;

  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema),
    values: {
      legalEntityId: candidate?.legalEntityId ?? '',
      lastName: candidate?.lastName ?? '',
      firstName: candidate?.firstName ?? '',
      middleName: candidate?.middleName ?? '',
      iin: candidate?.iin ?? '',
      noIin: candidate?.noIin ?? false,
      birthDate: candidate?.birthDate ?? '',
      gender: candidate?.gender ?? '',
      channels: candidate?.channels ?? ['EMAIL'],
      email: candidate?.email ?? '',
      phone: candidate?.phone ?? '',
      comment: candidate?.comment ?? '',
      tags: candidate?.tags ?? [],
      responsibleUserId: candidate ? (candidate.responsibleUserId ?? null) : me.id,
      departmentId: candidate?.departmentId ?? '',
      positionId: candidate?.positionId ?? '',
      plannedHireDate: candidate?.plannedHireDate ?? '',
    },
    resetOptions: { keepDirtyValues: true },
  });
  const e = form.formState.errors;
  const legalEntityId = form.watch('legalEntityId');
  const departments = useDepartments(legalEntityId || undefined);
  const noIin = form.watch('noIin');
  const channels = form.watch('channels');

  // Default legal entity for a new candidate.
  useEffect(() => {
    if (!candidate && !form.getValues('legalEntityId') && entities.data?.length) {
      form.setValue('legalEntityId', entities.data[0]!.id);
    }
  }, [candidate, entities.data, form]);

  const onIinChange = (raw: string) => {
    const iin = raw.replace(/\D/g, '').slice(0, 12);
    form.setValue('iin', iin, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
    // Fill DOB / gender from the ИИН when still empty (same rule as the API).
    if (iin.length === 12 && isValidIin(iin)) {
      const d = decodeIin(iin);
      if (d) {
        if (!form.getValues('birthDate')) form.setValue('birthDate', d.birthDate, { shouldDirty: true });
        if (!form.getValues('gender')) form.setValue('gender', d.gender, { shouldDirty: true });
      }
    }
  };

  const toggleChannel = (ch: ContactChannel, on: boolean) => {
    const cur = form.getValues('channels');
    const next = on ? CONTACT_CHANNELS.filter((c) => c === ch || cur.includes(c)) : cur.filter((c) => c !== ch);
    form.setValue('channels', next, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
    if (form.formState.isSubmitted) void form.trigger(['email', 'phone']);
  };

  const onSubmit = form.handleSubmit(async (v) => {
    const input: CandidateInput = {
      legalEntityId: v.legalEntityId,
      lastName: v.lastName,
      firstName: v.firstName,
      middleName: v.middleName || null,
      iin: v.noIin ? null : v.iin || null,
      noIin: v.noIin,
      birthDate: v.birthDate || null,
      gender: v.gender || null,
      channels: v.channels,
      email: v.email || null,
      phone: v.phone || null,
      comment: v.comment || null,
      tags: v.tags,
      responsibleUserId: v.responsibleUserId,
      departmentId: v.departmentId || null,
      positionId: v.positionId || null,
      plannedHireDate: v.plannedHireDate || null,
    };
    try {
      const saved = await save.mutateAsync({ id: candidate?.id, input });
      toast.success(candidate ? tc('saved') : t('created', { name: saved.fullName }));
      form.reset(undefined, { keepValues: true });
      onSaved(saved);
    } catch (err) {
      if (applyServerErrors(err, form.setError, { fields: Object.keys(schema.shape) })) return;
      if (isApiError(err) && err.code === 'CONFLICT' && (err.details as { field?: string } | undefined)?.field === 'iin') {
        form.setError('iin', { message: t('iinTaken') }, { shouldFocus: true });
      } else form.setError('root.server', { message: isApiError(err) ? err.message : tc('error') });
    }
  });

  const selectOpts = (items: { id: string; name: string; nameKk?: string | null }[] | undefined) => [
    { value: SELECT_NONE, label: t('notSet') },
    ...(items ?? []).map((i) => ({ value: i.id, label: locale === 'kk' && i.nameKk ? i.nameKk : i.name })),
  ];

  return (
    <form id={formId} onSubmit={onSubmit} noValidate className="grid gap-5">
      <FormError message={e.root?.server?.message} />
      <fieldset disabled={readOnly || save.isPending} className="grid min-w-0 gap-5">
        <Card>
          <CardHeader title={t('cardTitle')} />
          <CardBody className="grid gap-4">
            <FormField label={t('labels.legalEntityId')} required error={e.legalEntityId?.message} className="sm:max-w-md">
              <Select
                value={legalEntityId || undefined}
                onValueChange={(v) => {
                  form.setValue('legalEntityId', v, { shouldDirty: true, shouldValidate: true });
                  form.setValue('departmentId', '', { shouldDirty: true });
                }}
                options={(entities.data ?? []).map((le) => ({ value: le.id, label: locale === 'kk' && le.nameKk ? le.nameKk : le.name }))}
                placeholder={entities.isLoading ? tc('loading') : tc('select')}
                disabled={readOnly}
              />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label={t('labels.lastName')} required error={e.lastName?.message}>
                <Input autoComplete="off" {...form.register('lastName')} />
              </FormField>
              <FormField label={t('labels.firstName')} required error={e.firstName?.message}>
                <Input autoComplete="off" {...form.register('firstName')} />
              </FormField>
              <FormField label={t('labels.middleName')} error={e.middleName?.message}>
                <Input autoComplete="off" {...form.register('middleName')} />
              </FormField>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid content-start gap-2">
                <FormField label={t('labels.iin')} required={!noIin} error={e.iin?.message} hint={noIin ? undefined : t('iinHint')}>
                  <Input
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={12}
                    placeholder="000000000000"
                    className="tabular"
                    disabled={noIin || readOnly}
                    value={form.watch('iin')}
                    onChange={(ev) => onIinChange(ev.target.value)}
                  />
                </FormField>
                <Checkbox
                  label={t('labels.noIin')}
                  checked={noIin}
                  disabled={readOnly}
                  onCheckedChange={(v) => {
                    form.setValue('noIin', v === true, { shouldDirty: true });
                    if (v === true) form.clearErrors('iin');
                  }}
                />
              </div>
              <FormField label={t('labels.birthDate')} error={e.birthDate?.message}>
                <Controller control={form.control} name="birthDate" render={({ field }) => <DatePicker value={field.value} onChange={field.onChange} max={new Date().toISOString().slice(0, 10)} />} />
              </FormField>
              <div className="grid content-start gap-2">
                <Label id="gender-label">{t('labels.gender')}</Label>
                <RadioGroup
                  aria-labelledby="gender-label"
                  orientation="horizontal"
                  value={form.watch('gender') || ''}
                  onValueChange={(v) => form.setValue('gender', v as 'MALE' | 'FEMALE', { shouldDirty: true })}
                  disabled={readOnly}
                  options={[
                    { value: 'MALE', label: t('male') },
                    { value: 'FEMALE', label: t('female') },
                  ]}
                  className="h-9 items-center"
                />
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('contactsTitle')} />
          <CardBody className="grid gap-4">
            <fieldset className="grid gap-2" aria-describedby="channels-hint">
              <legend className="mb-1 text-[13px] font-medium text-fg">
                {t('labels.channels')}
                <span className="ml-0.5 text-red-fg" aria-hidden>
                  *
                </span>
              </legend>
              <p id="channels-hint" className="-mt-1 text-xs text-fg-subtle">
                {t('channelsHint')}
              </p>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {CONTACT_CHANNELS.map((ch) => (
                  <Checkbox key={ch} label={tch(ch)} checked={channels.includes(ch)} disabled={readOnly} onCheckedChange={(v) => toggleChannel(ch, v === true)} />
                ))}
              </div>
              {e.channels?.message && (
                <p role="alert" className="text-xs font-medium text-red-fg">
                  {e.channels.message}
                </p>
              )}
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('labels.email')} required={channels.includes('EMAIL')} error={e.email?.message}>
                <Input type="email" autoComplete="off" placeholder="email@example.com" {...form.register('email')} />
              </FormField>
              <FormField label={t('labels.phone')} required={channels.includes('SMS') || channels.includes('WHATSAPP')} error={e.phone?.message} hint={t('phoneHint')}>
                <Input type="tel" autoComplete="off" placeholder="+77011234567" {...form.register('phone')} />
              </FormField>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('extraTitle')} />
          <CardBody className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('labels.departmentId')} error={e.departmentId?.message}>
                <Select
                  value={form.watch('departmentId') || SELECT_NONE}
                  onValueChange={(v) => form.setValue('departmentId', v === SELECT_NONE ? '' : v, { shouldDirty: true })}
                  options={selectOpts(departments.data)}
                  disabled={!legalEntityId || readOnly}
                />
              </FormField>
              <FormField label={t('labels.positionId')} error={e.positionId?.message}>
                <Select
                  value={form.watch('positionId') || SELECT_NONE}
                  onValueChange={(v) => form.setValue('positionId', v === SELECT_NONE ? '' : v, { shouldDirty: true })}
                  options={selectOpts(positions.data)}
                  disabled={readOnly}
                />
              </FormField>
              <FormField label={t('labels.plannedHireDate')} error={e.plannedHireDate?.message}>
                <Controller control={form.control} name="plannedHireDate" render={({ field }) => <DatePicker value={field.value} onChange={field.onChange} />} />
              </FormField>
              <FormField label={t('labels.responsibleUserId')} error={e.responsibleUserId?.message}>
                <ResponsiblePicker
                  value={form.watch('responsibleUserId')}
                  current={candidate?.responsible}
                  onChange={(v) => form.setValue('responsibleUserId', v, { shouldDirty: true })}
                />
              </FormField>
            </div>
            <FormField label={t('labels.tags')} error={e.tags?.message} hint={t('tagsHint')}>
              <Controller control={form.control} name="tags" render={({ field }) => <TagInput value={field.value} onChange={field.onChange} placeholder={t('tagsPlaceholder')} />} />
            </FormField>
            <FormField label={t('labels.comment')} error={e.comment?.message}>
              <Textarea rows={3} {...form.register('comment')} />
            </FormField>
          </CardBody>
        </Card>
      </fieldset>
      {!readOnly && (
        <div className="flex justify-end">
          <Button type="submit" loading={save.isPending} disabled={candidate ? !form.formState.isDirty : false}>
            {candidate ? tc('save') : t('create')}
          </Button>
        </div>
      )}
    </form>
  );
}
