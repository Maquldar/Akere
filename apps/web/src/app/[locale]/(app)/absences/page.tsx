import { Suspense } from 'react';
import { MyAbsencesPage } from '@/components/time/my-absences-page';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'myAbsences');

export default function Page() {
  return (
    <Suspense>
      <MyAbsencesPage />
    </Suspense>
  );
}
