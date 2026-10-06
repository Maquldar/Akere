import { DocumentTypesPage } from '@/components/documents/admin/document-types-page';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'dictionaries');

export default function Page() {
  return <DocumentTypesPage />;
}
