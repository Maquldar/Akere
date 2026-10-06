import { toQueryString } from '../utils';
import { networkError, toApiError } from './errors';

export const API_PREFIX = '/api/v1';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type ApiFetchOptions = {
  method?: HttpMethod;
  /** JSON-serialised unless it is FormData/Blob. */
  body?: unknown;
  query?: Record<string, unknown>;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Do not redirect to the login page on 401 (the caller handles it). */
  skipAuthRedirect?: boolean;
};

/** Endpoints whose 401 means "wrong credentials / no pending session", not "session expired". */
const AUTH_PATHS = ['/auth/login', '/auth/password/', '/auth/demo-', '/auth/logout', '/portal/'];

export function isAuthEndpoint(path: string): boolean {
  return AUTH_PATHS.some((p) => path.startsWith(p));
}

/** Current UI locale from the URL prefix (falls back to <html lang>). */
export function currentLocale(): string {
  if (typeof window === 'undefined') return 'ru';
  const seg = window.location.pathname.split('/')[1];
  if (seg === 'ru' || seg === 'kk' || seg === 'en') return seg;
  return document.documentElement.lang || 'ru';
}

let redirecting = false;

/** Sends the browser to the login page, remembering where the user was. */
export function redirectToLogin(): void {
  if (typeof window === 'undefined' || redirecting) return;
  const locale = currentLocale();
  const { pathname, search } = window.location;
  const sub = pathname.replace(new RegExp(`^/${locale}`), '') || '/';
  if (sub.startsWith('/login') || sub.startsWith('/reset')) return;
  redirecting = true;
  const next = sub === '/' ? '' : `?next=${encodeURIComponent(sub + search)}`;
  window.location.assign(`/${locale}/login${next}`);
}

export function buildUrl(path: string, query?: Record<string, unknown>): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${API_PREFIX}${p}${toQueryString(query)}`;
}

export function baseHeaders(method: HttpMethod): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json', 'Accept-Language': currentLocale() };
  // CSRF (API.md §0): every non-GET request carries this header.
  if (method !== 'GET') headers['X-Requested-With'] = 'akere';
  return headers;
}

/**
 * Typed fetch against `/api/v1`. Resolves with the parsed JSON body (or `undefined` for 204),
 * rejects with `ApiError`.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers = { ...baseHeaders(method), ...options.headers };
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (options.body instanceof FormData || options.body instanceof Blob) {
      body = options.body;
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      body,
      credentials: 'include',
      signal: options.signal,
    });
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') throw e;
    throw networkError(e);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    const error = toApiError(res.status, parsed, res.statusText || 'Request failed');
    if (res.status === 401 && !options.skipAuthRedirect && !isAuthEndpoint(path)) redirectToLogin();
    throw error;
  }
  return parsed as T;
}

