'use client';

import { Download, ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** Embedded PDF (browser viewer) with open/download actions. `src` must be same-origin. */
export function PdfFrame({
  src,
  title,
  downloadHref,
  toolbar,
  className,
}: {
  src: string;
  title: string;
  downloadHref?: string;
  toolbar?: ReactNode;
  className?: string;
}) {
  const t = useTranslations('documents.pdf');
  const [loaded, setLoaded] = useState<string | null>(null);
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{toolbar}</div>
        <Button variant="outline" size="sm" asChild>
          <a href={src} target="_blank" rel="noopener">
            <ExternalLink aria-hidden />
            {t('open')}
          </a>
        </Button>
        {downloadHref && (
          <Button variant="outline" size="sm" asChild>
            <a href={downloadHref} download>
              <Download aria-hidden />
              {t('download')}
            </a>
          </Button>
        )}
      </div>
      <div className="relative h-[70dvh] min-h-[420px] overflow-hidden rounded-xl border border-border bg-surface-muted">
        {loaded !== src && <Skeleton className="absolute inset-4" />}
        <iframe key={src} src={src} title={title} className="relative size-full" onLoad={() => setLoaded(src)} />
      </div>
    </div>
  );
}
