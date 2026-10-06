import { HelpArticlePage } from '@/components/compliance/help/help-article';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'help');

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <HelpArticlePage slug={decodeURIComponent(slug)} />;
}
