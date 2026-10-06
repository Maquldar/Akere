'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronRight, FolderTree, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { FormError, FormField, Label } from '@/components/ui/label';
import { Select, SELECT_NONE } from '@/components/ui/select';
import { SkeletonList } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { applyServerErrors } from '@/lib/api/form-errors';
import { isApiError } from '@/lib/api/errors';
import { useDeleteDepartment, useDepartments, useLegalEntities, useSaveDepartment } from '@/lib/api/hooks/org';
import type { Department } from '@/lib/api/types';
import { cleanOptional } from '@/lib/forms';
import { cn } from '@/lib/utils';
import { buildDepartmentTree, descendantIds, flattenTree, type DeptNode } from './tree';

type DialogState = { mode: 'create'; parentId: string | null } | { mode: 'edit'; dept: Department } | null;

function DepartmentDialog({
  state,
  onClose,
  legalEntityId,
  departments,
}: {
  state: DialogState;
  onClose: () => void;
  legalEntityId: string;
  departments: Department[];
}) {
  const t = useTranslations('admin.org.structure');
  const tc = useTranslations('common');
  const locale = useLocale();
  const save = useSaveDepartment();
  const editing = state?.mode === 'edit' ? state.dept : null;
  const schema = z.object({
    name: z.string().trim().min(1, tc('requiredField')).max(300),
    nameKk: z.string().max(300),
    parentId: z.string(),
  });
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: {
      name: editing?.name ?? '',
      nameKk: editing?.nameKk ?? '',
      parentId: (editing ? editing.parentId : state?.mode === 'create' ? state.parentId : null) ?? SELECT_NONE,
    },
  });

  const parentOptions = useMemo(() => {
    const blocked = editing ? descendantIds(departments, editing.id) : new Set<string>();
    const flat = flattenTree(buildDepartmentTree(departments, locale)).filter((d) => !blocked.has(d.id));
    return [
      { value: SELECT_NONE, label: t('topLevel') },
      ...flat.map((d) => ({ value: d.id, label: `${'— '.repeat(d.depth)}${d.name}` })),
    ];
  }, [departments, editing, locale, t]);

  const e = form.formState.errors;
  const onSubmit = form.handleSubmit(async (v) => {
    const parentId = v.parentId === SELECT_NONE ? null : v.parentId;
    try {
      const base = cleanOptional({ name: v.name, nameKk: v.nameKk }, editing);
      await save.mutateAsync({
        id: editing?.id,
        input: editing ? { ...base, parentId } : { ...base, parentId, legalEntityId },
      });
      toast.success(editing ? tc('saved') : t('created'));
      onClose();
    } catch (err) {
      if (applyServerErrors(err, form.setError, { fields: ['name', 'nameKk', 'parentId'] })) return;
      form.setError('root.server', { message: isApiError(err) ? err.message : tc('error') });
    }
  });

  return (
    <Dialog
      open={state !== null}
      onOpenChange={(o) => !o && onClose()}
      title={editing ? t('editTitle') : t('createTitle')}
      dismissible={!save.isPending}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="department-form" loading={save.isPending}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <form id="department-form" onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormError message={e.root?.server?.message} />
        <FormField label={t('name')} required error={e.name?.message}>
          <Input {...form.register('name')} />
        </FormField>
        <FormField label={t('nameKk')} error={e.nameKk?.message}>
          <Input lang="kk" {...form.register('nameKk')} />
        </FormField>
        <FormField label={t('parent')} error={e.parentId?.message}>
          <Select value={form.watch('parentId')} onValueChange={(v) => form.setValue('parentId', v, { shouldDirty: true })} options={parentOptions} />
        </FormField>
      </form>
    </Dialog>
  );
}

function TreeRow({
  node,
  expanded,
  onToggle,
  onAdd,
  onEdit,
  onDelete,
}: {
  node: DeptNode;
  expanded: boolean;
  onToggle: () => void;
  onAdd: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('admin.org.structure');
  const tc = useTranslations('common');
  const hasChildren = node.children.length > 0;
  return (
    <div
      role="treeitem"
      aria-level={node.depth + 1}
      aria-expanded={hasChildren ? expanded : undefined}
      aria-selected={false}
      className="group flex min-h-11 items-center gap-2 border-b border-border pr-2 last:border-b-0 hover:bg-surface-muted"
      style={{ paddingLeft: `${12 + node.depth * 20}px` }}
    >
      {hasChildren ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={expanded ? t('collapse') : t('expand')}
          className="focus-ring inline-flex size-6 shrink-0 items-center justify-center rounded text-fg-subtle hover:bg-surface-active hover:text-fg"
        >
          <ChevronRight className={cn('size-4 transition-transform', expanded && 'rotate-90')} aria-hidden />
        </button>
      ) : (
        <span className="size-6 shrink-0" aria-hidden />
      )}
      <div className="min-w-0 flex-1 py-2">
        <div className="truncate text-sm font-medium text-fg">{node.name}</div>
        {node.nameKk && (
          <div className="truncate text-xs text-fg-subtle" lang="kk">
            {node.nameKk}
          </div>
        )}
      </div>
      <span className="shrink-0 text-xs text-fg-subtle tabular">{t('employees', { count: node.employeeCount })}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={tc('actionsFor', { name: node.name })}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onAdd}>
            <Plus aria-hidden />
            {t('addChild')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil aria-hidden />
            {tc('edit')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onDelete} danger>
            <Trash2 aria-hidden />
            {tc('delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function DepartmentsTab() {
  const t = useTranslations('admin.org.structure');
  const tc = useTranslations('common');
  const locale = useLocale();
  const entities = useLegalEntities();
  const [legalEntityId, setLegalEntityId] = useState<string | undefined>();
  const depts = useDepartments(legalEntityId);
  const remove = useDeleteDepartment();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [toDelete, setToDelete] = useState<Department | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!legalEntityId && entities.data?.[0]) setLegalEntityId(entities.data[0].id);
  }, [entities.data, legalEntityId]);

  const tree = useMemo(() => buildDepartmentTree(depts.data ?? [], locale), [depts.data, locale]);
  const rows = useMemo(() => flattenTree(tree, collapsed), [tree, collapsed]);

  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const confirmDelete = () => {
    if (!toDelete) return;
    remove.mutate(toDelete.id, {
      onSuccess: () => {
        toast.success(t('deleted'));
        setToDelete(null);
      },
      onError: (e) => {
        toast.error(isApiError(e) && e.code === 'CONFLICT' ? t('deleteHasEmployees') : isApiError(e) ? e.message : tc('error'));
        setToDelete(null);
      },
    });
  };

  if (entities.isError) return <ErrorState error={entities.error} onRetry={() => entities.refetch()} />;
  if (entities.data && entities.data.length === 0) {
    return (
      <Card>
        <EmptyState icon={<FolderTree aria-hidden />} title={t('noEntities')} description={t('noEntitiesHint')} />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex w-full flex-col gap-1.5 sm:w-80">
          <Label htmlFor="dept-le">{t('legalEntity')}</Label>
          <Select
            id="dept-le"
            value={legalEntityId}
            onValueChange={(v) => {
              setLegalEntityId(v);
              setCollapsed(new Set());
            }}
            placeholder={tc('loading')}
            disabled={!entities.data}
            options={(entities.data ?? []).map((e) => ({ value: e.id, label: e.name }))}
          />
        </div>
        <Button onClick={() => setDialog({ mode: 'create', parentId: null })} disabled={!legalEntityId}>
          <Plus />
          {t('add')}
        </Button>
      </div>
      <Card className="overflow-hidden">
        {(entities.isLoading || depts.isLoading) && <SkeletonList rows={5} className="p-4" />}
        {depts.isError && <ErrorState error={depts.error} onRetry={() => depts.refetch()} compact />}
        {depts.data && depts.data.length === 0 && (
          <EmptyState
            compact
            icon={<FolderTree aria-hidden />}
            title={t('empty')}
            description={t('emptyHint')}
            action={
              <Button size="sm" variant="outline" onClick={() => setDialog({ mode: 'create', parentId: null })}>
                <Plus />
                {t('add')}
              </Button>
            }
          />
        )}
        {rows.length > 0 && (
          <div role="tree" aria-label={t('treeLabel')}>
            {rows.map((node) => (
              <TreeRow
                key={node.id}
                node={node}
                expanded={!collapsed.has(node.id)}
                onToggle={() => toggle(node.id)}
                onAdd={() => setDialog({ mode: 'create', parentId: node.id })}
                onEdit={() => setDialog({ mode: 'edit', dept: node })}
                onDelete={() => setToDelete(node)}
              />
            ))}
          </div>
        )}
      </Card>
      {legalEntityId && (
        <DepartmentDialog state={dialog} onClose={() => setDialog(null)} legalEntityId={legalEntityId} departments={depts.data ?? []} />
      )}
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t('deleteTitle')}
        description={toDelete ? t('deleteText', { name: toDelete.name }) : undefined}
        confirmLabel={tc('delete')}
        onConfirm={confirmDelete}
        loading={remove.isPending}
      />
    </div>
  );
}
