import { HelpCenter } from '@/components/compliance/help/help-center';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'help');

export default function Page() {
  return <HelpCenter />;
}
