export const LOCALES = ['ru', 'kk', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const CONTACT_CHANNELS = ['EMAIL', 'SMS', 'WHATSAPP'] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];
export const GENDERS = ['MALE', 'FEMALE'] as const;
export const ERROR_CODES = [
  'VALIDATION_ERROR', 'UNAUTHENTICATED', 'FORBIDDEN', 'CSRF', 'NOT_FOUND', 'CONFLICT',
  'FILE_TOO_LARGE', 'UNSUPPORTED_FILE', 'BUSINESS_RULE', 'RATE_LIMITED', 'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
