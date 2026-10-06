'use client';

import { ArrowLeft, KeyRound, Mail, MessageCircle, Smartphone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { OtpInput } from '@/components/auth/otp-input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { FormError, FormField } from '@/components/ui/label';
import { isApiError } from '@/lib/api/errors';
import { usePortalRequestCode, usePortalVerify } from '@/lib/api/hooks/onboarding';
import type { PortalCodeResult } from '@/lib/api/types-onboarding';
import { normalizePhone } from '@/lib/validation';

const RESEND_SEC = 60;

/** OTP sign-in for candidates (F-07): login (email/phone) → 6-digit code. */
export function PortalLogin() {
  const t = useTranslations('onboarding.portal');
  const tch = useTranslations('channels');
  const tc = useTranslations('common');
  const search = useSearchParams();
  const [login, setLogin] = useState(() => search.get('login') ?? '');
  const [sent, setSent] = useState<PortalCodeResult | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const requestCode = usePortalRequestCode();
  const verify = usePortalVerify();
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);

  useEffect(() => {
    if (sent) codeRef.current?.focus();
  }, [sent]);

  const normalized = () => {
    const v = login.trim();
    return v.includes('@') ? v.toLowerCase() : normalizePhone(v);
  };

  const ask = async () => {
    setError(null);
    const value = normalized();
    if (value.length < 3) return setError(t('loginRequired'));
    try {
      const res = await requestCode.mutateAsync(value);
      setSent(res);
      setCode('');
      setLeft(RESEND_SEC);
    } catch (e) {
      if (isApiError(e) && e.code === 'RATE_LIMITED') {
        setError(t('rateLimited', { sec: e.retryAfterSec ?? 60 }));
        if (e.retryAfterSec) setLeft(e.retryAfterSec);
      } else setError(isApiError(e) && e.code === 'VALIDATION_ERROR' ? t('loginRequired') : isApiError(e) ? e.message : tc('error'));
    }
  };

  const submitCode = async (value = code) => {
    if (value.length !== 6) return setError(t('codeLength'));
    setError(null);
    try {
      await verify.mutateAsync({ login: normalized(), code: value });
    } catch (e) {
      if (isApiError(e) && e.code === 'RATE_LIMITED') setError(t('rateLimited', { sec: e.retryAfterSec ?? 60 }));
      else setError(isApiError(e) && (e.code === 'VALIDATION_ERROR' || e.status === 400) ? t('codeInvalid') : isApiError(e) ? e.message : tc('error'));
      setCode('');
      codeRef.current?.focus();
    }
  };

  const ChannelIcon = sent?.channel === 'EMAIL' ? Mail : sent?.channel === 'WHATSAPP' ? MessageCircle : Smartphone;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 pt-2 sm:pt-6">
      <div className="text-center">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <KeyRound className="size-6" aria-hidden />
        </div>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-fg">{t('loginTitle')}</h1>
        <p className="mt-1.5 text-sm text-fg-muted">{sent ? t('codeSubtitle') : t('loginSubtitle')}</p>
      </div>
      <Card className="p-5">
        {!sent ? (
          <form
            noValidate
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void ask();
            }}
          >
            <FormError message={error} />
            <FormField label={t('loginLabel')} hint={t('loginHint')}>
              <Input
                autoComplete="username"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                placeholder="name@example.com / +7 701 123 45 67"
                className="h-11 text-base sm:text-sm"
              />
            </FormField>
            <Button type="submit" size="lg" loading={requestCode.isPending} disabled={left > 0}>
              {left > 0 ? t('resendIn', { sec: left }) : t('getCode')}
            </Button>
          </form>
        ) : (
          <form
            noValidate
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submitCode();
            }}
          >
            <div className="flex items-start gap-3 rounded-lg bg-surface-muted p-3 text-[13px] text-fg-muted">
              <ChannelIcon className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
              <p>{t('codeSent', { channel: tch(sent.channel), target: sent.maskedTarget })}</p>
            </div>
            <FormError message={error} />
            <FormField label={t('codeLabel')}>
              <OtpInput
                ref={codeRef}
                value={code}
                onChange={(v) => {
                  setCode(v);
                  if (v.length === 6) void submitCode(v);
                }}
                disabled={verify.isPending}
              />
            </FormField>
            <Button type="submit" size="lg" loading={verify.isPending} disabled={code.length !== 6}>
              {t('signIn')}
            </Button>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSent(null);
                  setError(null);
                }}
              >
                <ArrowLeft />
                {t('changeLogin')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void ask()} disabled={left > 0 || requestCode.isPending} aria-live="polite">
                {left > 0 ? t('resendIn', { sec: left }) : t('resend')}
              </Button>
            </div>
          </form>
        )}
      </Card>
      <p className="text-center text-xs text-fg-subtle">{t('loginFooter')}</p>
    </div>
  );
}
