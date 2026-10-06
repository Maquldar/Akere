import { setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';

export default async function AppLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AppShell>{children}</AppShell>;
}
