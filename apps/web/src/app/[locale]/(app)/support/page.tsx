import { SupportPage } from '@/components/compliance/help/support-page';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'support');

export default function Page() {
  return <SupportPage />;
}
