import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { isApiError } from './errors';

/**
 * Maps `VALIDATION_ERROR.details.fieldErrors` onto react-hook-form fields.
 * Server keys use dot paths (`roles.0.legalEntityId`), the same as RHF.
 * `formErrors` (and field errors for unknown fields) go to `root.server`.
 * Returns true when at least one error was applied.
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  options: { fields?: readonly string[]; map?: Record<string, Path<T>> } = {},
): boolean {
  if (!isApiError(error) || error.code !== 'VALIDATION_ERROR') return false;
  let applied = false;
  const rootMessages: string[] = [...error.formErrors];
  for (const [key, messages] of Object.entries(error.fieldErrors)) {
    const message = messages?.[0];
    if (!message) continue;
    const target = options.map?.[key] ?? key;
    if (options.fields && !options.fields.includes(target.split('.')[0]!)) {
      rootMessages.push(message);
      continue;
    }
    setError(target as Path<T>, { type: 'server', message }, { shouldFocus: !applied });
    applied = true;
  }
  if (rootMessages.length) {
    setError('root.server' as Path<T>, { type: 'server', message: rootMessages.join(' ') });
    applied = true;
  }
  return applied;
}
