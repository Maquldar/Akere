import { TemplatesPage } from '@/components/documents/admin/templates-page';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'documentTemplates');

export default function Page() {
  return <TemplatesPage />;
}
