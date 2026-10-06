import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { NavItemKey } from '@/components/shell/nav';
import { isAppLocale } from '@/i18n/routing';

/** `<title>` for app pages from the nav labels. */
export async function navPageMetadata(params: Promise<{ locale: string }>, key: NavItemKey): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: isAppLocale(locale) ? locale : 'ru', namespace: 'nav.items' });
  return { title: t(key) };
}
