'use client';

import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/i18n/navigation';
import type { Me } from '@/lib/api/types';
import { safeNextPath } from '@/lib/validation';

/** After a successful login: go to `?next=` (if safe) in the user's saved locale. */
export function useAfterLogin() {
  const router = useRouter();
  const search = useSearchParams();
  return (me: Me) => {
    const next = safeNextPath(search.get('next')) ?? '/';
    router.replace(next, { locale: me.locale });
    router.refresh();
  };
}
