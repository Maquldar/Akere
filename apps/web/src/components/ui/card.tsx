import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl border border-border bg-surface shadow-card', className)} {...props} />;
}

export function CardHeader({
  title,
  count,
  actions,
  className,
  titleAs: Title = 'h2',
}: {
  title: ReactNode;
  count?: number;
  actions?: ReactNode;
  className?: string;
  titleAs?: 'h2' | 'h3';
}) {
  return (
    <div className={cn('flex min-h-[52px] items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5', className)}>
      <div className="flex min-w-0 items-center gap-2">
        <Title className="truncate text-[15px] font-semibold text-fg">{title}</Title>
        {count !== undefined && (
          <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium text-fg-muted tabular">{count}</span>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 sm:p-5', className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center justify-end gap-2 border-t border-border px-4 py-3 sm:px-5', className)} {...props} />;
}
