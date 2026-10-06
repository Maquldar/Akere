'use client';

import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import type { AccessContext } from '@/lib/permissions';
import { useCurrentUser } from './me-context';

/** Renders children only when `allow(access)` is true; otherwise a "no access" block. */
export function RequireAccess({ allow, children }: { allow: (access: AccessContext) => boolean; children: ReactNode }) {
  const t = useTranslations('errors');
  const { access } = useCurrentUser();
  if (!allow(access)) {
    return (
      <Card className="mx-auto mt-6 max-w-lg">
        <EmptyState icon={<Lock aria-hidden />} title={t('forbiddenTitle')} description={t('forbiddenText')} />
      </Card>
    );
  }
  return <>{children}</>;
}
