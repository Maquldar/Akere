import { setRequestLocale } from 'next-intl/server';
import { Suspense, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Logo } from '@/components/shell/logo';
import { LocaleSwitcher } from '@/components/shell/locale-switcher';

function Footer() {
  const t = useTranslations('auth');
  return <p className="text-center text-xs text-fg-subtle">{t('footer', { year: new Date().getFullYear() })}</p>;
}

export default async function AuthLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="flex h-16 items-center justify-between px-4 sm:px-6">
        <Logo />
        <Suspense>
          <LocaleSwitcher variant="compact" />
        </Suspense>
      </header>
      <main id="main" className="flex flex-1 flex-col items-center px-4 pb-10 pt-4 sm:pt-12">
        {children}
      </main>
      <footer className="pb-safe px-4 py-4">
        <Footer />
      </footer>
    </div>
  );
}
