'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, ExternalLink, KeyRound, QrCode, ShieldCheck, Smartphone, TimerOff, XCircle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormError, FormField } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/components/shell/me-context';
import { isApiError } from '@/lib/api/errors';
import {
  invalidateDocuments, useCancelSigningSession, useCreateSigningSession, useNcaLayerSign, useSigningSession,
} from '@/lib/api/hooks/documents';
import type { SessionMethod, SigningSessionView } from '@/lib/api/types-documents';
import { cn } from '@/lib/utils';
import { localSignPath } from './labels';
import { SuccessBurst } from './success-burst';

type Step = 'choose' | 'qr' | 'pin' | 'done';

function useCountdown(expiresAt: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  if (!expiresAt) return { left: 0, label: '0:00' };
  const left = Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 1000));
  return { left, label: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` };
}

/** Sandbox badge so nobody mistakes the demo signing for a legally binding one. */
export function SandboxBadge({ className }: { className?: string }) {
  const t = useTranslations('documents.signing');
  return (
    <Badge tone="orange" className={cn('uppercase tracking-wide', className)}>
      {t('sandbox')}
    </Badge>
  );
}

export function SigningDialog({
  open,
  onOpenChange,
  documentIds,
  onSigned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentIds: string[];
  onSigned?: (session: SigningSessionView) => void;
}) {
  const t = useTranslations('documents.signing');
  const tc = useTranslations('common');
  const locale = useLocale();
  const qc = useQueryClient();
  const { me } = useCurrentUser();
  const canSignBusiness = me.roles.some((r) => r.canSign);
  const [step, setStep] = useState<Step>('choose');
  const [method, setMethod] = useState<SessionMethod | null>(null);
  const [session, setSession] = useState<SigningSessionView | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useCreateSigningSession();
  const nca = useNcaLayerSign();
  const cancel = useCancelSigningSession();
  const polling = step === 'qr' && session?.status === 'PENDING';
  const live = useSigningSession(step === 'qr' ? (session?.id ?? null) : null, { poll: polling });
  // GET /signing/sessions/:id does not repeat the QR (only the create response carries it).
  const current = live.data && session ? { ...live.data, qrDataUrl: session.qrDataUrl, qrUrl: session.qrUrl } : session;
  const countdown = useCountdown(current?.status === 'PENDING' ? current.expiresAt : undefined);
  const finished = useRef(false);

  const errorText = (e: unknown) => {
    if (isApiError(e)) {
      if (e.rule === 'NOTHING_TO_SIGN') return t('errNothing');
      if (e.rule === 'NOT_SIGNATORY') return t('errNotSignatory');
      if (e.rule === 'INVALID_PIN') return t('errPin');
      if (e.rule === 'SESSION_EXPIRED') return t('errExpired');
      return e.message;
    }
    return tc('error');
  };

  // Reset when (re)opened.
  useEffect(() => {
    if (open) {
      setStep('choose');
      setMethod(null);
      setSession(null);
      setPin('');
      setError(null);
      finished.current = false;
    }
  }, [open]);

  const complete = (s: SigningSessionView) => {
    if (finished.current) return;
    finished.current = true;
    setSession(s);
    setStep('done');
    invalidateDocuments(qc);
    onSigned?.(s);
  };

  // QR flow: the phone page confirms; we learn about it by polling.
  useEffect(() => {
    if (step === 'qr' && live.data?.status === 'COMPLETED') complete(live.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.data?.status, step]);

  const start = (m: SessionMethod) => {
    setError(null);
    setMethod(m);
    create.mutate(
      { documentIds, method: m },
      {
        onSuccess: (s) => {
          setSession(s);
          setStep(m === 'NCALAYER' ? 'pin' : 'qr');
        },
        onError: (e) => setError(errorText(e)),
      },
    );
  };

  const submitPin = (e: FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setError(null);
    if (pin.trim().length < 4) {
      setError(t('pinShort'));
      return;
    }
    nca.mutate(
      { sessionId: session.id, pin: pin.trim() },
      {
        onSuccess: (s) => complete(s),
        onError: (err) => setError(errorText(err)),
      },
    );
  };

  const close = (o: boolean) => {
    if (!o && session && step !== 'done' && (current?.status ?? 'PENDING') === 'PENDING') cancel.mutate(session.id);
    onOpenChange(o);
  };

  const back = () => {
    if (session && current?.status === 'PENDING') cancel.mutate(session.id);
    setSession(null);
    setStep('choose');
    setError(null);
    setPin('');
  };

  const methods: { m: SessionMethod; title: string; hint: string; icon: typeof Smartphone; hidden?: boolean }[] = [
    { m: 'EGOV_MOBILE', title: 'eGov mobile', hint: t('egovHint'), icon: Smartphone },
    { m: 'EGOV_BUSINESS', title: 'eGov mobile Business', hint: t('egovBusinessHint'), icon: QrCode, hidden: !canSignBusiness },
    { m: 'NCALAYER', title: t('ncaTitle'), hint: t('ncaHint'), icon: KeyRound },
  ];

  const status = current?.status;
  const total = session?.documentIds.length ?? documentIds.length;

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      size="sm"
      dismissible={!create.isPending && !nca.isPending}
      title={
        <span className="flex flex-wrap items-center gap-2">
          {step === 'done' ? t('doneTitle') : t('title')}
          <SandboxBadge />
        </span>
      }
      description={step === 'choose' ? t('chooseText', { count: documentIds.length }) : undefined}
      footer={
        step === 'done' ? (
          <Button onClick={() => onOpenChange(false)}>{t('continue')}</Button>
        ) : step !== 'choose' ? (
          <Button variant="outline" onClick={back} disabled={nca.isPending}>
            <ArrowLeft />
            {t('otherMethod')}
          </Button>
        ) : undefined
      }
    >
      {step === 'choose' && (
        <div className="flex flex-col gap-2" role="list" aria-label={t('chooseMethod')}>
          <p className="section-label pb-1">{t('chooseMethod')}</p>
          {methods
            .filter((x) => !x.hidden)
            .map(({ m, title, hint, icon: Icon }) => (
              <button
                key={m}
                type="button"
                role="listitem"
                onClick={() => start(m)}
                disabled={create.isPending}
                className="focus-ring flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-3 text-left transition-colors hover:bg-surface-hover disabled:opacity-60"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-white">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-fg">{title}</span>
                  <span className="block text-xs text-fg-subtle">{hint}</span>
                </span>
                {create.isPending && method === m ? <Spinner /> : <ChevronRight className="size-4 text-fg-subtle" aria-hidden />}
              </button>
            ))}
          <FormError message={error} className="mt-2" />
        </div>
      )}

      {step === 'qr' && current && (
        <div className="flex flex-col items-center gap-4">
          {status === 'PENDING' && current.qrDataUrl && (
            <>
              <div className="rounded-xl border border-border bg-white p-3 shadow-card">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={current.qrDataUrl} alt={t('qrAlt')} width={208} height={208} className="size-52" />
              </div>
              <ol className="w-full space-y-1.5 text-sm text-fg">
                <li className="flex gap-2"><span className="font-semibold text-primary">1.</span>{t('qrStep1', { app: method === 'EGOV_BUSINESS' ? 'eGov mobile Business' : 'eGov mobile' })}</li>
                <li className="flex gap-2"><span className="font-semibold text-primary">2.</span>{t('qrStep2')}</li>
                <li className="flex gap-2"><span className="font-semibold text-primary">3.</span>{t('qrStep3')}</li>
              </ol>
              <div className="flex w-full items-center justify-between gap-2 rounded-lg bg-surface-muted px-3 py-2 text-[13px]">
                <span className="flex items-center gap-2 text-fg-muted">
                  <Spinner />
                  {t('waiting')}
                </span>
                <span className="font-semibold tabular text-fg" aria-label={t('expiresIn', { time: countdown.label })}>
                  {countdown.label}
                </span>
              </div>
              {current.qrUrl && (
                <a
                  href={localSignPath(current.qrUrl, locale)}
                  target="_blank"
                  rel="noopener"
                  className="focus-ring inline-flex items-center gap-1.5 rounded text-[13px] font-medium text-primary hover:underline"
                >
                  <ExternalLink className="size-3.5" aria-hidden />
                  {t('openHere')}
                </a>
              )}
            </>
          )}
          {(status === 'EXPIRED' || (status === 'PENDING' && countdown.left === 0)) && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <TimerOff className="size-8 text-orange-fg" aria-hidden />
              <p className="text-sm text-fg">{t('expired')}</p>
              <Button onClick={() => method && start(method)} loading={create.isPending}>
                {t('newQr')}
              </Button>
            </div>
          )}
          {status === 'CANCELLED' && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <XCircle className="size-8 text-red-fg" aria-hidden />
              <p className="text-sm text-fg">{t('declined')}</p>
              <Button onClick={() => method && start(method)} loading={create.isPending}>
                {t('newQr')}
              </Button>
            </div>
          )}
          <FormError message={error} className="w-full" />
        </div>
      )}

      {step === 'pin' && (
        <form onSubmit={submitPin} className="flex flex-col gap-4" noValidate>
          <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-muted p-3">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <p className="text-[13px] text-fg-muted">{t('ncaText', { count: total })}</p>
          </div>
          <FormField label={t('pin')} required hint={t('pinHint')} error={null}>
            <Input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              maxLength={32}
            />
          </FormField>
          <FormError message={error} />
          <Button type="submit" loading={nca.isPending}>
            {t('signWithKey')}
          </Button>
        </form>
      )}

      {step === 'done' && session && (
        <SuccessBurst title={t('success')}>{t('successText', { count: session.signedCount || total })}</SuccessBurst>
      )}
    </Dialog>
  );
}
