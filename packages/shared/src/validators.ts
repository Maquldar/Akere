import { z } from 'zod';

/** Kazakhstan ИИН/БИН: 12 digits with the official two-pass mod-11 checksum. */
export function isValidIinBin(value: string): boolean {
  if (!/^\d{12}$/.test(value)) return false;
  const d = value.split('').map(Number);
  const w1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const w2 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2];
  let sum = w1.reduce((s, w, i) => s + w * d[i]!, 0) % 11;
  if (sum === 10) {
    sum = w2.reduce((s, w, i) => s + w * d[i]!, 0) % 11;
    if (sum === 10) return false;
  }
  return sum === d[11];
}

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');
export const iin = z.string().refine(isValidIinBin, 'Invalid ИИН');
export const bin = z.string().refine(isValidIinBin, 'Invalid БИН');
/** E.164 Kazakhstan-style phone: +7 followed by 10 digits. Other countries allowed with + and 8–15 digits. */
export const phone = z
  .string()
  .transform((s) => s.replace(/[\s()-]/g, ''))
  .refine((s) => /^\+\d{8,15}$/.test(s), 'Invalid phone, use +7XXXXXXXXXX');
export const email = z.string().trim().toLowerCase().pipe(z.email());
export const password = z
  .string()
  .min(10, 'At least 10 characters')
  .max(200)
  .refine((s) => /[A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі]/.test(s) && /\d/.test(s), 'Must contain letters and digits');
export const id = z.string().min(1).max(64);
export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export const boolQuery = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');
