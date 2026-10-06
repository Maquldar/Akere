'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox, RadioGroup } from '@/components/ui/checkbox';
import { Dialog } from '@/components/ui/dialog';
import { FormError, Label } from '@/components/ui/label';
import { toast } from '@/components/ui/toaster';
import { isApiError } from '@/lib/api/errors';
import { useExportCandidates } from '@/lib/api/hooks/onboarding';
import type { ExportFormat } from '@/lib/api/types-onboarding';

/** "Выгрузить в 1С" (F-13): selected candidates or all accepted ones → json / xml / xlsx file. */
export function ExportDialog({
  open,
  onOpenChange,
  candidateIds,
  canMark,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  candidateIds?: string[];
  canMark: boolean;
}) {
  const t = useTranslations('onboarding.export');
  const tc = useTranslations('common');
  const exp = useExportCandidates();
  const [format, setFormat] = useState<ExportFormat>('xlsx');
  const [mark, setMark] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setMark(false);
    }
  }, [open]);

  const submit = async () => {
    setError(null);
    try {
      await exp.mutateAsync({ candidateIds: candidateIds?.length ? candidateIds : undefined, format, markExported: canMark && mark });
      toast.success(canMark && mark ? t('doneMarked') : t('done'));
      onOpenChange(false);
    } catch (e) {
      setError(isApiError(e) ? e.message : tc('error'));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={t('title')}
      description={candidateIds?.length ? t('scopeSelected', { count: candidateIds.length }) : t('scopeAccepted')}
      dismissible={!exp.isPending}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={exp.isPending}>
            {tc('cancel')}
          </Button>
          <Button onClick={submit} loading={exp.isPending}>
            {t('download')}
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <FormError message={error} />
        <div className="grid gap-2">
          <Label id="export-format">{t('format')}</Label>
          <RadioGroup
            aria-labelledby="export-format"
            value={format}
            onValueChange={(v) => setFormat(v as ExportFormat)}
            options={[
              { value: 'xlsx', label: 'XLSX', description: t('xlsxHint') },
              { value: 'json', label: 'JSON', description: t('jsonHint') },
              { value: 'xml', label: 'XML', description: t('xmlHint') },
            ]}
          />
        </div>
        {canMark && <Checkbox label={t('mark')} description={t('markHint')} checked={mark} onCheckedChange={(v) => setMark(v === true)} />}
      </div>
    </Dialog>
  );
}
