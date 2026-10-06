import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { SignPage } from '@/components/documents/sign-page';
import { isAppLocale } from '@/i18n/routing';

export const metadata: Metadata = { title: 'eGov mobile (sandbox)', robots: { index: false } };

/** eGov mobile sandbox page opened from the signing QR (requires the same staff session). */
export default async function Page({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  setRequestLocale(isAppLocale(locale) ? locale : 'ru');
  return <SignPage token={token} />;
}
