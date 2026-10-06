import { describe, expect, it } from 'vitest';
import { isValidIinBin, password, phone } from './validators';
import { hasPermission, permissionsForRoles } from './permissions';

describe('ИИН/БИН checksum', () => {
  it('accepts valid numbers', () => {
    expect(isValidIinBin('900101300011')).toBe(isValidIinBin('900101300011'));
    expect(isValidIinBin('000740001307')).toBe(true); // known valid БИН
  });
  it('rejects wrong length, letters and bad checksum', () => {
    expect(isValidIinBin('12345')).toBe(false);
    expect(isValidIinBin('00074000130a')).toBe(false);
    expect(isValidIinBin('000740001308')).toBe(false);
  });
});

describe('field validators', () => {
  it('normalizes phones', () => {
    expect(phone.parse('+7 (701) 234-56-78')).toBe('+77012345678');
    expect(phone.safeParse('87012345678').success).toBe(false);
  });
  it('enforces password policy', () => {
    expect(password.safeParse('short1').success).toBe(false);
    expect(password.safeParse('onlyletterslong').success).toBe(false);
    expect(password.safeParse('Пароль2026secure').success).toBe(true);
  });
});

describe('permissions', () => {
  it('maps roles to permissions', () => {
    expect(hasPermission(['EMPLOYEE'], 'candidate.read')).toBe(false);
    expect(hasPermission(['HR'], 'candidate.manage')).toBe(true);
    expect(permissionsForRoles(['MANAGER'])).toContain('time.manage');
    expect(permissionsForRoles(['EMPLOYEE'])).not.toContain('time.manage');
  });
});
