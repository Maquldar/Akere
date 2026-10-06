'use client';

import { CheckCircle2, ChevronRight, FileSignature, ScrollText } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Link } from '@/i18n/navigation';
import { useMyVnd } from '@/lib/api/hooks/compliance';
import type { VndRecipientStatus } from '@/lib/api/types-compliance';
import { formatDateTime } from '@/lib/format';

type Filter = 'all' | VndRecipientStatus;

/** "Мои ознакомления": ВНД sent to the current employee (M3 1:13 "Требуется ознакомление"). */
export function VndMyList() {
  const t = useTranslations('vnd.my');
  const locale = useLocale();
  const [filter, setFilter] = useState<Filter>('all');
  const list = useMyVnd(filter === 'all' ? undefined : filter);
  const all = useMyVnd(undefined);
  const pendingCount = (all.data ?? []).filter((v) => v.myStatus === 'PENDING').length;

  return (
    <div className="flex flex-col gap-4">
      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <TabsList aria-label={t('filterLabel')}>
          <TabsTrigger value="all">{t('all')}</TabsTrigger>
          <TabsTrigger value="PENDING" count={pendingCount}>
            {t('pending')}
          </TabsTrigger>
          <TabsTrigger value="ACKNOWLEDGED">{t('acknowledged')}</TabsTrigger>
        </TabsList>
      </Tabs>

      {list.isLoading ? (
        <div className="grid gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Card key={i} className="p-4">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="mt-2 h-3 w-1/3" />
            </Card>
          ))}
        </div>
      ) : list.error ? (
        <Card>
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        </Card>
      ) : !list.data?.length ? (
        <Card>
          <EmptyState
            icon={<ScrollText aria-hidden />}
            title={filter === 'PENDING' ? t('emptyPending') : t('empty')}
            description={t('emptyHint')}
          />
        </Card>
      ) : (
        <ul className="grid gap-3" aria-label={t('listLabel')}>
          {list.data.map((v) => {
            const pending = v.myStatus === 'PENDING' && v.status === 'IN_ROUTE';
            return (
              <li key={v.id}>
                <Link
                  href={`/vnd/${v.id}`}
                  className="focus-ring group flex items-center gap-3 rounded-xl border border-border bg-surface p-4 shadow-card transition-colors hover:bg-surface-hover"
                >
                  <span
                    className={
                      pending
                        ? 'flex size-10 shrink-0 items-center justify-center rounded-lg bg-orange-bg text-orange-fg'
                        : 'flex size-10 shrink-0 items-center justify-center rounded-lg bg-green-bg text-green-fg'
                    }
                    aria-hidden
                  >
                    {pending ? <FileSignature className="size-5" /> : <CheckCircle2 className="size-5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-fg">{v.title}</span>
                      {pending ? (
                        <Badge tone="orange">{t('required')}</Badge>
                      ) : v.myStatus === 'ACKNOWLEDGED' ? (
                        <Badge tone="green">{t('done')}</Badge>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-fg-subtle">
                      {[v.number ? `№${v.number}` : null, v.type.name, v.legalEntity.name, v.sentAt ? t('sentAt', { date: formatDateTime(v.sentAt, locale) }) : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="hidden text-[13px] font-medium text-primary sm:inline">{pending ? t('open') : t('view')}</span>
                  <ChevronRight className="size-4 shrink-0 text-fg-subtle group-hover:text-fg" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
