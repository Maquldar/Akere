import { describe, expect, it, vi } from 'vitest';
import { applyServerErrors } from './form-errors';
import { ApiError } from './errors';

describe('applyServerErrors', () => {
  it('maps fieldErrors to fields and formErrors to root.server', () => {
    const setError = vi.fn();
    const err = new ApiError(400, 'VALIDATION_ERROR', 'bad', {
      fieldErrors: { email: ['Taken'], 'roles.0.legalEntityId': ['Required'], unknown: ['Oops'] },
      formErrors: ['General'],
    });
    const applied = applyServerErrors(err, setError, { fields: ['email', 'roles'] });
    expect(applied).toBe(true);
    expect(setError).toHaveBeenCalledWith('email', { type: 'server', message: 'Taken' }, { shouldFocus: true });
    expect(setError).toHaveBeenCalledWith('roles.0.legalEntityId', { type: 'server', message: 'Required' }, { shouldFocus: false });
    expect(setError).toHaveBeenCalledWith('root.server', { type: 'server', message: 'General Oops' });
  });
  it('ignores non-validation errors', () => {
    const setError = vi.fn();
    expect(applyServerErrors(new ApiError(409, 'CONFLICT', 'x'), setError)).toBe(false);
    expect(applyServerErrors(new Error('x'), setError)).toBe(false);
    expect(setError).not.toHaveBeenCalled();
  });
});
