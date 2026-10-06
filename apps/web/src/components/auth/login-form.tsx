'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, LogIn } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { FormError, FormField } from '@/components/ui/label';
import { Link } from '@/i18n/navigation';
import { useLogin, useLoginOtp } from '@/lib/api/hooks/auth';
import type { ContactChannel } from '@/lib/api/types';
import { authErrorMessage } from '@/lib/auth-errors';
import { DemoAccounts } from './demo-accounts';
import { OtpInput } from './otp-input';
import { PasswordInput } from './password-input';
import { useAfterLogin } from './use-after-login';

type OtpState = { channel: ContactChannel; maskedTarget: string };

export function LoginForm() {
  const t = useTranslations('auth');
  const te = useTranslations('auth.errors');
  const tch = useTranslations('channels');
  const locale = useLocale();
  const [otp, setOtp] = useState<OtpState | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const login = useLogin();
  const loginOtp = useLoginOtp();
  const afterLogin = useAfterLogin();

  const schema = z.object({
    login: z.string().trim().min(1, t('loginRequired')),
    password: z.string().min(1, t('passwordRequired')),
  });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { login: '', password: '' } });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await login.mutateAsync(values);
      if (res.status === 'OK') afterLogin(res.me);
      else {
        setOtp({ channel: res.channel, maskedTarget: res.maskedTarget });
        setCode('');
      }
    } catch (e) {
      setError(authErrorMessage(e, te));
    }
  });

  const onSubmitOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) {
      setError(t('otpLength'));
      return;
    }
    setError(null);
    try {
      const res = await loginOtp.mutateAsync(code);
      afterLogin(res.me);
    } catch (err) {
      setError(authErrorMessage(err, te));
    }
  };

  const loginValue = form.watch('login');

  return (
    <div className="flex w-full max-w-[400px] flex-col gap-5">
      <Card className="p-6 sm:p-7">
        {!otp ? (
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4" lang={locale}>
            <div>
              <h1 className="text-xl font-semibold tracking-[-0.01em] text-fg">{t('title')}</h1>
              <p className="mt-1 text-[13px] text-fg-muted">{t('subtitle')}</p>
            </div>
            <FormError message={error} />
            <FormField label={t('login')} required error={form.formState.errors.login?.message} hint={t('loginHint')}>
              <Input autoComplete="username" autoFocus inputMode="email" {...form.register('login')} />
            </FormField>
            <FormField label={t('password')} required error={form.formState.errors.password?.message}>
              <PasswordInput autoComplete="current-password" {...form.register('password')} />
            </FormField>
            <div className="-mt-1 flex justify-end">
              <Link
                href={loginValue ? { pathname: '/reset', query: { login: loginValue } } : '/reset'}
                className="focus-ring rounded text-[13px] font-medium text-primary hover:underline"
              >
                {t('forgot')}
              </Link>
            </div>
            <Button type="submit" size="lg" loading={login.isPending} className="w-full">
              <LogIn />
              {t('submit')}
            </Button>
          </form>
        ) : (
          <form onSubmit={onSubmitOtp} noValidate className="flex flex-col gap-4">
            <div>
              <h1 className="text-xl font-semibold tracking-[-0.01em] text-fg">{t('otpTitle')}</h1>
              <p className="mt-1 text-[13px] text-fg-muted">
                {t('otpSent', { channel: tch(otp.channel), target: otp.maskedTarget })}
              </p>
            </div>
            <FormError message={error} />
            <FormField label={t('otpCode')} required hint={t('otpHint')}>
              <OtpInput value={code} onChange={setCode} autoFocus />
            </FormField>
            <Button type="submit" size="lg" loading={loginOtp.isPending} className="w-full">
              {t('otpSubmit')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setOtp(null);
                setError(null);
              }}
            >
              <ArrowLeft />
              {t('back')}
            </Button>
          </form>
        )}
      </Card>
      {!otp && <DemoAccounts />}
    </div>
  );
}
