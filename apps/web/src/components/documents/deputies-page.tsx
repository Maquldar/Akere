'use client';

import { ArrowRight, Plus, Trash2, UserCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { StatusPill } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-picker';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { FormError, FormField } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { SkeletonList } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toaster';
import { useCurrentUser } from '@/components/shell/me-context';
import { RequireAccess } from '@/components/shell/require-access';
import { isApiError } from '@/lib/api/errors';
import { useCreateDeputy, useDeleteDeputy, useDeputies } from '@/lib/api/hooks/documents';
import type { DeputyItem } from '@/lib/api/types-documents';
import type { UserRef } from '@/lib/api/types';
import { formatDate } from '@/lib/format';
import { can, hasRole } from '@/lib/permissions';
import { EmployeePicker } from './employee-picker';

const today = () => new Date().toISOString().slice(0, 10);

function Person({ user, caption }: { user: UserRef; caption: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar name={user.fullName} />
      <div className="min-w-0">
        <div className="text-xs text-fg-subtle">{caption}</div>
        <div className="truncate text-sm font-medium text-fg">{user.fullName}</div>
        {(user.position || user.department) && <div className="truncate text-xs text-fg-subtle">{[user.position, user.department].filter(Boolean).join(', ')}</div>}
      </div>
    </div>
  );
}

export function DeputyDialog({
  open,
  onOpenChange,
  forOthers,
  fixedPrincipal,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Admin: may choose the principal. */
  forOthers: boolean;
  /** Preselected principal (user id), e.g. from the e-dossier. */
  fixedPrincipal?: { userId: string; name: string } | null;
}) {
  const t = useTranslations('deputies');
  const tc = useTranslations('common');
  const { me } = useCurrentUser();
  const create = useCreateDeputy();
  const [principal, setPrincipal] = useState<string | null>(null);
  const [deputy, setDeputy] = useState<string | null>(null);
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setPrincipal(fixedPrincipal?.userId ?? null);
      setDeputy(null);
      setStart(today());
      setEnd('');
      setTouched(false);
      create.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const principalId = forOthers ? (principal ?? me.id) : (fixedPrincipal?.userId ?? me.id);
  const fe = isApiError(create.error) ? create.error.fieldErrors : {};
  const rule = isApiError(create.error) ? create.error.rule : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!deputy || !start || !end || end < start) return;
    create.mutate(
      { principalUserId: principalId === me.id ? undefined : principalId, deputyUserId: deputy, startDate: start, endDate: end },
      {
        onSuccess: () => {
          toast.success(t('added'));
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('addTitle')}
      description={t('addText')}
      dismissible={!create.isPending}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="deputy-form" loading={create.isPending}>
            {t('add')}
          </Button>
        </>
      }
    >
      <form id="deputy-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {forOthers && !fixedPrincipal && (
          <FormField label={t('principal')} hint={t('principalHint')} error={fe.principalUserId?.[0]}>
            <EmployeePicker valueKind="user" value={principal} onChange={(v) => setPrincipal(v)} placeholder={t('principalPlaceholder')} />
          </FormField>
        )}
        {fixedPrincipal && (
          <p className="text-sm text-fg-muted">
            {t('principal')}: <span className="font-medium text-fg">{fixedPrincipal.name}</span>
          </p>
        )}
        <FormField
          label={t('deputy')}
          required
          error={touched && !deputy ? tc('requiredField') : rule === 'SELF_DEPUTY' ? t('selfDeputy') : fe.deputyUserId?.[0]}
        >
          <EmployeePicker valueKind="user" value={deputy} onChange={(v) => setDeputy(v)} excludeIds={[principalId]} placeholder={t('deputyPlaceholder')} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('start')} required error={touched && !start ? tc('requiredField') : fe.startDate?.[0]}>
            <DatePicker value={start} onChange={setStart} />
          </FormField>
          <FormField
            label={t('end')}
            required
            error={
              touched && !end ? tc('requiredField') : touched && end < start ? t('endBeforeStart') : rule === 'PAST_PERIOD' ? t('pastPeriod') : fe.endDate?.[0]
            }
          >
            <DatePicker value={end} min={start || today()} onChange={setEnd} />
          </FormField>
        </div>
        {create.error && !rule && !Object.keys(fe).length ? <FormError message={isApiError(create.error) ? create.error.message : tc('error')} /> : null}
        <p className="text-xs text-fg-subtle">{t('rightsNote')}</p>
      </form>
    </Dialog>
  );
}

export function DeputyList({ items, onDelete, canDelete }: { items: DeputyItem[]; onDelete: (d: DeputyItem) => void; canDelete: (d: DeputyItem) => boolean }) {
  const t = useTranslations('deputies');
  const locale = useLocale();
  return (
    <ul className="flex flex-col gap-2">
      {items.map((d) => (
        <li key={d.id} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3 sm:flex-row sm:items-center">
          <div className="grid min-w-0 flex-1 items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
            <Person user={d.principal} caption={t('principal')} />
            <ArrowRight className="hidden size-4 text-fg-subtle sm:block" aria-hidden />
            <Person user={d.deputy} caption={t('deputy')} />
          </div>
          <div className="flex items-center gap-3 sm:justify-end">
            <div className="text-right">
              <div className="text-[13px] tabular text-fg">
                {formatDate(d.startDate, locale)} – {formatDate(d.endDate, locale)}
              </div>
              {d.active ? (
                <StatusPill tone="green" variant="dot">{t('active')}</StatusPill>
              ) : d.endDate < today() ? (
                <StatusPill tone="gray" variant="dot">{t('finished')}</StatusPill>
              ) : (
                <StatusPill tone="blue" variant="dot">{t('scheduled')}</StatusPill>
              )}
            </div>
            {canDelete(d) && (
              <Button variant="ghost" size="icon-sm" aria-label={t('remove', { name: d.deputy.fullName })} onClick={() => onDelete(d)}>
                <Trash2 aria-hidden />
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DeputiesPage() {
  const t = useTranslations('deputies');
  const tc = useTranslations('common');
  const { me, access } = useCurrentUser();
  const isAdmin = hasRole(access, 'ADMIN');
  const seesAll = hasRole(access, 'ADMIN', 'HR');
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const list = useDeputies(scope === 'mine' || !seesAll);
  const del = useDeleteDeputy();
  const [open, setOpen] = useState(false);
  const [toDelete, setToDelete] = useState<DeputyItem | null>(null);
  const canManage = can(access, 'deputy.manage');

  const mineAsPrincipal = (list.data ?? []).filter((d) => d.principal.id === me.id);
  const mineAsDeputy = (list.data ?? []).filter((d) => d.deputy.id === me.id);
  const canDelete = (d: DeputyItem) => canManage && (d.principal.id === me.id || isAdmin);

  return (
    <RequireAccess allow={(a) => can(a, 'deputy.read')}>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          canManage && (
            <Button onClick={() => setOpen(true)}>
              <Plus aria-hidden />
              {t('add')}
            </Button>
          )
        }
      />
      {seesAll && (
        <Tabs value={scope} onValueChange={(v) => setScope(v as 'mine' | 'all')} className="mb-4">
          <TabsList aria-label={t('scope')}>
            <TabsTrigger value="mine">{t('scopeMine')}</TabsTrigger>
            <TabsTrigger value="all">{t('scopeAll')}</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      {list.isLoading ? (
        <Card className="p-5">
          <SkeletonList rows={3} />
        </Card>
      ) : list.error ? (
        <Card>
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        </Card>
      ) : scope === 'all' && seesAll ? (
        list.data?.length ? (
          <DeputyList items={list.data} onDelete={setToDelete} canDelete={canDelete} />
        ) : (
          <Card>
            <EmptyState icon={<UserCheck aria-hidden />} title={t('emptyAll')} />
          </Card>
        )
      ) : (
        <div className="flex flex-col gap-6">
          <section aria-labelledby="dep-mine">
            <h2 id="dep-mine" className="section-label mb-2">
              {t('myDeputies')}
            </h2>
            {mineAsPrincipal.length ? (
              <DeputyList items={mineAsPrincipal} onDelete={setToDelete} canDelete={canDelete} />
            ) : (
              <Card>
                <EmptyState
                  compact
                  icon={<UserCheck aria-hidden />}
                  title={t('emptyMine')}
                  description={t('emptyMineHint')}
                  action={
                    canManage && (
                      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
                        <Plus aria-hidden />
                        {t('add')}
                      </Button>
                    )
                  }
                />
              </Card>
            )}
          </section>
          <section aria-labelledby="dep-for">
            <h2 id="dep-for" className="section-label mb-2">
              {t('iAmDeputy')}
            </h2>
            {mineAsDeputy.length ? (
              <DeputyList items={mineAsDeputy} onDelete={setToDelete} canDelete={canDelete} />
            ) : (
              <p className="text-sm text-fg-subtle">{t('emptyFor')}</p>
            )}
          </section>
        </div>
      )}
      <DeputyDialog open={open} onOpenChange={setOpen} forOthers={isAdmin} />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t('removeTitle')}
        description={toDelete ? t('removeText', { name: toDelete.deputy.fullName }) : undefined}
        confirmLabel={tc('delete')}
        loading={del.isPending}
        onConfirm={() =>
          toDelete &&
          del.mutate(toDelete.id, {
            onSuccess: () => {
              toast.success(t('removed'));
              setToDelete(null);
            },
            onError: (e) => toast.error(isApiError(e) ? e.message : tc('error')),
          })
        }
      />
    </RequireAccess>
  );
}
