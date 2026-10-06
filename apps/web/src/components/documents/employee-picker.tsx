'use client';

import { forwardRef, useCallback } from 'react';
import { Combobox, MultiSelect, type ComboOption } from '@/components/ui/combobox';
import { searchEmployees } from '@/lib/api/hooks/documents';

type Common = {
  /** Value is the employee id (default) or the user account id. */
  valueKind?: 'employee' | 'user';
  legalEntityId?: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  size?: 'sm' | 'md';
  excludeIds?: string[];
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  'aria-required'?: boolean;
};

function useLoader(valueKind: 'employee' | 'user', legalEntityId?: string, excludeIds?: string[]) {
  const exclude = excludeIds?.join(',') ?? '';
  return useCallback(
    async (q: string, signal: AbortSignal): Promise<ComboOption[]> => {
      const rows = await searchEmployees(q, signal, legalEntityId);
      const skip = new Set(exclude ? exclude.split(',') : []);
      return rows
        .map((r) => ({
          value: valueKind === 'user' ? r.userId : r.id,
          label: r.fullName,
          description: [r.position, r.department].filter(Boolean).join(' · ') || undefined,
        }))
        .filter((o) => !skip.has(o.value));
    },
    [valueKind, legalEntityId, exclude],
  );
}

/** Async employee picker backed by `/employees/options`. */
export const EmployeePicker = forwardRef<
  HTMLButtonElement,
  Common & { value: string | null | undefined; onChange: (value: string | null, option: ComboOption | null) => void; selectedOption?: ComboOption | null }
>(function EmployeePicker({ valueKind = 'employee', legalEntityId, excludeIds, ...props }, ref) {
  const load = useLoader(valueKind, legalEntityId, excludeIds);
  return <Combobox ref={ref} loadOptions={load} {...props} />;
});

export const EmployeeMultiPicker = forwardRef<
  HTMLDivElement,
  Common & { value: string[]; onChange: (values: string[], options: ComboOption[]) => void; selectedOptions?: ComboOption[] }
>(function EmployeeMultiPicker({ valueKind = 'employee', legalEntityId, excludeIds, ...props }, ref) {
  const load = useLoader(valueKind, legalEntityId, excludeIds);
  return <MultiSelect ref={ref} loadOptions={load} {...props} />;
});
