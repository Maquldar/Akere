import { Suspense } from 'react';
import { MySchedulePage } from '@/components/time/my-schedule-page';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'myTime');

export default function Page() {
  return (
    <Suspense>
      <MySchedulePage />
    </Suspense>
  );
}
