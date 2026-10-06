import { RequestTemplateEditor } from '@/components/onboarding/request-template-editor';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'requestTemplates');

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RequestTemplateEditor id={id} />;
}
