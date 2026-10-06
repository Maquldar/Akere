import { describe, expect, it } from 'vitest';
import { extractDataFields, insertAt, toDataPayload } from './template-fields';

describe('template fields', () => {
  it('extracts data keys with kinds in order', () => {
    const fields = extractDataFields([
      { type: 'paragraph', text: 'с {{data.startDate}} по {{ data.endDate }} — {{data.days}} дней, {{employee.fullName}}' },
      { type: 'fields', rows: [{ label: 'Оклад', value: '{{data.salary|money}}' }] },
      { type: 'paragraph', text: '{{data.comment|optional}} {{data.startDate}}' },
      { type: 'spacer' },
    ]);
    expect(fields).toEqual([
      { key: 'startDate', kind: 'date', optional: false },
      { key: 'endDate', kind: 'date', optional: false },
      { key: 'days', kind: 'number', optional: false },
      { key: 'salary', kind: 'money', optional: false },
      { key: 'comment', kind: 'textarea', optional: true },
    ]);
  });
  it('builds the data payload', () => {
    const fields = extractDataFields([{ type: 'paragraph', text: '{{data.days}} {{data.reason}} {{data.salary|money}}' }]);
    expect(toDataPayload(fields, { days: '14', reason: ' ok ', salary: '450 000' })).toEqual({ days: 14, reason: 'ok', salary: 450000 });
    expect(toDataPayload(fields, { days: '' })).toEqual({});
  });
  it('inserts tokens at the caret', () => {
    expect(insertAt('Hello world', 6, 6, '{{x}} ')).toEqual({ value: 'Hello {{x}} world', caret: 12 });
    expect(insertAt('abc', null, null, '!')).toEqual({ value: 'abc!', caret: 4 });
  });
});
