import { describe, expect, it } from 'vitest';
import { ApiError, toApiError } from './errors';

describe('toApiError', () => {
  it('parses the API.md error envelope', () => {
    const e = toApiError(400, {
      error: { code: 'VALIDATION_ERROR', message: 'Invalid', details: { fieldErrors: { bin: ['12 digits'] }, formErrors: ['x'] } },
    });
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(400);
    expect(e.code).toBe('VALIDATION_ERROR');
    expect(e.fieldErrors).toEqual({ bin: ['12 digits'] });
    expect(e.formErrors).toEqual(['x']);
  });
  it('exposes retryAfterSec and rule', () => {
    expect(toApiError(429, { error: { code: 'RATE_LIMITED', message: 'slow', details: { retryAfterSec: 120 } } }).retryAfterSec).toBe(120);
    expect(toApiError(422, { error: { code: 'BUSINESS_RULE', message: 'no', details: { rule: 'OVERLAP' } } }).rule).toBe('OVERLAP');
  });
  it('falls back to a code derived from the status for non-conforming bodies', () => {
    const e = toApiError(404, '<html>');
    expect(e.code).toBe('NOT_FOUND');
    expect(e.fieldErrors).toEqual({});
    expect(toApiError(502, null).code).toBe('INTERNAL');
  });
});
