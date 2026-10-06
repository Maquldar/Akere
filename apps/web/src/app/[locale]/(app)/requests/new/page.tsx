import { Suspense } from 'react';
import { NewRequestPage } from '@/components/requests/request-form';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'myRequests');

export default function Page() {
  return (
    <Suspense>
      <NewRequestPage />
    </Suspense>
  );
}
