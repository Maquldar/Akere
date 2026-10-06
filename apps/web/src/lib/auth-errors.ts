import { isApiError } from './api/errors';

type AuthErrorKey = 'generic' | 'network' | 'invalidCredentials' | 'rateLimited' | 'rateLimitedFor' | 'forbidden';
type T = (key: AuthErrorKey, values?: Record<string, string | number>) => string;

/**
 * User-facing message for auth endpoint errors. `t` is scoped to the `auth.errors` namespace.
 */
export function authErrorMessage(error: unknown, t: T): string {
  if (!isApiError(error)) return t('generic');
  if (error.status === 0) return t('network');
  switch (error.code) {
    case 'RATE_LIMITED': {
      const sec = error.retryAfterSec;
      return sec ? t('rateLimitedFor', { minutes: Math.max(1, Math.ceil(sec / 60)) }) : t('rateLimited');
    }
    case 'UNAUTHENTICATED':
      return t('invalidCredentials');
    case 'VALIDATION_ERROR':
      return error.formErrors[0] ?? Object.values(error.fieldErrors)[0]?.[0] ?? t('invalidCredentials');
    case 'FORBIDDEN':
      return error.message || t('forbidden');
    case 'BUSINESS_RULE':
    case 'CONFLICT':
      return error.message || t('generic');
    default:
      return t('generic');
  }
}
