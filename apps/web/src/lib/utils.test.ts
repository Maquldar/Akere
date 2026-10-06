import { describe, expect, it } from 'vitest';
import { formatBytes, initials, toQueryString } from './utils';

describe('initials', () => {
  it('takes first letters of the first two words', () => {
    expect(initials('Сулейменова Жанара Нурлановна')).toBe('СЖ');
    expect(initials('Әлия')).toBe('Ә');
  });
  it('handles empty input', () => {
    expect(initials('')).toBe('?');
    expect(initials(null)).toBe('?');
  });
});

describe('toQueryString', () => {
  it('skips empty values and repeats arrays', () => {
    expect(toQueryString({ q: 'abc', role: undefined, page: 1, active: false, empty: '', ids: ['a', 'b'] })).toBe(
      '?q=abc&page=1&active=false&ids=a&ids=b',
    );
  });
  it('returns empty string for no params', () => {
    expect(toQueryString({})).toBe('');
    expect(toQueryString()).toBe('');
  });
});

describe('formatBytes', () => {
  it('formats sizes', () => {
    expect(formatBytes(512, 'en')).toBe('512 B');
    expect(formatBytes(25 * 1024 * 1024, 'en')).toBe('25 MB');
  });
});
