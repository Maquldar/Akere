'use client';

import { ChevronDown, FileText, Link2, Plus, Send, ShieldAlert, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useRef, useState, type FormEvent } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { FileDropzone, validateFiles, DEFAULT_MAX_FILE_SIZE } from '@/components/ui/file-dropzone';
import { Textarea } from '@/components/ui/input';
import { FormError, FormField } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SkeletonList } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { Link } from '@/i18n/navigation';
import { isApiError } from '@/lib/api/errors';
import {
  searchDocuments, useAddComment, useAddLink, useDeleteLink, useDocumentComments, useUploadDocumentFile, useVerifySignatures,
} from '@/lib/api/hooks/documents';
import type { DocumentDetail, DocumentFileView, SignMethod } from '@/lib/api/types-documents';
import { formatDateTime } from '@/lib/format';
import { cn, formatBytes } from '@/lib/utils';
import { DocStatusPill } from './labels';

const ATTACH_ACCEPT = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.heic', '.xlsx'];

// Attachments (F-16: any number of files with version history) -------------------------

function FileRow({ f, canUpload, onNewVersion, uploading }: { f: DocumentFileView; canUpload: boolean; onNewVersion: (file: File) => void; uploading: boolean }) {
  const t = useTranslations('documents.files');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const current = f.versions.find((v) => v.version === f.currentVersion) ?? f.versions[0];
  return (
    <li className="rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
        <FileText className="size-5 shrink-0 text-fg-subtle" aria-hidden />
        <div className="min-w-0 flex-1">
          {current ? (
            <a href={current.file.url} target="_blank" rel="noopener" className="focus-ring block truncate rounded text-sm font-medium text-fg hover:text-primary">
              {f.name}
            </a>
          ) : (
            <span className="block truncate text-sm font-medium">{f.name}</span>
          )}
          <div className="text-xs text-fg-subtle">
            {t('version', { n: f.currentVersion })}
            {current && ` · ${formatBytes(current.file.size, locale)} · ${current.uploadedBy.shortName} · ${formatDateTime(current.createdAt, locale)}`}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {f.versions.length > 1 && (
            <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              {t('history', { count: f.versions.length })}
              <ChevronDown className={cn('transition-transform', open && 'rotate-180')} aria-hidden />
            </Button>
          )}
          {canUpload && (
            <>
              <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} loading={uploading}>
                <Upload aria-hidden />
                {t('newVersion')}
              </Button>
              <input
                ref={inputRef}
                type="file"
                className="sr-only"
                tabIndex={-1}
                aria-label={t('newVersionFor', { name: f.name })}
                accept={ATTACH_ACCEPT.join(',')}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  const { ok } = validateFiles([file], ATTACH_ACCEPT, DEFAULT_MAX_FILE_SIZE);
                  if (!ok.length) toast.error(t('badFile'));
                  else onNewVersion(file);
                }}
              />
            </>
          )}
        </div>
      </div>
      {open && (
        <ol className="border-t border-border px-3 py-2">
          {f.versions.map((v) => (
            <li key={v.version} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1 text-[13px]">
              <Badge tone={v.version === f.currentVersion ? 'blue' : 'gray'}>v{v.version}</Badge>
              <a href={v.file.url} target="_blank" rel="noopener" className="focus-ring min-w-0 flex-1 truncate rounded text-fg hover:text-primary">
                {v.file.filename}
              </a>
              <span className="text-xs text-fg-subtle">
                {v.uploadedBy.shortName} · {formatDateTime(v.createdAt, locale)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

export function AttachmentsTab({ doc, canUpload }: { doc: DocumentDetail; canUpload: boolean }) {
  const t = useTranslations('documents.files');
  const tc = useTranslations('common');
  const upload = useUploadDocumentFile(doc.id);
  const [progress, setProgress] = useState<number | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const send = (file: File, documentFileId?: string) => {
    setTarget(documentFileId ?? 'new');
    upload.mutate(
      { file, documentFileId, onProgress: setProgress },
      {
        onSuccess: () => toast.success(documentFileId ? t('versionUploaded') : t('uploaded')),
        onError: (e) => toast.error(isApiError(e) ? e.message : tc('error')),
        onSettled: () => {
          setProgress(null);
          setTarget(null);
        },
      },
    );
  };
  return (
    <div className="flex flex-col gap-4">
      {doc.files.length === 0 ? (
        <EmptyState compact icon={<FileText aria-hidden />} title={t('empty')} description={canUpload ? t('emptyHint') : undefined} />
      ) : (
        <ul className="flex flex-col gap-2">
          {doc.files.map((f) => (
            <FileRow key={f.id} f={f} canUpload={canUpload} uploading={upload.isPending && target === f.id} onNewVersion={(file) => send(file, f.id)} />
          ))}
        </ul>
      )}
      {canUpload && (
        <FileDropzone
          accept={ATTACH_ACCEPT}
          disabled={upload.isPending}
          onFiles={(files) => files[0] && send(files[0])}
          progress={target === 'new' ? progress : null}
          label={t('dropLabel')}
        />
      )}
    </div>
  );
}

// Comments --------------------------------------------------------------------------------

export function CommentsTab({ doc }: { doc: DocumentDetail }) {
  const t = useTranslations('documents.comments');
  const tc = useTranslations('common');
  const locale = useLocale();
  const comments = useDocumentComments(doc.id);
  const add = useAddComment(doc.id);
  const [text, setText] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    add.mutate(text.trim(), {
      onSuccess: () => setText(''),
      onError: (err) => toast.error(isApiError(err) ? err.message : tc('error')),
    });
  };
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {comments.isLoading ? (
        <SkeletonList rows={3} />
      ) : comments.error ? (
        <ErrorState error={comments.error} onRetry={() => comments.refetch()} compact />
      ) : comments.data?.length ? (
        <ul className="flex flex-col gap-4">
          {comments.data.map((c) => (
            <li key={c.id} className="flex gap-3">
              <Avatar name={c.author?.fullName} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium text-fg">{c.author?.fullName ?? '—'}</span>
                  <span className="text-xs text-fg-subtle">{formatDateTime(c.createdAt, locale)}</span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-fg">{c.text}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-subtle">{t('empty')}</p>
      )}
      <form onSubmit={submit} className="flex flex-col gap-2 rounded-lg border border-border bg-surface-muted p-3">
        <label htmlFor="doc-comment" className="sr-only">
          {t('label')}
        </label>
        <Textarea id="doc-comment" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('placeholder')} rows={3} maxLength={4000} />
        <div className="flex justify-end">
          <Button type="submit" size="sm" loading={add.isPending} disabled={!text.trim()}>
            <Send aria-hidden />
            {t('send')}
          </Button>
        </div>
      </form>
    </div>
  );
}

// Links (Связи) -----------------------------------------------------------------------------

const RELATIONS = ['RELATED', 'BASIS', 'SUPPLEMENT', 'REPLACES'] as const;

export function LinksTab({ doc, canManage }: { doc: DocumentDetail; canManage: boolean }) {
  const t = useTranslations('documents.links');
  const tc = useTranslations('common');
  const addLink = useAddLink(doc.id);
  const delLink = useDeleteLink(doc.id);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [relation, setRelation] = useState<string>('RELATED');
  const [toDelete, setToDelete] = useState<string | null>(null);
  const relLabel = (r: string) => ((RELATIONS as readonly string[]).includes(r) ? t(`rel_${r as (typeof RELATIONS)[number]}`) : r);

  const load = useCallback(
    async (q: string, signal: AbortSignal): Promise<ComboOption[]> =>
      (await searchDocuments(q, signal))
        .filter((d) => d.id !== doc.id)
        .map((d) => ({ value: d.id, label: d.title, description: [d.number, d.type.name].filter(Boolean).join(' · ') })),
    [doc.id],
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!target) return;
    addLink.mutate(
      { toId: target, relation },
      {
        onSuccess: () => {
          toast.success(t('added'));
          setOpen(false);
          setTarget(null);
        },
      },
    );
  };

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      {canManage && (
        <div>
          <Button variant="outline" size="sm" onClick={() => { addLink.reset(); setOpen(true); }}>
            <Plus aria-hidden />
            {t('add')}
          </Button>
        </div>
      )}
      {doc.request && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm">
          <Link2 className="size-4 shrink-0 text-fg-subtle" aria-hidden />
          <span className="min-w-0 flex-1">{t('request')}</span>
          <Badge tone="gray">{doc.request.status}</Badge>
        </div>
      )}
      {doc.links.length === 0 && !doc.request ? (
        <EmptyState compact icon={<Link2 aria-hidden />} title={t('empty')} description={t('emptyHint')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {doc.links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5">
              <Link2 className="size-4 shrink-0 text-fg-subtle" aria-hidden />
              <div className="min-w-0 flex-1">
                <Link href={`/documents/${l.document.id}`} className="focus-ring block truncate rounded text-sm font-medium text-fg hover:text-primary">
                  {l.document.title}
                </Link>
                <div className="text-xs text-fg-subtle">
                  {relLabel(l.relation)} · {l.direction === 'from' ? t('outgoing') : t('incoming')}
                  {l.document.number && ` · № ${l.document.number}`}
                </div>
              </div>
              <DocStatusPill status={l.document.status} />
              {canManage && (
                <Button variant="ghost" size="icon-sm" aria-label={t('remove', { name: l.document.title })} onClick={() => setToDelete(l.id)}>
                  <Trash2 aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        size="sm"
        title={t('addTitle')}
        dismissible={!addLink.isPending}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={addLink.isPending}>
              {tc('cancel')}
            </Button>
            <Button type="submit" form="doc-link" loading={addLink.isPending} disabled={!target}>
              {t('add')}
            </Button>
          </>
        }
      >
        <form id="doc-link" onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <FormField label={t('document')} required>
            <Combobox value={target} onChange={(v) => setTarget(v)} loadOptions={load} placeholder={t('documentPlaceholder')} />
          </FormField>
          <FormField label={t('relation')}>
            <Select value={relation} onValueChange={setRelation} options={RELATIONS.map((r) => ({ value: r, label: relLabel(r) }))} />
          </FormField>
          <FormError message={addLink.error ? (isApiError(addLink.error) ? addLink.error.message : tc('error')) : null} />
        </form>
      </Dialog>
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t('removeTitle')}
        confirmLabel={tc('delete')}
        loading={delLink.isPending}
        onConfirm={() =>
          toDelete &&
          delLink.mutate(toDelete, {
            onSuccess: () => {
              toast.success(t('removed'));
              setToDelete(null);
            },
            onError: (e) => toast.error(isApiError(e) ? e.message : tc('error')),
          })
        }
      />
    </div>
  );
}

// Signature verification (F-18) ---------------------------------------------------------------

const methodNames: Record<SignMethod, string> = {
  EGOV_MOBILE: 'eGov mobile',
  EGOV_BUSINESS: 'eGov mobile Business',
  NCALAYER: 'NCALayer',
  PAPER: 'PAPER',
  CLICK: 'CLICK',
};

export function VerificationPanel({ doc }: { doc: DocumentDetail }) {
  const t = useTranslations('documents.verify');
  const locale = useLocale();
  const hasSignatures = doc.steps.some((s) => s.signatureMethod) || doc.paperSigned;
  const verify = useVerifySignatures(doc.id, { enabled: hasSignatures });
  if (!hasSignatures) return null;
  const method = (m: SignMethod) => (m === 'PAPER' ? t('paper') : m === 'CLICK' ? t('click') : methodNames[m]);
  return (
    <section aria-label={t('title')} className="rounded-xl border border-border bg-surface p-4" data-testid="signature-verification">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">{t('title')}</h3>
        {verify.data &&
          (verify.data.valid ? (
            <Badge tone="green">
              <ShieldCheck className="size-3.5" aria-hidden />
              {t('valid')}
            </Badge>
          ) : (
            <Badge tone="red">
              <ShieldAlert className="size-3.5" aria-hidden />
              {t('invalid')}
            </Badge>
          ))}
      </div>
      {verify.isLoading ? (
        <SkeletonList rows={2} className="mt-3" />
      ) : verify.error ? (
        <ErrorState error={verify.error} onRetry={() => verify.refetch()} compact />
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {verify.data?.signatures.map((s, i) => (
            <li key={i} className="flex items-start gap-2 text-[13px]">
              {s.valid ? (
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-green-fg" aria-label={t('valid')} />
              ) : (
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-red-fg" aria-label={t('invalid')} />
              )}
              <div className="min-w-0">
                <div className="font-medium text-fg">{s.signer.fullName}</div>
                <div className="text-xs text-fg-subtle">
                  {method(s.method)} · {formatDateTime(s.signedAt, locale)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-fg-subtle">{t('note')}</p>
    </section>
  );
}
