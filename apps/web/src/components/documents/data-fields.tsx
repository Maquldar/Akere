'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { DatePicker } from '@/components/ui/date-picker';
import { Input, Textarea } from '@/components/ui/input';
import { FormField } from '@/components/ui/label';
import { useTemplateVariables } from '@/lib/api/hooks/documents';
import { formatDate } from '@/lib/format';
import type { DataField } from './template-fields';

/** "effectiveDate" → "Effective date" (fallback label for data keys without a known variable). */
export function humanizeKey(key: string): string {
  const s = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Labels of `data.*` keys from `/document-templates/variables` (server labels), else humanized. */
export function useDataLabels() {
  const vars = useTemplateVariables();
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const v of vars.data ?? []) {
      const m = /^data\.([\w]+)/.exec(v.key);
      if (m) map.set(m[1]!, v.label.replace(/\s*\((из данных|₸)\)\s*$/i, '').trim());
    }
    return (key: string) => map.get(key) ?? humanizeKey(key);
  }, [vars.data]);
}

export function DataFieldsEditor({
  fields,
  values,
  onChange,
  errors,
  idPrefix = 'data',
}: {
  fields: DataField[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  errors?: Record<string, string | undefined>;
  idPrefix?: string;
}) {
  const label = useDataLabels();
  const t = useTranslations('documents.new');
  if (fields.length === 0) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((f) => {
        const common = { id: `${idPrefix}-${f.key}`, value: values[f.key] ?? '' };
        return (
          <FormField
            key={f.key}
            label={label(f.key)}
            required={!f.optional}
            error={errors?.[f.key]}
            hint={f.kind === 'money' ? t('moneyHint') : undefined}
            className={f.kind === 'textarea' ? 'sm:col-span-2' : undefined}
          >
            {f.kind === 'date' ? (
              <DatePicker {...common} onChange={(v) => onChange(f.key, v)} />
            ) : f.kind === 'textarea' ? (
              <Textarea {...common} rows={3} onChange={(e) => onChange(f.key, e.target.value)} />
            ) : (
              <Input
                {...common}
                inputMode={f.kind === 'number' || f.kind === 'money' ? 'decimal' : undefined}
                onChange={(e) => onChange(f.key, e.target.value)}
              />
            )}
          </FormField>
        );
      })}
    </div>
  );
}

/** Read-only rendering of a document's `data` (Данные tab). */
export function DataView({ data }: { data: Record<string, unknown> }) {
  const label = useDataLabels();
  const locale = useLocale();
  const t = useTranslations('documents.card');
  const entries = Object.entries(data).filter(([k, v]) => !/Id$/.test(k) && v !== null && v !== undefined && v !== '');
  if (entries.length === 0) return <p className="text-sm text-fg-subtle">{t('noData')}</p>;
  const fmt = (v: unknown): string => {
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return formatDate(v, locale);
    if (typeof v === 'number') return new Intl.NumberFormat(locale).format(v);
    if (typeof v === 'boolean') return v ? '✓' : '—';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };
  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      {entries.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-fg-subtle">{label(k)}</dt>
          <dd className="mt-0.5 whitespace-pre-wrap break-words text-sm text-fg">{fmt(v)}</dd>
        </div>
      ))}
    </dl>
  );
}
