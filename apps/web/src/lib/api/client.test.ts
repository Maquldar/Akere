import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, isAuthEndpoint } from './client';
import { ApiError } from './errors';

type Call = { url: string; init: RequestInit };

function mockFetch(status: number, body?: unknown) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(body === undefined ? null : JSON.stringify(body), { status });
    }),
  );
  return calls;
}

describe('apiFetch', () => {
  const assign = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('window', { location: { pathname: '/kk/admin/users', search: '?page=2', assign } });
    vi.stubGlobal('document', { documentElement: { lang: 'kk' } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    assign.mockReset();
  });

  it('prefixes /api/v1, adds query, credentials and Accept-Language', async () => {
    const calls = mockFetch(200, { ok: true });
    await apiFetch('/org/users', { query: { q: 'а', page: 1, role: undefined } });
    expect(calls[0]!.url).toBe('/api/v1/org/users?q=%D0%B0&page=1');
    expect(calls[0]!.init.credentials).toBe('include');
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h['Accept-Language']).toBe('kk');
    expect(h['X-Requested-With']).toBeUndefined();
  });

  it('sends JSON and the CSRF header on non-GET', async () => {
    const calls = mockFetch(201, { id: '1' });
    const res = await apiFetch<{ id: string }>('/org/positions', { method: 'POST', body: { name: 'X' } });
    expect(res.id).toBe('1');
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h['X-Requested-With']).toBe('akere');
    expect(h['Content-Type']).toBe('application/json');
    expect(calls[0]!.init.body).toBe('{"name":"X"}');
  });

  it('returns undefined for 204', async () => {
    mockFetch(204);
    await expect(apiFetch('/me/notifications/read', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('throws ApiError and redirects to login on 401 for app endpoints', async () => {
    mockFetch(401, { error: { code: 'UNAUTHENTICATED', message: 'No session' } });
    await expect(apiFetch('/auth/me')).rejects.toBeInstanceOf(ApiError);
    expect(assign).toHaveBeenCalledWith('/kk/login?next=%2Fadmin%2Fusers%3Fpage%3D2');
  });

  it('does not redirect on 401 from login endpoints', async () => {
    mockFetch(401, { error: { code: 'UNAUTHENTICATED', message: 'Wrong password' } });
    const err = await apiFetch('/auth/login', { method: 'POST', body: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('Wrong password');
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('isAuthEndpoint', () => {
  it('recognises credential endpoints only', () => {
    expect(isAuthEndpoint('/auth/login/otp')).toBe(true);
    expect(isAuthEndpoint('/auth/password/change')).toBe(true);
    expect(isAuthEndpoint('/auth/me')).toBe(false);
    expect(isAuthEndpoint('/org/users')).toBe(false);
  });
});
