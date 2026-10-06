import { VndRegistry } from '@/components/compliance/vnd/vnd-registry';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'vnd');

export default function Page() {
  return <VndRegistry />;
}
