'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../client';
import { qk } from '../query-keys';
import type { InboxCounts, Me, MeUpdate } from '../types';

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MeUpdate) => apiFetch<Me>('/me', { method: 'PATCH', body: input }),
    onSuccess: (me) => qc.setQueryData(qk.me, me),
  });
}

export function useInboxCounts(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.inboxCounts,
    queryFn: ({ signal }) => apiFetch<InboxCounts>('/me/inbox-counts', { signal }),
    enabled: options.enabled ?? true,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
