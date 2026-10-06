import { ApiKeysPage } from '@/components/compliance/api-keys/api-keys-page';
import { navPageMetadata } from '@/lib/metadata';

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => navPageMetadata(params, 'apiKeys');

export default function Page() {
  return <ApiKeysPage />;
}
