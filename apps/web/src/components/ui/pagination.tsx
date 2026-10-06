'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Select } from './select';

export const PAGE_SIZES = [10, 25, 50, 100] as const;

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  className?: string;
}) {
  const t = useTranslations('pagination');
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 text-[13px] text-fg-muted', className)}>
      <span className="tabular" aria-live="polite">
        {t('range', { from, to, total })}
      </span>
      <div className="flex items-center gap-2">
        {onPageSizeChange && (
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline">{t('perPage')}</span>
            <Select
              size="sm"
              aria-label={t('perPage')}
              className="w-[76px]"
              value={String(pageSize)}
              onValueChange={(v) => onPageSizeChange(Number(v))}
              options={PAGE_SIZES.map((s) => ({ value: String(s), label: String(s) }))}
            />
          </div>
        )}
        <Button variant="outline" size="icon-sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label={t('prev')}>
          <ChevronLeft />
        </Button>
        <span className="min-w-[64px] text-center tabular">{t('pageOf', { page, pages })}</span>
        <Button variant="outline" size="icon-sm" onClick={() => onPageChange(page + 1)} disabled={page >= pages} aria-label={t('next')}>
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
