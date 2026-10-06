import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

export type Crumb = { label: ReactNode; href?: string };

export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  const t = useTranslations('common');
  if (items.length === 0) return null;
  return (
    <nav aria-label={t('breadcrumbs')} className={cn('min-w-0', className)}>
      <ol className="flex min-w-0 items-center gap-1 text-[13px] text-fg-subtle">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className={cn('flex min-w-0 items-center gap-1', !last && 'hidden sm:flex')}>
              {c.href && !last ? (
                <Link href={c.href} className="focus-ring truncate rounded hover:text-fg">
                  {c.label}
                </Link>
              ) : (
                <span className={cn('truncate', last && 'font-medium text-fg')} aria-current={last ? 'page' : undefined}>
                  {c.label}
                </span>
              )}
              {!last && <ChevronRight className="size-3.5 shrink-0" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Page title block: optional breadcrumbs, title, subtitle, and right-aligned actions. */
export function PageHeader({
  title,
  subtitle,
  breadcrumbs,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {breadcrumbs && <Breadcrumbs items={breadcrumbs} className="mb-1.5" />}
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.01em] text-fg sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
