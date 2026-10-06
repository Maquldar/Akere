import { ReportsPage } from '@/components/compliance/reports/reports-page';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'reports');

export default function Page() {
  return <ReportsPage />;
}
