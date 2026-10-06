import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { isAppLocale } from '@/i18n/routing';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: isAppLocale(locale) ? locale : 'ru', namespace: 'onboarding.portal' });
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/** Candidate portal: standalone mobile-first layout (no staff shell). */
export default async function PortalLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(isAppLocale(locale) ? locale : 'ru');
  return <div className="flex min-h-dvh flex-col bg-canvas">{children}</div>;
}
