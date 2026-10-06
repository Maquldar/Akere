import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { ResetForm } from '@/components/auth/reset-form';
import { isAppLocale } from '@/i18n/routing';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: isAppLocale(locale) ? locale : 'ru', namespace: 'auth.reset' });
  return { title: t('title') };
}

export default function ResetPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
