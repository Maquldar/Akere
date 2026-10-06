'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Minus, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { RadioGroup, Switch } from '@/components/ui/checkbox';
import { MultiSelect } from '@/components/ui/combobox';
import { DateRangeInput } from '@/components/ui/date-picker';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { FormError, FormField, Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/toaster';
import { applyServerErrors } from '@/lib/api/form-errors';
import { isApiError } from '@/lib/api/errors';
import { useApplyPattern, useShiftTemplates } from '@/lib/api/hooks/time';
import type { ScheduleRow } from '@/lib/api/types-time';
import { cn } from '@/lib/utils';
import { diffDays } from './time-utils';

/** "Применить график": generate draft shifts by a 5/2, 2/2 or custom cycle over a date range (F-41). */
export function PatternDialog({
  open,
  onOpenChange,
  rows,
  defaultFrom,
  defaultTo,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  rows: ScheduleRow[];
  defaultFrom: string;
  defaultTo: string;
}) {
  const t = useTranslations('time.pattern');
  const tc = useTranslations('common');
  const templates = useShiftTemplates();
  const apply = useApplyPattern();

  const schema = z
    .object({
      employeeIds: z.array(z.string()).min(1, t('employeesRequired')),
      templateId: z.string().min(1, tc('requiredField')),
      pattern: z.enum(['5/2', '2/2', 'custom']),
      cycle: z.array(z.boolean()),
      from: z.string().min(1, tc('requiredField')),
      to: z.string().min(1, tc('requiredField')),
      startOffset: z.coerce.number<string>().int().min(0).max(365),
      skipHolidays: z.boolean(),
      replace: z.boolean(),
    })
    .refine((v) => !v.from || !v.to || v.to >= v.from, { path: ['to'], message: t('rangeInvalid') })
    .refine((v) => !v.from || !v.to || diffDays(v.from, v.to) < 93, { path: ['to'], message: t('rangeTooLong') })
    .refine((v) => v.pattern !== 'custom' || v.cycle.some(Boolean), { path: ['cycle'], message: t('cycleRequired') });
  type In = z.input<typeof schema>;
  type Out = z.output<typeof schema>;

  const form = useForm<In, unknown, Out>({
    resolver: zodResolver(schema),
    defaultValues: {
      employeeIds: [], templateId: '', pattern: '5/2', cycle: [true, true, true, false], from: defaultFrom, to: defaultTo, startOffset: '0', skipHolidays: true, replace: false,
    },
  });
  const { reset } = form;
  useEffect(() => {
    if (open) {
      reset({
        employeeIds: rows.map((r) => r.employee.employeeId), templateId: '', pattern: '5/2', cycle: [true, true, true, false],
        from: defaultFrom, to: defaultTo, startOffset: '0', skipHolidays: true, replace: false,
      });
    }
  }, [open, reset, rows, defaultFrom, defaultTo]);

  const pattern = form.watch('pattern');
  const cycle = form.watch('cycle');
  const e = form.formState.errors;
  const options = rows.map((r) => ({ value: r.employee.employeeId, label: r.employee.fullName, description: r.employee.position ?? undefined }));

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const res = await apply.mutateAsync({
        employeeIds: v.employeeIds,
        templateId: v.templateId,
        pattern: v.pattern,
        cycle: v.pattern === 'custom' ? v.cycle : undefined,
        from: v.from,
        to: v.to,
        startOffset: v.pattern === '5/2' ? 0 : v.startOffset,
        skipHolidays: v.skipHolidays,
        replace: v.replace,
      });
      toast.success(t('done', { created: res.created, skipped: res.skipped }), { description: t('doneHint') });
      onOpenChange(false);
    } catch (err) {
      if (applyServerErrors(err, form.setError, { fields: Object.keys(schema.shape) })) return;
      form.setError('root.server', { message: isApiError(err) ? err.message : tc('error') });
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={t('title')}
      description={t('description')}
      dismissible={!apply.isPending}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={apply.isPending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="pattern-form" loading={apply.isPending}>
            {t('apply')}
          </Button>
        </>
      }
    >
      <form id="pattern-form" onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <FormField label={t('employees')} required error={e.employeeIds?.message}>
          <Controller
            control={form.control}
            name="employeeIds"
            render={({ field }) => <MultiSelect value={field.value} onChange={(v) => field.onChange(v)} options={options} placeholder={t('employeesPlaceholder')} maxChips={4} />}
          />
        </FormField>
        <FormField label={t('template')} required error={e.templateId?.message}>
          <Controller
            control={form.control}
            name="templateId"
            render={({ field }) => (
              <Select
                value={field.value || undefined}
                onValueChange={field.onChange}
                placeholder={tc('select')}
                options={(templates.data ?? []).map((x) => ({ value: x.id, label: `${x.name} · ${x.startTime}–${x.endTime}` }))}
              />
            )}
          />
        </FormField>
        <div className="flex flex-col gap-1.5">
          <Label>{t('pattern')}</Label>
          <Controller
            control={form.control}
            name="pattern"
            render={({ field }) => (
              <RadioGroup
                orientation="horizontal"
                value={field.value}
                onValueChange={field.onChange}
                aria-label={t('pattern')}
                options={[
                  { value: '5/2', label: t('p52'), description: t('p52Hint') },
                  { value: '2/2', label: t('p22'), description: t('p22Hint') },
                  { value: 'custom', label: t('pCustom'), description: t('pCustomHint') },
                ]}
              />
            )}
          />
        </div>
        {pattern === 'custom' && (
          <div className="flex flex-col gap-1.5">
            <Label>{t('cycle')}</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {cycle.map((work, i) => (
                <button
                  key={i}
                  type="button"
                  aria-pressed={work}
                  aria-label={t('cycleDay', { n: i + 1 })}
                  onClick={() => form.setValue('cycle', cycle.map((c, j) => (j === i ? !c : c)), { shouldValidate: true })}
                  className={cn(
                    'focus-ring flex h-9 w-11 flex-col items-center justify-center rounded-md border text-[11px] font-semibold',
                    work ? 'border-teal-border bg-shift-teal text-teal-fg' : 'border-border bg-surface-muted text-fg-subtle',
                  )}
                >
                  <span className="text-[10px] font-normal opacity-70">{i + 1}</span>
                  {work ? t('work') : t('off')}
                </button>
              ))}
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={t('removeDay')}
                disabled={cycle.length <= 1}
                onClick={() => form.setValue('cycle', cycle.slice(0, -1), { shouldValidate: true })}
              >
                <Minus />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={t('addDay')}
                disabled={cycle.length >= 28}
                onClick={() => form.setValue('cycle', [...cycle, false], { shouldValidate: true })}
              >
                <Plus />
              </Button>
            </div>
            {e.cycle?.message && <p className="text-xs font-medium text-red-fg">{e.cycle.message}</p>}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
          <FormField label={t('range')} required error={e.to?.message ?? e.from?.message}>
            <Controller
              control={form.control}
              name="from"
              render={({ field }) => (
                <DateRangeInput
                  value={{ from: field.value, to: form.watch('to') }}
                  onChange={(r) => {
                    field.onChange(r.from ?? '');
                    form.setValue('to', r.to ?? '');
                  }}
                />
              )}
            />
          </FormField>
          {pattern !== '5/2' && (
            <FormField label={t('offset')} hint={t('offsetHint')}>
              <Input type="number" min={0} max={365} {...form.register('startOffset')} />
            </FormField>
          )}
        </div>
        <Controller
          control={form.control}
          name="skipHolidays"
          render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} label={t('skipHolidays')} description={t('skipHolidaysHint')} />}
        />
        <Controller
          control={form.control}
          name="replace"
          render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} label={t('replace')} description={t('replaceHint')} />}
        />
        <FormError message={e.root?.server?.message} />
      </form>
    </Dialog>
  );
}
