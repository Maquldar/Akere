'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type KeyboardEvent } from 'react';
import { fieldBase } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** Free-form chips: Enter / comma adds, Backspace on empty removes the last one. */
export function TagInput({
  value,
  onChange,
  id,
  placeholder,
  max = 20,
  maxLength = 40,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  id?: string;
  placeholder?: string;
  max?: number;
  maxLength?: number;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
}) {
  const tc = useTranslations('common');
  const [text, setText] = useState('');

  const commit = () => {
    const parts = text
      .split(',')
      .map((s) => s.trim().slice(0, maxLength))
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) if (!next.some((x) => x.toLocaleLowerCase() === p.toLocaleLowerCase()) && next.length < max) next.push(p);
    onChange(next);
    setText('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !text && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className={cn(fieldBase, 'flex min-h-9 flex-wrap items-center gap-1 px-1.5 py-1 focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/15')}>
      {value.map((tag) => (
        <span key={tag} className="inline-flex max-w-full items-center gap-1 rounded-md bg-surface-hover px-2 py-0.5 text-[13px] text-fg">
          <span className="truncate">{tag}</span>
          <button
            type="button"
            className="focus-ring -mr-1 rounded p-0.5 text-fg-subtle hover:text-fg"
            onClick={() => onChange(value.filter((x) => x !== tag))}
            aria-label={tc('removeItem', { name: tag })}
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        placeholder={value.length ? undefined : placeholder}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        disabled={value.length >= max}
        className="h-7 min-w-[120px] flex-1 bg-transparent px-1.5 text-sm outline-none placeholder:text-fg-subtle"
      />
    </div>
  );
}
