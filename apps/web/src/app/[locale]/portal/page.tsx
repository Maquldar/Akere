import { Suspense } from 'react';
import { PortalApp } from '@/components/onboarding/portal/portal-app';

export default function Page() {
  return (
    <Suspense>
      <PortalApp />
    </Suspense>
  );
}
