import type { TemplateBlock } from '@/lib/api/types-documents';

export type DataFieldKind = 'text' | 'textarea' | 'date' | 'number' | 'money';
export type DataField = { key: string; kind: DataFieldKind; optional: boolean };

const PLACEHOLDER = /\{\{\s*([a-zA-Z][\w.]*)(?:\|([a-z]+))?\s*\}\}/g;

/** Every string of a template block that may contain placeholders. */
export function blockTexts(block: TemplateBlock): string[] {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      return [block.text];
    case 'fields':
      return block.rows.flatMap((r) => [r.label, r.value]);
    case 'signatures':
      return block.parties.flatMap((p) => [p.label, p.name]);
    default:
      return [];
  }
}

function kindFor(key: string, filter: string | undefined): DataFieldKind {
  if (filter === 'money' || /salary|amount|sum/i.test(key)) return 'money';
  if (filter === 'date' || filter === 'short' || /date$/i.test(key) || /^date/i.test(key)) return 'date';
  if (filter === 'number' || /days|count|qty|months/i.test(key)) return 'number';
  if (/changes|comment|reason|purpose|description|text|note/i.test(key)) return 'textarea';
  return 'text';
}

/** `data.*` keys used by a template, in order of first appearance (F-14 dynamic fields). */
export function extractDataFields(blocks: TemplateBlock[] | undefined | null): DataField[] {
  const out = new Map<string, DataField>();
  for (const b of blocks ?? []) {
    for (const s of blockTexts(b)) {
      for (const m of s.matchAll(PLACEHOLDER)) {
        const path = m[1]!;
        if (!path.startsWith('data.')) continue;
        const key = path.slice(5).split('.')[0]!;
        if (!key) continue;
        const prev = out.get(key);
        const optional = m[2] === 'optional';
        if (prev) {
          prev.optional = prev.optional && optional;
          continue;
        }
        out.set(key, { key, kind: kindFor(key, m[2]), optional });
      }
    }
  }
  return [...out.values()];
}

/** Converts form strings into the `data` payload (numbers for numeric fields, empty values dropped). */
export function toDataPayload(fields: DataField[], values: Record<string, string>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const data: Record<string, unknown> = { ...extra };
  for (const f of fields) {
    const raw = (values[f.key] ?? '').trim();
    if (!raw) continue;
    if (f.kind === 'number' || f.kind === 'money') {
      const n = Number(raw.replace(/\s/g, '').replace(',', '.'));
      data[f.key] = Number.isFinite(n) ? n : raw;
    } else {
      data[f.key] = raw;
    }
  }
  return data;
}

/** Inserts `{{key}}` at the caret of a text control, returning the new value and caret position. */
export function insertAt(value: string, start: number | null, end: number | null, token: string): { value: string; caret: number } {
  const s = start ?? value.length;
  const e = end ?? s;
  const next = value.slice(0, s) + token + value.slice(e);
  return { value: next, caret: s + token.length };
}
