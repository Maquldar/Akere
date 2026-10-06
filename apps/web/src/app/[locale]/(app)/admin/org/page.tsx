import { Suspense } from 'react';
import { OrgPage } from '@/components/admin/org/org-page';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'orgStructure');

export default function Page() {
  return (
    <Suspense>
      <OrgPage />
    </Suspense>
  );
}
