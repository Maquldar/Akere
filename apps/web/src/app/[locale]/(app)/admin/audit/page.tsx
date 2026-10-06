import { AuditPage } from '@/components/admin/audit/audit-page';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'audit');

export default function Page() {
  return <AuditPage />;
}
