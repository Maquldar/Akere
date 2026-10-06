'use client';

import { ArrowRight, ClipboardList } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/components/shell/me-context';
import { Link } from '@/i18n/navigation';
import { useRequestTypes, useVacationBalance } from '@/lib/api/hooks/requests';
import { cn } from '@/lib/utils';
import { formatDays, typeIcon, useTypeName } from './shared';

const POPULAR = ['ANNUAL_LEAVE', 'BUSINESS_TRIP', 'UNPAID_LEAVE', 'CERTIFICATE'] as const;
type PopularCode = (typeof POPULAR)[number];

/** Home "Популярные сервисы" tiles (M3 1:03): one tap to start the most common requests. */
export function PopularServices({ className }: { className?: string }) {
  const t = useTranslations('requests.popular');
  const locale = useLocale();
  const typeName = useTypeName();
  const { me, can } = useCurrentUser();
  const allowed = can('request.create') && Boolean(me.employee);
  const types = useRequestTypes({ enabled: allowed });
  const balance = useVacationBalance(allowed ? me.employee?.id : null);

  if (!allowed || types.isError) return null;
  const tiles = (types.data ?? [])
    .filter((ty) => (POPULAR as readonly string[]).includes(ty.code))
    .sort((a, b) => POPULAR.indexOf(a.code as PopularCode) - POPULAR.indexOf(b.code as PopularCode));
  if (types.data && tiles.length === 0) return null;

  return (
    <Card className={cn('mx-auto w-full max-w-6xl', className)}>
      <CardHeader
        title={t('title')}
        actions={
          <Link href="/requests" className="focus-ring inline-flex items-center gap-1 rounded text-[13px] font-medium text-fg-muted hover:text-fg">
            {t('allRequests')} <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        }
      />
      <ul className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4 sm:gap-3 sm:p-4">
        {types.isLoading &&
          Array.from({ length: 4 }, (_, i) => (
            <li key={i}>
              <Skeleton className="h-[92px] rounded-xl" />
            </li>
          ))}
        {tiles.map((ty) => {
          const Icon = typeIcon(ty.code);
          const label = t(`tiles.${ty.code as PopularCode}`) || typeName(ty);
          return (
            <li key={ty.id}>
              <Link
                href={`/requests/new?type=${encodeURIComponent(ty.code)}`}
                className="focus-ring group flex h-full min-h-[92px] flex-col justify-between gap-3 rounded-xl border border-border bg-surface-muted p-3 transition-colors hover:border-primary/30 hover:bg-primary-soft"
              >
                <span className="flex size-9 items-center justify-center rounded-lg bg-surface text-primary shadow-card">
                  <Icon className="size-[18px]" aria-hidden />
                </span>
                <span className="flex flex-col">
                  <span className="text-[13px] font-semibold leading-snug text-fg">{label}</span>
                  {ty.usesVacationBalance && balance.data && (
                    <span className="mt-0.5 text-xs text-fg-muted tabular">
                      {t('balance', { days: formatDays(balance.data.available, locale) })}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {types.data && types.data.length > tiles.length && (
        <div className="border-t border-border px-4 py-2.5">
          <Link href="/requests" className="focus-ring inline-flex items-center gap-1.5 rounded text-[13px] font-medium text-primary hover:underline">
            <ClipboardList className="size-3.5" aria-hidden />
            {t('moreTypes', { count: types.data.length - tiles.length })}
          </Link>
        </div>
      )}
    </Card>
  );
}
