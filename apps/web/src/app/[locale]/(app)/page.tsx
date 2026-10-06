import { HomeDashboard } from '@/components/home/home-dashboard';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'home');

export default function HomePage() {
  return <HomeDashboard />;
}
