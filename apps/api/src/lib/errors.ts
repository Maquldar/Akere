import type { ErrorCode } from '@akere/shared';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'VALIDATION_ERROR', message, details);
export const unauthenticated = (message = 'Authentication required') => new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have access to this action') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (message: string, details?: unknown) => new AppError(409, 'CONFLICT', message, details);
export const businessRule = (rule: string, message: string, extra?: Record<string, unknown>) =>
  new AppError(422, 'BUSINESS_RULE', message, { rule, ...extra });
export const rateLimited = (retryAfterSec: number) =>
  new AppError(429, 'RATE_LIMITED', 'Too many attempts, try again later', { retryAfterSec });
export const fieldError = (field: string, message: string) =>
  new AppError(400, 'VALIDATION_ERROR', message, { fieldErrors: { [field]: [message] }, formErrors: [] });
