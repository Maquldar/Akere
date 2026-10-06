'use client';

import { AlertTriangle, Inbox, Lock, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { isApiError } from '@/lib/api/errors';
import { cn } from '@/lib/utils';
import { Button } from './button';

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
  compact,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-14', className)}>
      <div className="flex size-11 items-center justify-center rounded-xl border border-border bg-surface-muted text-fg-subtle [&_svg]:size-5">
        {icon ?? <Inbox aria-hidden />}
      </div>
      <div className="max-w-sm">
        <p className="text-sm font-semibold text-fg">{title}</p>
        {description && <p className="mt-1 text-[13px] text-fg-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Generic error block with retry. Maps ApiError codes to friendly copy. */
export function ErrorState({
  error,
  onRetry,
  title,
  className,
  compact,
}: {
  error?: unknown;
  onRetry?: () => void;
  title?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  const t = useTranslations('errors');
  const tc = useTranslations('common');
  const forbidden = isApiError(error) && error.code === 'FORBIDDEN';
  const notFound = isApiError(error) && error.code === 'NOT_FOUND';
  const network = isApiError(error) && error.status === 0;
  const heading = title ?? (forbidden ? t('forbiddenTitle') : notFound ? t('notFoundTitle') : t('loadTitle'));
  const description = forbidden
    ? t('forbiddenText')
    : notFound
      ? t('notFoundText')
      : network
        ? t('network')
        : t('loadText');
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center text-center', compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-14', className)}>
      <div
        className={cn(
          'flex size-11 items-center justify-center rounded-xl border [&_svg]:size-5',
          forbidden ? 'border-border bg-surface-muted text-fg-subtle' : 'border-red-border bg-red-bg text-red-fg',
        )}
      >
        {forbidden ? <Lock aria-hidden /> : <AlertTriangle aria-hidden />}
      </div>
      <div className="max-w-sm">
        <p className="text-sm font-semibold text-fg">{heading}</p>
        <p className="mt-1 text-[13px] text-fg-muted">{description}</p>
      </div>
      {onRetry && !forbidden && !notFound && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw aria-hidden />
          {tc('retry')}
        </Button>
      )}
    </div>
  );
}
