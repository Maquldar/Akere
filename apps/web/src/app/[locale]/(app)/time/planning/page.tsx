import { Suspense } from 'react';
import { PlanningPage } from '@/components/time/planning-page';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'planning');

export default function Page() {
  return (
    <Suspense>
      <PlanningPage />
    </Suspense>
  );
}
