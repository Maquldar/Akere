import { Suspense } from 'react';
import { MyTimePage } from '@/components/time/my-time-page';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'myTime');

export default function Page() {
  return (
    <Suspense>
      <MyTimePage />
    </Suspense>
  );
}
