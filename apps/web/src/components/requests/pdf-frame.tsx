'use client';

import { Download, FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Shows a PDF given as a data URL or a same-origin URL (data URLs are turned into blob URLs for iframes). */
export function PdfFrame({ src, title, fileName, className }: { src: string; title: string; fileName?: string; className?: string }) {
  const t = useTranslations('requests.pdf');
  const [url, setUrl] = useState<string | null>(src.startsWith('data:') ? null : src);

  useEffect(() => {
    if (!src.startsWith('data:')) {
      setUrl(src);
      return;
    }
    let revoked = false;
    let objectUrl: string | null = null;
    try {
      const [meta, b64 = ''] = src.split(',', 2);
      const mime = /data:([^;]+)/.exec(meta ?? '')?.[1] ?? 'application/pdf';
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
      if (!revoked) setUrl(objectUrl);
    } catch {
      setUrl(null);
    }
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="relative h-[min(75dvh,880px)] min-h-[420px] overflow-hidden rounded-xl border border-border bg-surface-hover">
        {url ? (
          <iframe src={url} title={title} className="size-full" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 text-sm text-fg-muted">
            <FileText className="size-6 text-fg-subtle" aria-hidden />
            {t('unavailable')}
          </div>
        )}
      </div>
      {url && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" asChild>
            <a href={url} download={fileName ?? `${title}.pdf`} target="_blank" rel="noreferrer">
              <Download aria-hidden />
              {t('download')}
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}
