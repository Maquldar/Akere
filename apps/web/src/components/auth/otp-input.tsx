'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { fieldBase } from '@/components/ui/input';

/** 6-digit one-time code field (single input → works with SMS autofill and paste). */
export const OtpInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & { value: string; onChange: (v: string) => void }
>(function OtpInput({ value, onChange, className, ...props }, ref) {
  return (
    <input
      ref={ref}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="\d{6}"
      maxLength={6}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      className={cn(fieldBase, 'h-12 px-3 text-center font-mono text-2xl tracking-[0.5em] tabular', className)}
      {...props}
    />
  );
});
