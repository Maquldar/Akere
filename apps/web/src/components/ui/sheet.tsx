'use client';

import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';

export type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  side?: 'right' | 'left';
  className?: string;
  /** Hide the header (e.g. mobile navigation drawer renders its own). Title is still announced. */
  hideHeader?: boolean;
};

/** Side panel (details, filters, mobile navigation). */
export function Sheet({ open, onOpenChange, title, description, children, footer, side = 'right', className, hideHeader }: SheetProps) {
  const t = useTranslations('common');
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 animate-fade-in" />
        <DialogPrimitive.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(
            'fixed inset-y-0 z-50 flex w-[min(100vw-40px,480px)] flex-col border-border bg-surface shadow-pop focus:outline-none',
            side === 'right' ? 'right-0 border-l animate-slide-in-right' : 'left-0 border-r animate-slide-in-left',
            className,
          )}
        >
          {hideHeader ? (
            <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          ) : (
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <DialogPrimitive.Title className="text-base font-semibold text-fg">{title}</DialogPrimitive.Title>
                {description && (
                  <DialogPrimitive.Description className="mt-1 text-[13px] text-fg-muted">{description}</DialogPrimitive.Description>
                )}
              </div>
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon-sm" aria-label={t('close')} className="-mr-2">
                  <X />
                </Button>
              </DialogPrimitive.Close>
            </div>
          )}
          <div className={cn('min-h-0 flex-1 overflow-y-auto', !hideHeader && 'p-5')}>{children}</div>
          {footer && <div className="pb-safe flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
