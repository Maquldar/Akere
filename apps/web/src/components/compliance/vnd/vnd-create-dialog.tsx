'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import { Dialog } from '@/components/ui/dialog';
import { FileDropzone } from '@/components/ui/file-dropzone';
import { Input } from '@/components/ui/input';
import { FormError, FormField } from '@/components/ui/label';
import { Select, SELECT_NONE } from '@/components/ui/select';
import { toast } from '@/components/ui/toaster';
import { useCurrentUser } from '@/components/shell/me-context';
import { useRouter } from '@/i18n/navigation';
import { isApiError } from '@/lib/api/errors';
import { applyServerErrors } from '@/lib/api/form-errors';
import { useCreateVnd, useDocumentTypes } from '@/lib/api/hooks/compliance';
import { useLegalEntities } from '@/lib/api/hooks/org';

const ACCEPT = ['.pdf', '.docx'];

export function VndCreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('vnd.create');
  const tc = useTranslations('common');
  const { me } = useCurrentUser();
  const router = useRouter();
  const entities = useLegalEntities();
  const types = useDocumentTypes('VND');
  const create = useCreateVnd();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  const schema = z.object({
    title: z.string().trim().min(1, tc('requiredField')).max(300),
    legalEntityId: z.string().min(1, tc('requiredField')),
    documentTypeId: z.string(),
    dueAt: z.string(),
    requireSignature: z.boolean(),
  });
  type Form = z.infer<typeof schema>;
  const defaultEntity = me.employee?.legalEntityId ?? '';
  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { title: '', legalEntityId: defaultEntity, documentTypeId: SELECT_NONE, dueAt: '', requireSignature: true },
  });
  const e = form.formState.errors;
  const entityValue = form.watch('legalEntityId');
  // Preselect the only (or the user's own) legal entity once the list loads.
  useEffect(() => {
    if (!form.getValues('legalEntityId') && entities.data?.length) form.setValue('legalEntityId', entities.data[0]!.id);
  }, [entities.data, form, open]);

  const close = (o: boolean) => {
    if (create.isPending) return;
    onOpenChange(o);
    if (!o) {
      form.reset();
      setFile(null);
      setFileError(null);
      setProgress(null);
    }
  };

  const onSubmit = form.handleSubmit(async (v) => {
    if (!file) {
      setFileError(t('fileRequired'));
      return;
    }
    try {
      const doc = await create.mutateAsync({
        input: {
          title: v.title,
          legalEntityId: v.legalEntityId,
          documentTypeId: v.documentTypeId === SELECT_NONE ? undefined : v.documentTypeId,
          dueAt: v.dueAt || undefined,
          requireSignature: v.requireSignature,
          file,
        },
        onProgress: setProgress,
      });
      toast.success(t('created'));
      close(false);
      router.push(`/vnd/${doc.id}`);
    } catch (err) {
      setProgress(null);
      if (isApiError(err) && err.fieldErrors.file) {
        setFileError(err.fieldErrors.file[0] ?? null);
        return;
      }
      if (isApiError(err) && (err.code === 'UNSUPPORTED_FILE' || err.code === 'FILE_TOO_LARGE')) {
        setFileError(err.message);
        return;
      }
      if (applyServerErrors(err, form.setError, { fields: Object.keys(schema.shape) })) return;
      form.setError('root.server', { message: isApiError(err) ? err.message : tc('error') });
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={t('title')}
      description={t('description')}
      dismissible={!create.isPending}
      footer={
        <>
          <Button variant="outline" onClick={() => close(false)} disabled={create.isPending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="vnd-create-form" loading={create.isPending}>
            {t('submit')}
          </Button>
        </>
      }
    >
      <form id="vnd-create-form" onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormError message={e.root?.server?.message} />
        <FormField label={t('name')} required error={e.title?.message}>
          <Input autoComplete="off" placeholder={t('namePlaceholder')} {...form.register('title')} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            control={form.control}
            name="legalEntityId"
            render={({ field }) => (
              <FormField label={t('legalEntity')} required error={e.legalEntityId?.message}>
                <Select
                  value={entityValue || undefined}
                  onValueChange={field.onChange}
                  placeholder={tc('select')}
                  options={(entities.data ?? []).map((le) => ({ value: le.id, label: le.name }))}
                />
              </FormField>
            )}
          />
          <Controller
            control={form.control}
            name="documentTypeId"
            render={({ field }) => (
              <FormField label={t('type')} hint={t('typeHint')}>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  options={[
                    { value: SELECT_NONE, label: t('typeDefault') },
                    ...(types.data ?? []).filter((dt) => dt.isActive).map((dt) => ({ value: dt.id, label: dt.name })),
                  ]}
                />
              </FormField>
            )}
          />
        </div>
        <Controller
          control={form.control}
          name="dueAt"
          render={({ field }) => (
            <FormField label={t('dueAt')} hint={t('dueAtHint')} error={e.dueAt?.message}>
              <DatePicker value={field.value} onChange={field.onChange} min={new Date().toISOString().slice(0, 10)} className="sm:w-56" />
            </FormField>
          )}
        />
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium text-fg">
            {t('file')}
            <span className="ml-0.5 text-red-fg" aria-hidden>
              *
            </span>
          </span>
          <FileDropzone
            accept={ACCEPT}
            label={t('file')}
            files={file ? [file] : []}
            onFiles={(fs) => {
              setFile(fs[0] ?? null);
              setFileError(null);
            }}
            onRemove={() => setFile(null)}
            progress={progress}
            disabled={create.isPending}
          />
          {fileError && (
            <p role="alert" className="text-xs font-medium text-red-fg">
              {fileError}
            </p>
          )}
        </div>
        <Controller
          control={form.control}
          name="requireSignature"
          render={({ field }) => (
            <Switch
              checked={field.value}
              onCheckedChange={(v) => field.onChange(v === true)}
              label={t('requireSignature')}
              description={t('requireSignatureHint')}
            />
          )}
        />
      </form>
    </Dialog>
  );
}
