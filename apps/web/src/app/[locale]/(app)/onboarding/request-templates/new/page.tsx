import { RequestTemplateEditor } from '@/components/onboarding/request-template-editor';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'requestTemplates');

export default function Page() {
  return <RequestTemplateEditor />;
}
