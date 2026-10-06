import { QuestionnairesPage } from '@/components/onboarding/questionnaires-page';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'questionnaires');

export default function Page() {
  return <QuestionnairesPage />;
}
