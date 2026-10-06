'use client';

import { ArrowRight, Bell, Building2, UserCircle, Users, UsersRound } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { SkeletonList } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { useCurrentUser } from '@/components/shell/me-context';
import { isItemShown, navSections } from '@/components/shell/nav';
import { NotificationItem, useOpenNotification } from '@/components/shell/notification-bell';
import { roleTone } from '@/components/shell/roles';
import { Link } from '@/i18n/navigation';
import { useNotifications } from '@/lib/api/hooks/notifications';
import { useSeats } from '@/lib/api/hooks/org';
import { dayPart, formatLongDate } from '@/lib/format';

function Greeting() {
  const t = useTranslations('home');
  const locale = useLocale();
  const { me } = useCurrentUser();
  // Client-only clock (avoids SSR/CSR time mismatch).
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);
  const part = now ? dayPart(now) : 'day';
  return (
    <div className="mb-6 sm:mb-8">
      <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.015em] text-fg sm:text-[28px]">
        {t(`greeting.${part}`, { name: me.firstName })}
      </h1>
      <p className="mt-1 min-h-5 text-sm text-fg-muted">{now ? formatLongDate(now, locale) : ''}</p>
    </div>
  );
}

function QuickLinks() {
  const t = useTranslations('home');
  const tn = useTranslations('nav.items');
  const { access } = useCurrentUser();
  const items = navSections.flatMap((s) => s.items).filter((i) => i.key !== 'home' && isItemShown(i, access));
  return (
    <Card>
      <CardHeader title={t('quickLinks')} />
      <CardBody className="p-2 sm:p-2">
        {items.length === 0 ? (
          <EmptyState compact title={t('noLinks')} description={t('noLinksHint')} />
        ) : (
          <ul className="grid gap-1 sm:grid-cols-2">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    className="focus-ring group flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-hover"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-muted text-fg-muted">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{tn(item.key)}</span>
                    <ArrowRight className="size-4 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function RecentNotifications() {
  const t = useTranslations('home');
  const tn = useTranslations('notifications');
  const q = useNotifications({ pageSize: 5 });
  const open = useOpenNotification();
  return (
    <Card>
      <CardHeader
        title={t('recentNotifications')}
        count={q.data ? q.data.items.filter((n) => !n.readAt).length || undefined : undefined}
        actions={
          <Link href="/notifications" className="focus-ring inline-flex items-center gap-1 rounded text-[13px] font-medium text-fg-muted hover:text-fg">
            {t('all')} <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        }
      />
      <div className="p-1.5">
        {q.isLoading && <SkeletonList rows={3} className="p-3" />}
        {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} compact />}
        {q.data && q.data.items.length === 0 && (
          <EmptyState compact icon={<Bell aria-hidden />} title={tn('empty')} description={tn('emptyHint')} />
        )}
        {q.data?.items.map((n) => <NotificationItem key={n.id} n={n} onOpen={open} dense />)}
      </div>
    </Card>
  );
}

function ProfileCard() {
  const t = useTranslations('home');
  const tr = useTranslations('roles');
  const { me } = useCurrentUser();
  const roles = Array.from(new Set(me.roles.map((r) => r.role)));
  const rows: [string, string | null | undefined][] = [
    [t('company'), me.tenant.name],
    [t('legalEntity'), me.employee?.legalEntity],
    [t('department'), me.employee?.department],
    [t('position'), me.employee?.position],
  ];
  return (
    <Card>
      <CardHeader
        title={t('aboutMe')}
        actions={
          <Link href="/profile" className="focus-ring inline-flex items-center gap-1 rounded text-[13px] font-medium text-fg-muted hover:text-fg">
            <UserCircle className="size-3.5" aria-hidden /> {t('profile')}
          </Link>
        }
      />
      <CardBody>
        <dl className="grid gap-3 text-[13px]">
          {rows
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="grid grid-cols-[120px_1fr] gap-3">
                <dt className="text-fg-subtle">{k}</dt>
                <dd className="min-w-0 break-words font-medium text-fg">{v}</dd>
              </div>
            ))}
          <div className="grid grid-cols-[120px_1fr] gap-3">
            <dt className="text-fg-subtle">{t('roles')}</dt>
            <dd className="flex flex-wrap gap-1">
              {roles.map((r) => (
                <Badge key={r} tone={roleTone[r]}>
                  {tr(r)}
                </Badge>
              ))}
            </dd>
          </div>
        </dl>
      </CardBody>
    </Card>
  );
}

function AdminStats() {
  const t = useTranslations('home.seats');
  const seats = useSeats();
  if (seats.isError) return null;
  const v = seats.data;
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-3">
      <StatCard label={t('employees')} value={v ? v.activeEmployees : '—'} icon={<Users aria-hidden />} />
      <StatCard label={t('hrUsers')} value={v ? v.hrUsers : '—'} icon={<UsersRound aria-hidden />} />
      <StatCard label={t('legalEntities')} value={v ? v.legalEntities : '—'} icon={<Building2 aria-hidden />} />
    </div>
  );
}

export function HomeDashboard() {
  const { can } = useCurrentUser();
  return (
    <div className="mx-auto w-full max-w-6xl">
      <Greeting />
      {can('users.manage') && <AdminStats />}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <QuickLinks />
          <RecentNotifications />
        </div>
        <ProfileCard />
      </div>
    </div>
  );
}
