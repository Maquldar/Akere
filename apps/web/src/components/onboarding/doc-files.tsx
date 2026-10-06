'use client';

import { Download, Eye, EyeOff, FileText, ImageIcon, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FileDropzone } from '@/components/ui/file-dropzone';
import { toast } from '@/components/ui/toaster';
import { isApiError } from '@/lib/api/errors';
import type { FileRef } from '@/lib/api/types';
import { cn, formatBytes } from '@/lib/utils';

export const DOC_ACCEPT = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.heic'];

const previewable = (f: FileRef) => f.mime === 'application/pdf' || f.mime === 'image/jpeg' || f.mime === 'image/png';

/** Inline preview: PDF in an iframe (same-origin file URL), images as <img>. */
export function FilePreview({ file, className }: { file: FileRef; className?: string }) {
  const t = useTranslations('onboarding.files');
  if (file.mime === 'application/pdf') {
    return (
      <iframe
        src={`${file.url}#toolbar=0&view=FitH`}
        title={t('previewOf', { name: file.filename })}
        className={cn('h-[420px] w-full rounded-lg border border-border bg-surface-muted sm:h-[560px]', className)}
      />
    );
  }
  if (file.mime.startsWith('image/')) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={file.url}
        alt={t('previewOf', { name: file.filename })}
        className={cn('max-h-[560px] w-full rounded-lg border border-border bg-surface-muted object-contain', className)}
      />
    );
  }
  return null;
}

/** Upload zone + list of files with download, preview toggle and optional delete. */
export function DocFiles({
  files,
  onUpload,
  onDelete,
  disabled,
  canUpload = true,
  defaultPreview = true,
}: {
  files: FileRef[];
  onUpload?: (file: File, onProgress: (f: number) => void) => Promise<unknown>;
  onDelete?: (file: FileRef) => Promise<unknown>;
  disabled?: boolean;
  canUpload?: boolean;
  defaultPreview?: boolean;
}) {
  const t = useTranslations('onboarding.files');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [progress, setProgress] = useState<number | null>(null);
  const [shown, setShown] = useState<string | null>(() => (defaultPreview ? (files.find(previewable)?.id ?? null) : null));
  const [deleting, setDeleting] = useState<string | null>(null);

  const upload = async (list: File[]) => {
    if (!onUpload) return;
    for (const file of list) {
      setProgress(0);
      try {
        await onUpload(file, setProgress);
        toast.success(t('uploaded', { name: file.name }));
      } catch (e) {
        toast.error(
          isApiError(e) && e.code === 'FILE_TOO_LARGE'
            ? t('tooLarge')
            : isApiError(e) && e.code === 'UNSUPPORTED_FILE'
              ? t('unsupported')
              : isApiError(e)
                ? e.message
                : tc('error'),
        );
      } finally {
        setProgress(null);
      }
    }
  };

  const current = files.find((f) => f.id === shown) ?? null;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {canUpload && onUpload && (
        <FileDropzone
          accept={DOC_ACCEPT}
          multiple
          disabled={disabled || progress !== null}
          onFiles={(fs) => void upload(fs)}
          progress={progress}
          label={t('dropLabel')}
        />
      )}
      {canUpload && onUpload && <p className="-mt-1 text-xs text-fg-subtle">{t('totalLimit')}</p>}
      {files.length > 0 ? (
        <ul className="flex flex-col gap-1.5" aria-label={t('listLabel')}>
          {files.map((f) => {
            const Icon = f.mime.startsWith('image/') ? ImageIcon : FileText;
            const isShown = shown === f.id;
            return (
              <li key={f.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px]">
                <Icon className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-fg" title={f.filename}>
                  {f.filename}
                </span>
                <span className="hidden shrink-0 text-xs text-fg-subtle tabular sm:inline">{formatBytes(f.size, locale)}</span>
                {previewable(f) && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-pressed={isShown}
                    aria-label={isShown ? t('hidePreview', { name: f.filename }) : t('showPreview', { name: f.filename })}
                    onClick={() => setShown(isShown ? null : f.id)}
                  >
                    {isShown ? <EyeOff /> : <Eye />}
                  </Button>
                )}
                <Button variant="ghost" size="icon-sm" asChild>
                  <a href={`${f.url}?download=1`} aria-label={t('download', { name: f.filename })}>
                    <Download />
                  </a>
                </Button>
                {onDelete && !disabled && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    loading={deleting === f.id}
                    aria-label={t('delete', { name: f.filename })}
                    onClick={async () => {
                      setDeleting(f.id);
                      try {
                        await onDelete(f);
                        if (shown === f.id) setShown(null);
                      } catch (e) {
                        toast.error(isApiError(e) ? e.message : tc('error'));
                      } finally {
                        setDeleting(null);
                      }
                    }}
                  >
                    {deleting === f.id ? null : <Trash2 />}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        !canUpload && <p className="text-[13px] text-fg-subtle">{t('none')}</p>
      )}
      {current && <FilePreview file={current} />}
    </div>
  );
}
