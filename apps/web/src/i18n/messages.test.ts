import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import kk from '../../messages/kk.json';
import ru from '../../messages/ru.json';

function keys(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

function leaves(obj: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (o: unknown, p: string) => {
    if (typeof o === 'string') out[p] = o;
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, p ? `${p}.${k}` : k);
  };
  walk(obj, '');
  return out;
}

const placeholders = (s: string) => (s.match(/\{(\w+)/g) ?? []).map((x) => x.slice(1)).sort();

describe('messages', () => {
  const ruKeys = keys(ru).sort();
  it.each([
    ['kk', kk],
    ['en', en],
  ])('%s has exactly the same keys as ru', (_name, catalog) => {
    expect(keys(catalog).sort()).toEqual(ruKeys);
  });

  it.each([
    ['kk', kk],
    ['en', en],
  ])('%s uses the same ICU placeholders as ru', (_name, catalog) => {
    const r = leaves(ru);
    const c = leaves(catalog);
    for (const k of Object.keys(r)) expect([k, placeholders(c[k]!)]).toEqual([k, placeholders(r[k]!)]);
  });

  it('kk is a real translation, not a copy of ru or en', () => {
    const r = leaves(ru);
    const k = leaves(kk);
    const e = leaves(en);
    const same = Object.keys(r).filter((key) => k[key] === r[key] || k[key] === e[key]);
    // Only brand names / codes may be identical (Outbox, SMS, WhatsApp, ЕСУТД, numbers).
    expect(same.length).toBeLessThan(Object.keys(r).length * 0.05);
  });
});
