import { Suspense } from 'react';
import { TimesheetPage } from '@/components/time/timesheet-page';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'timesheet');

export default function Page() {
  return (
    <Suspense>
      <TimesheetPage />
    </Suspense>
  );
}
