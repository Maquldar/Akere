'use client';

import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const fieldBase =
  'w-full rounded-md border border-border bg-surface text-sm text-fg placeholder:text-fg-subtle transition-colors hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-fg-subtle aria-[invalid=true]:border-red-solid aria-[invalid=true]:focus-visible:ring-red-solid/15';

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  leftIcon?: ReactNode;
  rightSlot?: ReactNode;
  inputSize?: 'sm' | 'md';
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, leftIcon, rightSlot, inputSize = 'md', type = 'text', ...props },
  ref,
) {
  const h = inputSize === 'sm' ? 'h-8' : 'h-9';
  if (!leftIcon && !rightSlot) {
    return <input ref={ref} type={type} className={cn(fieldBase, h, 'px-3', className)} {...props} />;
  }
  return (
    <div className={cn('relative flex items-center', className)}>
      {leftIcon && (
        <span className="pointer-events-none absolute left-2.5 text-fg-subtle [&_svg]:size-4" aria-hidden>
          {leftIcon}
        </span>
      )}
      <input
        ref={ref}
        type={type}
        className={cn(fieldBase, h, leftIcon ? 'pl-8' : 'pl-3', rightSlot ? 'pr-9' : 'pr-3')}
        {...props}
      />
      {rightSlot && <span className="absolute right-1.5 flex items-center">{rightSlot}</span>}
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, rows = 3, ...props },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={cn(fieldBase, 'min-h-[72px] px-3 py-2', className)} {...props} />;
});
