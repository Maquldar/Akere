import { ProfilePage } from '@/components/profile/profile-page';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'profile');

export default function Page() {
  return <ProfilePage />;
}
