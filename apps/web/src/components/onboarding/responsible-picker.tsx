'use client';

import { useTranslations } from 'next-intl';
import { forwardRef, useCallback, useMemo } from 'react';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { useCurrentUser } from '@/components/shell/me-context';
import { searchResponsible } from '@/lib/api/hooks/onboarding';
import type { UserRef } from '@/lib/api/types';

/** HR / admin picker for the candidate's "Ответственный". */
export const ResponsiblePicker = forwardRef<
  HTMLButtonElement,
  {
    value: string | null | undefined;
    onChange: (id: string | null) => void;
    current?: UserRef | null;
    id?: string;
    size?: 'sm' | 'md';
    placeholder?: string;
    className?: string;
    'aria-label'?: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean | 'true' | 'false';
  }
>(function ResponsiblePicker({ value, onChange, current, placeholder, ...rest }, ref) {
  const t = useTranslations('onboarding.form');
  const { me, can } = useCurrentUser();
  const canListUsers = can('users.manage');
  const load = useCallback(
    async (q: string, signal: AbortSignal) => {
      const list = await searchResponsible(q, signal, canListUsers);
      const mine: ComboOption = { value: me.id, label: me.fullName, description: t('me') };
      const rest = list.filter((o) => o.value !== me.id);
      return !q || me.fullName.toLocaleLowerCase().includes(q.toLocaleLowerCase()) ? [mine, ...rest] : rest;
    },
    [canListUsers, me.id, me.fullName, t],
  );
  const selectedOption = useMemo<ComboOption | null>(() => {
    if (!value) return null;
    if (current && current.id === value) return { value: current.id, label: current.fullName };
    if (value === me.id) return { value: me.id, label: me.fullName };
    return null;
  }, [value, current, me.id, me.fullName]);
  return (
    <Combobox
      ref={ref}
      value={value ?? null}
      onChange={(v) => onChange(v)}
      loadOptions={load}
      selectedOption={selectedOption}
      clearable
      placeholder={placeholder ?? t('responsiblePlaceholder')}
      {...rest}
    />
  );
});
