'use client';

import { Archive, CheckCircle2, ExternalLink, FileText, FolderOpen, RotateCcw, Trash2, UploadCloud, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker';
import { FileDropzone } from '@/components/ui/file-dropzone';
import { Input } from '@/components/ui/input';
import { FormError, FormField } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { toast } from '@/components/ui/toaster';
import { RequireAccess } from '@/components/shell/require-access';
import { Link } from '@/i18n/navigation';
import { isApiError } from '@/lib/api/errors';
import { searchEmployeeOptions, useArchiveUpload, useDocumentTypes } from '@/lib/api/hooks/compliance';
import { useLegalEntities } from '@/lib/api/hooks/org';
import type { ArchiveItemInput, ArchiveResult } from '@/lib/api/types-compliance';
import { can } from '@/lib/permissions';
import { cn, formatBytes } from '@/lib/utils';

const ACCEPT = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.heic'];
const MAX_FILES = 50;

type Row = {
  key: string;
  file: File;
  documentTypeId: string;
  legalEntityId: string;
  title: string;
  number: string;
  registeredAt: string;
  subjectEmployeeId: string | null;
  subjectOption: ComboOption | null;
};
type RowErrors = Partial<Record<'documentTypeId' | 'legalEntityId' | 'title' | 'registeredAt', string>>;

const stripExt = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim().slice(0, 300);

/** /archive — bulk upload of archival (paper-signed) documents with metadata (F-25, API.md §7 POST /documents/archive). */
export function ArchiveUpload() {
  const t = useTranslations('archive');
  const tc = useTranslations('common');
  const entities = useLegalEntities();
  const types = useDocumentTypes();
  const upload = useArchiveUpload();
  const [rows, setRows] = useState<Row[]>([]);
  const [errors, setErrors] = useState<Record<string, RowErrors>>({});
  const [defaults, setDefaults] = useState({ documentTypeId: '', legalEntityId: '', registeredAt: '' });
  const [progress, setProgress] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<{ result: ArchiveResult; rows: Row[] } | null>(null);

  const typeOptions = useMemo(() => {
    const list = (types.data ?? []).filter((x) => x.isActive);
    // Archive types first, then the rest alphabetically.
    list.sort((a, b) => Number(b.kind === 'ARCHIVE') - Number(a.kind === 'ARCHIVE') || a.name.localeCompare(b.name));
    return list.map((x) => ({ value: x.id, label: x.name }));
  }, [types.data]);
  const entityOptions = (entities.data ?? []).map((e) => ({ value: e.id, label: e.name }));
  const defaultEntity = defaults.legalEntityId || (entityOptions.length === 1 ? entityOptions[0]!.value : '');

  const addFiles = (files: File[]) => {
    setFormError(null);
    const room = MAX_FILES - rows.length;
    if (files.length > room) toast.warning(t('tooMany', { max: MAX_FILES }));
    const next = files.slice(0, Math.max(0, room)).map<Row>((file) => ({
      key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
      file,
      documentTypeId: defaults.documentTypeId,
      legalEntityId: defaultEntity,
      title: stripExt(file.name),
      number: '',
      registeredAt: defaults.registeredAt,
      subjectEmployeeId: null,
      subjectOption: null,
    }));
    setRows((r) => [...r, ...next]);
  };

  const patch = (key: string, p: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
    setErrors((es) => {
      if (!es[key]) return es;
      const e = { ...es[key] };
      for (const k of Object.keys(p)) delete e[k as keyof RowErrors];
      return { ...es, [key]: e };
    });
  };

  const applyDefaults = () => {
    setRows((rs) =>
      rs.map((r) => ({
        ...r,
        documentTypeId: defaults.documentTypeId || r.documentTypeId,
        legalEntityId: defaults.legalEntityId || r.legalEntityId,
        registeredAt: defaults.registeredAt || r.registeredAt,
      })),
    );
    setErrors({});
  };

  const validate = () => {
    const out: Record<string, RowErrors> = {};
    const today = new Date().toISOString().slice(0, 10);
    for (const r of rows) {
      const e: RowErrors = {};
      if (!r.documentTypeId) e.documentTypeId = tc('requiredField');
      if (!r.legalEntityId) e.legalEntityId = tc('requiredField');
      if (!r.title.trim()) e.title = tc('requiredField');
      if (!r.registeredAt) e.registeredAt = tc('requiredField');
      else if (r.registeredAt > today) e.registeredAt = t('dateInFuture');
      if (Object.keys(e).length) out[r.key] = e;
    }
    setErrors(out);
    return Object.keys(out).length === 0;
  };

  const submit = async () => {
    setFormError(null);
    if (!rows.length) {
      setFormError(t('noFiles'));
      return;
    }
    if (!validate()) {
      setFormError(t('fixErrors'));
      return;
    }
    const meta: ArchiveItemInput[] = rows.map((r) => ({
      documentTypeId: r.documentTypeId,
      legalEntityId: r.legalEntityId,
      title: r.title.trim(),
      number: r.number.trim() || undefined,
      registeredAt: r.registeredAt,
      subjectEmployeeId: r.subjectEmployeeId ?? undefined,
    }));
    try {
      const res = await upload.mutateAsync({ files: rows.map((r) => r.file), meta, onProgress: setProgress });
      setResult({ result: res, rows });
      setProgress(null);
      if (res.documentIds.length) toast.success(t('uploaded', { count: res.documentIds.length }));
      if (res.errors.length) toast.warning(t('uploadedWithErrors', { count: res.errors.length }));
    } catch (e) {
      setProgress(null);
      if (isApiError(e) && e.code === 'VALIDATION_ERROR') {
        // Server keys look like "2.title" / "meta.2.title".
        const out: Record<string, RowErrors> = {};
        for (const [k, msgs] of Object.entries(e.fieldErrors)) {
          const m = /(?:^|\.)(\d+)\.(\w+)$/.exec(k);
          const row = m ? rows[Number(m[1])] : undefined;
          if (row && m) out[row.key] = { ...out[row.key], [m[2] as keyof RowErrors]: msgs[0] };
        }
        setErrors(out);
        setFormError([...e.formErrors, Object.keys(out).length ? t('fixErrors') : e.message].filter(Boolean).join(' '));
      } else setFormError(isApiError(e) ? e.message : tc('error'));
    }
  };

  const reset = () => {
    setRows([]);
    setErrors({});
    setResult(null);
    setFormError(null);
  };

  const header = (
    <PageHeader
      title={t('title')}
      subtitle={t('subtitle')}
      actions={
        <Button asChild variant="outline">
          <Link href={{ pathname: '/documents', query: { box: 'archive' } }}>
            <FolderOpen aria-hidden />
            {t('openArchive')}
          </Link>
        </Button>
      }
    />
  );

  if (result) {
    const failedIdx = new Map(result.result.errors.map((e) => [e.index, e.message]));
    let created = 0;
    const items = result.rows.map((r, i) => {
      const err = failedIdx.get(i);
      const id = err === undefined ? result.result.documentIds[created++] : undefined;
      return { r, err, id };
    });
    return (
      <RequireAccess allow={(a) => can(a, 'document.manage')}>
        {header}
        <Card>
          <CardHeader
            title={t('resultTitle')}
            actions={
              <Button variant="outline" size="sm" onClick={reset}>
                <RotateCcw aria-hidden />
                {t('uploadMore')}
              </Button>
            }
          />
          <CardBody className="grid gap-4">
            <div className="flex flex-wrap gap-3 text-sm" role="status">
              <span className="inline-flex items-center gap-1.5 font-medium text-green-fg">
                <CheckCircle2 className="size-4" aria-hidden />
                {t('resultOk', { count: result.result.documentIds.length })}
              </span>
              {result.result.errors.length > 0 && (
                <span className="inline-flex items-center gap-1.5 font-medium text-red-fg">
                  <XCircle className="size-4" aria-hidden />
                  {t('resultFailed', { count: result.result.errors.length })}
                </span>
              )}
            </div>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {items.map(({ r, err, id }) => (
                <li key={r.key} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  {err === undefined ? (
                    <CheckCircle2 className="size-4 shrink-0 text-green-fg" aria-label={t('ok')} />
                  ) : (
                    <XCircle className="size-4 shrink-0 text-red-fg" aria-label={t('error')} />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-fg">{r.title}</div>
                    <div className={cn('truncate text-xs', err === undefined ? 'text-fg-subtle' : 'text-red-fg')}>{err ?? r.file.name}</div>
                  </div>
                  {id && (
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/documents/${id}`}>
                        <ExternalLink aria-hidden />
                        {t('openDocument')}
                      </Link>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </RequireAccess>
    );
  }

  return (
    <RequireAccess allow={(a) => can(a, 'document.manage')}>
      {header}
      <div className="grid gap-5">
        <Card>
          <CardHeader title={t('step1')} />
          <CardBody className="grid gap-4">
            <FileDropzone accept={ACCEPT} multiple onFiles={addFiles} label={t('dropLabel')} disabled={upload.isPending} />
            <div className="grid gap-3 rounded-lg border border-border bg-surface-muted p-3 sm:grid-cols-[1fr_1fr_180px_auto] sm:items-end">
              <FormField label={t('defaultType')}>
                <Select
                  value={defaults.documentTypeId || undefined}
                  onValueChange={(v) => setDefaults((d) => ({ ...d, documentTypeId: v }))}
                  placeholder={tc('select')}
                  options={typeOptions}
                />
              </FormField>
              <FormField label={t('defaultEntity')}>
                <Select
                  value={defaultEntity || undefined}
                  onValueChange={(v) => setDefaults((d) => ({ ...d, legalEntityId: v }))}
                  placeholder={tc('select')}
                  options={entityOptions}
                />
              </FormField>
              <FormField label={t('defaultDate')}>
                <DatePicker
                  value={defaults.registeredAt}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(v) => setDefaults((d) => ({ ...d, registeredAt: v }))}
                />
              </FormField>
              <Button variant="outline" onClick={applyDefaults} disabled={!rows.length}>
                {t('applyToAll')}
              </Button>
              <p className="text-xs text-fg-subtle sm:col-span-4">{t('defaultsHint')}</p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('step2')} count={rows.length} />
          {rows.length === 0 ? (
            <CardBody>
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <span className="flex size-11 items-center justify-center rounded-xl border border-border bg-surface-muted text-fg-subtle">
                  <Archive className="size-5" aria-hidden />
                </span>
                <p className="text-sm font-semibold text-fg">{t('emptyTitle')}</p>
                <p className="max-w-sm text-[13px] text-fg-muted">{t('emptyText')}</p>
              </div>
            </CardBody>
          ) : (
            <TableContainer className="max-h-[60dvh]">
              <Table aria-label={t('step2')}>
                <THead sticky>
                  <TR>
                    <TH>{t('colFile')}</TH>
                    <TH>{t('colType')} *</TH>
                    <TH>{t('colEntity')} *</TH>
                    <TH>{t('colTitle')} *</TH>
                    <TH>{t('colNumber')}</TH>
                    <TH>{t('colDate')} *</TH>
                    <TH>{t('colEmployee')}</TH>
                    <TH>
                      <span className="sr-only">{tc('actions')}</span>
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((r, i) => {
                    const e = errors[r.key] ?? {};
                    return (
                      <TR key={r.key} className="align-top">
                        <TD className="min-w-[160px] max-w-[220px]">
                          <div className="flex items-start gap-2 pt-1.5">
                            <FileText className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
                            <div className="min-w-0">
                              <div className="truncate text-[13px] font-medium text-fg" title={r.file.name}>
                                {r.file.name}
                              </div>
                              <div className="text-xs text-fg-subtle tabular">{formatBytes(r.file.size)}</div>
                            </div>
                          </div>
                        </TD>
                        <TD className="min-w-[200px]">
                          <CellField error={e.documentTypeId}>
                            <Select
                              size="sm"
                              aria-label={t('rowLabel', { field: t('colType'), n: i + 1 })}
                              aria-invalid={e.documentTypeId ? true : undefined}
                              value={r.documentTypeId || undefined}
                              onValueChange={(v) => patch(r.key, { documentTypeId: v })}
                              placeholder={tc('select')}
                              options={typeOptions}
                            />
                          </CellField>
                        </TD>
                        <TD className="min-w-[180px]">
                          <CellField error={e.legalEntityId}>
                            <Select
                              size="sm"
                              aria-label={t('rowLabel', { field: t('colEntity'), n: i + 1 })}
                              aria-invalid={e.legalEntityId ? true : undefined}
                              value={r.legalEntityId || undefined}
                              onValueChange={(v) => patch(r.key, { legalEntityId: v, subjectEmployeeId: null, subjectOption: null })}
                              placeholder={tc('select')}
                              options={entityOptions}
                            />
                          </CellField>
                        </TD>
                        <TD className="min-w-[220px]">
                          <CellField error={e.title}>
                            <Input
                              inputSize="sm"
                              aria-label={t('rowLabel', { field: t('colTitle'), n: i + 1 })}
                              aria-invalid={e.title ? true : undefined}
                              value={r.title}
                              maxLength={300}
                              onChange={(ev) => patch(r.key, { title: ev.target.value })}
                            />
                          </CellField>
                        </TD>
                        <TD className="min-w-[120px]">
                          <Input
                            inputSize="sm"
                            aria-label={t('rowLabel', { field: t('colNumber'), n: i + 1 })}
                            value={r.number}
                            maxLength={60}
                            placeholder={t('numberAuto')}
                            onChange={(ev) => patch(r.key, { number: ev.target.value })}
                          />
                        </TD>
                        <TD className="min-w-[150px]">
                          <CellField error={e.registeredAt}>
                            <DatePicker
                              inputSize="sm"
                              aria-label={t('rowLabel', { field: t('colDate'), n: i + 1 })}
                              aria-invalid={e.registeredAt ? true : undefined}
                              value={r.registeredAt}
                              max={new Date().toISOString().slice(0, 10)}
                              onChange={(v) => patch(r.key, { registeredAt: v })}
                            />
                          </CellField>
                        </TD>
                        <TD className="min-w-[220px]">
                          <Combobox
                            size="sm"
                            aria-label={t('rowLabel', { field: t('colEmployee'), n: i + 1 })}
                            value={r.subjectEmployeeId}
                            selectedOption={r.subjectOption}
                            onChange={(v, o) => patch(r.key, { subjectEmployeeId: v, subjectOption: o })}
                            loadOptions={(q, signal) => searchEmployeeOptions(q, r.legalEntityId || undefined, signal)}
                            placeholder={t('employeeNone')}
                            clearable
                          />
                        </TD>
                        <TD className="w-10">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={tc('removeItem', { name: r.file.name })}
                            onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                            disabled={upload.isPending}
                          >
                            <Trash2 />
                          </Button>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableContainer>
          )}
          <CardFooter className="flex-wrap justify-between">
            <div className="min-w-0 flex-1">
              <FormError message={formError} />
              {progress !== null && (
                <div className="flex items-center gap-2 text-xs text-fg-muted" role="status">
                  <div className="h-1.5 w-40 overflow-hidden rounded-full bg-surface-active">
                    <div className="h-full bg-primary" style={{ width: `${Math.round(progress * 100)}%` }} />
                  </div>
                  {Math.round(progress * 100)}%
                </div>
              )}
            </div>
            <div className="flex gap-2">
              {rows.length > 0 && (
                <Button variant="ghost" onClick={reset} disabled={upload.isPending}>
                  {tc('clear')}
                </Button>
              )}
              <Button onClick={submit} loading={upload.isPending} disabled={!rows.length}>
                <UploadCloud />
                {t('submit')}
              </Button>
            </div>
          </CardFooter>
        </Card>
      </div>
    </RequireAccess>
  );
}

function CellField({ error, children }: { error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      {children}
      {error && (
        <span role="alert" className="text-xs font-medium text-red-fg">
          {error}
        </span>
      )}
    </div>
  );
}
