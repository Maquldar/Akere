'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { DatePicker } from '@/components/ui/date-picker';
import { Input, Textarea } from '@/components/ui/input';
import { FormError, FormField } from '@/components/ui/label';
import { Select, SELECT_NONE } from '@/components/ui/select';
import { toast } from '@/components/ui/toaster';
import { EmployeePicker } from '@/components/documents/employee-picker';
import { useRouter } from '@/i18n/navigation';
import { isApiError } from '@/lib/api/errors';
import { useHrEvent, useUpdateEmployee, useVacationAdjustment } from '@/lib/api/hooks/documents';
import { useDepartments, useLocations, usePositions } from '@/lib/api/hooks/org';
import type { EmployeeProfile } from '@/lib/api/types-documents';

const today = () => new Date().toISOString().slice(0, 10);
type Errs = Record<string, string | undefined>;

function serverErrors(e: unknown): { fields: Errs; form: string | null } {
  if (!isApiError(e)) return { fields: {}, form: e ? 'error' : null };
  if (e.code === 'VALIDATION_ERROR') {
    const fields = Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k, v[0]]));
    return { fields, form: e.formErrors.join(' ') || null };
  }
  return { fields: {}, form: e.message };
}

/** Перевод (F-30): generates a transfer order and starts its route, then opens it. */
export function TransferDialog({ employee, open, onOpenChange }: { employee: EmployeeProfile; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('employees.transfer');
  const tc = useTranslations('common');
  const router = useRouter();
  const ev = useHrEvent(employee.id);
  const departments = useDepartments(open ? employee.legalEntity.id : undefined);
  const positions = usePositions();
  const [date, setDate] = useState(today());
  const [dept, setDept] = useState(SELECT_NONE);
  const [pos, setPos] = useState(SELECT_NONE);
  const [manager, setManager] = useState<string | null>(null);
  const [salary, setSalary] = useState('');
  const [reason, setReason] = useState('');
  const [errs, setErrs] = useState<Errs>({});

  useEffect(() => {
    if (open) {
      setDate(today());
      setDept(SELECT_NONE);
      setPos(SELECT_NONE);
      setManager(null);
      setSalary('');
      setReason('');
      setErrs({});
      ev.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const salaryNum = salary.trim() ? Number(salary.replace(/\s/g, '').replace(',', '.')) : undefined;
    const next: Errs = {};
    if (!date) next.effectiveDate = tc('requiredField');
    if (salaryNum !== undefined && (!Number.isFinite(salaryNum) || salaryNum <= 0)) next.salary = t('badSalary');
    if (dept === SELECT_NONE && pos === SELECT_NONE && !manager && salaryNum === undefined) next.form = t('nothing');
    setErrs(next);
    if (Object.keys(next).length) return;
    ev.mutate(
      {
        kind: 'transfer',
        input: {
          effectiveDate: date,
          departmentId: dept === SELECT_NONE ? undefined : dept,
          positionId: pos === SELECT_NONE ? undefined : pos,
          managerId: manager ?? undefined,
          salary: salaryNum,
          reason: reason.trim() || undefined,
        },
      },
      {
        onSuccess: (doc) => {
          toast.success(t('created', { number: doc.number ?? '' }));
          onOpenChange(false);
          router.push(`/documents/${doc.id}`);
        },
        onError: (err) => {
          const s = serverErrors(err);
          setErrs({ ...s.fields, form: s.form === 'error' ? tc('error') : (s.form ?? undefined) });
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('title')}
      description={t('text', { name: employee.fullName })}
      dismissible={!ev.isPending}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={ev.isPending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="transfer-form" loading={ev.isPending}>
            {t('submit')}
          </Button>
        </>
      }
    >
      <form id="transfer-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-[13px] text-fg-muted">
          {t('current')}: <span className="font-medium text-fg">{[employee.position?.name, employee.department?.name].filter(Boolean).join(' · ') || '—'}</span>
        </div>
        <FormField label={t('effectiveDate')} required error={errs.effectiveDate}>
          <DatePicker value={date} onChange={setDate} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('department')} error={errs.departmentId}>
            <Select
              value={dept}
              onValueChange={setDept}
              options={[{ value: SELECT_NONE, label: t('noChange') }, ...(departments.data ?? []).filter((d) => d.id !== employee.department?.id).map((d) => ({ value: d.id, label: d.name }))]}
            />
          </FormField>
          <FormField label={t('position')} error={errs.positionId}>
            <Select
              value={pos}
              onValueChange={setPos}
              options={[{ value: SELECT_NONE, label: t('noChange') }, ...(positions.data ?? []).filter((p) => p.id !== employee.position?.id).map((p) => ({ value: p.id, label: p.name }))]}
            />
          </FormField>
          <FormField label={t('manager')} error={errs.managerId}>
            <EmployeePicker value={manager} onChange={(v) => setManager(v)} excludeIds={[employee.id]} placeholder={t('noChange')} />
          </FormField>
          <FormField label={t('salary')} hint={t('salaryHint')} error={errs.salary}>
            <Input inputMode="decimal" value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="450 000" />
          </FormField>
        </div>
        <FormField label={t('reason')} error={errs.reason}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000} placeholder={t('reasonPlaceholder')} />
        </FormField>
        <FormError message={errs.form} />
        <p className="text-xs text-fg-subtle">{t('note')}</p>
      </form>
    </Dialog>
  );
}

/** Увольнение (F-30): dismissal order into its route. */
export function DismissalDialog({ employee, open, onOpenChange }: { employee: EmployeeProfile; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('employees.dismissal');
  const tc = useTranslations('common');
  const router = useRouter();
  const ev = useHrEvent(employee.id);
  const [date, setDate] = useState(today());
  const [article, setArticle] = useState('');
  const [reason, setReason] = useState('');
  const [errs, setErrs] = useState<Errs>({});
  const articles = [t('art49'), t('art52'), t('art56'), t('art58')];

  useEffect(() => {
    if (open) {
      setDate(today());
      setArticle('');
      setReason('');
      setErrs({});
      ev.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Errs = {};
    if (!date) next.effectiveDate = tc('requiredField');
    if (!article.trim()) next.article = tc('requiredField');
    if (!reason.trim()) next.reason = tc('requiredField');
    setErrs(next);
    if (Object.keys(next).length) return;
    ev.mutate(
      { kind: 'dismissal', input: { effectiveDate: date, article: article.trim(), reason: reason.trim() } },
      {
        onSuccess: (doc) => {
          toast.success(t('created', { number: doc.number ?? '' }));
          onOpenChange(false);
          router.push(`/documents/${doc.id}`);
        },
        onError: (err) => {
          const s = serverErrors(err);
          const rule = isApiError(err) ? err.rule : null;
          setErrs({
            ...s.fields,
            effectiveDate: rule === 'BEFORE_HIRE_DATE' ? t('beforeHire') : s.fields.effectiveDate,
            form: rule === 'BEFORE_HIRE_DATE' ? undefined : s.form === 'error' ? tc('error') : (s.form ?? undefined),
          });
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('title')}
      description={t('text', { name: employee.fullName })}
      dismissible={!ev.isPending}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={ev.isPending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="dismissal-form" variant="danger" loading={ev.isPending}>
            {t('submit')}
          </Button>
        </>
      }
    >
      <form id="dismissal-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FormField label={t('effectiveDate')} required error={errs.effectiveDate}>
          <DatePicker value={date} min={employee.hireDate} onChange={setDate} />
        </FormField>
        <FormField label={t('article')} required hint={t('articleHint')} error={errs.article}>
          <Input value={article} onChange={(e) => setArticle(e.target.value)} list="dismissal-articles" maxLength={200} />
        </FormField>
        <datalist id="dismissal-articles">
          {articles.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
        <FormField label={t('reason')} required error={errs.reason}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000} placeholder={t('reasonPlaceholder')} />
        </FormField>
        <FormError message={errs.form} />
        <p className="text-xs text-fg-subtle">{t('note')}</p>
      </form>
    </Dialog>
  );
}

/** EmployeeUpdate (HR): place of work and vacation entitlement. */
export function EditEmployeeDialog({ employee, open, onOpenChange }: { employee: EmployeeProfile; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('employees.edit');
  const tc = useTranslations('common');
  const update = useUpdateEmployee(employee.id);
  const departments = useDepartments(open ? employee.legalEntity.id : undefined);
  const positions = usePositions();
  const locations = useLocations();
  const [dept, setDept] = useState(SELECT_NONE);
  const [pos, setPos] = useState(SELECT_NONE);
  const [loc, setLoc] = useState(SELECT_NONE);
  const [manager, setManager] = useState<string | null>(null);
  const [managerLabel, setManagerLabel] = useState<string | null>(null);
  const [tab, setTab] = useState('');
  const [days, setDays] = useState('');
  const [errs, setErrs] = useState<Errs>({});

  useEffect(() => {
    if (open) {
      setDept(employee.department?.id ?? SELECT_NONE);
      setPos(employee.position?.id ?? SELECT_NONE);
      setLoc(employee.location?.id ?? SELECT_NONE);
      setManager(null);
      setManagerLabel(employee.manager?.fullName ?? null);
      setTab(employee.tabNumber);
      setDays(String(employee.vacationDaysPerYear));
      setErrs({});
      update.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Errs = {};
    const d = Number(days);
    if (!tab.trim()) next.tabNumber = tc('requiredField');
    if (!Number.isInteger(d) || d < 0 || d > 366) next.vacationDaysPerYear = t('badDays');
    setErrs(next);
    if (Object.keys(next).length) return;
    update.mutate(
      {
        departmentId: dept === SELECT_NONE ? null : dept,
        positionId: pos === SELECT_NONE ? null : pos,
        locationId: loc === SELECT_NONE ? null : loc,
        ...(manager ? { managerId: manager } : managerLabel ? {} : { managerId: null }),
        tabNumber: tab.trim(),
        vacationDaysPerYear: d,
      },
      {
        onSuccess: () => {
          toast.success(tc('saved'));
          onOpenChange(false);
        },
        onError: (err) => {
          const s = serverErrors(err);
          setErrs({ ...s.fields, form: s.form === 'error' ? tc('error') : (s.form ?? undefined) });
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('title')}
      description={t('text')}
      dismissible={!update.isPending}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={update.isPending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="employee-edit" loading={update.isPending}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <form id="employee-edit" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('department')} error={errs.departmentId}>
          <Select value={dept} onValueChange={setDept} options={[{ value: SELECT_NONE, label: t('none') }, ...(departments.data ?? []).map((x) => ({ value: x.id, label: x.name }))]} />
        </FormField>
        <FormField label={t('position')} error={errs.positionId}>
          <Select value={pos} onValueChange={setPos} options={[{ value: SELECT_NONE, label: t('none') }, ...(positions.data ?? []).map((x) => ({ value: x.id, label: x.name }))]} />
        </FormField>
        <FormField label={t('manager')} hint={managerLabel && !manager ? t('managerCurrent', { name: managerLabel }) : undefined} error={errs.managerId}>
          <EmployeePicker
            value={manager}
            onChange={(v) => {
              setManager(v);
              if (!v) setManagerLabel(null);
            }}
            excludeIds={[employee.id]}
            placeholder={managerLabel ?? t('none')}
          />
        </FormField>
        <FormField label={t('location')} error={errs.locationId}>
          <Select value={loc} onValueChange={setLoc} options={[{ value: SELECT_NONE, label: t('none') }, ...(locations.data ?? []).map((x) => ({ value: x.id, label: x.name }))]} />
        </FormField>
        <FormField label={t('tabNumber')} required error={errs.tabNumber}>
          <Input value={tab} onChange={(e) => setTab(e.target.value)} maxLength={20} />
        </FormField>
        <FormField label={t('vacationDays')} required error={errs.vacationDaysPerYear}>
          <Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
        </FormField>
        <FormError message={errs.form} className="sm:col-span-2" />
      </form>
    </Dialog>
  );
}

/** Manual vacation balance adjustment (HR). */
export function AdjustmentDialog({ employeeId, open, onOpenChange }: { employeeId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('employees.vacation');
  const tc = useTranslations('common');
  const adjust = useVacationAdjustment(employeeId);
  const [days, setDays] = useState('');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [errs, setErrs] = useState<Errs>({});
  useEffect(() => {
    if (open) {
      setDays('');
      setDate(today());
      setNote('');
      setErrs({});
    }
  }, [open]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const d = Number(days.replace(',', '.'));
    const next: Errs = {};
    if (!days.trim() || !Number.isFinite(d) || d === 0 || Math.abs(d) > 366) next.days = t('badDays');
    if (!date) next.date = tc('requiredField');
    if (!note.trim()) next.note = tc('requiredField');
    setErrs(next);
    if (Object.keys(next).length) return;
    adjust.mutate(
      { days: d, date, note: note.trim() },
      {
        onSuccess: () => {
          toast.success(t('adjusted'));
          onOpenChange(false);
        },
        onError: (err) => {
          const s = serverErrors(err);
          setErrs({ ...s.fields, form: s.form === 'error' ? tc('error') : (s.form ?? undefined) });
        },
      },
    );
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={t('adjustTitle')}
      description={t('adjustText')}
      dismissible={!adjust.isPending}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={adjust.isPending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="vac-adjust" loading={adjust.isPending}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <form id="vac-adjust" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FormField label={t('days')} required hint={t('daysHint')} error={errs.days}>
          <Input inputMode="decimal" value={days} onChange={(e) => setDays(e.target.value)} placeholder="+3 / -2" />
        </FormField>
        <FormField label={t('date')} required error={errs.date}>
          <DatePicker value={date} onChange={setDate} />
        </FormField>
        <FormField label={t('note')} required error={errs.note}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} />
        </FormField>
        <FormError message={errs.form} />
      </form>
    </Dialog>
  );
}
