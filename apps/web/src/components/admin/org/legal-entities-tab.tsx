'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import { Building2, Pencil, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { FormError, FormField } from '@/components/ui/label';
import { EmptyState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { applyServerErrors } from '@/lib/api/form-errors';
import { isApiError } from '@/lib/api/errors';
import { useLegalEntities, useSaveLegalEntity } from '@/lib/api/hooks/org';
import type { LegalEntity } from '@/lib/api/types';
import { cleanOptional } from '@/lib/forms';
import { BIN_RE } from '@/lib/validation';

function LegalEntityDialog({ open, onOpenChange, entity }: { open: boolean; onOpenChange: (o: boolean) => void; entity: LegalEntity | null }) {
  const t = useTranslations('admin.org.entities');
  const tc = useTranslations('common');
  const save = useSaveLegalEntity();
  const schema = z.object({
    name: z.string().trim().min(1, tc('requiredField')).max(300),
    nameKk: z.string().max(300),
    bin: z.string().trim().regex(BIN_RE, t('binInvalid')),
    address: z.string().max(500),
    directorName: z.string().max(200),
  });
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: {
      name: entity?.name ?? '',
      nameKk: entity?.nameKk ?? '',
      bin: entity?.bin ?? '',
      address: entity?.address ?? '',
      directorName: entity?.directorName ?? '',
    },
  });
  const e = form.formState.errors;
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const input = cleanOptional(v, entity);
      await save.mutateAsync({ id: entity?.id, input });
      toast.success(entity ? tc('saved') : t('created'));
      onOpenChange(false);
    } catch (err) {
      if (applyServerErrors(err, form.setError, { fields: Object.keys(schema.shape) })) return;
      if (isApiError(err) && err.code === 'CONFLICT') form.setError('bin', { message: t('binTaken') });
      else form.setError('root.server', { message: isApiError(err) ? err.message : tc('error') });
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={entity ? t('editTitle') : t('createTitle')}
      dismissible={!save.isPending}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="legal-entity-form" loading={save.isPending}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <form id="legal-entity-form" onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormError message={e.root?.server?.message} />
        <FormField label={t('name')} required error={e.name?.message}>
          <Input placeholder={t('namePlaceholder')} {...form.register('name')} />
        </FormField>
        <FormField label={t('nameKk')} error={e.nameKk?.message}>
          <Input lang="kk" {...form.register('nameKk')} />
        </FormField>
        <FormField label={t('bin')} required error={e.bin?.message} hint={t('binHint')}>
          <Input inputMode="numeric" maxLength={12} className="tabular" {...form.register('bin')} />
        </FormField>
        <FormField label={t('director')} error={e.directorName?.message}>
          <Input {...form.register('directorName')} />
        </FormField>
        <FormField label={t('address')} error={e.address?.message}>
          <Input {...form.register('address')} />
        </FormField>
      </form>
    </Dialog>
  );
}

export function LegalEntitiesTab() {
  const t = useTranslations('admin.org.entities');
  const tc = useTranslations('common');
  const q = useLegalEntities();
  const [editing, setEditing] = useState<LegalEntity | null>(null);
  const [open, setOpen] = useState(false);

  const columns = useMemo<ColumnDef<LegalEntity, unknown>[]>(
    () => [
      {
        id: 'name',
        header: t('name'),
        meta: { label: t('name'), hideable: false },
        cell: ({ row }) => (
          <div className="min-w-[200px]">
            <div className="font-medium text-fg">{row.original.name}</div>
            {row.original.nameKk && <div className="text-xs text-fg-subtle" lang="kk">{row.original.nameKk}</div>}
          </div>
        ),
      },
      { id: 'bin', header: t('bin'), meta: { label: t('bin') }, cell: ({ row }) => <span className="tabular">{row.original.bin}</span> },
      { id: 'director', header: t('director'), meta: { label: t('director') }, cell: ({ row }) => row.original.directorName ?? '—' },
      {
        id: 'address',
        header: t('address'),
        meta: { label: t('address'), className: 'max-w-[280px]' },
        cell: ({ row }) => <span className="line-clamp-2">{row.original.address ?? '—'}</span>,
      },
      {
        id: 'employees',
        header: t('employees'),
        meta: { label: t('employees'), className: 'text-right tabular', headerClassName: 'text-right' },
        cell: ({ row }) => row.original.employeeCount,
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{tc('actions')}</span>,
        meta: { hideable: false, className: 'w-12 text-right' },
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={tc('editNamed', { name: row.original.name })}
            onClick={() => {
              setEditing(row.original);
              setOpen(true);
            }}
          >
            <Pencil />
          </Button>
        ),
      },
    ],
    [t, tc],
  );

  return (
    <>
      <DataTable
        label={t('title')}
        columns={columns}
        data={q.data}
        getRowId={(r) => r.id}
        isLoading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        columnVisibilityKey="legal-entities"
        skeletonRows={3}
        toolbar={<p className="text-[13px] text-fg-muted">{q.data ? t('total', { count: q.data.length }) : ''}</p>}
        toolbarRight={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus />
            {t('add')}
          </Button>
        }
        empty={<EmptyState compact icon={<Building2 aria-hidden />} title={t('empty')} description={t('emptyHint')} />}
      />
      <LegalEntityDialog open={open} onOpenChange={setOpen} entity={editing} />
    </>
  );
}
