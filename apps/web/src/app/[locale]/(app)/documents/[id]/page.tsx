import { DocumentCard } from '@/components/documents/document-card';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'allDocuments');

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DocumentCard key={id} id={id} />;
}
