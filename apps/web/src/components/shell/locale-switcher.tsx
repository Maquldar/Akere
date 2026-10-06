'use client';

import { Check, Languages } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip } from '@/components/ui/popover';
import { usePathname, useRouter } from '@/i18n/navigation';
import { locales, localeNames, type AppLocale } from '@/i18n/routing';
import { cn } from '@/lib/utils';

/**
 * Language switcher. `onPersist` is called after switching (the app shell saves the choice
 * via `PATCH /me`).
 */
export function LocaleSwitcher({
  variant = 'sidebar',
  collapsed,
  onPersist,
}: {
  variant?: 'sidebar' | 'compact';
  collapsed?: boolean;
  onPersist?: (locale: AppLocale) => void;
}) {
  const t = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const change = (next: AppLocale) => {
    if (next === locale) return;
    const qs = search.toString();
    startTransition(() => {
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { locale: next });
    });
    onPersist?.(next);
  };

  const trigger =
    variant === 'compact' ? (
      <Button variant="ghost" size="sm" aria-label={t('language')} disabled={pending}>
        <Languages />
        {localeNames[locale]}
      </Button>
    ) : (
      <button
        type="button"
        aria-label={t('language')}
        disabled={pending}
        className={cn(
          'focus-ring flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-sm text-fg-muted hover:bg-surface-active/60 hover:text-fg',
          collapsed && 'justify-center px-0',
        )}
      >
        <Languages className="size-4 shrink-0" aria-hidden />
        {!collapsed && <span className="truncate">{localeNames[locale]}</span>}
      </button>
    );

  return (
    <DropdownMenu>
      <Tooltip content={t('language')} side="right" disabled={!collapsed}>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align={variant === 'compact' ? 'end' : 'start'} side={variant === 'compact' ? 'bottom' : 'top'} className="min-w-[160px]">
        {locales.map((l) => (
          <DropdownMenuItem key={l} onSelect={() => change(l)} lang={l}>
            <span className="flex-1">{localeNames[l]}</span>
            {l === locale && <Check className="!text-primary" aria-hidden />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
