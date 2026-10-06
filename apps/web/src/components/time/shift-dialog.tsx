'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Trash2, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { FormError, FormField, Label } from '@/components/ui/label';
import { Select, SELECT_NONE } from '@/components/ui/select';
import { toast } from '@/components/ui/toaster';
import { applyServerErrors } from '@/lib/api/form-errors';
import { isApiError } from '@/lib/api/errors';
import { useLocations } from '@/lib/api/hooks/org';
import { useDecideClaim, useDeleteShift, useSaveShift, useShiftTemplates } from '@/lib/api/hooks/time';
import { SHIFT_COLORS, type ShiftColor, type ShiftView } from '@/lib/api/types-time';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ApprovalPill } from './shared';
import { shiftChipClass, timeOf } from './time-utils';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export type ShiftDialogTarget =
  | { kind: 'create'; employeeId: string | null; employeeName: string | null; date: string; templateId?: string }
  | { kind: 'edit'; shift: ShiftView; employeeName: string | null };

export function ColorPicker({ value, onChange, id }: { value: ShiftColor; onChange: (c: ShiftColor) => void; id?: string }) {
  const t = useTranslations('time.colors');
  return (
    <div id={id} role="radiogroup" className="flex flex-wrap gap-2">
      {SHIFT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={t(c)}
          title={t(c)}
          onClick={() => onChange(c)}
          className={cn(
            'focus-ring flex size-7 items-center justify-center rounded-full border-2 transition-transform hover:scale-105',
            value === c ? 'border-fg' : 'border-transparent',
          )}
        >
          <span className={cn('size-5 rounded-full', shiftChipClass[c].dot)} />
        </button>
      ))}
    </div>
  );
}

/** Create a custom shift or edit/delete an existing one (planning). Open shifts also show claims. */
export function ShiftDialog({ target, onOpenChange }: { target: ShiftDialogTarget | null; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations('time.planning');
  const tc = useTranslations('common');
  const locale = useLocale();
  const templates = useShiftTemplates();
  const locations = useLocations();
  const save = useSaveShift();
  const del = useDeleteShift();
  const decide = useDecideClaim();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const open = Boolean(target);
  const shift = target?.kind === 'edit' ? target.shift : null;

  const schema = z
    .object({
      templateId: z.string(),
      title: z.string().trim().max(120),
      date: z.string().min(1, tc('requiredField')),
      startTime: z.string().regex(TIME_RE, t('timeInvalid')),
      endTime: z.string().regex(TIME_RE, t('timeInvalid')),
      breakMinutes: z.coerce.number<string>().int().min(0, t('breakInvalid')).max(240, t('breakInvalid')),
      color: z.enum(SHIFT_COLORS),
      locationId: z.string(),
    })
    .refine((v) => v.startTime !== v.endTime, { path: ['endTime'], message: t('endDiffers') });
  type In = z.input<typeof schema>;
  type Out = z.output<typeof schema>;

  const form = useForm<In, unknown, Out>({
    resolver: zodResolver(schema),
    defaultValues: { templateId: SELECT_NONE, title: '', date: '', startTime: '09:00', endTime: '18:00', breakMinutes: '60', color: 'teal', locationId: SELECT_NONE },
  });
  const { reset, setValue } = form;

  useEffect(() => {
    if (!target) return;
    if (target.kind === 'edit') {
      const s = target.shift;
      reset({
        templateId: s.templateId ?? SELECT_NONE,
        title: s.title,
        date: s.date,
        startTime: timeOf(s.startAt, 'ru'),
        endTime: timeOf(s.endAt, 'ru'),
        breakMinutes: String(s.breakMinutes),
        color: s.color,
        locationId: s.location?.id ?? SELECT_NONE,
      });
    } else {
      const tpl = templates.data?.find((x) => x.id === target.templateId);
      reset({
        templateId: tpl?.id ?? SELECT_NONE,
        title: tpl?.name ?? '',
        date: target.date,
        startTime: tpl?.startTime ?? '09:00',
        endTime: tpl?.endTime ?? '18:00',
        breakMinutes: String(tpl?.breakMinutes ?? 60),
        color: tpl?.color ?? 'teal',
        locationId: tpl?.location?.id ?? SELECT_NONE,
      });
    }
  }, [target, reset, templates.data]);

  const applyTemplate = (id: string) => {
    const tpl = templates.data?.find((x) => x.id === id);
    if (!tpl) return;
    setValue('title', tpl.name);
    setValue('startTime', tpl.startTime);
    setValue('endTime', tpl.endTime);
    setValue('breakMinutes', String(tpl.breakMinutes));
    setValue('color', tpl.color);
    setValue('locationId', tpl.location?.id ?? SELECT_NONE);
  };

  const e = form.formState.errors;

  const onSubmit = form.handleSubmit(async (v) => {
    if (!target) return;
    const input = {
      date: v.date,
      templateId: v.templateId === SELECT_NONE ? null : v.templateId,
      startTime: v.startTime,
      endTime: v.endTime,
      breakMinutes: v.breakMinutes,
      title: v.title.trim() || undefined,
      color: v.color,
      locationId: v.locationId === SELECT_NONE ? null : v.locationId,
    };
    try {
      if (target.kind === 'edit') await save.mutateAsync({ id: target.shift.id, input });
      else await save.mutateAsync({ input: { ...input, employeeId: target.employeeId } });
      toast.success(target.kind === 'edit' ? t('shiftUpdated') : t('shiftCreated'));
      onOpenChange(false);
    } catch (err) {
      if (applyServerErrors(err, form.setError, { fields: Object.keys(schema.shape) })) return;
      if (isApiError(err) && err.code === 'CONFLICT') form.setError('root.server', { message: t('alreadyHasShift') });
      else form.setError('root.server', { message: isApiError(err) ? err.message : tc('error') });
    }
  });

  const onDelete = () => {
    if (!shift) return;
    del.mutate(shift.id, {
      onSuccess: () => {
        toast.success(t('shiftDeleted'));
        setConfirmDelete(false);
        onOpenChange(false);
      },
      onError: (err) => toast.error(isApiError(err) ? err.message : tc('error')),
    });
  };

  const isOpenShift = target?.kind === 'edit' ? target.shift.employeeId === null : target?.employeeId === null;
  const pendingClaims = shift?.claims.filter((c) => c.status === 'PENDING') ?? [];

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={target?.kind === 'edit' ? t('editShift') : isOpenShift ? t('newOpenShift') : t('newShift')}
        description={
          target
            ? `${target.employeeName ?? t('openShift')} · ${formatDate(target.kind === 'edit' ? target.shift.date : target.date, locale)}`
            : undefined
        }
        dismissible={!save.isPending}
        footer={
          <>
            {shift && (
              <Button variant="ghost" className="text-red-fg hover:bg-red-bg sm:mr-auto" onClick={() => setConfirmDelete(true)}>
                <Trash2 />
                {t('deleteShift')}
              </Button>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              {tc('cancel')}
            </Button>
            <Button type="submit" form="shift-form" loading={save.isPending}>
              {target?.kind === 'edit' ? tc('save') : t('create')}
            </Button>
          </>
        }
      >
        <form id="shift-form" onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {shift?.status === 'PUBLISHED' && <p className="rounded-lg bg-orange-bg px-3 py-2 text-xs text-orange-fg">{t('editResetsDraft')}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('template')}>
              <Controller
                control={form.control}
                name="templateId"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(v) => {
                      field.onChange(v);
                      applyTemplate(v);
                    }}
                    options={[{ value: SELECT_NONE, label: t('noTemplate') }, ...(templates.data ?? []).map((x) => ({ value: x.id, label: `${x.name} · ${x.startTime}–${x.endTime}` }))]}
                  />
                )}
              />
            </FormField>
            <FormField label={t('date')} required error={e.date?.message}>
              <Controller control={form.control} name="date" render={({ field }) => <DatePicker value={field.value} onChange={field.onChange} />} />
            </FormField>
          </div>
          <FormField label={t('shiftName')} error={e.title?.message} hint={t('shiftNameHint')}>
            <Input {...form.register('title')} placeholder={t('shiftNamePlaceholder')} />
          </FormField>
          <div className="grid grid-cols-3 gap-3">
            <FormField label={t('startTime')} required error={e.startTime?.message}>
              <Input type="time" {...form.register('startTime')} />
            </FormField>
            <FormField label={t('endTime')} required error={e.endTime?.message}>
              <Input type="time" {...form.register('endTime')} />
            </FormField>
            <FormField label={t('breakMinutes')} error={e.breakMinutes?.message}>
              <Input type="number" min={0} max={240} step={5} {...form.register('breakMinutes')} />
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>{t('color')}</Label>
              <Controller control={form.control} name="color" render={({ field }) => <ColorPicker value={field.value} onChange={field.onChange} />} />
            </div>
            <FormField label={t('location')}>
              <Controller
                control={form.control}
                name="locationId"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    options={[{ value: SELECT_NONE, label: t('defaultLocation') }, ...(locations.data ?? []).map((l) => ({ value: l.id, label: l.name }))]}
                  />
                )}
              />
            </FormField>
          </div>
          <FormError message={e.root?.server?.message} />
        </form>

        {shift && shift.employeeId === null && (
          <div className="mt-5 border-t border-border pt-4">
            <h3 className="mb-2 text-sm font-semibold text-fg">
              {t('claims')} {pendingClaims.length > 0 && <span className="text-fg-subtle">({pendingClaims.length})</span>}
            </h3>
            {shift.claims.length === 0 ? (
              <p className="text-[13px] text-fg-subtle">{t('noClaims')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {shift.claims.map((c) => (
                  <li key={c.id} className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2">
                    <Avatar name={c.employee.fullName} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-fg">{c.employee.fullName}</div>
                      {c.employee.position && <div className="truncate text-xs text-fg-subtle">{c.employee.position}</div>}
                    </div>
                    {c.status === 'PENDING' ? (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={t('rejectClaim', { name: c.employee.fullName })}
                          disabled={decide.isPending}
                          onClick={() =>
                            decide.mutate(
                              { shiftId: shift.id, claimId: c.id, decision: 'REJECT' },
                              { onSuccess: () => toast.success(t('claimRejected')), onError: (er) => toast.error(isApiError(er) ? er.message : tc('error')) },
                            )
                          }
                        >
                          <X />
                        </Button>
                        <Button
                          size="sm"
                          disabled={decide.isPending}
                          onClick={() =>
                            decide.mutate(
                              { shiftId: shift.id, claimId: c.id, decision: 'APPROVE' },
                              {
                                onSuccess: () => {
                                  toast.success(t('claimApproved', { name: c.employee.shortName }));
                                  onOpenChange(false);
                                },
                                onError: (er) =>
                                  toast.error(isApiError(er) && er.rule === 'ALREADY_SCHEDULED' ? t('alreadyHasShift') : isApiError(er) ? er.message : tc('error')),
                              },
                            )
                          }
                        >
                          <Check />
                          {t('approve')}
                        </Button>
                      </div>
                    ) : (
                      <ApprovalPill status={c.status} variant="pill" />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Dialog>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('deleteTitle')}
        description={t('deleteText')}
        confirmLabel={t('deleteShift')}
        onConfirm={onDelete}
        loading={del.isPending}
      />
    </>
  );
}
