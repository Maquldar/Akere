'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Pencil, Plus, Power, PowerOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { FormError, FormField, Label } from '@/components/ui/label';
import { Select, SELECT_NONE } from '@/components/ui/select';
import { SkeletonList } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { applyServerErrors } from '@/lib/api/form-errors';
import { isApiError } from '@/lib/api/errors';
import { useLocations } from '@/lib/api/hooks/org';
import { useDeactivateTemplate, useSaveTemplate, useShiftTemplates } from '@/lib/api/hooks/time';
import { SHIFT_COLORS, type ShiftTemplateView } from '@/lib/api/types-time';
import { cn } from '@/lib/utils';
import { useDuration } from './shared';
import { ColorPicker } from './shift-dialog';
import { shiftChipClass } from './time-utils';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function TemplateForm({ template, onDone }: { template: ShiftTemplateView | null; onDone: () => void }) {
  const t = useTranslations('time.templates');
  const tp = useTranslations('time.planning');
  const tc = useTranslations('common');
  const locations = useLocations();
  const save = useSaveTemplate();
  const schema = z
    .object({
      name: z.string().trim().min(1, tc('requiredField')).max(120),
      startTime: z.string().regex(TIME_RE, tp('timeInvalid')),
      endTime: z.string().regex(TIME_RE, tp('timeInvalid')),
      breakMinutes: z.coerce.number<string>().int().min(0, tp('breakInvalid')).max(240, tp('breakInvalid')),
      color: z.enum(SHIFT_COLORS),
      locationId: z.string(),
    })
    .refine((v) => v.startTime !== v.endTime, { path: ['endTime'], message: tp('endDiffers') });
  type In = z.input<typeof schema>;
  type Out = z.output<typeof schema>;
  const form = useForm<In, unknown, Out>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: template?.name ?? '',
      startTime: template?.startTime ?? '09:00',
      endTime: template?.endTime ?? '18:00',
      breakMinutes: String(template?.breakMinutes ?? 60),
      color: template?.color ?? 'green',
      locationId: template?.location?.id ?? SELECT_NONE,
    },
  });
  const e = form.formState.errors;
  const onSubmit = form.handleSubmit(async (v) => {
    const input = { ...v, name: v.name.trim(), locationId: v.locationId === SELECT_NONE ? null : v.locationId };
    try {
      await save.mutateAsync({ id: template?.id, input });
      toast.success(template ? t('updated') : t('created'));
      onDone();
    } catch (err) {
      if (applyServerErrors(err, form.setError, { fields: Object.keys(schema.shape) })) return;
      form.setError('root.server', { message: isApiError(err) ? err.message : tc('error') });
    }
  });
  return (
    <form id="template-form" onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <FormField label={t('name')} required error={e.name?.message}>
        <Input {...form.register('name')} placeholder={t('namePlaceholder')} />
      </FormField>
      <div className="grid grid-cols-3 gap-3">
        <FormField label={tp('startTime')} required error={e.startTime?.message}>
          <Input type="time" {...form.register('startTime')} />
        </FormField>
        <FormField label={tp('endTime')} required error={e.endTime?.message}>
          <Input type="time" {...form.register('endTime')} />
        </FormField>
        <FormField label={tp('breakMinutes')} error={e.breakMinutes?.message}>
          <Input type="number" min={0} max={240} step={5} {...form.register('breakMinutes')} />
        </FormField>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>{tp('color')}</Label>
        <Controller control={form.control} name="color" render={({ field }) => <ColorPicker value={field.value} onChange={field.onChange} />} />
      </div>
      <FormField label={tp('location')}>
        <Controller
          control={form.control}
          name="locationId"
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={field.onChange}
              options={[{ value: SELECT_NONE, label: tp('defaultLocation') }, ...(locations.data ?? []).map((l) => ({ value: l.id, label: l.name }))]}
            />
          )}
        />
      </FormField>
      <FormError message={e.root?.server?.message} />
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onDone} disabled={save.isPending}>
          {tc('cancel')}
        </Button>
        <Button type="submit" loading={save.isPending}>
          {template ? tc('save') : t('create')}
        </Button>
      </div>
    </form>
  );
}

/** Shift templates manager (name, time, break, color, location; soft-deactivate). */
export function TemplatesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('time.templates');
  const tc = useTranslations('common');
  const dur = useDuration();
  const templates = useShiftTemplates(true);
  const save = useSaveTemplate();
  const deactivate = useDeactivateTemplate();
  const [editing, setEditing] = useState<ShiftTemplateView | 'new' | null>(null);
  const [toDeactivate, setToDeactivate] = useState<ShiftTemplateView | null>(null);

  useEffect(() => {
    if (!open) setEditing(null);
  }, [open]);

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        size="md"
        title={editing ? (editing === 'new' ? t('newTitle') : t('editTitle')) : t('title')}
        description={editing ? undefined : t('description')}
      >
        {editing ? (
          <>
            <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={() => setEditing(null)}>
              <ArrowLeft />
              {t('back')}
            </Button>
            <TemplateForm template={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <Button variant="outline" className="self-start" onClick={() => setEditing('new')}>
              <Plus />
              {t('new')}
            </Button>
            {templates.isLoading && <SkeletonList rows={4} />}
            {templates.isError && <ErrorState error={templates.error} onRetry={() => templates.refetch()} compact />}
            {templates.data && templates.data.length === 0 && <EmptyState compact title={t('empty')} />}
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {templates.data?.map((tpl) => (
                <li key={tpl.id} className={cn('flex items-center gap-3 px-3 py-2.5', !tpl.isActive && 'opacity-60')}>
                  <span className={cn('size-2.5 shrink-0 rounded-full', shiftChipClass[tpl.color].dot)} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-fg">{tpl.name}</span>
                      {!tpl.isActive && <Badge tone="gray">{t('inactive')}</Badge>}
                    </div>
                    <div className="truncate text-xs text-fg-subtle tabular">
                      {tpl.startTime}–{tpl.endTime} · {t('breakShort', { duration: dur(tpl.breakMinutes) })}
                      {tpl.location ? ` · ${tpl.location.name}` : ''}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon-sm" onClick={() => setEditing(tpl)} aria-label={tc('editNamed', { name: tpl.name })}>
                    <Pencil />
                  </Button>
                  {tpl.isActive ? (
                    <Button variant="ghost" size="icon-sm" onClick={() => setToDeactivate(tpl)} aria-label={t('deactivateNamed', { name: tpl.name })}>
                      <PowerOff />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('activateNamed', { name: tpl.name })}
                      onClick={() =>
                        save.mutate(
                          { id: tpl.id, input: { isActive: true } },
                          { onSuccess: () => toast.success(t('activated')), onError: (er) => toast.error(isApiError(er) ? er.message : tc('error')) },
                        )
                      }
                    >
                      <Power />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Dialog>
      <ConfirmDialog
        open={Boolean(toDeactivate)}
        onOpenChange={(o) => !o && setToDeactivate(null)}
        title={t('deactivateTitle')}
        description={t('deactivateText', { name: toDeactivate?.name ?? '' })}
        confirmLabel={t('deactivate')}
        loading={deactivate.isPending}
        onConfirm={() =>
          toDeactivate &&
          deactivate.mutate(toDeactivate.id, {
            onSuccess: () => {
              toast.success(t('deactivated'));
              setToDeactivate(null);
            },
            onError: (er) => toast.error(isApiError(er) ? er.message : tc('error')),
          })
        }
      />
    </>
  );
}
