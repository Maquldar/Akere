import { RequestTemplatesPage } from '@/components/onboarding/request-templates-page';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'requestTemplates');

export default function Page() {
  return <RequestTemplatesPage />;
}
