import { RoutesPage } from '@/components/documents/admin/routes-page';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'routes');

export default function Page() {
  return <RoutesPage />;
}
