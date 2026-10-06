'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { FileStack, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { ConfirmDialog } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { RequireAccess } from '@/components/shell/require-access';
import { Link, useRouter } from '@/i18n/navigation';
import { isApiError } from '@/lib/api/errors';
import { useDeleteRequestTemplate, useRequestTemplates } from '@/lib/api/hooks/onboarding';
import type { RequestTemplateView } from '@/lib/api/types-onboarding';
import { formatDate } from '@/lib/format';
import { can } from '@/lib/permissions';
import { docTypeName } from './model';

export function RequestTemplatesPage() {
  const t = useTranslations('onboarding.templates');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const list = useRequestTemplates();
  const del = useDeleteRequestTemplate();
  const [toDelete, setToDelete] = useState<RequestTemplateView | null>(null);

  const columns = useMemo<ColumnDef<RequestTemplateView, unknown>[]>(
    () => [
      {
        id: 'name',
        header: t('colName'),
        meta: { hideable: false, className: 'min-w-[200px]' },
        cell: ({ row }) => (
          <Link href={`/onboarding/request-templates/${row.original.id}`} onClick={(e) => e.stopPropagation()} className="focus-ring rounded font-medium text-fg hover:text-primary">
            {row.original.name}
          </Link>
        ),
      },
      {
        id: 'docs',
        header: t('colDocs'),
        meta: { className: 'min-w-[260px]' },
        cell: ({ row }) => {
          const items = row.original.items;
          return (
            <div className="flex flex-wrap gap-1">
              {items.slice(0, 4).map((i) => (
                <Badge key={i.personalDocType.id} tone={i.required ? 'blue' : 'gray'} className="max-w-[220px]">
                  <span className="truncate">{docTypeName(i.personalDocType, locale)}</span>
                </Badge>
              ))}
              {items.length > 4 && <Badge tone="gray">+{items.length - 4}</Badge>}
            </div>
          );
        },
      },
      {
        id: 'questionnaire',
        header: t('colQuestionnaire'),
        meta: { className: 'whitespace-nowrap' },
        cell: ({ row }) => row.original.questionnaire?.name ?? <span className="text-fg-subtle">—</span>,
      },
      {
        id: 'updated',
        header: t('colUpdated'),
        meta: { className: 'whitespace-nowrap tabular text-fg-muted' },
        cell: ({ row }) => formatDate(row.original.updatedAt, locale),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{tc('actions')}</span>,
        meta: { hideable: false, className: 'w-12 text-right' },
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={tc('actionsFor', { name: row.original.name })} onClick={(e) => e.stopPropagation()}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onSelect={() => router.push(`/onboarding/request-templates/${row.original.id}`)}>
                <Pencil aria-hidden />
                {tc('edit')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem danger onSelect={() => setToDelete(row.original)}>
                <Trash2 aria-hidden />
                {tc('delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [t, tc, locale, router],
  );

  return (
    <RequireAccess allow={(a) => can(a, 'candidate.manage')}>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Button asChild>
            <Link href="/onboarding/request-templates/new">
              <Plus />
              {t('add')}
            </Link>
          </Button>
        }
      />
      <DataTable
        label={t('title')}
        columns={columns}
        data={list.data}
        getRowId={(r) => r.id}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.error}
        onRetry={() => list.refetch()}
        onRowClick={(r) => router.push(`/onboarding/request-templates/${r.id}`)}
        empty={
          <EmptyState
            compact
            icon={<FileStack aria-hidden />}
            title={t('empty')}
            description={t('emptyHint')}
            action={
              <Button size="sm" asChild>
                <Link href="/onboarding/request-templates/new">
                  <Plus />
                  {t('add')}
                </Link>
              </Button>
            }
          />
        }
      />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t('deleteTitle')}
        description={toDelete ? t('deleteText', { name: toDelete.name }) : undefined}
        confirmLabel={tc('delete')}
        loading={del.isPending}
        onConfirm={() =>
          toDelete &&
          del.mutate(toDelete.id, {
            onSuccess: () => {
              toast.success(t('deleted', { name: toDelete.name }));
              setToDelete(null);
            },
            onError: (e) => {
              setToDelete(null);
              toast.error(isApiError(e) && e.code === 'CONFLICT' ? t('deleteConflict') : isApiError(e) ? e.message : tc('error'));
            },
          })
        }
      />
    </RequireAccess>
  );
}
