'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { RadioGroup } from '@/components/ui/checkbox';
import { MultiSelect, type ComboOption } from '@/components/ui/combobox';
import { Dialog } from '@/components/ui/dialog';
import { FormError, FormField } from '@/components/ui/label';
import { toast } from '@/components/ui/toaster';
import { isApiError } from '@/lib/api/errors';
import { searchEmployeeOptions, useAddVndRecipients } from '@/lib/api/hooks/compliance';
import { useDepartments } from '@/lib/api/hooks/org';
import type { VndDetail } from '@/lib/api/types-compliance';

type Mode = 'employees' | 'departments' | 'all';

/** "+ Добавить получателя": employees, departments (with sub-departments) or the whole legal entity. */
export function VndAddRecipientsDialog({ open, onOpenChange, vnd }: { open: boolean; onOpenChange: (o: boolean) => void; vnd: VndDetail }) {
  const t = useTranslations('vnd.add');
  const tc = useTranslations('common');
  const add = useAddVndRecipients(vnd.id);
  const departments = useDepartments(vnd.legalEntity.id);
  const [mode, setMode] = useState<Mode>('employees');
  const [employees, setEmployees] = useState<string[]>([]);
  const [employeeOptions, setEmployeeOptions] = useState<ComboOption[]>([]);
  const [depts, setDepts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setMode('employees');
    setEmployees([]);
    setEmployeeOptions([]);
    setDepts([]);
    setError(null);
  };
  const close = (o: boolean) => {
    if (add.isPending) return;
    onOpenChange(o);
    if (!o) reset();
  };

  const submit = () => {
    setError(null);
    const input =
      mode === 'employees' ? { employeeIds: employees } : mode === 'departments' ? { departmentIds: depts } : { allOfLegalEntity: true };
    if ((mode === 'employees' && !employees.length) || (mode === 'departments' && !depts.length)) {
      setError(mode === 'employees' ? t('pickEmployees') : t('pickDepartments'));
      return;
    }
    add.mutate(input, {
      onSuccess: (r) => {
        if (r.added === 0) toast.info(t('noneAdded'));
        else if (r.added === 1) toast.success(t('addedOne'));
        else toast.success(t('addedMany', { count: r.added }));
        close(false);
      },
      onError: (e) => setError(isApiError(e) ? e.message : tc('error')),
    });
  };

  const deptOptions = (departments.data ?? []).map((d) => ({
    value: d.id,
    label: d.name,
    description: t('employeesCount', { count: d.employeeCount }),
  }));

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={t('title')}
      description={vnd.status === 'DRAFT' ? t('descriptionDraft') : t('descriptionSent')}
      dismissible={!add.isPending}
      footer={
        <>
          <Button variant="outline" onClick={() => close(false)} disabled={add.isPending}>
            {tc('cancel')}
          </Button>
          <Button onClick={submit} loading={add.isPending}>
            {t('submit')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4" data-dialog-body>
        <FormError message={error} />
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-[13px] font-medium text-fg">{t('mode')}</legend>
          <RadioGroup
            value={mode}
            onValueChange={(v) => {
              setMode(v as Mode);
              setError(null);
            }}
            orientation="horizontal"
            options={[
              { value: 'employees', label: t('modeEmployees') },
              { value: 'departments', label: t('modeDepartments') },
              { value: 'all', label: t('modeAll') },
            ]}
          />
        </fieldset>
        {mode === 'employees' && (
          <FormField label={t('employees')} hint={t('employeesHint', { entity: vnd.legalEntity.name })}>
            <MultiSelect
              value={employees}
              onChange={(v, opts) => {
                setEmployees(v);
                setEmployeeOptions(opts);
              }}
              selectedOptions={employeeOptions}
              loadOptions={(q, signal) => searchEmployeeOptions(q, vnd.legalEntity.id, signal)}
              placeholder={t('employeesPlaceholder')}
              searchPlaceholder={t('employeesSearch')}
            />
          </FormField>
        )}
        {mode === 'departments' && (
          <FormField label={t('departments')} hint={t('departmentsHint')}>
            <MultiSelect value={depts} onChange={(v) => setDepts(v)} options={deptOptions} placeholder={t('departmentsPlaceholder')} />
          </FormField>
        )}
        {mode === 'all' && (
          <p className="rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-[13px] text-fg-muted">
            {t('allText', { entity: vnd.legalEntity.name })}
          </p>
        )}
      </div>
    </Dialog>
  );
}
