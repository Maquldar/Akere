'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import { ExternalLink, LocateFixed, MapPin, Pencil, Plus } from 'lucide-react';
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
import { useLocations, useSaveLocation } from '@/lib/api/hooks/org';
import type { WorkLocation } from '@/lib/api/types';
import { cleanOptional } from '@/lib/forms';

export function osmLink(lat: number, lng: number) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
}

function LocationDialog({ open, onOpenChange, location }: { open: boolean; onOpenChange: (o: boolean) => void; location: WorkLocation | null }) {
  const t = useTranslations('admin.org.locations');
  const tc = useTranslations('common');
  const save = useSaveLocation();
  const [locating, setLocating] = useState(false);
  const num = (min: number, max: number, msg: string) =>
    z
      .string()
      .trim()
      .min(1, tc('requiredField'))
      .refine((v) => {
        const n = Number(v.replace(',', '.'));
        return Number.isFinite(n) && n >= min && n <= max;
      }, msg);
  const schema = z.object({
    name: z.string().trim().min(1, tc('requiredField')).max(200),
    address: z.string().max(500),
    lat: num(-90, 90, t('latInvalid')),
    lng: num(-180, 180, t('lngInvalid')),
    radiusM: z
      .string()
      .trim()
      .refine((v) => /^\d+$/.test(v) && Number(v) >= 10 && Number(v) <= 10000, t('radiusInvalid')),
  });
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: {
      name: location?.name ?? '',
      address: location?.address ?? '',
      lat: location ? String(location.lat) : '',
      lng: location ? String(location.lng) : '',
      radiusM: location ? String(location.radiusM) : '150',
    },
  });
  const e = form.formState.errors;

  const fillMyLocation = () => {
    if (!('geolocation' in navigator)) {
      toast.error(t('geoUnavailable'));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        form.setValue('lat', pos.coords.latitude.toFixed(6), { shouldDirty: true, shouldValidate: true });
        form.setValue('lng', pos.coords.longitude.toFixed(6), { shouldDirty: true, shouldValidate: true });
        setLocating(false);
      },
      () => {
        toast.error(t('geoDenied'));
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const input = {
        ...cleanOptional({ name: v.name, address: v.address }, location),
        lat: Number(v.lat.replace(',', '.')),
        lng: Number(v.lng.replace(',', '.')),
        radiusM: Number(v.radiusM),
      };
      await save.mutateAsync({ id: location?.id, input });
      toast.success(location ? tc('saved') : t('created'));
      onOpenChange(false);
    } catch (err) {
      if (applyServerErrors(err, form.setError, { fields: ['name', 'address', 'lat', 'lng', 'radiusM'] })) return;
      form.setError('root.server', { message: isApiError(err) ? err.message : tc('error') });
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={location ? t('editTitle') : t('createTitle')}
      description={t('dialogHint')}
      dismissible={!save.isPending}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="location-form" loading={save.isPending}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <form id="location-form" onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormError message={e.root?.server?.message} />
        <FormField label={t('name')} required error={e.name?.message}>
          <Input placeholder={t('namePlaceholder')} {...form.register('name')} />
        </FormField>
        <FormField label={t('address')} error={e.address?.message}>
          <Input {...form.register('address')} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('lat')} required error={e.lat?.message}>
            <Input inputMode="decimal" placeholder="43.238949" className="tabular" {...form.register('lat')} />
          </FormField>
          <FormField label={t('lng')} required error={e.lng?.message}>
            <Input inputMode="decimal" placeholder="76.889709" className="tabular" {...form.register('lng')} />
          </FormField>
        </div>
        <div>
          <Button variant="outline" size="sm" onClick={fillMyLocation} loading={locating}>
            <LocateFixed />
            {t('useMyLocation')}
          </Button>
        </div>
        <FormField label={t('radius')} required error={e.radiusM?.message} hint={t('radiusHint')}>
          <Input inputMode="numeric" className="tabular sm:max-w-[160px]" {...form.register('radiusM')} />
        </FormField>
      </form>
    </Dialog>
  );
}

export function LocationsTab() {
  const t = useTranslations('admin.org.locations');
  const tc = useTranslations('common');
  const locale = useLocale();
  const q = useLocations();
  const [editing, setEditing] = useState<WorkLocation | null>(null);
  const [open, setOpen] = useState(false);
  const nf = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }), [locale]);

  const columns = useMemo<ColumnDef<WorkLocation, unknown>[]>(
    () => [
      {
        id: 'name',
        header: t('name'),
        meta: { label: t('name'), hideable: false },
        cell: ({ row }) => (
          <div className="min-w-[180px]">
            <div className="font-medium">{row.original.name}</div>
            {row.original.address && <div className="text-xs text-fg-subtle">{row.original.address}</div>}
          </div>
        ),
      },
      {
        id: 'coords',
        header: t('coordinates'),
        meta: { label: t('coordinates') },
        cell: ({ row }) => (
          <a
            href={osmLink(row.original.lat, row.original.lng)}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring inline-flex items-center gap-1 rounded whitespace-nowrap text-fg tabular hover:text-primary"
          >
            {nf.format(row.original.lat)}, {nf.format(row.original.lng)}
            <ExternalLink className="size-3.5 text-fg-subtle" aria-hidden />
            <span className="sr-only">({t('openMap')})</span>
          </a>
        ),
      },
      {
        id: 'radius',
        header: t('radius'),
        meta: { label: t('radius'), className: 'tabular whitespace-nowrap' },
        cell: ({ row }) => t('meters', { value: row.original.radiusM }),
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
    [t, tc, nf],
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
        skeletonRows={3}
        toolbar={<p className="text-[13px] text-fg-muted">{t('hint')}</p>}
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
        empty={<EmptyState compact icon={<MapPin aria-hidden />} title={t('empty')} description={t('emptyHint')} />}
      />
      <LocationDialog open={open} onOpenChange={setOpen} location={editing} />
    </>
  );
}
