import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Two-letter initials from a full name ("Сарсенова Айгуль" → "СА"). */
export function initials(name: string | null | undefined, max = 2): string {
  if (!name) return '?';
  const parts = name
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  return parts
    .slice(0, max)
    .map((p) => p[0]!.toLocaleUpperCase())
    .join('');
}

/** Builds a query string from a flat object, skipping undefined/null/''. Arrays repeat the key. */
export function toQueryString(query?: Record<string, unknown>): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const v of value) if (v !== undefined && v !== null && v !== '') params.append(key, String(v));
    } else {
      params.append(key, String(value));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export function formatBytes(bytes: number, locale = 'ru'): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: i === 0 ? 0 : 1 }).format(value);
  return `${n} ${units[i]}`;
}
