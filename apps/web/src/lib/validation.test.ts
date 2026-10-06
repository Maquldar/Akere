import { describe, expect, it } from 'vitest';
import { BIN_RE, checkPassword, normalizePhone, safeNextPath } from './validation';

describe('checkPassword', () => {
  it('requires 10+ chars with letters and digits', () => {
    expect(checkPassword('short1').ok).toBe(false);
    expect(checkPassword('onlyletterslong').ok).toBe(false);
    expect(checkPassword('1234567890').ok).toBe(false);
    expect(checkPassword('Akere2026hr').ok).toBe(true);
    expect(checkPassword('құпиясөз2026').ok).toBe(true);
  });
});

describe('normalizePhone', () => {
  it('normalizes KZ numbers to E.164', () => {
    expect(normalizePhone('8 (701) 123-45-67')).toBe('+77011234567');
    expect(normalizePhone('+7 701 123 45 67')).toBe('+77011234567');
    expect(normalizePhone('7011234567')).toBe('+77011234567');
  });
});

describe('safeNextPath', () => {
  it('allows only same-app relative paths', () => {
    expect(safeNextPath('/admin/users?page=2')).toBe('/admin/users?page=2');
    expect(safeNextPath('//evil.com')).toBeNull();
    expect(safeNextPath('https://evil.com')).toBeNull();
    expect(safeNextPath('/\\evil.com')).toBeNull();
    expect(safeNextPath('/login')).toBeNull();
    expect(safeNextPath(null)).toBeNull();
  });
});

describe('BIN_RE', () => {
  it('matches 12 digits', () => {
    expect(BIN_RE.test('123456789012')).toBe(true);
    expect(BIN_RE.test('12345678901')).toBe(false);
  });
});
