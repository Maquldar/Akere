'use client';

import { CheckCircle2, ChevronLeft, CircleSlash, Loader2, UserRound } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export type AutofillStage =
  | { kind: 'sms'; smsPreview: string }
  | { kind: 'loading'; smsPreview: string; reply: '511' | '512' }
  | { kind: 'granted'; smsPreview: string; filled: number }
  | { kind: 'denied'; smsPreview: string };

/**
 * Simulated government consent SMS (F-08, M1 p9 right phone): number 1414, the candidate replies
 * 511 (yes) or 512 (no) right inside the bubble UI.
 */
export function AutofillDialog({
  stage,
  onReply,
  onClose,
  error,
}: {
  stage: AutofillStage | null;
  onReply: (reply: '511' | '512') => void;
  onClose: () => void;
  error: string | null;
}) {
  const t = useTranslations('onboarding.portal.autofill');
  const tc = useTranslations('common');
  const locale = useLocale();
  if (!stage) return null;
  const time = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : `${locale}-KZ`, { hour: '2-digit', minute: '2-digit' }).format(new Date());
  const reply = stage.kind === 'loading' ? stage.reply : stage.kind === 'granted' ? '511' : stage.kind === 'denied' ? '512' : null;
  const busy = stage.kind === 'loading';

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      title={t('title')}
      description={t('description')}
      dismissible={!busy}
      footer={
        stage.kind === 'sms' || stage.kind === 'loading' ? (
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <Button variant="outline" size="lg" onClick={() => onReply('512')} disabled={busy} loading={busy && stage.reply === '512'}>
              {t('reply512')}
            </Button>
            <Button size="lg" onClick={() => onReply('511')} disabled={busy} loading={busy && stage.reply === '511'}>
              {t('reply511')}
            </Button>
          </div>
        ) : (
          <Button size="lg" onClick={onClose}>
            {stage.kind === 'granted' ? t('continue') : tc('close')}
          </Button>
        )
      }
    >
      <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-[28px] border-[6px] border-fg/90 bg-[#f2f2f7] shadow-pop">
        {/* phone status / contact bar */}
        <div className="flex items-center gap-2 border-b border-black/5 bg-white/80 px-3 py-2">
          <ChevronLeft className="size-5 text-[#007aff]" aria-hidden />
          <div className="flex flex-1 flex-col items-center">
            <span className="flex size-8 items-center justify-center rounded-full bg-[#c7c7cc] text-white">
              <UserRound className="size-5" aria-hidden />
            </span>
            <span className="mt-0.5 text-[11px] font-medium text-fg">1414</span>
          </div>
          <span className="w-5" aria-hidden />
        </div>
        <div className="flex max-h-[46dvh] min-h-[220px] flex-col gap-2 overflow-y-auto px-3 py-3" aria-live="polite">
          <p className="text-center text-[11px] text-[#8e8e93]">{t('today', { time })}</p>
          <div className="max-w-[85%] self-start whitespace-pre-line break-words rounded-2xl rounded-bl-md bg-[#e5e5ea] px-3 py-2 text-[13px] leading-snug text-black">
            {stage.smsPreview}
          </div>
          {reply && (
            <div className={cn('self-end rounded-2xl rounded-br-md px-3 py-1.5 text-[14px] font-medium text-white', reply === '511' ? 'bg-[#34c759]' : 'bg-[#8e8e93]')}>
              {reply}
            </div>
          )}
          {stage.kind === 'loading' && stage.reply === '511' && (
            <div className="flex items-center gap-2 self-start rounded-2xl bg-white px-3 py-2 text-[13px] text-fg-muted">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t('loading')}
            </div>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-3 rounded-md border border-red-border bg-red-bg px-3 py-2 text-[13px] text-red-fg">
          {error}
        </p>
      )}
      {stage.kind === 'granted' && (
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-green-border bg-green-bg p-3 text-green-fg">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div>
            <p className="text-sm font-semibold">{t('grantedTitle')}</p>
            <p className="mt-0.5 text-[13px]">{t('grantedText', { count: stage.filled })}</p>
          </div>
        </div>
      )}
      {stage.kind === 'denied' && (
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-border bg-surface-muted p-3 text-fg-muted">
          <CircleSlash className="mt-0.5 size-5 shrink-0" aria-hidden />
          <p className="text-[13px]">{t('deniedText')}</p>
        </div>
      )}
      {stage.kind === 'sms' && <p className="mt-3 text-center text-xs text-fg-subtle">{t('sandboxNote')}</p>}
    </Dialog>
  );
}
