'use client';

import { AlertTriangle, CheckCircle2, Loader2, PencilLine, Send, XCircle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from '@/components/ui/toaster';
import { StatusPill } from '@/components/ui/badge';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/popover';
import { isApiError } from '@/lib/api/errors';
import type { EsutdStatus, VndRecipientStatus, VndStatus } from '@/lib/api/types-compliance';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { downloadApiFile } from './download';

/** ВНД status with an icon (deck p33: ✎ Черновик, ➤ На ознакомлении, ✓ Завершен). */
export function VndStatusLabel({ status, className }: { status: VndStatus; className?: string }) {
  const t = useTranslations('vnd.status');
  const map = {
    DRAFT: { icon: PencilLine, cls: 'text-fg-muted' },
    IN_ROUTE: { icon: Send, cls: 'text-blue-fg' },
    COMPLETED: { icon: CheckCircle2, cls: 'text-green-fg' },
  }[status];
  const Icon = map.icon;
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium', map.cls, className)}>
      <Icon className="size-4 shrink-0" aria-hidden />
      {t(status)}
    </span>
  );
}

export function RecipientStatusPill({ status }: { status: VndRecipientStatus }) {
  const t = useTranslations('vnd.recipientStatus');
  return status === 'ACKNOWLEDGED' ? <StatusPill tone="green">{t(status)}</StatusPill> : <StatusPill tone="blue">{t(status)}</StatusPill>;
}

/** "12 / 24" with a thin progress bar. */
export function AckProgress({ acknowledged, total, className }: { acknowledged: number; total: number; className?: string }) {
  const t = useTranslations('vnd');
  if (!total) return <span className="text-fg-subtle">—</span>;
  const pct = Math.round((acknowledged / total) * 100);
  return (
    <div className={cn('flex min-w-[88px] flex-col gap-1', className)}>
      <span className="text-[13px] font-medium tabular text-fg" aria-label={t('ackAria', { acknowledged, total })}>
        {acknowledged} <span className="text-fg-subtle">/ {total}</span>
      </span>
      <div className="h-1 w-full overflow-hidden rounded-full bg-surface-active" role="presentation">
        <div className={cn('h-full rounded-full', pct === 100 ? 'bg-green-solid' : 'bg-primary')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** ЕСУТД status: Не отправлено (red) / В очереди / Отправлено + time (green) / Ошибка with reason tooltip. */
export function EsutdStatusCell({ status, sentAt, error }: { status: EsutdStatus; sentAt: string | null; error: string | null }) {
  const t = useTranslations('esutd.status');
  const locale = useLocale();
  if (status === 'SENT') {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-green-fg">
          <CheckCircle2 className="size-4" aria-hidden />
          {t('SENT')}
        </span>
        {sentAt && <span className="pl-[22px] text-xs tabular text-fg-subtle">{formatDateTime(sentAt, locale)}</span>}
      </div>
    );
  }
  if (status === 'QUEUED') {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-orange-fg">
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
        {t('QUEUED')}
      </span>
    );
  }
  if (status === 'ERROR') {
    return (
      <Tooltip content={error ?? t('ERROR')}>
        <button type="button" className="focus-ring inline-flex items-center gap-1.5 whitespace-nowrap rounded text-[13px] font-medium text-red-fg">
          <AlertTriangle className="size-4" aria-hidden />
          {t('ERROR')}
          <span className="sr-only">: {error}</span>
        </button>
      </Tooltip>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-red-fg">
      <XCircle className="size-4" aria-hidden />
      {t('NOT_SENT')}
    </span>
  );
}

/** Button that downloads an API file via fetch (errors → toast). */
export function DownloadButton({
  path,
  query,
  filename,
  children,
  ...props
}: Omit<ButtonProps, 'onClick'> & { path: string; query?: Record<string, unknown>; filename: string }) {
  const tc = useTranslations('compliance');
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      {...props}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await downloadApiFile(path, query, filename);
        } catch (e) {
          toast.error(isApiError(e) && e.status !== 0 ? e.message : tc('downloadFailed'));
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
    </Button>
  );
}
