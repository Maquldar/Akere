'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { FileCog, Pencil, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Badge, StatusPill } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/checkbox';
import { DataTable } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { FormError, FormField } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select, SELECT_NONE } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { RequireAccess } from '@/components/shell/require-access';
import { isApiError } from '@/lib/api/errors';
import { useDocumentTemplates, useDocumentTypes, useRouteTemplates, useSaveDocumentType } from '@/lib/api/hooks/documents';
import { DOCUMENT_KINDS, type DocumentKind, type DocumentTypeView } from '@/lib/api/types-documents';
import { can } from '@/lib/permissions';
import { AdminTabs } from './admin-tabs';

function TypeDialog({ open, onOpenChange, type }: { open: boolean; onOpenChange: (o: boolean) => void; type: DocumentTypeView | null }) {
  const t = useTranslations('docAdmin.types');
  const tk = useTranslations('documents.kind');
  const tc = useTranslations('common');
  const save = useSaveDocumentType();
  const templates = useDocumentTemplates({ enabled: open });
  const routes = useRouteTemplates({ enabled: open });
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [nameKk, setNameKk] = useState('');
  const [kind, setKind] = useState<DocumentKind>('ORDER');
  const [pattern, setPattern] = useState('{seq}-{MM}/{YY}');
  const [templateId, setTemplateId] = useState(SELECT_NONE);
  const [routeId, setRouteId] = useState(SELECT_NONE);
  const [esutd, setEsutd] = useState(false);
  const [active, setActive] = useState(true);
  const [errs, setErrs] = useState<Record<string, string | undefined>>({});

  useEffect(() => {
    if (!open) return;
    setCode(type?.code ?? '');
    setName(type?.name ?? '');
    setNameKk(type?.nameKk ?? '');
    setKind(type?.kind ?? 'ORDER');
    setPattern(type?.numberPattern ?? '{seq}-{MM}/{YY}');
    setTemplateId(type?.templateId ?? SELECT_NONE);
    setRouteId(type?.routeTemplateId ?? SELECT_NONE);
    setEsutd(type?.esutdRequired ?? false);
    setActive(type?.isActive ?? true);
    setErrs({});
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, type]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string | undefined> = {};
    if (!/^[A-Z0-9_]{2,50}$/.test(code.trim())) next.code = t('codeRule');
    if (!name.trim()) next.name = tc('requiredField');
    if (!pattern.includes('{seq}')) next.numberPattern = t('patternRule');
    setErrs(next);
    if (Object.values(next).some(Boolean)) return;
    save.mutate(
      {
        id: type?.id,
        input: {
          code: code.trim(),
          name: name.trim(),
          nameKk: nameKk.trim() || null,
          kind,
          numberPattern: pattern.trim(),
          templateId: templateId === SELECT_NONE ? null : templateId,
          routeTemplateId: routeId === SELECT_NONE ? null : routeId,
          esutdRequired: esutd,
          isActive: active,
        },
      },
      {
        onSuccess: () => {
          toast.success(type ? tc('saved') : t('created'));
          onOpenChange(false);
        },
        onError: (err) => {
          if (isApiError(err) && err.code === 'VALIDATION_ERROR') setErrs(Object.fromEntries(Object.entries(err.fieldErrors).map(([k, v]) => [k, v[0]])));
          else if (isApiError(err) && err.code === 'CONFLICT') setErrs({ code: t('codeTaken') });
          else setErrs({ form: isApiError(err) ? err.message : tc('error') });
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={type ? t('editTitle') : t('addTitle')}
      dismissible={!save.isPending}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="doc-type-form" loading={save.isPending}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <form id="doc-type-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('name')} required error={errs.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </FormField>
        <FormField label={t('nameKk')} error={errs.nameKk}>
          <Input value={nameKk} onChange={(e) => setNameKk(e.target.value)} maxLength={200} />
        </FormField>
        <FormField label={t('code')} required hint={t('codeHint')} error={errs.code}>
          <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))} maxLength={50} className="font-mono" />
        </FormField>
        <FormField label={t('kind')} required error={errs.kind}>
          <Select value={kind} onValueChange={(v) => setKind(v as DocumentKind)} options={DOCUMENT_KINDS.map((k) => ({ value: k, label: tk(k) }))} />
        </FormField>
        <FormField label={t('pattern')} required hint={t('patternHint')} error={errs.numberPattern}>
          <Input value={pattern} onChange={(e) => setPattern(e.target.value)} maxLength={60} className="font-mono" />
        </FormField>
        <FormField label={t('template')} error={errs.templateId}>
          <Select
            value={templateId}
            onValueChange={setTemplateId}
            options={[{ value: SELECT_NONE, label: t('noTemplate') }, ...(templates.data ?? []).map((x) => ({ value: x.id, label: x.name }))]}
          />
        </FormField>
        <FormField label={t('route')} error={errs.routeTemplateId} className="sm:col-span-2">
          <Select
            value={routeId}
            onValueChange={setRouteId}
            options={[{ value: SELECT_NONE, label: t('noRoute') }, ...(routes.data ?? []).map((x) => ({ value: x.id, label: x.name }))]}
          />
        </FormField>
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:col-span-2">
          <Switch label={t('esutd')} description={t('esutdHint')} checked={esutd} onCheckedChange={setEsutd} />
          <Switch label={t('active')} description={t('activeHint')} checked={active} onCheckedChange={setActive} />
        </div>
        <FormError message={errs.form} className="sm:col-span-2" />
      </form>
    </Dialog>
  );
}

export function DocumentTypesPage() {
  const t = useTranslations('docAdmin.types');
  const tk = useTranslations('documents.kind');
  const tc = useTranslations('common');
  const types = useDocumentTypes();
  const [editing, setEditing] = useState<DocumentTypeView | null>(null);
  const [open, setOpen] = useState(false);

  const columns = useMemo<ColumnDef<DocumentTypeView, unknown>[]>(
    () => [
      {
        id: 'name',
        header: t('name'),
        meta: { hideable: false },
        cell: ({ row }) => (
          <div className="min-w-[220px]">
            <div className="font-medium text-fg">{row.original.name}</div>
            {row.original.nameKk && <div className="text-xs text-fg-subtle">{row.original.nameKk}</div>}
          </div>
        ),
      },
      { id: 'code', header: t('code'), meta: { label: t('code'), className: 'font-mono text-xs text-fg-muted' }, cell: ({ row }) => row.original.code },
      { id: 'kind', header: t('kind'), meta: { label: t('kind') }, cell: ({ row }) => <Badge tone="gray">{tk(row.original.kind)}</Badge> },
      { id: 'pattern', header: t('pattern'), meta: { label: t('pattern'), className: 'font-mono text-xs whitespace-nowrap' }, cell: ({ row }) => row.original.numberPattern },
      { id: 'template', header: t('template'), meta: { label: t('template'), className: 'max-w-[220px] truncate' }, cell: ({ row }) => row.original.template?.name ?? <span className="text-fg-subtle">—</span> },
      { id: 'route', header: t('route'), meta: { label: t('route'), className: 'max-w-[220px] truncate' }, cell: ({ row }) => row.original.routeTemplate?.name ?? <span className="text-fg-subtle">{t('defaultRoute')}</span> },
      { id: 'esutd', header: t('esutdShort'), meta: { label: t('esutdShort') }, cell: ({ row }) => (row.original.esutdRequired ? <Badge tone="blue">{t('esutdShort')}</Badge> : <span className="text-fg-subtle">—</span>) },
      {
        id: 'active',
        header: t('status'),
        meta: { label: t('status') },
        cell: ({ row }) => (row.original.isActive ? <StatusPill tone="green">{t('activeOn')}</StatusPill> : <StatusPill tone="gray">{t('activeOff')}</StatusPill>),
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
            onClick={(e) => {
              e.stopPropagation();
              setEditing(row.original);
              setOpen(true);
            }}
          >
            <Pencil aria-hidden />
          </Button>
        ),
      },
    ],
    [t, tk, tc],
  );

  return (
    <RequireAccess allow={(a) => can(a, 'document.manage')}>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus aria-hidden />
            {t('add')}
          </Button>
        }
      />
      <AdminTabs active="types" />
      <DataTable
        label={t('title')}
        columns={columns}
        data={types.data}
        getRowId={(x) => x.id}
        isLoading={types.isLoading}
        error={types.error}
        onRetry={() => types.refetch()}
        onRowClick={(x) => {
          setEditing(x);
          setOpen(true);
        }}
        columnVisibilityKey="doc-types"
        empty={<EmptyState compact icon={<FileCog aria-hidden />} title={t('empty')} />}
      />
      <TypeDialog open={open} onOpenChange={setOpen} type={editing} />
    </RequireAccess>
  );
}
