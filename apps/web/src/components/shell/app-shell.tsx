'use client';

import { Menu, PanelLeft } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Breadcrumbs, type Crumb } from '@/components/ui/page-header';
import { Tooltip } from '@/components/ui/popover';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { usePathname } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import { useLogout, useMe } from '@/lib/api/hooks/auth';
import { useUpdateMe } from '@/lib/api/hooks/me';
import { isApiError } from '@/lib/api/errors';
import { useLocalStorage } from '@/lib/hooks/use-local-storage';
import { cn } from '@/lib/utils';
import { LogoMark } from './logo';
import { MeProvider } from './me-context';
import { resolveRoute } from './nav';
import { NotificationBell } from './notification-bell';
import { SidebarContent } from './sidebar';

function useHeaderCrumbs(): Crumb[] {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const match = resolveRoute(pathname);
  if (!match) return [];
  const crumbs: Crumb[] = [];
  if (match.section) crumbs.push({ label: t(`sections.${match.section}`) });
  crumbs.push({ label: t(`items.${match.item.key}`), href: match.item.href });
  return crumbs;
}

function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh bg-canvas" aria-busy>
      <div className="hidden w-[248px] flex-col gap-3 p-4 lg:flex">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="mt-4 h-8 w-full" />
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-6 w-4/5" />
        ))}
      </div>
      <div className="flex-1 p-2">
        <div className="h-full min-h-[calc(100dvh-16px)] rounded-xl border border-border bg-surface p-8">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="mt-3 h-4 w-40" />
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations('shell');
  const locale = useLocale();
  const pathname = usePathname();
  const meQuery = useMe();
  const logout = useLogout();
  const updateMe = useUpdateMe();
  const [collapsed, setCollapsed] = useLocalStorage('akere.sidebar.collapsed', false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const crumbs = useHeaderCrumbs();

  useEffect(() => setMobileOpen(false), [pathname]);

  if (meQuery.isPending) return <ShellSkeleton />;
  if (meQuery.isError) {
    // 401 → apiFetch already redirects to login; keep the skeleton meanwhile.
    if (isApiError(meQuery.error) && meQuery.error.status === 401) return <ShellSkeleton />;
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas p-4">
        <div className="w-full max-w-md rounded-xl border border-border bg-surface">
          <ErrorState error={meQuery.error} onRetry={() => meQuery.refetch()} />
        </div>
      </div>
    );
  }

  const me = meQuery.data;
  const handleLogout = () => {
    logout.mutate(undefined, {
      onSettled: () => window.location.assign(`/${locale}/login`),
    });
  };
  const handleLocale = (l: AppLocale) => {
    if (l !== me.locale) updateMe.mutate({ locale: l });
  };

  const sidebarProps = { onLogout: handleLogout, onLocaleChange: handleLocale };

  return (
    <MeProvider me={me}>
      <a
        href="#main"
        className="focus-ring sr-only z-[70] rounded-md bg-surface px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        {t('skipToContent')}
      </a>
      <div className="flex min-h-dvh bg-canvas">
        <aside
          className={cn(
            'sticky top-0 hidden h-dvh shrink-0 transition-[width] duration-200 lg:block',
            collapsed ? 'w-[60px]' : 'w-[248px]',
          )}
        >
          <SidebarContent collapsed={collapsed} {...sidebarProps} />
        </aside>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen} side="left" title={t('menu')} hideHeader className="w-[min(86vw,300px)] bg-canvas">
          <SidebarContent onNavigate={() => setMobileOpen(false)} {...sidebarProps} />
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col lg:py-2 lg:pr-2">
          <div className="flex min-h-dvh min-w-0 flex-1 flex-col bg-surface lg:min-h-[calc(100dvh-16px)] lg:rounded-xl lg:border lg:border-border lg:shadow-card">
            <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface/95 px-2 backdrop-blur sm:px-4 lg:rounded-t-xl">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                onClick={() => setMobileOpen(true)}
                aria-label={t('openMenu')}
                aria-expanded={mobileOpen}
              >
                <Menu />
              </Button>
              <span className="lg:hidden">
                <LogoMark className="size-6" />
              </span>
              <Tooltip content={collapsed ? t('expandSidebar') : t('collapseSidebar')} side="bottom">
                <Button
                  variant="ghost"
                  size="icon"
                  className="hidden lg:inline-flex"
                  onClick={() => setCollapsed((c) => !c)}
                  aria-label={collapsed ? t('expandSidebar') : t('collapseSidebar')}
                  aria-pressed={collapsed}
                >
                  <PanelLeft />
                </Button>
              </Tooltip>
              <Breadcrumbs items={crumbs} className="ml-1 flex-1" />
              <NotificationBell />
            </header>
            <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-5 focus:outline-none sm:px-6 sm:py-6 lg:px-8 lg:py-7">
              {children}
            </main>
          </div>
        </div>
      </div>
    </MeProvider>
  );
}
