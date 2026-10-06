import { Suspense } from 'react';
import { CandidateDetailPage } from '@/components/onboarding/candidate-detail-page';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'candidates');

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <CandidateDetailPage id={id} />
    </Suspense>
  );
}
