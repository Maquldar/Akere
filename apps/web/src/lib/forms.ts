/**
 * Prepares optional text fields for the API: trims, drops empties on create, and on edit sends ''
 * only to clear a value that was previously set (API.md inputs type these as `field?: string`).
 */
export function cleanOptional<T extends Record<string, unknown>>(values: T, original?: Partial<Record<keyof T, unknown>> | null): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(values) as [keyof T, unknown][]) {
    if (typeof v === 'string') {
      const trimmed = v.trim();
      if (trimmed) out[k] = trimmed as T[keyof T];
      else if (original && original[k]) out[k] = '' as T[keyof T];
    } else if (v !== undefined) {
      out[k] = v as T[keyof T];
    }
  }
  return out;
}
