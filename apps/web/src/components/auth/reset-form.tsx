'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { FormError, FormField } from '@/components/ui/label';
import { toast } from '@/components/ui/toaster';
import { Link, useRouter } from '@/i18n/navigation';
import { applyServerErrors } from '@/lib/api/form-errors';
import { useForgotPassword, useResetPassword } from '@/lib/api/hooks/auth';
import { authErrorMessage } from '@/lib/auth-errors';
import { checkPassword } from '@/lib/validation';
import { OtpInput } from './otp-input';
import { PasswordInput, PasswordPolicyHint } from './password-input';

export function ResetForm() {
  const t = useTranslations('auth.reset');
  const ta = useTranslations('auth');
  const te = useTranslations('auth.errors');
  const search = useSearchParams();
  const router = useRouter();
  const [step, setStep] = useState<'request' | 'confirm'>('request');
  const [login, setLogin] = useState(search.get('login') ?? '');
  const [error, setError] = useState<string | null>(null);
  const forgot = useForgotPassword();
  const reset = useResetPassword();

  const requestSchema = z.object({ login: z.string().trim().min(1, ta('loginRequired')) });
  const requestForm = useForm<z.infer<typeof requestSchema>>({
    resolver: zodResolver(requestSchema),
    defaultValues: { login },
  });

  const confirmSchema = z
    .object({
      code: z.string().regex(/^\d{6}$/, ta('otpLength')),
      newPassword: z.string().refine((v) => checkPassword(v).ok, t('policyError')),
      confirm: z.string(),
    })
    .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: t('mismatch') });
  const confirmForm = useForm<z.infer<typeof confirmSchema>>({
    resolver: zodResolver(confirmSchema),
    defaultValues: { code: '', newPassword: '', confirm: '' },
  });

  const onRequest = requestForm.handleSubmit(async (v) => {
    setError(null);
    try {
      await forgot.mutateAsync(v.login.trim());
      setLogin(v.login.trim());
      setStep('confirm');
    } catch (e) {
      setError(authErrorMessage(e, te));
    }
  });

  const onConfirm = confirmForm.handleSubmit(async (v) => {
    setError(null);
    try {
      await reset.mutateAsync({ login, code: v.code, newPassword: v.newPassword });
      toast.success(t('success'));
      router.replace('/login');
    } catch (e) {
      if (!applyServerErrors(e, confirmForm.setError, { fields: ['code', 'newPassword'] })) setError(authErrorMessage(e, te));
    }
  });

  const pw = confirmForm.watch('newPassword');
  const code = confirmForm.watch('code');

  return (
    <Card className="w-full max-w-[400px] p-6 sm:p-7">
      {step === 'request' ? (
        <form onSubmit={onRequest} noValidate className="flex flex-col gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-[-0.01em] text-fg">{t('title')}</h1>
            <p className="mt-1 text-[13px] text-fg-muted">{t('requestHint')}</p>
          </div>
          <FormError message={error} />
          <FormField label={ta('login')} required error={requestForm.formState.errors.login?.message}>
            <Input autoComplete="username" autoFocus {...requestForm.register('login')} />
          </FormField>
          <Button type="submit" size="lg" loading={forgot.isPending} className="w-full">
            {t('sendCode')}
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/login">
              <ArrowLeft />
              {t('backToLogin')}
            </Link>
          </Button>
        </form>
      ) : (
        <form onSubmit={onConfirm} noValidate className="flex flex-col gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-[-0.01em] text-fg">{t('confirmTitle')}</h1>
            <p className="mt-1 text-[13px] text-fg-muted">{t('codeSent', { login })}</p>
          </div>
          <FormError message={error ?? confirmForm.formState.errors.root?.server?.message} />
          <FormField label={ta('otpCode')} required error={confirmForm.formState.errors.code?.message}>
            <OtpInput value={code} onChange={(v) => confirmForm.setValue('code', v, { shouldValidate: confirmForm.formState.isSubmitted })} autoFocus />
          </FormField>
          <FormField
            label={t('newPassword')}
            required
            error={confirmForm.formState.errors.newPassword?.message}
            hint={<PasswordPolicyHint value={pw} />}
          >
            <PasswordInput autoComplete="new-password" {...confirmForm.register('newPassword')} />
          </FormField>
          <FormField label={t('confirmPassword')} required error={confirmForm.formState.errors.confirm?.message}>
            <PasswordInput autoComplete="new-password" {...confirmForm.register('confirm')} />
          </FormField>
          <Button type="submit" size="lg" loading={reset.isPending} className="w-full">
            <KeyRound />
            {t('submit')}
          </Button>
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={() => setStep('request')}>
              <ArrowLeft />
              {ta('back')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => forgot.mutate(login, { onSuccess: () => toast.success(t('resent')) })} loading={forgot.isPending}>
              {t('resend')}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
