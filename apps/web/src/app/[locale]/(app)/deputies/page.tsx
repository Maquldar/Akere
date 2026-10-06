import { DeputiesPage } from '@/components/documents/deputies-page';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'deputies');

export default function Page() {
  return <DeputiesPage />;
}
