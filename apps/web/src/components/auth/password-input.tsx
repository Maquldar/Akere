'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { forwardRef, useState } from 'react';
import { Input, type InputProps } from '@/components/ui/input';

export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputProps, 'type' | 'rightSlot'>>(function PasswordInput(props, ref) {
  const t = useTranslations('auth');
  const [show, setShow] = useState(false);
  return (
    <Input
      ref={ref}
      type={show ? 'text' : 'password'}
      {...props}
      rightSlot={
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? t('hidePassword') : t('showPassword')}
          aria-pressed={show}
          className="focus-ring inline-flex size-7 items-center justify-center rounded text-fg-subtle hover:text-fg"
        >
          {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      }
    />
  );
});

export function PasswordPolicyHint({ value, id }: { value: string; id?: string }) {
  const t = useTranslations('auth.policy');
  const rules = [
    { ok: value.length >= 10, label: t('length') },
    { ok: /\p{L}/u.test(value), label: t('letter') },
    { ok: /\p{Nd}/u.test(value), label: t('digit') },
  ];
  return (
    <ul id={id} className="flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-label={t('title')}>
      {rules.map((r) => (
        <li key={r.label} className={r.ok ? 'text-green-fg' : 'text-fg-subtle'}>
          <span aria-hidden>{r.ok ? '✓' : '•'}</span> {r.label}
          <span className="sr-only">{r.ok ? ` (${t('met')})` : ` (${t('notMet')})`}</span>
        </li>
      ))}
    </ul>
  );
}
