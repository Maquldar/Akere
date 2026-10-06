'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { DatePicker } from '@/components/ui/date-picker';
import { FileDropzone } from '@/components/ui/file-dropzone';
import { Input, Textarea } from '@/components/ui/input';
import { FormError, FormField } from '@/components/ui/label';
import { toast } from '@/components/ui/toaster';
import { useCurrentUser } from '@/components/shell/me-context';
import { isApiError } from '@/lib/api/errors';
import { useDocumentAction, useDocumentTemplate, useDocumentTypes, usePaperSigned } from '@/lib/api/hooks/documents';
import type { DocumentDetail } from '@/lib/api/types-documents';
import { can } from '@/lib/permissions';
import { DataFieldsEditor } from './data-fields';
import { extractDataFields, toDataPayload, type DataField } from './template-fields';

const today = () => new Date().toISOString().slice(0, 10);

function fieldError(e: unknown, field: string): string | undefined {
  return isApiError(e) ? e.fieldErrors[field]?.[0] : undefined;
}

function generalError(e: unknown, fallback: string): string | null {
  if (!e) return null;
  if (isApiError(e)) return e.code === 'VALIDATION_ERROR' && Object.keys(e.fieldErrors).length ? null : e.message;
  return fallback;
}

/** Comment-required route action: return for rework / reject. */
export function CommentActionDialog({
  doc,
  kind,
  onOpenChange,
}: {
  doc: DocumentDetail;
  kind: 'return' | 'reject' | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('documents.card');
  const tc = useTranslations('common');
  const action = useDocumentAction(doc.id);
  const [comment, setComment] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (kind) {
      setComment('');
      setTouched(false);
      action.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!kind || !comment.trim()) return;
    action.mutate(
      { kind, comment: comment.trim() },
      {
        onSuccess: () => {
          toast.success(kind === 'return' ? t('returnedToast') : t('rejectedToast'));
          onOpenChange(false);
        },
      },
    );
  };
  return (
    <Dialog
      open={kind !== null}
      onOpenChange={onOpenChange}
      size="sm"
      title={kind === 'reject' ? t('rejectTitle') : t('returnTitle')}
      description={kind === 'reject' ? t('rejectText') : t('returnText')}
      dismissible={!action.isPending}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={action.isPending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="doc-comment-action" variant={kind === 'reject' ? 'danger' : 'primary'} loading={action.isPending}>
            {kind === 'reject' ? t('reject') : t('return')}
          </Button>
        </>
      }
    >
      <form id="doc-comment-action" onSubmit={submit} noValidate className="flex flex-col gap-3">
        <FormField label={t('comment')} required error={touched && !comment.trim() ? tc('requiredField') : fieldError(action.error, 'comment')}>
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={4} maxLength={2000} />
        </FormField>
        <FormError message={generalError(action.error, tc('error'))} />
      </form>
    </Dialog>
  );
}

export function CancelDialog({ doc, open, onOpenChange }: { doc: DocumentDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('documents.card');
  const tc = useTranslations('common');
  const action = useDocumentAction(doc.id);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (open) {
      setReason('');
      setTouched(false);
      action.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!reason.trim()) return;
    action.mutate(
      { kind: 'cancel', reason: reason.trim() },
      {
        onSuccess: () => {
          toast.success(t('cancelledToast'));
          onOpenChange(false);
        },
      },
    );
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={t('cancelTitle')}
      description={t('cancelText')}
      dismissible={!action.isPending}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={action.isPending}>
            {tc('close')}
          </Button>
          <Button type="submit" form="doc-cancel" variant="danger" loading={action.isPending}>
            {t('cancelDoc')}
          </Button>
        </>
      }
    >
      <form id="doc-cancel" onSubmit={submit} noValidate className="flex flex-col gap-3">
        <FormField label={t('cancelReason')} required error={touched && !reason.trim() ? tc('requiredField') : fieldError(action.error, 'reason')}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={2000} />
        </FormField>
        <FormError message={generalError(action.error, tc('error'))} />
      </form>
    </Dialog>
  );
}

export function RegisterDialog({ doc, open, onOpenChange }: { doc: DocumentDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('documents.card');
  const tc = useTranslations('common');
  const action = useDocumentAction(doc.id);
  const [number, setNumber] = useState('');
  const [date, setDate] = useState('');
  useEffect(() => {
    if (open) {
      setNumber(doc.number ?? '');
      setDate(doc.registeredAt ?? '');
      action.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    action.mutate(
      { kind: 'register', number: number.trim() && number.trim() !== doc.number ? number.trim() : undefined, registeredAt: date || undefined },
      {
        onSuccess: (d) => {
          toast.success(t('registeredToast', { number: d.number ?? '' }));
          onOpenChange(false);
        },
      },
    );
  };
  const conflict = isApiError(action.error) && action.error.code === 'CONFLICT';
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={t('registerTitle')}
      description={t('registerText')}
      dismissible={!action.isPending}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={action.isPending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="doc-register" loading={action.isPending}>
            {t('register')}
          </Button>
        </>
      }
    >
      <form id="doc-register" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FormField label={t('number')} hint={t('numberHint')} error={conflict ? t('numberTaken') : fieldError(action.error, 'number')}>
          <Input value={number} onChange={(e) => setNumber(e.target.value)} maxLength={60} placeholder={t('numberAuto')} />
        </FormField>
        <FormField label={t('registeredAt')} hint={t('backdateHint')} error={fieldError(action.error, 'registeredAt')}>
          <DatePicker value={date} max={today()} onChange={setDate} />
        </FormField>
        {!conflict && <FormError message={generalError(action.error, tc('error'))} />}
      </form>
    </Dialog>
  );
}

export function PaperSignedDialog({ doc, open, onOpenChange }: { doc: DocumentDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('documents.card');
  const tc = useTranslations('common');
  const paper = usePaperSigned(doc.id);
  const [file, setFile] = useState<File | null>(null);
  const [date, setDate] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (open) {
      setFile(null);
      setDate('');
      setProgress(null);
      setTouched(false);
      paper.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!file) return;
    paper.mutate(
      { file, registeredAt: date || undefined, onProgress: setProgress },
      {
        onSuccess: () => {
          toast.success(t('paperToast'));
          onOpenChange(false);
        },
        onSettled: () => setProgress(null),
      },
    );
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('paperTitle')}
      description={t('paperText')}
      dismissible={!paper.isPending}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={paper.isPending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="doc-paper" loading={paper.isPending}>
            {t('paperSubmit')}
          </Button>
        </>
      }
    >
      <form id="doc-paper" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-fg">
            {t('scan')} <span className="text-red-fg" aria-hidden>*</span>
          </span>
          <FileDropzone
            accept={['.pdf', '.jpg', '.jpeg', '.png']}
            onFiles={(f) => setFile(f[0] ?? null)}
            files={file ? [file] : []}
            onRemove={() => setFile(null)}
            progress={progress}
          />
          {touched && !file && (
            <p role="alert" className="text-xs font-medium text-red-fg">
              {t('scanRequired')}
            </p>
          )}
        </div>
        <FormField label={t('registeredAt')} hint={t('backdateHint')}>
          <DatePicker value={date} max={today()} onChange={setDate} />
        </FormField>
        <FormError message={generalError(paper.error, tc('error'))} />
      </form>
    </Dialog>
  );
}

/** Edit title / due date / data of a DRAFT or REWORK document (regenerates the PDF). */
export function EditDocumentDialog({ doc, open, onOpenChange }: { doc: DocumentDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('documents.card');
  const tn = useTranslations('documents.new');
  const tc = useTranslations('common');
  const { access } = useCurrentUser();
  const manage = can(access, 'document.manage');
  const types = useDocumentTypes({}, { enabled: open });
  const templateId = types.data?.find((x) => x.id === doc.type.id)?.templateId;
  const template = useDocumentTemplate(templateId, { enabled: open && manage });
  const action = useDocumentAction(doc.id);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});

  const fields = useMemo<DataField[]>(() => {
    const fromTemplate = extractDataFields(template.data?.body);
    const known = new Set(fromTemplate.map((f) => f.key));
    const extra: DataField[] = Object.entries(doc.data)
      .filter(([k, v]) => !known.has(k) && !/Id$/.test(k) && (typeof v === 'string' || typeof v === 'number'))
      .map(([k, v]) => ({ key: k, kind: typeof v === 'number' ? 'number' : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? 'date' : 'text', optional: true }));
    return [...fromTemplate, ...extra];
  }, [template.data, doc.data]);

  useEffect(() => {
    if (open) {
      setTitle(doc.title);
      setDue(doc.dueAt ? doc.dueAt.slice(0, 10) : '');
      setValues(Object.fromEntries(Object.entries(doc.data).map(([k, v]) => [k, v === null || v === undefined ? '' : String(v)])));
      action.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const data = { ...doc.data, ...toDataPayload(fields, values) };
    for (const f of fields) if (!(values[f.key] ?? '').trim()) delete data[f.key];
    action.mutate(
      { kind: 'update', input: { title: title.trim() || undefined, dueAt: due ? new Date(`${due}T23:59:00`).toISOString() : null, data } },
      {
        onSuccess: () => {
          toast.success(tc('saved'));
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={t('editTitle')}
      description={t('editText')}
      dismissible={!action.isPending}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={action.isPending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="doc-edit" loading={action.isPending}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <form id="doc-edit" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={tn('docTitle')} error={fieldError(action.error, 'title')}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
          </FormField>
          <FormField label={tn('dueAt')} error={fieldError(action.error, 'dueAt')}>
            <DatePicker value={due} min={today()} onChange={setDue} />
          </FormField>
        </div>
        <DataFieldsEditor fields={fields} values={values} onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} idPrefix="edit" />
        <FormError message={generalError(action.error, tc('error'))} />
      </form>
    </Dialog>
  );
}
