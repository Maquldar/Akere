import { TeamRequestsPage } from '@/components/requests/team-requests-page';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'teamRequests');

export default function Page() {
  return <TeamRequestsPage />;
}
