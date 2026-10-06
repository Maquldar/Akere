import { EsutdPage } from '@/components/compliance/esutd/esutd-page';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'esutd');

export default function Page() {
  return <EsutdPage />;
}
