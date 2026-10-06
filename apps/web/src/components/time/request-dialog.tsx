'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker';
import { Dialog } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { FormError, FormField } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/toaster';
import { applyServerErrors } from '@/lib/api/form-errors';
import { isApiError } from '@/lib/api/errors';
import { searchEmployeeOptions, useCreateTimeRequest, useMyDay } from '@/lib/api/hooks/time';
import type { TimeRequestInput, TimeRequestKind } from '@/lib/api/types-time';
import { formatDate } from '@/lib/format';
import { shiftRange, todayStr } from './time-utils';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** New time request: correction / work on a day off / substitution (F-39). */
export function TimeRequestDialog({
  open,
  onOpenChange,
  defaultKind = 'CORRECTION',
  defaultDate,
  defaultIn,
  defaultOut,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultKind?: TimeRequestKind;
  defaultDate?: string;
  defaultIn?: string;
  defaultOut?: string;
}) {
  const t = useTranslations('time.requests');
  const tk = useTranslations('time.requestKind');
  const tc = useTranslations('common');
  const locale = useLocale();
  const create = useCreateTimeRequest();
  const day = useMyDay();

  const myShifts = useMemo(() => {
    const list = [day.data?.shift ?? null, ...(day.data?.upcoming.map((u) => u.shift) ?? [])].filter((s): s is NonNullable<typeof s> => Boolean(s));
    return list.filter((s, i) => list.findIndex((x) => x.id === s.id) === i && s.date >= todayStr());
  }, [day.data]);

  const schema = z
    .object({
      kind: z.enum(['CORRECTION', 'DAY_OFF_WORK', 'SUBSTITUTION']),
      date: z.string(),
      in: z.string(),
      out: z.string(),
      start: z.string(),
      end: z.string(),
      shiftId: z.string(),
      substituteEmployeeId: z.string(),
      reason: z.string().trim().min(1, tc('requiredField')).max(1000),
    })
    .superRefine((v, ctx) => {
      const req = (path: string) => ctx.addIssue({ code: 'custom', path: [path], message: tc('requiredField') });
      const badTime = (path: string) => ctx.addIssue({ code: 'custom', path: [path], message: t('timeInvalid') });
      if (v.kind !== 'SUBSTITUTION' && !v.date) req('date');
      if (v.kind === 'CORRECTION') {
        if (!v.in && !v.out) ctx.addIssue({ code: 'custom', path: ['in'], message: t('inOrOut') });
        if (v.in && !TIME_RE.test(v.in)) badTime('in');
        if (v.out && !TIME_RE.test(v.out)) badTime('out');
        if (v.date && v.date > todayStr()) ctx.addIssue({ code: 'custom', path: ['date'], message: t('notFuture') });
      }
      if (v.kind === 'DAY_OFF_WORK') {
        if (!v.start) req('start');
        else if (!TIME_RE.test(v.start)) badTime('start');
        if (!v.end) req('end');
        else if (!TIME_RE.test(v.end)) badTime('end');
        if (v.start && v.start === v.end) ctx.addIssue({ code: 'custom', path: ['end'], message: t('endDiffers') });
      }
      if (v.kind === 'SUBSTITUTION') {
        if (!v.shiftId) req('shiftId');
        if (!v.substituteEmployeeId) req('substituteEmployeeId');
      }
    });
  type Values = z.infer<typeof schema>;

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { kind: defaultKind, date: defaultDate ?? todayStr(), in: '', out: '', start: '', end: '', shiftId: '', substituteEmployeeId: '', reason: '' },
  });
  const { reset } = form;
  useEffect(() => {
    if (open) {
      reset({ kind: defaultKind, date: defaultDate ?? todayStr(), in: defaultIn ?? '', out: defaultOut ?? '', start: '', end: '', shiftId: '', substituteEmployeeId: '', reason: '' });
    }
  }, [open, reset, defaultKind, defaultDate, defaultIn, defaultOut]);
  const kind = form.watch('kind');
  const e = form.formState.errors;

  const onSubmit = form.handleSubmit(async (v) => {
    let input: TimeRequestInput;
    if (v.kind === 'CORRECTION') input = { kind: 'CORRECTION', date: v.date, in: v.in || undefined, out: v.out || undefined, reason: v.reason.trim() };
    else if (v.kind === 'DAY_OFF_WORK') input = { kind: 'DAY_OFF_WORK', date: v.date, start: v.start, end: v.end, reason: v.reason.trim() };
    else input = { kind: 'SUBSTITUTION', shiftId: v.shiftId, substituteEmployeeId: v.substituteEmployeeId, reason: v.reason.trim() };
    try {
      await create.mutateAsync(input);
      toast.success(t('created'));
      onOpenChange(false);
    } catch (err) {
      if (applyServerErrors(err, form.setError, { fields: Object.keys(schema.shape) })) return;
      if (isApiError(err) && err.code === 'CONFLICT') form.setError('root.server', { message: t('duplicate') });
      else if (isApiError(err) && err.rule === 'DATE_IN_FUTURE') form.setError('date', { message: t('notFuture') });
      else if (isApiError(err) && err.rule === 'SHIFT_IN_PAST') form.setError('shiftId', { message: t('shiftInPast') });
      else form.setError('root.server', { message: isApiError(err) ? err.message : tc('error') });
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('newTitle')}
      description={t('newDescription')}
      dismissible={!create.isPending}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="time-request-form" loading={create.isPending}>
            {t('send')}
          </Button>
        </>
      }
    >
      <form id="time-request-form" onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <FormField label={t('kind')} required>
          <Controller
            control={form.control}
            name="kind"
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={(v) => field.onChange(v as TimeRequestKind)}
                options={(['CORRECTION', 'DAY_OFF_WORK', 'SUBSTITUTION'] as const).map((k) => ({ value: k, label: tk(k) }))}
              />
            )}
          />
        </FormField>

        {kind !== 'SUBSTITUTION' && (
          <FormField label={t('date')} required error={e.date?.message}>
            <Controller
              control={form.control}
              name="date"
              render={({ field }) => <DatePicker value={field.value} onChange={field.onChange} max={kind === 'CORRECTION' ? todayStr() : undefined} />}
            />
          </FormField>
        )}

        {kind === 'CORRECTION' && (
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t('in')} error={e.in?.message} hint={t('inOutHint')}>
              <Input type="time" {...form.register('in')} />
            </FormField>
            <FormField label={t('out')} error={e.out?.message}>
              <Input type="time" {...form.register('out')} />
            </FormField>
          </div>
        )}

        {kind === 'DAY_OFF_WORK' && (
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t('start')} required error={e.start?.message}>
              <Input type="time" {...form.register('start')} />
            </FormField>
            <FormField label={t('end')} required error={e.end?.message}>
              <Input type="time" {...form.register('end')} />
            </FormField>
          </div>
        )}

        {kind === 'SUBSTITUTION' && (
          <>
            <FormField label={t('shift')} required error={e.shiftId?.message} hint={myShifts.length === 0 ? t('noShifts') : undefined}>
              <Controller
                control={form.control}
                name="shiftId"
                render={({ field }) => (
                  <Select
                    value={field.value || undefined}
                    onValueChange={field.onChange}
                    placeholder={tc('select')}
                    disabled={myShifts.length === 0}
                    options={myShifts.map((s) => ({ value: s.id, label: `${formatDate(s.date, locale)} · ${s.title} · ${shiftRange(s, locale)}` }))}
                  />
                )}
              />
            </FormField>
            <FormField label={t('substitute')} required error={e.substituteEmployeeId?.message}>
              <Controller
                control={form.control}
                name="substituteEmployeeId"
                render={({ field }) => (
                  <Combobox value={field.value || null} onChange={(v) => field.onChange(v ?? '')} loadOptions={searchEmployeeOptions} placeholder={t('substitutePlaceholder')} />
                )}
              />
            </FormField>
          </>
        )}

        <FormField label={t('reason')} required error={e.reason?.message}>
          <Textarea rows={3} {...form.register('reason')} placeholder={t('reasonPlaceholder')} />
        </FormField>
        <FormError message={e.root?.server?.message} />
      </form>
    </Dialog>
  );
}
