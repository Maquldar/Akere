'use client';

import { CheckCircle2, ExternalLink, KeyRound, QrCode, RefreshCw, Smartphone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { FormError, FormField } from '@/components/ui/label';
import { Skeleton, Spinner } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toaster';
import { isApiError } from '@/lib/api/errors';
import {
  useAcknowledgeVnd, useCancelSigningSession, useCreateSigningSession, useSignWithNcaLayer, useSigningSession,
} from '@/lib/api/hooks/compliance';
import type { VndDetail } from '@/lib/api/types-compliance';

type Method = 'egov' | 'ncalayer';

/**
 * "Подтвердить ознакомление" (deck p33): acknowledgment = ACKNOWLEDGE signature through /signing/sessions
 * (eGov mobile QR or NCALayer PIN), then POST /vnd/:id/acknowledge { signingSessionId }.
 * ВНД created without the ЭЦП requirement are acknowledged with a simple confirmation (CLICK).
 */
export function VndAcknowledgeDialog({ open, onOpenChange, vnd }: { open: boolean; onOpenChange: (o: boolean) => void; vnd: VndDetail }) {
  const t = useTranslations('vnd.ack');
  const tc = useTranslations('common');
  const ack = useAcknowledgeVnd(vnd.id);
  const createSession = useCreateSigningSession();
  const cancelSession = useCancelSigningSession();
  const nca = useSignWithNcaLayer();
  const [method, setMethod] = useState<Method>('egov');
  const [egovId, setEgovId] = useState<string | null>(null);
  // GET /signing/sessions/:id does not repeat the QR, so keep the one from the create response.
  const [egovQr, setEgovQr] = useState<{ dataUrl: string | null; url: string | null } | null>(null);
  const [ncaId, setNcaId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const finalized = useRef(false);
  // Guards against creating two QR sessions (StrictMode double effects, re-renders before isPending flips).
  const egovRequested = useRef(false);
  const egov = useSigningSession(open && method === 'egov' ? egovId : null);
  const requireSignature = vnd.requireSignature !== false;

  const finalize = useCallback(
    (sessionId?: string) => {
      if (finalized.current) return;
      finalized.current = true;
      // mutateAsync: the dialog unmounts as soon as the detail query says "acknowledged",
      // and per-call mutate() callbacks would then never run.
      ack
        .mutateAsync(sessionId)
        .then(() => {
          toast.success(t('success'));
          onOpenChange(false);
        })
        .catch((e: unknown) => {
          finalized.current = false;
          if (isApiError(e) && e.rule === 'ALREADY_ACKNOWLEDGED') {
            toast.success(t('success'));
            onOpenChange(false);
            return;
          }
          setError(isApiError(e) ? e.message : tc('error'));
        });
    },
    [ack, onOpenChange, t, tc],
  );

  const startEgov = useCallback(() => {
    if (egovRequested.current) return;
    egovRequested.current = true;
    setError(null);
    createSession.mutate(
      { documentIds: [vnd.id], method: 'EGOV_MOBILE' },
      {
        onSuccess: (s) => {
          setEgovId(s.id);
          setEgovQr({ dataUrl: s.qrDataUrl, url: s.qrUrl });
        },
        onError: (e) => {
          egovRequested.current = false;
          setError(isApiError(e) ? e.message : tc('error'));
        },
      },
    );
  }, [createSession, vnd.id, tc]);

  // Create the QR session as soon as the eGov tab is shown.
  useEffect(() => {
    if (open && requireSignature && method === 'egov' && !egovId && !createSession.isPending && !error) startEgov();
  }, [open, requireSignature, method, egovId, createSession.isPending, error, startEgov]);

  // Poll result → acknowledge.
  useEffect(() => {
    if (egov.data?.status === 'COMPLETED' && egovId) finalize(egovId);
  }, [egov.data?.status, egovId, finalize]);

  // Reset when closed; cancel sessions that were left pending.
  useEffect(() => {
    if (open) {
      finalized.current = false;
      return;
    }
    for (const id of [egovId, ncaId]) if (id) cancelSession.mutate(id, { onError: () => undefined });
    egovRequested.current = false;
    setEgovId(null);
    setNcaId(null);
    setPin('');
    setPinError(null);
    setError(null);
    setMethod('egov');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const signNca = async () => {
    setPinError(null);
    setError(null);
    if (!/^\d{4,32}$/.test(pin.trim())) {
      setPinError(t('pinInvalid'));
      return;
    }
    try {
      let id = ncaId;
      if (!id) {
        const s = await createSession.mutateAsync({ documentIds: [vnd.id], method: 'NCALAYER' });
        id = s.id;
        setNcaId(id);
      }
      const res = await nca.mutateAsync({ sessionId: id, pin: pin.trim() });
      if (res.status === 'COMPLETED') finalize(id);
      else setError(t('notCompleted'));
    } catch (e) {
      if (isApiError(e) && e.rule === 'INVALID_PIN') setPinError(t('pinWrong'));
      else if (isApiError(e) && e.status === 404) {
        setNcaId(null);
        setError(t('sessionExpired'));
      } else setError(isApiError(e) ? e.message : tc('error'));
    }
  };

  const busy = ack.isPending;
  const egovStatus = egov.data?.status;
  const session = egovId && egovQr ? { status: egov.data?.status ?? 'PENDING', qrDataUrl: egovQr.dataUrl, qrUrl: egovQr.url } : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title={t('title')}
      description={vnd.title}
      dismissible={!busy}
      footer={
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
          {tc('close')}
        </Button>
      }
    >
      <div className="grid gap-4" data-dialog-body>
        <FormError message={error} />
        {busy && (
          <div role="status" className="flex items-center gap-2 rounded-lg border border-blue-border bg-blue-bg px-3 py-2 text-[13px] text-blue-fg">
            <Spinner className="size-4" />
            {t('finishing')}
          </div>
        )}
        {!requireSignature ? (
          <div className="grid gap-3">
            <p className="text-sm text-fg-muted">{t('clickText')}</p>
            <Button onClick={() => finalize(undefined)} loading={busy} className="justify-self-start">
              <CheckCircle2 />
              {t('clickConfirm')}
            </Button>
          </div>
        ) : (
          <Tabs value={method} onValueChange={(v) => setMethod(v as Method)}>
            <TabsList aria-label={t('methodLabel')}>
              <TabsTrigger value="egov">
                <Smartphone className="size-3.5" aria-hidden />
                {t('egov')}
              </TabsTrigger>
              <TabsTrigger value="ncalayer">
                <KeyRound className="size-3.5" aria-hidden />
                {t('ncalayer')}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="egov">
              <div className="grid gap-4 sm:grid-cols-[200px_1fr] sm:items-start">
                <div className="flex aspect-square w-[200px] items-center justify-center justify-self-center overflow-hidden rounded-xl border border-border bg-white p-2">
                  {session?.qrDataUrl && egovStatus !== 'EXPIRED' && egovStatus !== 'CANCELLED' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={session.qrDataUrl} alt={t('qrAlt')} className="size-full" data-testid="vnd-qr" />
                  ) : createSession.isPending ? (
                    <Skeleton className="size-full" />
                  ) : (
                    <QrCode className="size-10 text-fg-subtle" aria-hidden />
                  )}
                </div>
                <div className="grid gap-3 text-[13px]">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-fg">{t('egovTitle')}</span>
                    <Badge tone="purple">{t('sandbox')}</Badge>
                  </div>
                  <ol className="list-decimal space-y-1 pl-4 text-fg-muted">
                    <li>{t('step1')}</li>
                    <li>{t('step2')}</li>
                    <li>{t('step3')}</li>
                  </ol>
                  {egovStatus === 'EXPIRED' || egovStatus === 'CANCELLED' ? (
                    <div className="grid gap-2">
                      <p className="text-orange-fg">{egovStatus === 'EXPIRED' ? t('qrExpired') : t('qrDeclined')}</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="justify-self-start"
                        onClick={() => {
                          egovRequested.current = false;
                          setEgovId(null);
                          setError(null);
                        }}
                      >
                        <RefreshCw aria-hidden />
                        {t('newQr')}
                      </Button>
                    </div>
                  ) : session ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 text-fg-muted" role="status">
                        <Spinner className="size-3.5" />
                        {t('waiting')}
                      </span>
                      {session.qrUrl && (
                        <Button asChild variant="ghost" size="sm">
                          <a href={session.qrUrl} target="_blank" rel="noopener noreferrer">
                            <ExternalLink aria-hidden />
                            {t('openOnDevice')}
                          </a>
                        </Button>
                      )}
                    </div>
                  ) : null}
                  <div className="flex items-center gap-2 text-xs text-fg-subtle">
                    <span className="h-px flex-1 bg-border" />
                    {t('or')}
                    <span className="h-px flex-1 bg-border" />
                  </div>
                  <Button variant="outline" onClick={() => setMethod('ncalayer')}>
                    <KeyRound />
                    {t('useNcaLayer')}
                  </Button>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="ncalayer">
              <form
                className="grid gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void signNca();
                }}
                noValidate
              >
                <p className="text-[13px] text-fg-muted">{t('ncaText')}</p>
                <FormField label={t('pin')} error={pinError} hint={t('pinHint')}>
                  <Input
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    className="sm:w-56"
                  />
                </FormField>
                <Button type="submit" className="justify-self-start" loading={createSession.isPending || nca.isPending}>
                  <KeyRound />
                  {t('signNca')}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </Dialog>
  );
}
