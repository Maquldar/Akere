'use client';

import { FlaskConical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { roleTone } from '@/components/shell/roles';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toaster';
import { useDemoLogin, useDemoUsers } from '@/lib/api/hooks/auth';
import type { Role } from '@/lib/api/types';
import { authErrorMessage } from '@/lib/auth-errors';
import { primaryRole } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { useAfterLogin } from './use-after-login';

/** Demo accounts panel: rendered only when `GET /auth/demo-users` returns 200 (DEMO_MODE). */
export function DemoAccounts() {
  const t = useTranslations('auth.demo');
  const te = useTranslations('auth.errors');
  const tr = useTranslations('roles');
  const users = useDemoUsers();
  const demoLogin = useDemoLogin();
  const afterLogin = useAfterLogin();
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (users.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-hidden>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }
  // Hidden on 404 (demo mode off) and on any error: the panel is a convenience only.
  if (!users.data || users.data.length === 0) return null;

  const order: Role[] = ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'];
  const sorted = [...users.data].sort(
    (a, b) => order.indexOf(primaryRole(a.roles)) - order.indexOf(primaryRole(b.roles)),
  );

  const loginAs = (id: string) => {
    setPendingId(id);
    demoLogin.mutate(id, {
      onSuccess: (res) => afterLogin(res.me),
      onError: (e) => {
        toast.error(authErrorMessage(e, te));
        setPendingId(null);
      },
    });
  };

  return (
    <section aria-labelledby="demo-title" className="min-w-0 rounded-xl border border-dashed border-border-strong bg-surface-muted p-4">
      <div className="mb-3 flex items-start gap-2">
        <FlaskConical className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
        <div>
          <h2 id="demo-title" className="text-[13px] font-semibold text-fg">
            {t('title')}
          </h2>
          <p className="text-xs text-fg-subtle">{t('hint')}</p>
        </div>
      </div>
      <ul className="grid grid-cols-1 gap-2">
        {sorted.map((u) => {
          const role = primaryRole(u.roles);
          const busy = pendingId === u.id;
          return (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => loginAs(u.id)}
                disabled={demoLogin.isPending}
                aria-busy={busy || undefined}
                aria-label={t('loginAs', { name: u.fullName, role: tr(role) })}
                className={cn(
                  'focus-ring flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 text-left shadow-card transition-colors hover:border-border-strong hover:bg-surface-hover disabled:cursor-wait',
                  busy && 'border-primary',
                )}
              >
                <Avatar name={u.fullName} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-fg">{u.fullName}</span>
                  <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
                    <Badge tone={roleTone[role]} className="shrink-0 sm:hidden">
                      {tr(role)}
                    </Badge>
                    {u.position && <span className="truncate text-xs text-fg-subtle">{u.position}</span>}
                  </span>
                </span>
                <Badge tone={roleTone[role]} className="hidden shrink-0 sm:inline-flex">
                  {tr(role)}
                </Badge>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
