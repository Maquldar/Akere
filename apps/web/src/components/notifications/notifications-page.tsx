'use client';

import { Bell, CheckCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import { SkeletonList } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCurrentUser } from '@/components/shell/me-context';
import { NotificationItem, useOpenNotification } from '@/components/shell/notification-bell';
import { useMarkNotificationsRead, useNotifications } from '@/lib/api/hooks/notifications';

export function NotificationsPage() {
  const t = useTranslations('notifications');
  const { me } = useCurrentUser();
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const q = useNotifications({ unread: tab === 'unread', page, pageSize });
  const unreadCount = useNotifications({ unread: true, pageSize: 1 });
  const markAll = useMarkNotificationsRead();
  const open = useOpenNotification();
  const unread = unreadCount.data?.total ?? me.unreadNotifications;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Button variant="outline" onClick={() => markAll.mutate(undefined)} disabled={!unread} loading={markAll.isPending}>
            <CheckCheck />
            {t('markAll')}
          </Button>
        }
      />
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as 'all' | 'unread');
          setPage(1);
        }}
      >
        <TabsList aria-label={t('filter')}>
          <TabsTrigger value="all">{t('tabAll')}</TabsTrigger>
          <TabsTrigger value="unread" count={unread}>
            {t('tabUnread')}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <Card className="mt-4 p-1.5">
        {q.isLoading && <SkeletonList rows={6} className="p-3" />}
        {q.isError && !q.data && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {q.data && q.data.items.length === 0 && (
          <EmptyState
            icon={<Bell aria-hidden />}
            title={tab === 'unread' ? t('emptyUnread') : t('empty')}
            description={t('emptyHint')}
          />
        )}
        {q.data && q.data.items.length > 0 && (
          <ul className="divide-y divide-border">
            {q.data.items.map((n) => (
              <li key={n.id}>
                <NotificationItem n={n} onOpen={open} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      {q.data && q.data.total > 0 && (
        <Pagination
          className="mt-4"
          page={page}
          pageSize={pageSize}
          total={q.data.total}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
        />
      )}
    </div>
  );
}
