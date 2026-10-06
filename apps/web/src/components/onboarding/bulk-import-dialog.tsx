'use client';

import { CheckCircle2, Download, FileSpreadsheet, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FileDropzone } from '@/components/ui/file-dropzone';
import { FormError, FormField } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { toast } from '@/components/ui/toaster';
import { isApiError } from '@/lib/api/errors';
import { useLegalEntities } from '@/lib/api/hooks/org';
import { downloadFile, useImportCandidates } from '@/lib/api/hooks/onboarding';
import type { ImportResult } from '@/lib/api/types-onboarding';

const FIELD_KEYS = ['lastName', 'firstName', 'middleName', 'iin', 'noIin', 'birthDate', 'gender', 'channels', 'email', 'phone', 'tags', 'comment', 'legalEntityId', 'file'] as const;
type FieldKey = (typeof FIELD_KEYS)[number];

/** "Массовое добавление" (M1 p7): template → fill → upload → dry-run report → create. */
export function BulkImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('onboarding.import');
  const tf = useTranslations('onboarding.form');
  const tc = useTranslations('common');
  const entities = useLegalEntities({ enabled: open });
  const imp = useImportCandidates();
  const [legalEntityId, setLegalEntityId] = useState<string | undefined>();
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [created, setCreated] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setCheck(null);
    setCreated(null);
    setError(null);
    imp.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!legalEntityId && entities.data?.length) setLegalEntityId(entities.data[0]!.id);
  }, [entities.data, legalEntityId]);

  const fieldName = (f: string) => ((FIELD_KEYS as readonly string[]).includes(f) ? tf(`labels.${f as FieldKey}`) : f);

  const run = async (dryRun: boolean, f: File | null = file) => {
    if (!f || !legalEntityId) return;
    setError(null);
    try {
      const res = await imp.mutateAsync({ file: f, legalEntityId, dryRun, onProgress: setProgress });
      if (dryRun || res.errors.length) setCheck(res);
      else {
        setCreated(res.created);
        toast.success(t('createdToast', { count: res.created }));
      }
    } catch (e) {
      setCheck(null);
      setError(
        isApiError(e) && e.code === 'UNSUPPORTED_FILE' ? t('unsupported') : isApiError(e) ? e.message : tc('error'),
      );
    } finally {
      setProgress(null);
    }
  };

  const downloadTemplate = async () => {
    setDownloading(true);
    try {
      await downloadFile('/candidates/import-template', { fallbackName: 'candidates-import.xlsx' });
    } catch (e) {
      toast.error(isApiError(e) ? e.message : tc('error'));
    } finally {
      setDownloading(false);
    }
  };

  const valid = check && check.errors.length === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={t('title')}
      dismissible={!imp.isPending}
      footer={
        created !== null ? (
          <Button onClick={() => onOpenChange(false)}>{tc('close')}</Button>
        ) : (
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={imp.isPending}>
              {tc('cancel')}
            </Button>
            <Button onClick={() => run(false)} loading={imp.isPending && progress !== null && Boolean(valid)} disabled={!valid || imp.isPending}>
              {t('create')}
            </Button>
          </>
        )
      }
    >
      {created !== null ? (
        <div className="flex items-start gap-3 rounded-lg border border-green-border bg-green-bg p-4 text-green-fg" aria-live="polite">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />
          <p className="text-sm font-medium">{t('created', { count: created })}</p>
        </div>
      ) : (
        <ol className="grid gap-5">
          <li className="grid gap-2">
            <h3 className="text-sm font-semibold text-fg">{t('step1')}</h3>
            <p className="text-[13px] text-fg-muted">{t('step1Text')}</p>
            <div>
              <Button variant="outline" onClick={downloadTemplate} loading={downloading}>
                {!downloading && <Download />}
                {t('downloadTemplate')}
              </Button>
            </div>
          </li>
          <li className="grid gap-2">
            <h3 className="text-sm font-semibold text-fg">{t('step2')}</h3>
            <p className="text-[13px] text-fg-muted">{t('step2Text')}</p>
          </li>
          <li className="grid gap-3">
            <h3 className="text-sm font-semibold text-fg">{t('step3')}</h3>
            <FormField label={tf('labels.legalEntityId')} required>
              <Select
                value={legalEntityId}
                onValueChange={(v) => {
                  setLegalEntityId(v);
                  setCheck(null);
                }}
                options={(entities.data ?? []).map((e) => ({ value: e.id, label: e.name }))}
                placeholder={entities.isLoading ? tc('loading') : tc('select')}
              />
            </FormField>
            {file ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-[13px]">
                <FileSpreadsheet className="size-4 shrink-0 text-green-fg" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-fg">{file.name}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={tc('removeItem', { name: file.name })}
                  disabled={imp.isPending}
                  onClick={() => {
                    setFile(null);
                    setCheck(null);
                    setError(null);
                  }}
                >
                  <X />
                </Button>
              </div>
            ) : (
              <FileDropzone
                accept={['.xlsx']}
                disabled={!legalEntityId}
                label={t('dropLabel')}
                onFiles={(fs) => {
                  const f = fs[0] ?? null;
                  setFile(f);
                  void run(true, f);
                }}
              />
            )}
            {progress !== null && (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-active" role="progressbar" aria-label={t('checking')} aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}
            <FormError message={error} />
            {valid && (
              <div className="flex items-start gap-2 rounded-lg border border-green-border bg-green-bg px-3 py-2 text-[13px] font-medium text-green-fg" aria-live="polite">
                <CheckCircle2 className="mt-px size-4 shrink-0" aria-hidden />
                {t('valid')}
              </div>
            )}
            {check && check.errors.length > 0 && (
              <div className="grid gap-2" aria-live="polite">
                <p className="text-[13px] font-medium text-red-fg">{t('errorsTitle', { count: check.errors.length })}</p>
                <div className="overflow-hidden rounded-lg border border-border">
                  <TableContainer style={{ maxHeight: 260 }}>
                    <Table aria-label={t('errorsTitle', { count: check.errors.length })}>
                      <THead sticky>
                        <TR>
                          <TH className="w-16">{t('row')}</TH>
                          <TH>{t('field')}</TH>
                          <TH>{t('message')}</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {check.errors.map((er, i) => (
                          <TR key={i}>
                            <TD className="tabular">{er.row}</TD>
                            <TD className="whitespace-nowrap">{fieldName(er.field)}</TD>
                            <TD className="text-fg-muted">{er.message}</TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  </TableContainer>
                </div>
                <p className="text-xs text-fg-subtle">{t('fixAndRetry')}</p>
              </div>
            )}
          </li>
        </ol>
      )}
    </Dialog>
  );
}
