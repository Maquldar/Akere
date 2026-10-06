import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type Tone = 'green' | 'orange' | 'red' | 'blue' | 'gray' | 'purple' | 'teal';

const pill: Record<Tone, string> = {
  green: 'bg-green-bg text-green-fg border-green-border',
  orange: 'bg-orange-bg text-orange-fg border-orange-border',
  red: 'bg-red-bg text-red-fg border-red-border',
  blue: 'bg-blue-bg text-blue-fg border-blue-border',
  gray: 'bg-gray-bg text-gray-fg border-gray-border',
  purple: 'bg-purple-bg text-purple-fg border-purple-border',
  teal: 'bg-teal-bg text-teal-fg border-teal-border',
};

const dot: Record<Tone, string> = {
  green: 'bg-green-solid',
  orange: 'bg-orange-solid',
  red: 'bg-red-solid',
  blue: 'bg-blue-solid',
  gray: 'bg-gray-solid',
  purple: 'bg-purple-solid',
  teal: 'bg-teal-solid',
};

const text: Record<Tone, string> = {
  green: 'text-green-fg',
  orange: 'text-orange-fg',
  red: 'text-red-fg',
  blue: 'text-blue-fg',
  gray: 'text-gray-fg',
  purple: 'text-purple-fg',
  teal: 'text-teal-fg',
};

/** Rounded pill label (shift chips, role tags, counters). */
export function Badge({
  tone = 'gray',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 truncate rounded-md border px-2 py-0.5 text-xs font-medium leading-4',
        pill[tone],
        className,
      )}
      {...props}
    />
  );
}

/**
 * Status indicator. `variant="dot"` = colored dot + colored text (M4 "● Норма"),
 * `variant="pill"` = filled pill with a dot (M1 status pills).
 */
export function StatusPill({
  tone,
  children,
  variant = 'pill',
  className,
}: {
  tone: Tone;
  children: ReactNode;
  variant?: 'pill' | 'dot';
  className?: string;
}) {
  if (variant === 'dot') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-[13px] font-medium', text[tone], className)}>
        <span className={cn('size-1.5 shrink-0 rounded-full ring-2 ring-current/15', dot[tone])} aria-hidden />
        {children}
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium leading-4',
        pill[tone],
        className,
      )}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', dot[tone])} aria-hidden />
      {children}
    </span>
  );
}

/** Small numeric counter used in the sidebar and tabs. */
export function CountBadge({ value, tone = 'gray', className }: { value: number; tone?: 'gray' | 'red' | 'blue'; className?: string }) {
  if (!value) return null;
  const styles = {
    gray: 'bg-surface-active text-fg-muted',
    red: 'bg-red-solid text-white',
    blue: 'bg-primary text-white',
  }[tone];
  return (
    <span className={cn('inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular', styles, className)}>
      {value > 99 ? '99+' : value}
    </span>
  );
}
