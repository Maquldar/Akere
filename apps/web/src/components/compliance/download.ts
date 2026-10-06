import { baseHeaders, buildUrl, isAuthEndpoint, redirectToLogin } from '@/lib/api/client';
import { networkError, toApiError } from '@/lib/api/errors';

/** Filename from `Content-Disposition` (RFC 5987 `filename*` first). */
export function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      /* fall through */
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() || fallback;
}

/**
 * Downloads an API file (xlsx exports, sheets) through fetch so errors become ApiError (toast) instead of
 * navigating to a JSON error page. Rejects with ApiError.
 */
export async function downloadApiFile(path: string, query: Record<string, unknown> | undefined, fallbackName: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), { headers: { ...baseHeaders('GET'), Accept: '*/*' }, credentials: 'include' });
  } catch (e) {
    throw networkError(e);
  }
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    if (res.status === 401 && !isAuthEndpoint(path)) redirectToLogin();
    throw toApiError(res.status, body, res.statusText || 'Download failed');
  }
  const blob = await res.blob();
  const name = filenameFromDisposition(res.headers.get('Content-Disposition'), fallbackName);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
