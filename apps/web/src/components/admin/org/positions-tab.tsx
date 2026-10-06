'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import { BriefcaseBusiness, Pencil, Plus, Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
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
import { usePositions, useSavePosition } from '@/lib/api/hooks/org';
import type { Position } from '@/lib/api/types';
import { cleanOptional } from '@/lib/forms';

function PositionDialog({ open, onOpenChange, position }: { open: boolean; onOpenChange: (o: boolean) => void; position: Position | null }) {
  const t = useTranslations('admin.org.positions');
  const tc = useTranslations('common');
  const save = useSavePosition();
  const schema = z.object({ name: z.string().trim().min(1, tc('requiredField')).max(200), nameKk: z.string().max(200) });
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: { name: position?.name ?? '', nameKk: position?.nameKk ?? '' },
  });
  const e = form.formState.errors;
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await save.mutateAsync({ id: position?.id, input: cleanOptional(v, position) });
      toast.success(position ? tc('saved') : t('created'));
      onOpenChange(false);
    } catch (err) {
      if (applyServerErrors(err, form.setError, { fields: ['name', 'nameKk'] })) return;
      form.setError('root.server', { message: isApiError(err) ? err.message : tc('error') });
    }
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={position ? t('editTitle') : t('createTitle')}
      dismissible={!save.isPending}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="position-form" loading={save.isPending}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <form id="position-form" onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormError message={e.root?.server?.message} />
        <FormField label={t('name')} required error={e.name?.message}>
          <Input {...form.register('name')} />
        </FormField>
        <FormField label={t('nameKk')} error={e.nameKk?.message}>
          <Input lang="kk" {...form.register('nameKk')} />
        </FormField>
      </form>
    </Dialog>
  );
}

export function PositionsTab() {
  const t = useTranslations('admin.org.positions');
  const tc = useTranslations('common');
  const locale = useLocale();
  const q = usePositions();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Position | null>(null);
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!q.data) return undefined;
    const s = search.trim().toLocaleLowerCase(locale);
    const collator = new Intl.Collator(locale);
    return q.data
      .filter((p) => !s || p.name.toLocaleLowerCase(locale).includes(s) || p.nameKk?.toLocaleLowerCase(locale).includes(s))
      .sort((a, b) => collator.compare(a.name, b.name));
  }, [q.data, search, locale]);

  const columns = useMemo<ColumnDef<Position, unknown>[]>(
    () => [
      { id: 'name', header: t('name'), meta: { label: t('name'), hideable: false }, cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
      { id: 'nameKk', header: t('nameKk'), meta: { label: t('nameKk') }, cell: ({ row }) => <span lang="kk">{row.original.nameKk ?? '—'}</span> },
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
        data={filtered}
        getRowId={(r) => r.id}
        isLoading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        skeletonRows={5}
        toolbar={
          <Input
            type="search"
            aria-label={tc('search')}
            placeholder={tc('searchPlaceholder')}
            leftIcon={<Search />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-72"
          />
        }
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
        empty={<EmptyState compact icon={<BriefcaseBusiness aria-hidden />} title={search ? tc('nothingFound') : t('empty')} description={search ? undefined : t('emptyHint')} />}
      />
      <PositionDialog open={open} onOpenChange={setOpen} position={editing} />
    </>
  );
}
