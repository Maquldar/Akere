import { describe, expect, it } from 'vitest';
import { filenameFromDisposition } from './download';
import { excerpt } from './help/excerpt';

describe('filenameFromDisposition', () => {
  it('prefers RFC 5987 filename*', () => {
    expect(filenameFromDisposition(`attachment; filename*=UTF-8''%D0%9B%D0%B8%D1%81%D1%82.xlsx`, 'x.xlsx')).toBe('Лист.xlsx');
  });
  it('reads a plain filename', () => {
    expect(filenameFromDisposition('attachment; filename="report.xlsx"', 'x.xlsx')).toBe('report.xlsx');
  });
  it('falls back when the header is missing', () => {
    expect(filenameFromDisposition(null, 'fallback.xlsx')).toBe('fallback.xlsx');
  });
});

describe('excerpt', () => {
  it('strips markdown syntax and headings', () => {
    expect(excerpt('# Title\n\nSign **the** [document](/documents) with `eGov`.')).toBe('Sign the document with eGov .');
  });
  it('truncates long text', () => {
    const out = excerpt('word '.repeat(100), 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.endsWith('…')).toBe(true);
  });
});
