import { OutboxPage } from '@/components/admin/outbox/outbox-page';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'outbox');

export default function Page() {
  return <OutboxPage />;
}
