import { UsersPage } from '@/components/admin/users/users-page';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'users');

export default function Page() {
  return <UsersPage />;
}
