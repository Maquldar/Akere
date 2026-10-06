'use client';

import { ArrowDown, ArrowUp, ChevronRight, GitFork, Pencil, Plus, Route, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { FormError, FormField } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { RequireAccess } from '@/components/shell/require-access';
import { isApiError } from '@/lib/api/errors';
import { useDeleteRouteTemplate, useRouteTemplates, useSaveRouteTemplate } from '@/lib/api/hooks/documents';
import {
  ASSIGNEE_RULES, STEP_ACTIONS, type AssigneeRule, type RouteStepDef, type RouteTemplateView, type StepAction,
} from '@/lib/api/types-documents';
import { can } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { EmployeePicker } from '../employee-picker';
import { AdminTabs } from './admin-tabs';

type EditStep = { key: number; action: StepAction; rule: AssigneeRule; userId?: string; dueDays: string; parallel: boolean };

let seq = 0;
const newStep = (): EditStep => ({ key: ++seq, action: 'APPROVE', rule: 'MANAGER_OF_SUBJECT', dueDays: '2', parallel: false });

/** API steps (with `order`) → editor rows (parallel = same order as the previous row). */
export function toEditSteps(steps: RouteStepDef[]): EditStep[] {
  const sorted = [...steps].sort((a, b) => a.order - b.order);
  return sorted.map((s, i) => ({
    key: ++seq,
    action: s.action,
    rule: s.rule,
    userId: s.userId,
    dueDays: s.dueDays === undefined ? '' : String(s.dueDays),
    parallel: i > 0 && sorted[i - 1]!.order === s.order,
  }));
}

/** Editor rows → API steps with consecutive orders. */
export function toStepDefs(rows: EditStep[]): RouteStepDef[] {
  let order = 0;
  return rows.map((r, i) => {
    if (i === 0 || !r.parallel) order += 1;
    const due = r.dueDays.trim() === '' ? undefined : Number(r.dueDays);
    return { order, action: r.action, rule: r.rule, ...(r.rule === 'USER' && r.userId ? { userId: r.userId } : {}), ...(due !== undefined && Number.isFinite(due) ? { dueDays: due } : {}) };
  });
}

function StepSummary({ steps }: { steps: RouteStepDef[] }) {
  const ta = useTranslations('documents.action');
  const tr = useTranslations('docAdmin.rules');
  const sorted = [...steps].sort((a, b) => a.order - b.order);
  const groups = new Map<number, RouteStepDef[]>();
  for (const s of sorted) groups.set(s.order, [...(groups.get(s.order) ?? []), s]);
  return (
    <ol className="flex flex-wrap items-center gap-1.5">
      {[...groups.entries()].map(([order, g], i) => (
        <Fragment key={order}>
          {i > 0 && <ChevronRight className="size-3.5 text-fg-subtle" aria-hidden />}
          <li className={cn('flex flex-wrap gap-1', g.length > 1 && 'rounded-md border border-dashed border-border p-0.5')}>
            {g.map((s, j) => (
              <Badge key={j} tone={s.action === 'SIGN' ? 'purple' : s.action === 'ACKNOWLEDGE' ? 'blue' : 'teal'}>
                {order}. {tr(s.rule)} · {ta(s.action)}
              </Badge>
            ))}
          </li>
        </Fragment>
      ))}
    </ol>
  );
}

function RouteDialog({ open, onOpenChange, route }: { open: boolean; onOpenChange: (o: boolean) => void; route: RouteTemplateView | null }) {
  const t = useTranslations('docAdmin.routes');
  const ta = useTranslations('documents.action');
  const tr = useTranslations('docAdmin.rules');
  const tc = useTranslations('common');
  const save = useSaveRouteTemplate();
  const [name, setName] = useState('');
  const [rows, setRows] = useState<EditStep[]>([]);
  const [errs, setErrs] = useState<Record<string, string | undefined>>({});

  useEffect(() => {
    if (!open) return;
    setName(route?.name ?? '');
    setRows(route ? toEditSteps(route.steps) : [{ ...newStep(), action: 'SIGN', rule: 'SIGNATORY' }]);
    setErrs({});
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, route]);

  const patch = (i: number, p: Partial<EditStep>) => setRows((s) => s.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const move = (i: number, d: -1 | 1) =>
    setRows((s) => {
      const j = i + d;
      if (j < 0 || j >= s.length) return s;
      const next = [...s];
      [next[i], next[j]] = [next[j]!, next[i]!];
      next[0] = { ...next[0]!, parallel: false };
      return next;
    });
  const defs = toStepDefs(rows);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string | undefined> = {};
    if (!name.trim()) next.name = tc('requiredField');
    if (rows.length === 0) next.form = t('noSteps');
    rows.forEach((r, i) => {
      if (r.rule === 'USER' && !r.userId) next[`user${i}`] = t('userRequired');
      const d = r.dueDays.trim() === '' ? 0 : Number(r.dueDays);
      if (!Number.isInteger(d) || d < 0 || d > 365) next[`due${i}`] = t('badDue');
    });
    setErrs(next);
    if (Object.values(next).some(Boolean)) return;
    save.mutate(
      { id: route?.id, input: { name: name.trim(), steps: defs } },
      {
        onSuccess: () => {
          toast.success(route ? tc('saved') : t('created'));
          onOpenChange(false);
        },
        onError: (err) => setErrs({ form: isApiError(err) ? err.message : tc('error') }),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={route ? t('editTitle') : t('addTitle')}
      description={t('editText')}
      dismissible={!save.isPending}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="route-form" loading={save.isPending}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <form id="route-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FormField label={t('name')} required error={errs.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </FormField>
        <ol className="flex flex-col gap-2" aria-label={t('steps')}>
          {rows.map((r, i) => (
            <li key={r.key} className={cn('rounded-lg border border-border bg-surface-muted p-3', r.parallel && 'ml-4 border-dashed sm:ml-8')}>
              <div className="mb-2 flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white tabular">{defs[i]?.order}</span>
                <span className="flex-1 text-[13px] font-medium text-fg">
                  {r.parallel ? (
                    <span className="inline-flex items-center gap-1 text-purple-fg">
                      <GitFork className="size-3.5" aria-hidden />
                      {t('parallelWith', { order: defs[i]?.order ?? 0 })}
                    </span>
                  ) : (
                    t('stage', { order: defs[i]?.order ?? 0 })
                  )}
                </span>
                <Button variant="ghost" size="icon-sm" aria-label={t('moveUp')} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp aria-hidden />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={t('moveDown')} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown aria-hidden />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={t('removeStep')} disabled={rows.length === 1} onClick={() => setRows((s) => s.filter((_, j) => j !== i).map((x, j) => (j === 0 ? { ...x, parallel: false } : x)))}>
                  <Trash2 aria-hidden />
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_110px]">
                <FormField label={t('action')}>
                  <Select size="sm" value={r.action} onValueChange={(v) => patch(i, { action: v as StepAction })} options={STEP_ACTIONS.map((a) => ({ value: a, label: ta(a) }))} />
                </FormField>
                <FormField label={t('rule')}>
                  <Select size="sm" value={r.rule} onValueChange={(v) => patch(i, { rule: v as AssigneeRule })} options={ASSIGNEE_RULES.map((x) => ({ value: x, label: tr(x) }))} />
                </FormField>
                <FormField label={t('dueDays')} error={errs[`due${i}`]}>
                  <Input inputSize="sm" inputMode="numeric" value={r.dueDays} onChange={(e) => patch(i, { dueDays: e.target.value.replace(/\D/g, '') })} />
                </FormField>
                {r.rule === 'USER' && (
                  <FormField label={t('user')} required error={errs[`user${i}`]} className="sm:col-span-3">
                    <EmployeePicker size="sm" valueKind="user" value={r.userId ?? null} onChange={(v) => patch(i, { userId: v ?? undefined })} placeholder={t('userPlaceholder')} />
                  </FormField>
                )}
              </div>
              {i > 0 && (
                <div className="mt-3">
                  <Checkbox label={t('parallel')} description={t('parallelHint')} checked={r.parallel} onCheckedChange={(v) => patch(i, { parallel: v === true })} />
                </div>
              )}
            </li>
          ))}
        </ol>
        <div>
          <Button variant="outline" size="sm" onClick={() => setRows((s) => [...s, newStep()])}>
            <Plus aria-hidden />
            {t('addStep')}
          </Button>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="section-label mb-2">{t('summary')}</p>
          <StepSummary steps={defs} />
        </div>
        <FormError message={errs.form} />
      </form>
    </Dialog>
  );
}

export function RoutesPage() {
  const t = useTranslations('docAdmin.routes');
  const tc = useTranslations('common');
  const routes = useRouteTemplates();
  const del = useDeleteRouteTemplate();
  const [editing, setEditing] = useState<RouteTemplateView | null>(null);
  const [open, setOpen] = useState(false);
  const [toDelete, setToDelete] = useState<RouteTemplateView | null>(null);

  return (
    <RequireAccess allow={(a) => can(a, 'document.manage')}>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus aria-hidden />
            {t('add')}
          </Button>
        }
      />
      <AdminTabs active="routes" />
      {routes.isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : routes.error ? (
        <Card>
          <ErrorState error={routes.error} onRetry={() => routes.refetch()} />
        </Card>
      ) : !routes.data?.length ? (
        <Card>
          <EmptyState icon={<Route aria-hidden />} title={t('empty')} description={t('emptyHint')} />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {routes.data.map((r) => (
            <li key={r.id}>
              <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-fg">{r.name}</span>
                    <span className="text-xs text-fg-subtle">{r.usedBy ? t('usedBy', { count: r.usedBy }) : t('unused')}</span>
                  </div>
                  <div className="mt-2">
                    <StepSummary steps={r.steps} />
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditing(r);
                      setOpen(true);
                    }}
                  >
                    <Pencil aria-hidden />
                    {tc('edit')}
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={t('remove', { name: r.name })} disabled={r.usedBy > 0} title={r.usedBy > 0 ? t('inUse') : undefined} onClick={() => setToDelete(r)}>
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <RouteDialog open={open} onOpenChange={setOpen} route={editing} />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t('removeTitle')}
        description={toDelete ? t('removeText', { name: toDelete.name }) : undefined}
        confirmLabel={tc('delete')}
        loading={del.isPending}
        onConfirm={() =>
          toDelete &&
          del.mutate(toDelete.id, {
            onSuccess: () => {
              toast.success(t('removed'));
              setToDelete(null);
            },
            onError: (e) => toast.error(isApiError(e) && e.code === 'CONFLICT' ? t('inUse') : isApiError(e) ? e.message : tc('error')),
          })
        }
      />
    </RequireAccess>
  );
}
