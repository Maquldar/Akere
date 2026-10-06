import { VndDetailPage } from '@/components/compliance/vnd/vnd-detail';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'vnd');

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VndDetailPage id={id} />;
}
