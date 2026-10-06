import { DocumentRegistry } from '@/components/documents/document-registry';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'outgoing');

export default function Page() {
  return <DocumentRegistry box="outbox" />;
}
