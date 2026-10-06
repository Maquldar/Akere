import { DocumentRegistry } from '@/components/documents/document-registry';
import type { DocumentBox } from '@/lib/api/types-documents';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'allDocuments');

const BOXES: DocumentBox[] = ['inbox', 'outbox', 'drafts', 'all', 'archive'];

/** `/documents?box=inbox|outbox|drafts|all|archive` (default: all). */
export default async function Page({ searchParams }: { searchParams: Promise<{ box?: string }> }) {
  const { box } = await searchParams;
  const value = BOXES.includes(box as DocumentBox) ? (box as DocumentBox) : 'all';
  return <DocumentRegistry key={value} box={value} />;
}
