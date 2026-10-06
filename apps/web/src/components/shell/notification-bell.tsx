'use client';

import { Bell, CheckCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SkeletonList } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Link, useRouter } from '@/i18n/navigation';
import { useMarkNotificationsRead, useNotifications } from '@/lib/api/hooks/notifications';
import type { Notification } from '@/lib/api/types';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useCurrentUser } from './me-context';

export function isInternalLink(link: string): boolean {
  return link.startsWith('/') && !link.startsWith('//');
}

/** Strips a leading locale prefix so the i18n router re-adds the active one. */
export function stripLocale(link: string): string {
  return link.replace(/^\/(ru|kk|en)(?=\/|$)/, '') || '/';
}

export function NotificationItem({
  n,
  onOpen,
  dense,
}: {
  n: Notification;
  onOpen: (n: Notification) => void;
  dense?: boolean;
}) {
  const locale = useLocale();
  const unread = !n.readAt;
  return (
    <button
      type="button"
      onClick={() => onOpen(n)}
      className={cn(
        'focus-ring flex w-full items-start gap-3 rounded-lg text-left transition-colors hover:bg-surface-hover',
        dense ? 'px-3 py-2.5' : 'px-4 py-3',
      )}
    >
      <span
        className={cn('mt-1.5 size-2 shrink-0 rounded-full', unread ? 'bg-primary' : 'bg-transparent')}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className={cn('block text-[13px] text-fg', unread ? 'font-semibold' : 'font-medium')}>{n.title}</span>
        {n.body && <span className="mt-0.5 line-clamp-2 block text-[13px] text-fg-muted">{n.body}</span>}
        <time dateTime={n.createdAt} className="mt-1 block text-xs text-fg-subtle">
          {formatRelative(n.createdAt, locale)}
        </time>
      </span>
    </button>
  );
}

export function useOpenNotification() {
  const router = useRouter();
  const mark = useMarkNotificationsRead();
  return (n: Notification) => {
    if (!n.readAt) mark.mutate([n.id]);
    if (n.link) {
      if (isInternalLink(n.link)) router.push(stripLocale(n.link));
      else window.open(n.link, '_blank', 'noopener,noreferrer');
    }
  };
}

export function NotificationBell() {
  const t = useTranslations('notifications');
  const { me } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const unread = useNotifications({ unread: true, pageSize: 1 }, { refetchInterval: 60_000 });
  const list = useNotifications({ pageSize: 10 }, { enabled: open });
  const markAll = useMarkNotificationsRead();
  const openItem = useOpenNotification();
  const count = unread.data?.total ?? me.unreadNotifications;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={count ? t('bellUnread', { count }) : t('bell')}>
          <Bell />
          {count > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-solid px-1 text-[10px] font-semibold text-white tabular" aria-hidden>
              {count > 9 ? '9+' : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex max-h-[min(560px,80dvh)] w-[min(380px,calc(100vw-16px))] flex-col p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-fg">{t('title')}</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => markAll.mutate(undefined)}
            disabled={count === 0 || markAll.isPending}
          >
            <CheckCheck />
            {t('markAll')}
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {list.isLoading && <SkeletonList rows={4} className="p-3" />}
          {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} compact />}
          {list.data && list.data.items.length === 0 && <EmptyState title={t('empty')} description={t('emptyHint')} compact />}
          {list.data?.items.map((n) => (
            <NotificationItem
              key={n.id}
              n={n}
              dense
              onOpen={(x) => {
                openItem(x);
                if (x.link) setOpen(false);
              }}
            />
          ))}
        </div>
        <div className="border-t border-border p-1.5">
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="focus-ring flex h-8 items-center justify-center rounded-md text-[13px] font-medium text-primary hover:bg-surface-hover"
          >
            {t('viewAll')}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
