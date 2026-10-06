import { VacationSchedulePage } from '@/components/requests/vacation/schedule-page';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'vacationSchedule');

export default function Page() {
  return <VacationSchedulePage />;
}
