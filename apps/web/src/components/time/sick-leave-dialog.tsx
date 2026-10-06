'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { FileText, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { DateRangeInput } from '@/components/ui/date-picker';
import { Dialog } from '@/components/ui/dialog';
import { FileDropzone } from '@/components/ui/file-dropzone';
import { Input, Textarea } from '@/components/ui/input';
import { FormError, FormField } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/toaster';
import { applyServerErrors } from '@/lib/api/form-errors';
import { isApiError } from '@/lib/api/errors';
import { searchEmployeeOptions, useSaveSickLeave } from '@/lib/api/hooks/time';
import { uploadFiles } from '@/lib/api/upload';
import type { FileRef } from '@/lib/api/types';
import type { SickLeaveInput, SickLeaveView } from '@/lib/api/types-time';
import { formatBytes } from '@/lib/utils';
import { diffDays } from './time-utils';

const ACCEPT = ['.pdf', '.jpg', '.jpeg', '.png'];

/** Create / edit a sick-leave record; the scan goes through `POST /uploads` first. */
export function SickLeaveDialog({ open, onOpenChange, item }: { open: boolean; onOpenChange: (o: boolean) => void; item: SickLeaveView | null }) {
  const t = useTranslations('absences.sick');
  const tc = useTranslations('common');
  const save = useSaveSickLeave();
  const [file, setFile] = useState<File | null>(null);
  const [keepFile, setKeepFile] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);

  const schema = z
    .object({
      employeeId: z.string(),
      number: z.string().trim().min(1, tc('requiredField')).max(64),
      startDate: z.string().min(1, tc('requiredField')),
      endDate: z.string().min(1, tc('requiredField')),
      source: z.enum(['MANUAL', 'ELECTRONIC']),
      note: z.string().max(1000),
    })
    .refine((v) => item || v.employeeId, { path: ['employeeId'], message: tc('requiredField') })
    .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, { path: ['endDate'], message: t('rangeInvalid') });
  type Values = z.infer<typeof schema>;

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { employeeId: '', number: '', startDate: '', endDate: '', source: 'MANUAL', note: '' },
  });
  const { reset } = form;
  useEffect(() => {
    if (!open) return;
    setFile(null);
    setKeepFile(true);
    setProgress(null);
    reset({
      employeeId: '',
      number: item?.number ?? '',
      startDate: item?.startDate ?? '',
      endDate: item?.endDate ?? '',
      source: item?.source ?? 'MANUAL',
      note: item?.note ?? '',
    });
  }, [open, item, reset]);

  const e = form.formState.errors;
  const start = form.watch('startDate');
  const end = form.watch('endDate');
  const days = start && end && end >= start ? diffDays(start, end) + 1 : null;
  const busy = save.isPending || progress !== null;

  const onSubmit = form.handleSubmit(async (v) => {
    let fileId: string | null | undefined;
    try {
      if (file) {
        setProgress(0);
        const ref = await uploadFiles<FileRef>('/uploads', file, { onProgress: setProgress });
        fileId = ref.id;
      } else if (item?.file && !keepFile) fileId = null;
    } catch (err) {
      setProgress(null);
      toast.error(isApiError(err) && err.code === 'UNSUPPORTED_FILE' ? t('badFile') : isApiError(err) && err.code === 'FILE_TOO_LARGE' ? t('fileTooLarge') : t('uploadFailed'));
      return;
    }
    setProgress(null);
    const base: Partial<SickLeaveInput> = {
      number: v.number.trim(),
      startDate: v.startDate,
      endDate: v.endDate,
      source: v.source,
      note: v.note.trim() || (item?.note ? null : undefined),
      ...(fileId !== undefined ? { fileId } : {}),
    };
    try {
      if (item) await save.mutateAsync({ id: item.id, input: base });
      else await save.mutateAsync({ input: { ...base, employeeId: v.employeeId } });
      toast.success(item ? t('updated') : t('created'));
      onOpenChange(false);
    } catch (err) {
      if (applyServerErrors(err, form.setError, { fields: Object.keys(schema.shape) })) return;
      if (isApiError(err) && err.code === 'CONFLICT') {
        const fields = (err.details as { fields?: string[] } | undefined)?.fields;
        if (fields?.includes('number')) form.setError('number', { message: t('numberTaken') });
        else form.setError('root.server', { message: t('overlap') });
      } else if (isApiError(err) && err.code === 'FORBIDDEN') form.setError('employeeId', { message: t('outOfScope') });
      else form.setError('root.server', { message: isApiError(err) ? err.message : tc('error') });
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={item ? t('editTitle') : t('createTitle')}
      description={item ? item.employee.fullName : t('createDescription')}
      dismissible={!busy}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="sick-leave-form" loading={busy}>
            {item ? tc('save') : t('create')}
          </Button>
        </>
      }
    >
      <form id="sick-leave-form" onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {!item && (
          <FormField label={t('employee')} required error={e.employeeId?.message}>
            <Controller
              control={form.control}
              name="employeeId"
              render={({ field }) => (
                <Combobox value={field.value || null} onChange={(v) => field.onChange(v ?? '')} loadOptions={searchEmployeeOptions} placeholder={t('employeePlaceholder')} />
              )}
            />
          </FormField>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('number')} required error={e.number?.message}>
            <Input {...form.register('number')} placeholder={t('numberPlaceholder')} autoComplete="off" />
          </FormField>
          <FormField label={t('source')}>
            <Controller
              control={form.control}
              name="source"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  options={[
                    { value: 'MANUAL', label: t('sourceManual') },
                    { value: 'ELECTRONIC', label: t('sourceElectronic') },
                  ]}
                />
              )}
            />
          </FormField>
        </div>
        <FormField label={t('period')} required error={e.endDate?.message ?? e.startDate?.message} hint={days ? t('daysCount', { count: days }) : undefined}>
          <Controller
            control={form.control}
            name="startDate"
            render={({ field }) => (
              <DateRangeInput
                value={{ from: field.value, to: end }}
                onChange={(r) => {
                  field.onChange(r.from ?? '');
                  form.setValue('endDate', r.to ?? '', { shouldValidate: form.formState.isSubmitted });
                }}
              />
            )}
          />
        </FormField>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-fg">{t('file')}</span>
          {item?.file && keepFile && !file ? (
            <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-[13px]">
              <FileText className="size-4 shrink-0 text-fg-subtle" aria-hidden />
              <a href={item.file.url} target="_blank" rel="noreferrer" className="focus-ring min-w-0 flex-1 truncate rounded text-primary hover:underline">
                {item.file.filename}
              </a>
              <span className="text-xs text-fg-subtle tabular">{formatBytes(item.file.size)}</span>
              <Button variant="ghost" size="icon-sm" onClick={() => setKeepFile(false)} aria-label={tc('removeItem', { name: item.file.filename })}>
                <X />
              </Button>
            </div>
          ) : (
            <FileDropzone
              accept={ACCEPT}
              onFiles={(fs) => setFile(fs[0] ?? null)}
              files={file ? [file] : []}
              onRemove={() => setFile(null)}
              progress={progress}
              label={t('fileLabel')}
              disabled={busy}
            />
          )}
        </div>
        <FormField label={t('note')} error={e.note?.message}>
          <Textarea rows={2} {...form.register('note')} />
        </FormField>
        <FormError message={e.root?.server?.message} />
      </form>
    </Dialog>
  );
}
