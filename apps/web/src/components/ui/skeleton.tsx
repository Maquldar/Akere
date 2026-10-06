import type { HTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn('animate-shimmer rounded-md bg-surface-active/70', className)} {...props} />;
}

export function Spinner({ className, label }: { className?: string; label?: string }) {
  const t = useTranslations('common');
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-fg-subtle', className)}>
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label ? <span className="text-sm">{label}</span> : <span className="sr-only">{t('loading')}</span>}
    </span>
  );
}

/** Stack of skeleton rows for list/card loading states. */
export function SkeletonList({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3', className)} aria-busy>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
