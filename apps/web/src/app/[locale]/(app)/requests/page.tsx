import { MyRequestsPage } from '@/components/requests/my-requests-page';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'myRequests');

export default function Page() {
  return <MyRequestsPage />;
}
