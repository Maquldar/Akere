import { TemplateEditor } from '@/components/documents/admin/template-editor';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'documentTemplates');

/** `/admin/document-templates/new` creates, any other id edits. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TemplateEditor key={id} id={id === 'new' ? null : id} />;
}
