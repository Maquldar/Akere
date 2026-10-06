import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/shell/logo';
import { Link } from '@/i18n/navigation';

export default function NotFound() {
  const t = useTranslations('errors');
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-canvas p-6 text-center">
      <Logo />
      <div>
        <p className="text-5xl font-semibold tracking-tight text-fg">404</p>
        <h1 className="mt-2 text-lg font-semibold text-fg">{t('notFoundTitle')}</h1>
        <p className="mt-1 text-sm text-fg-muted">{t('notFoundPage')}</p>
      </div>
      <Button asChild>
        <Link href="/">{t('goHome')}</Link>
      </Button>
    </div>
  );
}
