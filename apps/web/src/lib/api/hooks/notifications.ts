'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../client';
import { qk } from '../query-keys';
import type { Me, Notification, Page } from '../types';

export type NotificationFilter = { unread?: boolean; page?: number; pageSize?: number };

export function useNotifications(filter: NotificationFilter = {}, options: { enabled?: boolean; refetchInterval?: number } = {}) {
  const query = { unread: filter.unread ? true : undefined, page: filter.page ?? 1, pageSize: filter.pageSize ?? 25 };
  return useQuery({
    queryKey: qk.notifications(query),
    queryFn: ({ signal }) => apiFetch<Page<Notification>>('/me/notifications', { query, signal }),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
    refetchInterval: options.refetchInterval,
  });
}

/** `POST /me/notifications/read`; omit ids to mark all as read. Updates caches optimistically. */
export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids?: string[]) =>
      apiFetch<void>('/me/notifications/read', { method: 'POST', body: ids ? { ids } : {} }),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: qk.notifications() });
      const now = new Date().toISOString();
      const marked = new Set<string>();
      qc.setQueriesData<Page<Notification>>({ queryKey: qk.notifications() }, (page) => {
        if (!page) return page;
        return {
          ...page,
          items: page.items.map((n) => {
            if (n.readAt || (ids && !ids.includes(n.id))) return n;
            marked.add(n.id);
            return { ...n, readAt: now };
          }),
        };
      });
      qc.setQueryData<Me>(qk.me, (me) =>
        me ? { ...me, unreadNotifications: ids ? Math.max(0, me.unreadNotifications - marked.size) : 0 } : me,
      );
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.notifications() });
      void qc.invalidateQueries({ queryKey: qk.me, exact: true });
    },
  });
}
