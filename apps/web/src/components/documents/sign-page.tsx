'use client';

import { FileText, Smartphone, TimerOff, XCircle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { Link } from '@/i18n/navigation';
import { isApiError } from '@/lib/api/errors';
import { useMe } from '@/lib/api/hooks/auth';
import { useConfirmSigningQr, useSigningQr } from '@/lib/api/hooks/documents';
import { formatDateTime } from '@/lib/format';
import { SandboxBadge } from './signing-dialog';
import { SuccessBurst } from './success-burst';

/**
 * "eGov mobile (sandbox)" confirmation page opened from the QR code on the phone (deck p22).
 * Requires the same staff session that created the signing session.
 */
export function SignPage({ token }: { token: string }) {
  const t = useTranslations('sign');
  const tc = useTranslations('common');
  const locale = useLocale();
  const me = useMe();
  const qr = useSigningQr(token);
  const confirm = useConfirmSigningQr(token);
  const [result, setResult] = useState<'signed' | 'declined' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = (decision: 'SIGN' | 'DECLINE') => {
    setError(null);
    confirm.mutate(decision, {
      onSuccess: () => setResult(decision === 'SIGN' ? 'signed' : 'declined'),
      onError: (e) => {
        if (isApiError(e) && e.rule === 'SESSION_EXPIRED') setError(t('expired'));
        else if (isApiError(e) && e.rule === 'NOTHING_TO_SIGN') setError(t('nothing'));
        else setError(isApiError(e) ? e.message : tc('error'));
      },
    });
  };

  const session = qr.data?.session;
  const expired = session && (session.status === 'EXPIRED' || (session.status === 'PENDING' && new Date(session.expiresAt) < new Date()));

  return (
    <div className="flex min-h-dvh justify-center bg-canvas sm:items-center sm:py-8">
      <main className="flex min-h-dvh w-full max-w-[420px] flex-col bg-surface sm:min-h-[720px] sm:rounded-[28px] sm:border sm:border-border sm:shadow-pop">
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-fg">
            <span className="flex size-7 items-center justify-center rounded-lg bg-[#1d6ef0] text-[11px] font-bold text-white" aria-hidden>
              e
            </span>
            {t('app')}
          </span>
          <SandboxBadge />
        </header>

        <div className="flex flex-1 flex-col px-5 py-5">
          {me.isPending || qr.isLoading ? (
            <div className="flex flex-col gap-4" aria-busy>
              <Skeleton className="h-7 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : qr.error ? (
            <ErrorState
              error={qr.error}
              title={isApiError(qr.error) && qr.error.code === 'NOT_FOUND' ? t('notFound') : undefined}
              onRetry={() => qr.refetch()}
            />
          ) : result === 'signed' ? (
            <div className="flex flex-1 flex-col">
              <div className="flex flex-1 items-center justify-center">
                <SuccessBurst title={t('success')}>{t('successText')}</SuccessBurst>
              </div>
              <Button size="lg" asChild>
                <Link href="/inbox">{t('continue')}</Link>
              </Button>
            </div>
          ) : result === 'declined' ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <XCircle className="size-12 text-red-fg" aria-hidden />
              <p className="text-lg font-semibold text-fg">{t('declined')}</p>
              <p className="text-sm text-fg-muted">{t('declinedText')}</p>
              <Button variant="outline" asChild className="mt-4">
                <Link href="/inbox">{t('continue')}</Link>
              </Button>
            </div>
          ) : session && session.status !== 'PENDING' && !expired ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <Smartphone className="size-10 text-fg-subtle" aria-hidden />
              <p className="text-base font-semibold text-fg">{session.status === 'COMPLETED' ? t('alreadySigned') : t('closed')}</p>
              <Button variant="outline" asChild className="mt-4">
                <Link href="/inbox">{t('continue')}</Link>
              </Button>
            </div>
          ) : expired ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <TimerOff className="size-10 text-orange-fg" aria-hidden />
              <p className="text-base font-semibold text-fg">{t('expired')}</p>
              <p className="text-sm text-fg-muted">{t('expiredText')}</p>
            </div>
          ) : session && qr.data ? (
            <div className="flex flex-1 flex-col">
              <h1 className="text-xl font-semibold text-fg">{t('title')}</h1>
              <section className="mt-6 flex flex-col gap-4">
                <h2 className="text-sm font-semibold text-fg">{t('signing')}</h2>
                <dl className="flex flex-col gap-3">
                  <div>
                    <dt className="text-xs text-fg-subtle">{t('qrExpiry')}</dt>
                    <dd className="text-sm text-fg tabular">{formatDateTime(session.expiresAt, locale)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-fg-subtle">{t('from')}</dt>
                    <dd className="text-sm text-fg">Akere HR</dd>
                  </div>
                  {me.data && (
                    <div>
                      <dt className="text-xs text-fg-subtle">{t('signer')}</dt>
                      <dd className="text-sm text-fg">{me.data.fullName}</dd>
                    </div>
                  )}
                </dl>
                <div>
                  <h2 className="text-sm font-semibold text-fg">{t('documents', { count: qr.data.documents.length })}</h2>
                  <ul className="mt-2 divide-y divide-border border-y border-border">
                    {qr.data.documents.map((d) => (
                      <li key={d.id} className="flex items-start gap-2 py-3 text-sm">
                        <FileText className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
                        <span className="min-w-0">
                          <span className="block text-fg">{d.title}</span>
                          {d.number && <span className="block text-xs text-fg-subtle">№ {d.number}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
              <div className="mt-auto flex flex-col gap-2 pt-8">
                {error && (
                  <p role="alert" className="rounded-md border border-red-border bg-red-bg px-3 py-2 text-[13px] text-red-fg">
                    {error}
                  </p>
                )}
                <Button size="lg" onClick={() => decide('SIGN')} loading={confirm.isPending && confirm.variables === 'SIGN'} disabled={confirm.isPending}>
                  {t('sign')}
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  className="text-red-fg"
                  onClick={() => decide('DECLINE')}
                  loading={confirm.isPending && confirm.variables === 'DECLINE'}
                  disabled={confirm.isPending}
                >
                  {t('decline')}
                </Button>
                <p className="pt-2 text-center text-xs text-fg-subtle">{t('sandboxNote')}</p>
              </div>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
