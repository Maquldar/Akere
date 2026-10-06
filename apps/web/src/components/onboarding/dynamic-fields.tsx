'use client';

import { Wand2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import { Input, Textarea } from '@/components/ui/input';
import { FormField as Field } from '@/components/ui/label';
import { Select, SELECT_NONE } from '@/components/ui/select';
import { Tooltip } from '@/components/ui/popover';
import type { FormField } from '@/lib/api/types-onboarding';
import { cn } from '@/lib/utils';
import { fieldLabel } from './model';

/** Magic-wand marker for values pulled from the digital personal file. */
export function AutoFilledMark({ className }: { className?: string }) {
  const t = useTranslations('onboarding.review');
  return (
    <Tooltip content={t('autoFilled')}>
      <span className={cn('inline-flex text-purple-fg', className)}>
        <Wand2 className="size-3.5" aria-label={t('autoFilled')} />
      </span>
    </Tooltip>
  );
}

/**
 * Controlled renderer for `FormField[]` (doc types and questionnaires): text / textarea / number / date /
 * select / checkbox. Values are form drafts (strings / booleans), see `toDraft` / `fromDraft`.
 */
export function DynamicFields({
  fields,
  values,
  onChange,
  errors,
  autoFilledKeys = [],
  disabled,
  idPrefix,
  columns = 1,
}: {
  fields: FormField[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  errors?: Record<string, string | undefined>;
  autoFilledKeys?: string[];
  disabled?: boolean;
  idPrefix: string;
  columns?: 1 | 2;
}) {
  const locale = useLocale();
  const t = useTranslations('onboarding.fields');
  return (
    <div className={cn('grid gap-4', columns === 2 && 'sm:grid-cols-2')}>
      {fields.map((f) => {
        const id = `${idPrefix}-${f.key}`;
        const label = fieldLabel(f, locale);
        const auto = autoFilledKeys.includes(f.key);
        const error = errors?.[f.key];
        const value = values[f.key];
        const labelNode = (
          <span className="inline-flex items-center gap-1.5">
            {label}
            {auto && <AutoFilledMark />}
          </span>
        );
        if (f.type === 'checkbox') {
          return (
            <div key={f.key} className={cn('flex flex-col gap-1', columns === 2 && 'sm:col-span-2')}>
              <Checkbox
                id={id}
                label={
                  <>
                    {labelNode}
                    {f.required && (
                      <span className="ml-0.5 text-red-fg" aria-hidden>
                        *
                      </span>
                    )}
                  </>
                }
                checked={value === true}
                disabled={disabled}
                aria-invalid={error ? true : undefined}
                aria-required={f.required || undefined}
                onCheckedChange={(v) => onChange(f.key, v === true)}
              />
              {error && (
                <p role="alert" className="text-xs font-medium text-red-fg">
                  {error}
                </p>
              )}
            </div>
          );
        }
        const str = typeof value === 'string' ? value : '';
        return (
          <Field
            key={f.key}
            id={id}
            label={labelNode}
            required={f.required}
            error={error}
            className={cn(f.type === 'textarea' && columns === 2 && 'sm:col-span-2')}
          >
            {f.type === 'textarea' ? (
              <Textarea value={str} disabled={disabled} onChange={(e) => onChange(f.key, e.target.value)} className={cn(auto && 'bg-purple-bg/40')} />
            ) : f.type === 'date' ? (
              <DatePicker value={str} disabled={disabled} onChange={(v) => onChange(f.key, v)} className={cn(auto && 'bg-purple-bg/40')} />
            ) : f.type === 'select' ? (
              <Select
                value={str || SELECT_NONE}
                disabled={disabled}
                onValueChange={(v) => onChange(f.key, v === SELECT_NONE ? '' : v)}
                options={[{ value: SELECT_NONE, label: t('notSelected') }, ...(f.options ?? []).map((o) => ({ value: o, label: o }))]}
                className={cn(auto && 'bg-purple-bg/40')}
              />
            ) : (
              <Input
                value={str}
                disabled={disabled}
                inputMode={f.type === 'number' ? 'decimal' : f.key === 'iin' ? 'numeric' : undefined}
                onChange={(e) => onChange(f.key, e.target.value)}
                className={cn(auto && 'bg-purple-bg/40')}
              />
            )}
          </Field>
        );
      })}
    </div>
  );
}

/** Read-only definition list of answers (HR side, questionnaire). */
export function AnswersList({ fields, values }: { fields: FormField[]; values: Record<string, unknown> }) {
  const locale = useLocale();
  const t = useTranslations('onboarding.fields');
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {fields.map((f) => {
        const v = values[f.key];
        const text = v === true ? t('yes') : v === false ? t('no') : v === null || v === undefined || v === '' ? '—' : String(v);
        return (
          <div key={f.key} className="min-w-0">
            <dt className="text-xs text-fg-subtle">{fieldLabel(f, locale)}</dt>
            <dd className="mt-0.5 break-words text-sm text-fg">{text}</dd>
          </div>
        );
      })}
    </dl>
  );
}
