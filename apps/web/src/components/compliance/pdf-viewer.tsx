'use client';

import { Download, ExternalLink, FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { toApiError } from '@/lib/api/errors';

const MAX_PAGES = 40;

/**
 * Renders a PDF from the API into canvases with pdf.js. The app's CSP forbids framing API responses
 * (X-Frame-Options DENY, frame-ancestors 'none'), so an <iframe> preview is not an option.
 */
export function PdfViewer({ url, title, className }: { url: string; title: string; className?: string }) {
  const t = useTranslations('compliance.pdf');
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<unknown>(null);
  const [pages, setPages] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    const el = host.current;
    setState('loading');
    setError(null);
    (async () => {
      try {
        const res = await fetch(url, { credentials: 'include', signal: ctrl.signal });
        if (!res.ok) {
          let body: unknown;
          try {
            body = await res.json();
          } catch {
            body = undefined;
          }
          throw toApiError(res.status, body);
        }
        const data = new Uint8Array(await res.arrayBuffer());
        const pdfjs = await import('pdfjs-dist');
        if (!pdfjs.GlobalWorkerOptions.workerPort) {
          pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' });
        }
        const doc = await pdfjs.getDocument({ data }).promise;
        if (cancelled || !el) return;
        el.replaceChildren();
        const count = Math.min(doc.numPages, MAX_PAGES);
        setPages(doc.numPages);
        const width = Math.max(280, el.clientWidth - 2);
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        for (let i = 1; i <= count; i++) {
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
          canvas.setAttribute('aria-label', t('pageOf', { page: i, total: doc.numPages }));
          el.appendChild(canvas);
          await page.render({ canvas, viewport }).promise;
          if (i === 1 && !cancelled) setState('ready');
        }
        if (!cancelled) setState('ready');
      } catch (e) {
        if (cancelled || (e as { name?: string })?.name === 'AbortError') return;
        setError(e);
        setState('error');
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [url, attempt, t]);

  return (
    <div className={className}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FileText className="size-4 text-fg-subtle" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{title}</span>
        {pages > 0 && <span className="text-xs text-fg-subtle tabular">{t('pages', { count: pages })}</span>}
        <Button asChild variant="outline" size="sm">
          <a href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink aria-hidden />
            {t('open')}
          </a>
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href={`${url}${url.includes('?') ? '&' : '?'}download=1`}>
            <Download aria-hidden />
            {t('download')}
          </a>
        </Button>
      </div>
      {state === 'loading' && (
        <div className="grid gap-3" aria-busy>
          <Skeleton className="aspect-[1/1.414] w-full" />
        </div>
      )}
      {state === 'error' && <ErrorState error={error} onRetry={() => setAttempt((a) => a + 1)} compact />}
      <div
        ref={host}
        className="flex max-h-[78dvh] flex-col gap-3 overflow-y-auto rounded-lg bg-surface-hover p-2 sm:p-3"
        hidden={state === 'error'}
        aria-label={title}
      />
      {pages > MAX_PAGES && <p className="mt-2 text-xs text-fg-subtle">{t('truncated', { shown: MAX_PAGES, total: pages })}</p>}
    </div>
  );
}
