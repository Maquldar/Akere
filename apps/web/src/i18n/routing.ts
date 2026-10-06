import { defineRouting } from 'next-intl/routing';

export const locales = ['ru', 'kk', 'en'] as const;
export type AppLocale = (typeof locales)[number];

export const routing = defineRouting({
  locales,
  defaultLocale: 'ru',
  localePrefix: 'always',
});

export const localeNames: Record<AppLocale, string> = {
  ru: 'Русский',
  kk: 'Қазақша',
  en: 'English',
};

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}
