import { setRequestLocale } from 'next-intl/server';
import { isAppLocale } from '@/i18n/routing';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';

export default async function AppLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(isAppLocale(locale) ? locale : 'ru');
  return <AppShell>{children}</AppShell>;
}
