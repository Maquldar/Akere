'use client';

import { FileText, UploadCloud, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { cn, formatBytes } from '@/lib/utils';
import { Button } from './button';

export type FileDropzoneProps = {
  /** Extensions incl. dot, e.g. ['.pdf', '.docx', '.jpg']. */
  accept?: string[];
  /** Max size per file in bytes (default 25 MB, API.md §0). */
  maxSize?: number;
  multiple?: boolean;
  disabled?: boolean;
  /** Called with files that passed validation. */
  onFiles: (files: File[]) => void;
  /** Optional list of files to show under the zone (controlled). */
  files?: File[];
  onRemove?: (index: number) => void;
  /** 0..1 upload progress shown under the zone. */
  progress?: number | null;
  label?: string;
  className?: string;
  id?: string;
  'aria-describedby'?: string;
};

export const DEFAULT_MAX_FILE_SIZE = 25 * 1024 * 1024;

export function validateFiles(files: File[], accept: string[] | undefined, maxSize: number) {
  const ok: File[] = [];
  const rejected: { file: File; reason: 'type' | 'size' }[] = [];
  const allowed = accept?.map((a) => a.toLowerCase());
  for (const f of files) {
    const ext = f.name.includes('.') ? `.${f.name.split('.').pop()!.toLowerCase()}` : '';
    if (allowed && allowed.length > 0 && !allowed.includes(ext)) rejected.push({ file: f, reason: 'type' });
    else if (f.size > maxSize) rejected.push({ file: f, reason: 'size' });
    else ok.push(f);
  }
  return { ok, rejected };
}

/** Drag & drop or click/Enter/Space to pick files. */
export function FileDropzone({
  accept,
  maxSize = DEFAULT_MAX_FILE_SIZE,
  multiple = false,
  disabled,
  onFiles,
  files,
  onRemove,
  progress,
  label,
  className,
  id,
  'aria-describedby': describedBy,
}: FileDropzoneProps) {
  const t = useTranslations('dropzone');
  const tc = useTranslations('common');
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [dragging, setDragging] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const handle = (list: FileList | null) => {
    if (!list || disabled) return;
    const arr = Array.from(list).slice(0, multiple ? undefined : 1);
    const { ok, rejected } = validateFiles(arr, accept, maxSize);
    setErrors(
      rejected.map((r) =>
        r.reason === 'type' ? t('badType', { name: r.file.name }) : t('tooLarge', { name: r.file.name, max: formatBytes(maxSize) }),
      ),
    );
    if (ok.length) onFiles(ok);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handle(e.dataTransfer.files);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      inputRef.current?.click();
    }
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div
        id={id}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        aria-describedby={[hintId, describedBy].filter(Boolean).join(' ')}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={onKeyDown}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'focus-ring flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-7 text-center transition-colors',
          dragging ? 'border-primary bg-primary-soft' : 'border-border-strong bg-surface-muted hover:bg-surface-hover',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        <UploadCloud className="size-6 text-fg-subtle" aria-hidden />
        <p className="text-sm font-medium text-fg">
          {label ?? t('label')} <span className="text-primary">{t('browse')}</span>
        </p>
        <p id={hintId} className="text-xs text-fg-subtle">
          {accept?.length ? t('accepted', { types: accept.join(', ') }) : t('anyType')} · {t('maxSize', { max: formatBytes(maxSize) })}
        </p>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          multiple={multiple}
          accept={accept?.join(',')}
          disabled={disabled}
          onChange={(e) => {
            handle(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {errors.length > 0 && (
        <ul role="alert" className="flex flex-col gap-0.5 text-xs font-medium text-red-fg">
          {errors.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
      {files && files.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-[13px]">
              <FileText className="size-4 shrink-0 text-fg-subtle" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-fg">{f.name}</span>
              <span className="shrink-0 text-xs text-fg-subtle tabular">{formatBytes(f.size)}</span>
              {onRemove && (
                <Button variant="ghost" size="icon-sm" onClick={() => onRemove(i)} aria-label={tc('removeItem', { name: f.name })}>
                  <X />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {progress !== undefined && progress !== null && (
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-surface-active"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          aria-label={t('progress')}
        >
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
    </div>
  );
}
