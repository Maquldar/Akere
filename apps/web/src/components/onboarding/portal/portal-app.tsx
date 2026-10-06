'use client';

import { LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { LocaleSwitcher } from '@/components/shell/locale-switcher';
import { Logo } from '@/components/shell/logo';
import { isApiError } from '@/lib/api/errors';
import { usePortalLogout, usePortalMe } from '@/lib/api/hooks/onboarding';
import { PortalCabinet } from './portal-cabinet';
import { PortalLogin } from './portal-login';

function PortalHeader({ right }: { right?: ReactNode }) {
  const t = useTranslations('onboarding.portal');
  return (
    <header style={{ paddingTop: 'env(safe-area-inset-top)' }} className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between gap-2 px-4">
        <span className="flex min-w-0 items-center gap-2">
          <Logo />
          <span className="hidden truncate rounded-md bg-surface-hover px-2 py-0.5 text-xs font-medium text-fg-muted min-[400px]:inline">{t('badge')}</span>
        </span>
        <div className="flex items-center gap-1">
          <LocaleSwitcher variant="compact" />
          {right}
        </div>
      </div>
    </header>
  );
}

/** Candidate portal root: session check → OTP login or cabinet. */
export function PortalApp() {
  const t = useTranslations('onboarding.portal');
  const tc = useTranslations('common');
  const me = usePortalMe();
  const logout = usePortalLogout();

  const unauth = me.isError && isApiError(me.error) && (me.error.status === 401 || me.error.status === 403);
  const loggedIn = Boolean(me.data);

  return (
    <>
      <PortalHeader
        right={
          loggedIn ? (
            <Button
              variant="ghost"
              size="sm"
              loading={logout.isPending}
              onClick={() =>
                logout.mutate(undefined, {
                  onSuccess: () => toast.success(t('loggedOut')),
                  onError: () => toast.error(tc('error')),
                })
              }
            >
              {!logout.isPending && <LogOut />}
              <span className="hidden min-[400px]:inline">{t('logout')}</span>
              <span className="sr-only min-[400px]:hidden">{t('logout')}</span>
            </Button>
          ) : null
        }
      />
      <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pb-6 pt-5 sm:pt-8">
        {me.isLoading ? (
          <div className="grid gap-3" aria-busy>
            <Skeleton className="mx-auto h-7 w-3/4" />
            <Skeleton className="mx-auto h-4 w-2/3" />
            <Skeleton className="mt-4 h-40 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : loggedIn ? (
          <PortalCabinet me={me.data!} />
        ) : unauth || me.data === null ? (
          <PortalLogin />
        ) : (
          <ErrorState error={me.error} onRetry={() => me.refetch()} />
        )}
      </main>
    </>
  );
}
