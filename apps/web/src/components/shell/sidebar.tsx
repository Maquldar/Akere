'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronsUpDown, LogOut, Plus, UserCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { CountBadge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip } from '@/components/ui/popover';
import { Link, usePathname } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import { apiFetch } from '@/lib/api/client';
import { useInboxCounts } from '@/lib/api/hooks/me';
import { primaryRole } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { LocaleSwitcher } from './locale-switcher';
import { Logo } from './logo';
import { useCurrentUser } from './me-context';
import {
  bottomItems, hasBadge, isActive, isItemShown, newDocumentAction, visibleSections, type BadgeSource, type NavItem,
} from './nav';

type Counts = Partial<Record<BadgeSource, number>>;

function NavLink({
  item,
  pathname,
  collapsed,
  count,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  collapsed?: boolean;
  count?: number;
  onNavigate?: () => void;
}) {
  const t = useTranslations('nav.items');
  const active = isActive(item, pathname);
  const Icon = item.icon;
  const label = t(item.key);
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'focus-ring group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors',
        active ? 'bg-surface-active font-medium text-fg' : 'text-fg-muted hover:bg-surface-active/60 hover:text-fg',
        collapsed && 'justify-center px-0',
      )}
    >
      <Icon className={cn('size-4 shrink-0', active ? 'text-fg' : 'text-fg-subtle group-hover:text-fg')} aria-hidden />
      {collapsed ? (
        <span className="sr-only">{label}</span>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {count ? <CountBadge value={count} tone={item.badge === 'esutd' ? 'red' : 'gray'} /> : null}
        </>
      )}
      {collapsed && count ? <span className="absolute ml-5 -mt-4 size-2 rounded-full bg-red-solid" aria-hidden /> : null}
    </Link>
  );
  return (
    <li className="relative">
      {collapsed ? (
        <Tooltip content={label} side="right">
          {link}
        </Tooltip>
      ) : (
        link
      )}
    </li>
  );
}

export function SidebarContent({
  collapsed = false,
  onNavigate,
  onLogout,
  onLocaleChange,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
  onLogout: () => void;
  onLocaleChange: (locale: AppLocale) => void;
}) {
  const t = useTranslations('nav');
  const tr = useTranslations('roles');
  const pathname = usePathname();
  const { me, access } = useCurrentUser();
  const sections = useMemo(() => visibleSections(access), [access]);
  const bottom = bottomItems.filter((i) => isItemShown(i, access));

  const inbox = useInboxCounts({ enabled: hasBadge(sections, 'inbox') });
  const esutd = useQuery({
    queryKey: ['esutd', 'count'],
    queryFn: ({ signal }) => apiFetch<{ notSent: number; errors: number }>('/esutd/count', { signal }),
    enabled: hasBadge(sections, 'esutd'),
    refetchInterval: 120_000,
  });
  const counts: Counts = {
    'inbox.documents': inbox.data?.documents,
    'inbox.requests': inbox.data?.requests,
    'inbox.vnd': inbox.data?.vnd,
    'inbox.timeRequests': inbox.data?.timeRequests,
    esutd: esutd.data ? esutd.data.notSent + esutd.data.errors : undefined,
  };

  const role = primaryRole(me.roles.map((r) => r.role));
  const showNewDoc = isItemShown(newDocumentAction, access);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn('flex h-14 shrink-0 items-center px-4', collapsed && 'justify-center px-0')}>
        <Link href="/" onClick={onNavigate} className="focus-ring rounded-md" aria-label={t('home')}>
          <Logo collapsed={collapsed} />
        </Link>
      </div>

      <nav aria-label={t('main')} className={cn('min-h-0 flex-1 overflow-y-auto pb-3', collapsed ? 'px-2' : 'px-3')}>
        {showNewDoc && (
          <Link
            href={newDocumentAction.href}
            onClick={onNavigate}
            className={cn(
              'focus-ring mb-3 flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-sm font-medium text-fg shadow-card hover:bg-surface-hover',
              collapsed && 'justify-center px-0',
            )}
          >
            <Plus className="size-4" aria-hidden />
            {collapsed ? <span className="sr-only">{t('items.newDocument')}</span> : t('items.newDocument')}
          </Link>
        )}
        {sections.map((section, idx) => (
          <div key={section.key ?? `s${idx}`} className={cn(idx > 0 && 'mt-4')}>
            {section.key &&
              (collapsed ? (
                <div className="mx-2 mb-2 h-px bg-border" role="separator" />
              ) : (
                <h2 className="section-label mb-1 px-2.5">{t(`sections.${section.key}`)}</h2>
              ))}
            <ul className="flex flex-col gap-0.5">
              {section.items.map((item) => (
                <NavLink
                  key={item.key}
                  item={item}
                  pathname={pathname}
                  collapsed={collapsed}
                  count={item.badge ? counts[item.badge] : undefined}
                  onNavigate={onNavigate}
                />
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className={cn('pb-safe shrink-0 border-t border-border/70 pt-2', collapsed ? 'px-2' : 'px-3')}>
        <ul className="flex flex-col gap-0.5">
          {bottom.map((item) => (
            <NavLink key={item.key} item={item} pathname={pathname} collapsed={collapsed} onNavigate={onNavigate} />
          ))}
          <li>
            <LocaleSwitcher collapsed={collapsed} onPersist={onLocaleChange} />
          </li>
        </ul>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'focus-ring my-2 flex w-full items-center gap-2.5 rounded-md p-1.5 text-left hover:bg-surface-active/60',
                collapsed && 'justify-center',
              )}
              aria-label={t('userMenu')}
            >
              <Avatar name={me.fullName} size="sm" />
              {!collapsed && (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-fg">{me.fullName}</span>
                    <span className="block truncate text-xs text-fg-subtle">{tr(role)}</span>
                  </span>
                  <ChevronsUpDown className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                </>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-[232px]">
            <DropdownMenuLabel className="normal-case tracking-normal">
              <span className="block truncate text-[13px] font-medium text-fg">{me.fullName}</span>
              <span className="block truncate text-xs font-normal text-fg-subtle">{me.email}</span>
              <span className="mt-0.5 block truncate text-xs font-normal text-fg-subtle">{me.tenant.name}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/profile" onClick={onNavigate}>
                <UserCircle aria-hidden />
                {t('items.profile')}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onLogout} danger>
              <LogOut aria-hidden />
              {t('logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
