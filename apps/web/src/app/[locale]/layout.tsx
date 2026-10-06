import '@fontsource-variable/inter';
import '@/styles/globals.css';
import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers/providers';
import { routing } from '@/i18n/routing';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: hasLocale(routing.locales, locale) ? locale : 'ru', namespace: 'meta' });
  return {
    title: { default: 'Akere HR', template: '%s · Akere HR' },
    description: t('description'),
    applicationName: 'Akere HR',
    appleWebApp: { capable: true, title: 'Akere HR', statusBarStyle: 'default' },
    icons: {
      icon: [{ url: '/icons/icon.svg', type: 'image/svg+xml' }, { url: '/icons/icon-192.png', sizes: '192x192' }],
      apple: '/icons/apple-touch-icon.png',
    },
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f5f5f4',
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
