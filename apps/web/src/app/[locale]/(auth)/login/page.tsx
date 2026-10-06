import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { LoginForm } from '@/components/auth/login-form';
import { isAppLocale } from '@/i18n/routing';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: isAppLocale(locale) ? locale : 'ru', namespace: 'auth' });
  return { title: t('title') };
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
