'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Me } from '@/lib/api/types';
import { accessContext, type AccessContext, type Permission, can } from '@/lib/permissions';

type MeContextValue = { me: Me; access: AccessContext; can: (...p: Permission[]) => boolean };

const MeContext = createContext<MeContextValue | null>(null);

export function MeProvider({ me, children }: { me: Me; children: ReactNode }) {
  const value = useMemo(() => {
    const access = accessContext(me);
    return { me, access, can: (...p: Permission[]) => can(access, ...p) };
  }, [me]);
  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}

/** Current user inside the protected app shell. */
export function useCurrentUser(): MeContextValue {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error('useCurrentUser must be used inside <MeProvider>');
  return ctx;
}
