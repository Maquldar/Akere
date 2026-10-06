'use client';

import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';

export const DialogRoot = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const widths = { sm: 'sm:max-w-[420px]', md: 'sm:max-w-[560px]', lg: 'sm:max-w-[760px]' };

export type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof widths;
  /** Prevent closing on outside click (e.g. while saving). */
  dismissible?: boolean;
};

/** Modal dialog. On phones it becomes a bottom sheet. */
export function Dialog({ open, onOpenChange, title, description, children, footer, size = 'md', dismissible = true }: DialogProps) {
  const t = useTranslations('common');
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 animate-fade-in" />
        <DialogPrimitive.Content
          onInteractOutside={(e) => {
            if (!dismissible) e.preventDefault();
          }}
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-2xl border border-border bg-surface shadow-pop animate-fade-in focus:outline-none',
            'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-[8vh] sm:max-h-[84vh] sm:w-[calc(100%-32px)] sm:-translate-x-1/2 sm:rounded-xl',
            widths[size],
          )}
        >
          <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-5">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-base font-semibold text-fg">{title}</DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="mt-1 text-[13px] text-fg-muted">{description}</DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t('close')} className="-mr-2 -mt-1">
                <X />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
          {footer && (
            <div className="pb-safe flex flex-col-reverse gap-2 border-t border-border px-5 py-3 sm:flex-row sm:justify-end">
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Confirmation dialog for destructive or important actions. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  loading,
  tone = 'danger',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: ReactNode;
  onConfirm: () => void;
  loading?: boolean;
  tone?: 'danger' | 'primary';
}) {
  const t = useTranslations('common');
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      dismissible={!loading}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {t('cancel')}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
