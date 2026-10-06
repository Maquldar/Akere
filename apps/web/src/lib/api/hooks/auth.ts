'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../client';
import { isApiError } from '../errors';
import { qk } from '../query-keys';
import type { DemoUser, LoginInput, LoginOk, LoginResult, Me } from '../types';

export function useMe(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.me,
    queryFn: ({ signal }) => apiFetch<Me>('/auth/me', { signal }),
    staleTime: 60_000,
    retry: false,
    enabled: options.enabled ?? true,
  });
}

function useSetMe() {
  const qc = useQueryClient();
  return (me: Me) => {
    // A new identity: drop everything cached for the previous one.
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    qc.setQueryData(qk.me, me);
  };
}

export function useLogin() {
  const setMe = useSetMe();
  return useMutation({
    mutationFn: (input: LoginInput) => apiFetch<LoginResult>('/auth/login', { method: 'POST', body: input }),
    onSuccess: (res) => {
      if (res.status === 'OK') setMe(res.me);
    },
  });
}

export function useLoginOtp() {
  const setMe = useSetMe();
  return useMutation({
    mutationFn: (code: string) => apiFetch<LoginOk>('/auth/login/otp', { method: 'POST', body: { code } }),
    onSuccess: (res) => setMe(res.me),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => qc.clear(),
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (login: string) => apiFetch<void>('/auth/password/forgot', { method: 'POST', body: { login } }),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (input: { login: string; code: string; newPassword: string }) =>
      apiFetch<void>('/auth/password/reset', { method: 'POST', body: input }),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      apiFetch<void>('/auth/password/change', { method: 'POST', body: input }),
  });
}

/** `GET /auth/demo-users`. Resolves to `null` when demo mode is off (404). */
export function useDemoUsers() {
  return useQuery({
    queryKey: qk.demoUsers,
    queryFn: async ({ signal }) => {
      try {
        return await apiFetch<DemoUser[]>('/auth/demo-users', { signal });
      } catch (e) {
        if (isApiError(e) && e.status === 404) return null;
        throw e;
      }
    },
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useDemoLogin() {
  const setMe = useSetMe();
  return useMutation({
    mutationFn: (userId: string) => apiFetch<LoginOk>('/auth/demo-login', { method: 'POST', body: { userId } }),
    onSuccess: (res) => setMe(res.me),
  });
}
