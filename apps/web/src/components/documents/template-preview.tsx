'use client';

import { Download, ExternalLink, FileText, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { fetchPdf } from '@/lib/api/hooks/documents';
import { cn } from '@/lib/utils';

export type PreviewBody = { data: Record<string, unknown>; legalEntityId: string; subjectEmployeeId?: string | null };

/** Renders `POST /document-templates/:id/preview` into a blob URL; `refresh()` re-renders. */
export function useTemplatePdf(templateId: string | null | undefined, body: PreviewBody | null, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const urlRef = useRef<string | null>(null);

  const refresh = useCallback(() => {
    const b = bodyRef.current;
    if (!templateId || !b?.legalEntityId) return () => undefined;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetchPdf(`/document-templates/${templateId}/preview`, { method: 'POST', body: { ...b, subjectEmployeeId: b.subjectEmployeeId || undefined }, signal: ctrl.signal })
      .then((blob) => {
        const next = URL.createObjectURL(blob);
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = next;
        setUrl(next);
      })
      .catch((e: unknown) => {
        if ((e as { name?: string })?.name !== 'AbortError') setError(e);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [templateId]);

  useEffect(() => {
    if (!enabled) return;
    return refresh();
  }, [enabled, refresh]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  return { url, error, loading, refresh };
}

/** PDF preview pane for a blob URL with open/download actions. */
export function BlobPdfPane({
  url,
  loading,
  error,
  onRetry,
  filename,
  title,
  className,
}: {
  url: string | null;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  filename: string;
  title: string;
  className?: string;
}) {
  const t = useTranslations('documents.pdf');
  // Some deployments' CSP forbid framing blob: URLs; then offer open/download instead of a blank frame.
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const onViolation = (e: SecurityPolicyViolationEvent) => {
      if (e.blockedURI.startsWith('blob')) setBlocked(true);
    };
    document.addEventListener('securitypolicyviolation', onViolation);
    return () => document.removeEventListener('securitypolicyviolation', onViolation);
  }, []);
  return (
    <div className={cn('flex min-h-0 flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onRetry} loading={loading}>
          <RefreshCw aria-hidden />
          {t('refresh')}
        </Button>
        {url && (
          <>
            <Button variant="outline" size="sm" asChild>
              <a href={url} target="_blank" rel="noopener">
                <ExternalLink aria-hidden />
                {t('open')}
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={url} download={filename}>
                <Download aria-hidden />
                {t('download')}
              </a>
            </Button>
          </>
        )}
      </div>
      <div className="relative min-h-[420px] flex-1 overflow-hidden rounded-xl border border-border bg-surface-muted">
        {error ? (
          <ErrorState error={error} onRetry={onRetry} compact />
        ) : url && blocked ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <FileText className="size-8 text-fg-subtle" aria-hidden />
            <p className="max-w-sm text-sm text-fg-muted">{t('blocked')}</p>
            <Button variant="outline" size="sm" asChild>
              <a href={url} target="_blank" rel="noopener">
                <ExternalLink aria-hidden />
                {t('open')}
              </a>
            </Button>
          </div>
        ) : url ? (
          <iframe src={url} title={title} className="absolute inset-0 size-full" />
        ) : (
          <Skeleton className="absolute inset-4" />
        )}
      </div>
    </div>
  );
}

export function TemplatePreviewDialog({
  open,
  onOpenChange,
  templateId,
  title,
  body,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  templateId: string;
  title: string;
  body: PreviewBody;
}) {
  const t = useTranslations('documents.pdf');
  const pdf = useTemplatePdf(templateId, body, open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title={t('previewTitle')} description={t('previewText')}>
      <BlobPdfPane {...pdf} onRetry={() => pdf.refresh()} filename={`${title}.pdf`} title={title} className="h-[70dvh]" />
    </Dialog>
  );
}
