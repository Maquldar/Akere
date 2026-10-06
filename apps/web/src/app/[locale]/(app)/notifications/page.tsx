import { NotificationsPage } from '@/components/notifications/notifications-page';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'notifications');

export default function Page() {
  return <NotificationsPage />;
}
