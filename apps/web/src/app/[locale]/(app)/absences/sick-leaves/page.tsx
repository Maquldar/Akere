import { Suspense } from 'react';
import { SickLeavesPage } from '@/components/time/sick-leaves-page';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'sickLeaves');

export default function Page() {
  return (
    <Suspense>
      <SickLeavesPage />
    </Suspense>
  );
}
