import { HomeDashboard } from '@/components/home/home-dashboard';
import { PopularServices } from '@/components/requests/PopularServices';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'home');

export default function HomePage() {
  return (
    <>
      <HomeDashboard />
      {/* Renders only for users with request.create (checked inside). */}
      <PopularServices className="mt-4" />
    </>
  );
}
