import type { ErrorCode, ValidationDetails } from './types';

/** Typed error for every non-2xx API response (API.md §0 "Errors"). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** `details.fieldErrors` for VALIDATION_ERROR (empty object otherwise). */
  get fieldErrors(): Record<string, string[]> {
    const d = this.details as Partial<ValidationDetails> | undefined;
    return d && typeof d === 'object' && d.fieldErrors && typeof d.fieldErrors === 'object' ? d.fieldErrors : {};
  }

  get formErrors(): string[] {
    const d = this.details as Partial<ValidationDetails> | undefined;
    return d && Array.isArray(d.formErrors) ? d.formErrors : [];
  }

  /** `details.retryAfterSec` for RATE_LIMITED. */
  get retryAfterSec(): number | null {
    const d = this.details as { retryAfterSec?: unknown } | undefined;
    return d && typeof d.retryAfterSec === 'number' ? d.retryAfterSec : null;
  }

  /** `details.rule` for BUSINESS_RULE. */
  get rule(): string | null {
    const d = this.details as { rule?: unknown } | undefined;
    return d && typeof d.rule === 'string' ? d.rule : null;
  }
}

const KNOWN_CODES: ReadonlySet<string> = new Set<ErrorCode>([
  'VALIDATION_ERROR', 'UNAUTHENTICATED', 'FORBIDDEN', 'CSRF', 'NOT_FOUND', 'CONFLICT',
  'FILE_TOO_LARGE', 'UNSUPPORTED_FILE', 'BUSINESS_RULE', 'RATE_LIMITED', 'INTERNAL',
]);

function codeFromStatus(status: number): ErrorCode {
  switch (status) {
    case 400: return 'VALIDATION_ERROR';
    case 401: return 'UNAUTHENTICATED';
    case 403: return 'FORBIDDEN';
    case 404: return 'NOT_FOUND';
    case 409: return 'CONFLICT';
    case 413: return 'FILE_TOO_LARGE';
    case 415: return 'UNSUPPORTED_FILE';
    case 422: return 'BUSINESS_RULE';
    case 429: return 'RATE_LIMITED';
    default: return 'INTERNAL';
  }
}

/** Builds an ApiError from a status and a (possibly non-conforming) parsed body. */
export function toApiError(status: number, body: unknown, fallbackMessage = 'Request failed'): ApiError {
  const err = (body as { error?: { code?: unknown; message?: unknown; details?: unknown } } | null)?.error;
  if (err && typeof err === 'object') {
    const code = typeof err.code === 'string' && KNOWN_CODES.has(err.code) ? (err.code as ErrorCode) : codeFromStatus(status);
    const message = typeof err.message === 'string' && err.message ? err.message : fallbackMessage;
    return new ApiError(status, code, message, err.details);
  }
  return new ApiError(status, codeFromStatus(status), fallbackMessage);
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** Network failures (fetch threw) are surfaced as status 0 / INTERNAL. */
export function networkError(cause: unknown): ApiError {
  const e = new ApiError(0, 'INTERNAL', 'Network error');
  (e as { cause?: unknown }).cause = cause;
  return e;
}
