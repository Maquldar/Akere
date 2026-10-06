import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** KPI card like the M4 timesheet board ("На смене сейчас 7 / 12"). */
export function StatCard({
  label,
  value,
  total,
  icon,
  hint,
  progress,
  tone = 'default',
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  total?: ReactNode;
  icon?: ReactNode;
  hint?: ReactNode;
  /** 0..1 */
  progress?: number;
  tone?: 'default' | 'danger' | 'success';
  className?: string;
}) {
  const danger = tone === 'danger';
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-2 rounded-xl border p-4 shadow-card',
        danger ? 'border-red-border bg-red-bg' : 'border-border bg-surface',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={cn('text-[13px] font-medium', danger ? 'text-red-fg' : 'text-fg-muted')}>{label}</span>
        {icon && <span className={cn('[&_svg]:size-4', danger ? 'text-red-fg' : 'text-fg-subtle')}>{icon}</span>}
      </div>
      <div className="flex items-baseline gap-1">
        <span className={cn('text-2xl font-semibold tabular', danger ? 'text-red-fg' : 'text-fg')}>{value}</span>
        {total !== undefined && <span className="text-base font-medium text-fg-subtle tabular">/ {total}</span>}
      </div>
      {progress !== undefined && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-surface-active" role="presentation">
          <div
            className={cn('h-full rounded-full', tone === 'success' || tone === 'default' ? 'bg-green-solid' : 'bg-red-solid')}
            style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }}
          />
        </div>
      )}
      {hint && <span className={cn('text-xs', danger ? 'text-red-fg' : 'text-fg-subtle')}>{hint}</span>}
    </div>
  );
}
