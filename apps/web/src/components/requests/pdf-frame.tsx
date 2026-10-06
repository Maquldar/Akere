'use client';

import { Download, FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { toApiError } from '@/lib/api/errors';
import { cn } from '@/lib/utils';

const MAX_PAGES = 20;

function decodeDataUrl(src: string): Uint8Array {
  const b64 = src.slice(src.indexOf(',') + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Renders a PDF (data URL from /requests/preview or a same-origin URL) to canvases with pdf.js.
 * The app CSP forbids framing blob:/API responses, so an <iframe> is not an option.
 */
export function PdfFrame({ src, title, fileName, className }: { src: string; title: string; fileName?: string; className?: string }) {
  const t = useTranslations('requests.pdf');
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<unknown>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const ctrl = new AbortController();
    const el = host.current;
    setState('loading');
    setError(null);
    (async () => {
      try {
        let data: Uint8Array;
        if (src.startsWith('data:')) {
          data = decodeDataUrl(src);
        } else {
          const res = await fetch(src, { credentials: 'include', signal: ctrl.signal });
          if (!res.ok) throw toApiError(res.status, undefined);
          data = new Uint8Array(await res.arrayBuffer());
        }
        objectUrl = URL.createObjectURL(new Blob([data.slice()], { type: 'application/pdf' }));
        if (!cancelled) setDownloadUrl(objectUrl);
        const pdfjs = await import('pdfjs-dist');
        if (!pdfjs.GlobalWorkerOptions.workerPort) {
          pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' });
        }
        const doc = await pdfjs.getDocument({ data }).promise;
        if (cancelled || !el) return;
        el.replaceChildren();
        const width = Math.max(280, el.clientWidth - 2);
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        for (let i = 1; i <= Math.min(doc.numPages, MAX_PAGES); i++) {
          const page = await doc.getPage(i);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * ratio });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          canvas.className = 'block rounded-md border border-border bg-white shadow-card';
          canvas.setAttribute('role', 'img');
          canvas.setAttribute('aria-label', t('page', { page: i, total: doc.numPages }));
          el.appendChild(canvas);
          const canvasContext = canvas.getContext('2d');
          if (!canvasContext) throw new Error('Canvas 2D is unavailable');
          await page.render({ canvasContext, viewport }).promise;
          if (i === 1 && !cancelled) setState('ready');
        }
        if (!cancelled) setState('ready');
      } catch (e) {
        if (cancelled || (e as { name?: string })?.name === 'AbortError') return;
        console.warn('[PdfFrame]', e);
        setError(e);
        setState('error');
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, attempt, t]);

  return (
    <div className={cn('flex flex-col gap-3', className)} data-testid="pdf-preview">
      <div className="flex flex-wrap items-center gap-2">
        <FileText className="size-4 text-fg-subtle" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{title}</span>
        {downloadUrl && (
          <Button variant="outline" size="sm" asChild>
            <a href={downloadUrl} download={fileName ?? `${title}.pdf`}>
              <Download aria-hidden />
              {t('download')}
            </a>
          </Button>
        )}
      </div>
      {state === 'loading' && <Skeleton className="aspect-[1/1.414] w-full rounded-xl" />}
      {state === 'error' && <ErrorState error={error} title={t('unavailable')} onRetry={() => setAttempt((a) => a + 1)} compact />}
      <div
        ref={host}
        aria-label={title}
        hidden={state === 'error'}
        className="flex max-h-[78dvh] flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-surface-hover p-2 sm:p-3"
      />
    </div>
  );
}
