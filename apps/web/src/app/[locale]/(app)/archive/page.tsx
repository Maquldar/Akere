import { ArchiveUpload } from '@/components/compliance/archive/archive-upload';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'archive');

export default function Page() {
  return <ArchiveUpload />;
}
