import { CandidateNewPage } from '@/components/onboarding/candidate-new-page';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'candidates');

export default function Page() {
  return <CandidateNewPage />;
}
