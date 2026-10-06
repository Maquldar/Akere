'use client';

import { Slot } from 'radix-ui';
import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-primary-fg hover:bg-primary-hover active:bg-primary-active disabled:bg-primary/50 shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]',
  secondary: 'bg-surface-hover text-fg hover:bg-surface-active disabled:text-fg-subtle',
  outline: 'border border-border bg-surface text-fg hover:bg-surface-hover disabled:text-fg-subtle shadow-card',
  ghost: 'text-fg hover:bg-surface-hover disabled:text-fg-subtle',
  danger: 'bg-red-fg text-white hover:bg-[#912018] disabled:opacity-50',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-md',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-lg',
  icon: 'h-9 w-9 rounded-md',
  'icon-sm': 'h-8 w-8 rounded-md',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Render the child element (e.g. a Link) with button styles. */
  asChild?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, asChild = false, className, children, disabled, type, ...props },
  ref,
) {
  const classes = cn(
    'focus-ring inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-colors disabled:cursor-not-allowed [&_svg]:size-4 [&_svg]:shrink-0',
    variants[variant],
    sizes[size],
    className,
  );
  if (asChild) {
    return (
      <Slot.Root ref={ref} className={classes} {...props}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
});
