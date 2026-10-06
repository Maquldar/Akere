import { Suspense } from 'react';
import { NewDocumentForm } from '@/components/documents/new-document-form';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'newDocument');

export default function Page() {
  return (
    <Suspense>
      <NewDocumentForm />
    </Suspense>
  );
}
