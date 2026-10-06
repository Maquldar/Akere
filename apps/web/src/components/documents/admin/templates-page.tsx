'use client';

import { FileCheck2, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { RequireAccess } from '@/components/shell/require-access';
import { Link } from '@/i18n/navigation';
import { useDocumentTemplates, useDocumentTypes } from '@/lib/api/hooks/documents';
import { formatDateTime } from '@/lib/format';
import { can } from '@/lib/permissions';
import { AdminTabs } from './admin-tabs';

export function TemplatesPage() {
  const t = useTranslations('docAdmin.templates');
  const locale = useLocale();
  const templates = useDocumentTemplates();
  const types = useDocumentTypes();
  const usage = (id: string) => (types.data ?? []).filter((x) => x.templateId === id).map((x) => x.name);

  return (
    <RequireAccess allow={(a) => can(a, 'document.manage')}>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Button asChild>
            <Link href="/admin/document-templates/new">
              <Plus aria-hidden />
              {t('add')}
            </Link>
          </Button>
        }
      />
      <AdminTabs active="templates" />
      {templates.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : templates.error ? (
        <Card>
          <ErrorState error={templates.error} onRetry={() => templates.refetch()} />
        </Card>
      ) : !templates.data?.length ? (
        <Card>
          <EmptyState icon={<FileCheck2 aria-hidden />} title={t('empty')} description={t('emptyHint')} />
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {templates.data.map((tpl) => {
            const used = usage(tpl.id);
            return (
              <li key={tpl.id}>
                <Link
                  href={`/admin/document-templates/${tpl.id}`}
                  className="focus-ring flex h-full flex-col gap-2 rounded-xl border border-border bg-surface p-4 shadow-card transition-colors hover:border-border-strong hover:bg-surface-muted"
                >
                  <span className="flex items-start gap-2">
                    <FileCheck2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    <span className="text-sm font-semibold text-fg">{tpl.name}</span>
                  </span>
                  <span className="text-xs text-fg-subtle">{t('blocks', { count: tpl.body.length })}</span>
                  <span className="line-clamp-2 text-xs text-fg-muted">{used.length ? t('usedBy', { types: used.join(', ') }) : t('unused')}</span>
                  <span className="mt-auto text-xs text-fg-subtle">{t('updated', { date: formatDateTime(tpl.updatedAt, locale) })}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </RequireAccess>
  );
}
