'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { fieldBase } from './input';

export type DatePickerProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  /** `YYYY-MM-DD` or '' */
  value: string | undefined | null;
  onChange: (value: string) => void;
  inputSize?: 'sm' | 'md';
};

/** Native date input (locale-aware picker on every platform), styled like other fields. */
export const DatePicker = forwardRef<HTMLInputElement, DatePickerProps>(function DatePicker(
  { value, onChange, className, inputSize = 'md', ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type="date"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className={cn(fieldBase, inputSize === 'sm' ? 'h-8' : 'h-9', 'px-3 tabular', className)}
      {...props}
    />
  );
});

export type DateRange = { from?: string; to?: string };

export function DateRangeInput({
  value,
  onChange,
  className,
  inputSize = 'md',
  id,
  'aria-describedby': describedBy,
  labelFrom,
  labelTo,
}: {
  value: DateRange;
  onChange: (value: DateRange) => void;
  className?: string;
  inputSize?: 'sm' | 'md';
  id?: string;
  'aria-describedby'?: string;
  labelFrom?: string;
  labelTo?: string;
}) {
  const t = useTranslations('common');
  return (
    <div className={cn('flex min-w-0 items-center gap-1.5', className)} role="group">
      <DatePicker
        id={id}
        aria-describedby={describedBy}
        aria-label={labelFrom ?? t('dateFrom')}
        inputSize={inputSize}
        value={value.from}
        max={value.to || undefined}
        onChange={(from) => onChange({ ...value, from: from || undefined })}
        className="min-w-0 flex-1"
      />
      <span className="text-fg-subtle" aria-hidden>
        –
      </span>
      <DatePicker
        aria-label={labelTo ?? t('dateTo')}
        aria-describedby={describedBy}
        inputSize={inputSize}
        value={value.to}
        min={value.from || undefined}
        onChange={(to) => onChange({ ...value, to: to || undefined })}
        className="min-w-0 flex-1"
      />
    </div>
  );
}
