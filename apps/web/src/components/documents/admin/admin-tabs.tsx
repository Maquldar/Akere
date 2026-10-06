'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

const items = [
  { key: 'types', href: '/admin/document-types' },
  { key: 'templates', href: '/admin/document-templates' },
  { key: 'routes', href: '/admin/routes' },
] as const;

/** Links between the document configuration pages. */
export function AdminTabs({ active }: { active: (typeof items)[number]['key'] }) {
  const t = useTranslations('docAdmin.tabs');
  return (
    <nav aria-label={t('label')} className="-mx-1 mb-4 max-w-full overflow-x-auto px-1 py-0.5">
      <ul className="inline-flex items-center gap-0.5 rounded-lg bg-surface-hover p-1">
        {items.map((i) => (
          <li key={i.key}>
            <Link
              href={i.href}
              aria-current={i.key === active ? 'page' : undefined}
              className={cn(
                'focus-ring inline-flex h-7 items-center whitespace-nowrap rounded-md px-3 text-[13px] font-medium text-fg-muted transition-colors hover:text-fg',
                i.key === active && 'bg-surface text-fg shadow-[0_1px_2px_rgb(16_24_40/0.08)]',
              )}
            >
              {t(i.key)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
