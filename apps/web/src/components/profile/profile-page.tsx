'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { PasswordInput, PasswordPolicyHint } from '@/components/auth/password-input';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { Switch } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { FormError, FormField } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/toaster';
import { useCurrentUser } from '@/components/shell/me-context';
import { roleTone } from '@/components/shell/roles';
import { usePathname, useRouter } from '@/i18n/navigation';
import { locales, localeNames, type AppLocale } from '@/i18n/routing';
import { applyServerErrors } from '@/lib/api/form-errors';
import { isApiError } from '@/lib/api/errors';
import { useChangePassword } from '@/lib/api/hooks/auth';
import { useUpdateMe } from '@/lib/api/hooks/me';
import { checkPassword, KZ_PHONE_RE, normalizePhone } from '@/lib/validation';

function ReadOnlyRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[180px_1fr] sm:gap-4">
      <dt className="text-[13px] text-fg-subtle">{label}</dt>
      <dd className="min-w-0 break-words text-sm font-medium text-fg">{value || '—'}</dd>
    </div>
  );
}

function PersonalCard() {
  const t = useTranslations('profile');
  const tr = useTranslations('roles');
  const tc = useTranslations('common');
  const { me } = useCurrentUser();
  const update = useUpdateMe();
  const schema = z.object({
    phone: z
      .string()
      .trim()
      .transform((v) => (v ? normalizePhone(v) : ''))
      .refine((v) => v === '' || KZ_PHONE_RE.test(v), t('phoneInvalid')),
  });
  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    values: { phone: me.phone ?? '' },
  });
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await update.mutateAsync({ phone: v.phone });
      toast.success(t('saved'));
    } catch (e) {
      if (!applyServerErrors(e, form.setError, { fields: ['phone'] })) toast.error(isApiError(e) ? e.message : tc('error'));
    }
  });
  const roles = Array.from(new Set(me.roles.map((r) => r.role)));

  return (
    <Card>
      <CardHeader title={t('personal')} />
      <form onSubmit={onSubmit} noValidate>
        <CardBody className="flex flex-col gap-5">
          <div className="flex items-center gap-4">
            <Avatar name={me.fullName} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-fg">{me.fullName}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {roles.map((r) => (
                  <Badge key={r} tone={roleTone[r]}>
                    {tr(r)}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
          <dl className="flex flex-col gap-3">
            <ReadOnlyRow label={t('lastName')} value={me.lastName} />
            <ReadOnlyRow label={t('firstName')} value={me.firstName} />
            <ReadOnlyRow label={t('middleName')} value={me.middleName} />
            <ReadOnlyRow label={t('email')} value={me.email} />
            {me.employee && (
              <>
                <ReadOnlyRow label={t('legalEntity')} value={me.employee.legalEntity} />
                <ReadOnlyRow label={t('department')} value={me.employee.department} />
                <ReadOnlyRow label={t('position')} value={me.employee.position} />
              </>
            )}
          </dl>
          <FormField label={t('phone')} error={form.formState.errors.phone?.message} hint={t('phoneHint')} className="sm:max-w-sm">
            <Input type="tel" autoComplete="tel" placeholder="+7 701 123 45 67" {...form.register('phone')} />
          </FormField>
        </CardBody>
        <CardFooter>
          <Button type="submit" loading={update.isPending} disabled={!form.formState.isDirty}>
            {tc('save')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function PreferencesCard() {
  const t = useTranslations('profile');
  const tc = useTranslations('common');
  const { me } = useCurrentUser();
  const update = useUpdateMe();
  const router = useRouter();
  const pathname = usePathname();

  const changeLocale = (l: string) => {
    const locale = l as AppLocale;
    update.mutate(
      { locale },
      {
        onSuccess: () => {
          toast.success(t('saved'));
          router.replace(pathname, { locale });
        },
        onError: (e) => toast.error(isApiError(e) ? e.message : tc('error')),
      },
    );
  };

  const toggle2fa = (enabled: boolean) => {
    update.mutate(
      { twoFactorEnabled: enabled },
      {
        onSuccess: () => toast.success(enabled ? t('twoFactorOn') : t('twoFactorOff')),
        onError: (e) => toast.error(isApiError(e) ? e.message : tc('error')),
      },
    );
  };

  return (
    <Card>
      <CardHeader title={t('preferences')} />
      <CardBody className="flex flex-col gap-5">
        <FormField label={t('language')} hint={t('languageHint')} className="sm:max-w-sm">
          <Select
            value={me.locale}
            onValueChange={changeLocale}
            disabled={update.isPending}
            options={locales.map((l) => ({ value: l, label: localeNames[l] }))}
          />
        </FormField>
        <div className="border-t border-border pt-5">
          <Switch
            label={t('twoFactor')}
            description={t('twoFactorHint')}
            checked={Boolean(me.twoFactorEnabled)}
            onCheckedChange={toggle2fa}
            disabled={update.isPending}
          />
        </div>
      </CardBody>
    </Card>
  );
}

function PasswordCard() {
  const t = useTranslations('profile.password');
  const te = useTranslations('auth.errors');
  const change = useChangePassword();
  const schema = z
    .object({
      currentPassword: z.string().min(1, t('currentRequired')),
      newPassword: z.string().refine((v) => checkPassword(v).ok, t('policyError')),
      confirm: z.string(),
    })
    .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: t('mismatch') })
    .refine((v) => v.newPassword !== v.currentPassword, { path: ['newPassword'], message: t('sameAsCurrent') });
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  });
  const pw = form.watch('newPassword');
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await change.mutateAsync({ currentPassword: v.currentPassword, newPassword: v.newPassword });
      toast.success(t('changed'));
      form.reset();
    } catch (e) {
      if (applyServerErrors(e, form.setError, { fields: ['currentPassword', 'newPassword'] })) return;
      if (isApiError(e) && (e.code === 'UNAUTHENTICATED' || e.code === 'FORBIDDEN' || e.code === 'BUSINESS_RULE')) {
        form.setError('currentPassword', { message: t('wrongCurrent') });
      } else {
        form.setError('root.server', { message: isApiError(e) && e.code === 'RATE_LIMITED' ? te('rateLimited') : te('generic') });
      }
    }
  });
  return (
    <Card>
      <CardHeader title={t('title')} />
      <form onSubmit={onSubmit} noValidate>
        <CardBody className="flex flex-col gap-4 sm:max-w-md">
          <FormError message={form.formState.errors.root?.server?.message} />
          <FormField label={t('current')} required error={form.formState.errors.currentPassword?.message}>
            <PasswordInput autoComplete="current-password" {...form.register('currentPassword')} />
          </FormField>
          <FormField label={t('new')} required error={form.formState.errors.newPassword?.message} hint={<PasswordPolicyHint value={pw} />}>
            <PasswordInput autoComplete="new-password" {...form.register('newPassword')} />
          </FormField>
          <FormField label={t('confirm')} required error={form.formState.errors.confirm?.message}>
            <PasswordInput autoComplete="new-password" {...form.register('confirm')} />
          </FormField>
          <p className="text-xs text-fg-subtle">{t('sessionsNote')}</p>
        </CardBody>
        <CardFooter>
          <Button type="submit" loading={change.isPending}>
            {t('submit')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export function ProfilePage() {
  const t = useTranslations('profile');
  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="flex flex-col gap-4">
        <PersonalCard />
        <PreferencesCard />
        <PasswordCard />
      </div>
    </div>
  );
}
