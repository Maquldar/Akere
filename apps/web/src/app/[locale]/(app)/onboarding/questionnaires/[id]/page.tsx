import { QuestionnaireBuilder } from '@/components/onboarding/questionnaire-builder';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'questionnaires');

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <QuestionnaireBuilder id={id} />;
}
