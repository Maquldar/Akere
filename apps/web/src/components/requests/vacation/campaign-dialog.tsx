'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { FormError, FormField } from '@/components/ui/label';
import { toast } from '@/components/ui/toaster';
import { isApiError } from '@/lib/api/errors';
import { useSaveCampaign } from '@/lib/api/hooks/requests';
import type { CampaignView } from '@/lib/api/types-requests';
import { useRequestErrorText } from '../shared';

/** HR: open a yearly planning campaign. */
export function CampaignDialog({
  existingYears,
  onOpenChange,
  onCreated,
}: {
  existingYears: number[];
  onOpenChange: (o: boolean) => void;
  onCreated: (c: CampaignView) => void;
}) {
  const t = useTranslations('vacation.campaign');
  const tc = useTranslations('common');
  const errorText = useRequestErrorText();
  const save = useSaveCampaign();
  const nextYear = new Date().getFullYear() + 1;
  const [year, setYear] = useState(String(existingYears.includes(nextYear) ? Math.max(nextYear, ...existingYears) + 1 : nextYear));
  const [deadline, setDeadline] = useState('');
  const [errors, setErrors] = useState<{ year?: string; deadline?: string; root?: string }>({});

  const submit = () => {
    const y = Number(year);
    const next: typeof errors = {};
    if (!Number.isInteger(y) || y < 2000 || y > 2100) next.year = t('yearInvalid');
    else if (existingYears.includes(y)) next.year = t('yearExists', { year: y });
    if (deadline && y && deadline.slice(0, 4) > String(y)) next.deadline = t('deadlineLate');
    setErrors(next);
    if (Object.keys(next).length) return;
    save.mutate(
      { input: { year: y, deadline: deadline || null } },
      {
        onSuccess: (c) => {
          toast.success(t('created', { year: c.year }));
          onCreated(c);
          onOpenChange(false);
        },
        onError: (e) => {
          if (isApiError(e) && e.code === 'VALIDATION_ERROR') {
            setErrors({ year: e.fieldErrors.year?.[0], deadline: e.fieldErrors.deadline?.[0], root: e.formErrors.join(' ') || undefined });
          } else if (isApiError(e) && e.code === 'CONFLICT') {
            setErrors({ year: t('yearExists', { year: y }) });
          } else {
            setErrors({ root: errorText(e) });
          }
        },
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={t('title')}
      description={t('description')}
      size="sm"
      dismissible={!save.isPending}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            {tc('cancel')}
          </Button>
          <Button onClick={submit} loading={save.isPending}>
            {t('create')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <FormError message={errors.root} />
        <FormField label={t('year')} required error={errors.year}>
          <Input type="number" inputMode="numeric" min={2000} max={2100} value={year} onChange={(e) => setYear(e.target.value)} />
        </FormField>
        <FormField label={t('deadline')} hint={t('deadlineHint')} error={errors.deadline}>
          <DatePicker value={deadline} onChange={setDeadline} />
        </FormField>
        <button type="submit" className="sr-only" tabIndex={-1}>
          {t('create')}
        </button>
      </form>
    </Dialog>
  );
}
