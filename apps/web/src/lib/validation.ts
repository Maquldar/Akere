/** Client-side mirrors of server rules (API.md). The server stays authoritative. */

/** Password policy (API.md §1): ≥ 10 chars, at least one letter and one digit. */
export function checkPassword(pw: string): { length: boolean; letter: boolean; digit: boolean; ok: boolean } {
  const length = pw.length >= 10;
  const letter = /\p{L}/u.test(pw);
  const digit = /\p{Nd}/u.test(pw);
  return { length, letter, digit, ok: length && letter && digit };
}

/** БИН/ИИН: exactly 12 digits. */
export const BIN_RE = /^\d{12}$/;

/** Kazakhstan phone in E.164 (+7XXXXXXXXXX). */
export const KZ_PHONE_RE = /^\+7\d{10}$/;

/** Normalizes user-typed phones ("8 (701) 123-45-67" → "+77011234567"). Returns input if unsure. */
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 11 && (digits.startsWith('8') || digits.startsWith('7'))) return `+7${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith('7')) return `+7${digits}`;
  return input.trim();
}

/** Safe in-app redirect target: a relative path, never protocol-relative or absolute. */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  if (/^\/(login|reset)(\/|\?|$)/.test(next)) return null;
  return next;
}
