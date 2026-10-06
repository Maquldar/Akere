import { EmployeesPage } from '@/components/employees/employees-page';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'employees');

export default function Page() {
  return <EmployeesPage />;
}
