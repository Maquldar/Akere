import { cn, initials } from '@/lib/utils';

const sizes = { xs: 'size-6 text-[10px]', sm: 'size-7 text-[11px]', md: 'size-9 text-xs', lg: 'size-12 text-sm' };

/** Initials avatar (M4 style: light grey circle, dark initials). */
export function Avatar({
  name,
  size = 'sm',
  className,
}: {
  name: string | null | undefined;
  size?: keyof typeof sizes;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full border border-border bg-surface-hover font-semibold uppercase text-fg-muted',
        sizes[size],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
