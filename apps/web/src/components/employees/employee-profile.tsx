'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { ArrowRightLeft, FilePlus2, FileText, FolderOpen, Pencil, Plus, ShieldCheck, UserMinus, UserCheck, Wand2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, type ReactNode } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Badge, StatusPill } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { ConfirmDialog } from '@/components/ui/dialog';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton, SkeletonList } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toaster';
import { useCurrentUser } from '@/components/shell/me-context';
import { roleTone } from '@/components/shell/roles';
import { DeputyDialog, DeputyList } from '@/components/documents/deputies-page';
import { DocStatusPill, MyActionBadge } from '@/components/documents/labels';
import { Link, useRouter } from '@/i18n/navigation';
import { isApiError } from '@/lib/api/errors';
import { useDeleteDeputy, useEmployee, useEmployeeDocuments, usePersonalDocuments, useVacationBalance } from '@/lib/api/hooks/documents';
import type { CandidateDocumentView, DeputyItem, DocumentListItem, EmployeeProfile, PersonalDocumentField } from '@/lib/api/types-documents';
import { formatDate, formatDateTime } from '@/lib/format';
import { can, hasRole } from '@/lib/permissions';
import { formatBytes } from '@/lib/utils';
import { AdjustmentDialog, DismissalDialog, EditEmployeeDialog, TransferDialog } from './hr-dialogs';

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-subtle">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-fg">{children || <span className="text-fg-subtle">—</span>}</dd>
    </div>
  );
}

const fmtNum = (n: number, locale: string) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n);

function GeneralInfo({ e }: { e: EmployeeProfile }) {
  const t = useTranslations('employees.profile');
  const tr = useTranslations('roles');
  const locale = useLocale();
  const personal = Object.entries(e.personal ?? {}).filter(([, v]) => typeof v === 'string' || typeof v === 'number');
  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label={t('fullName')}>{e.fullName}</Field>
      <Field label={t('iin')}>{e.iin && <span className="tabular">{e.iin}</span>}</Field>
      <Field label={t('birthDate')}>{e.birthDate && formatDate(e.birthDate, locale)}</Field>
      <Field label={t('gender')}>{e.gender && t(e.gender === 'MALE' ? 'male' : 'female')}</Field>
      <Field label={t('email')}>{e.email}</Field>
      <Field label={t('phone')}>{e.phone}</Field>
      <Field label={t('roles')}>
        {e.roles.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {e.roles.map((r) => (
              <Badge key={r} tone={roleTone[r]}>
                {tr(r)}
              </Badge>
            ))}
          </span>
        )}
      </Field>
      {personal.map(([k, v]) => (
        <Field key={k} label={k}>
          {String(v)}
        </Field>
      ))}
    </dl>
  );
}

function WorkPlace({ e }: { e: EmployeeProfile }) {
  const t = useTranslations('employees.profile');
  const locale = useLocale();
  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label={t('legalEntity')}>{e.legalEntity.name}</Field>
      <Field label={t('department')}>{e.department?.name}</Field>
      <Field label={t('position')}>{e.position?.name}</Field>
      <Field label={t('manager')}>{e.manager?.fullName}</Field>
      <Field label={t('location')}>{e.location?.name}</Field>
      <Field label={t('tabNumber')}>{<span className="tabular">{e.tabNumber}</span>}</Field>
      <Field label={t('hireDate')}>{formatDate(e.hireDate, locale)}</Field>
      {e.terminationDate && <Field label={t('terminationDate')}>{formatDate(e.terminationDate, locale)}</Field>}
      <Field label={t('vacationAccrued')}>
        <span className="font-semibold tabular">{fmtNum(e.vacationBalance, locale)}</span> {t('daysUnit')}
      </Field>
      <Field label={t('vacationPerYear')}>
        {e.vacationDaysPerYear} {t('daysUnit')}
      </Field>
    </dl>
  );
}

function DeputiesBlock({ e }: { e: EmployeeProfile }) {
  const t = useTranslations('deputies');
  const tc = useTranslations('common');
  const { me, access } = useCurrentUser();
  const del = useDeleteDeputy();
  const [open, setOpen] = useState(false);
  const [toDelete, setToDelete] = useState<DeputyItem | null>(null);
  const isSelf = e.userId === me.id;
  const isAdmin = hasRole(access, 'ADMIN');
  const canAdd = can(access, 'deputy.manage') && (isSelf || isAdmin) && e.status === 'ACTIVE';
  return (
    <div className="flex flex-col gap-3">
      {canAdd && (
        <div>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Plus aria-hidden />
            {t('add')}
          </Button>
        </div>
      )}
      {e.deputies.length ? (
        <DeputyList items={e.deputies} onDelete={setToDelete} canDelete={(d) => d.principal.id === me.id || isAdmin} />
      ) : (
        <EmptyState compact icon={<UserCheck aria-hidden />} title={t('emptyProfile')} />
      )}
      <DeputyDialog open={open} onOpenChange={setOpen} forOthers={isAdmin} fixedPrincipal={isSelf ? null : { userId: e.userId, name: e.fullName }} />
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
            onError: (err) => toast.error(isApiError(err) ? err.message : tc('error')),
          })
        }
      />
    </div>
  );
}

function DocumentsTab({ employeeId }: { employeeId: string }) {
  const t = useTranslations('employees.docs');
  const locale = useLocale();
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const docs = useEmployeeDocuments(employeeId, { page, pageSize });
  const columns = useMemo<ColumnDef<DocumentListItem, unknown>[]>(
    () => [
      {
        id: 'title',
        header: t('colTitle'),
        meta: { hideable: false },
        cell: ({ row }) => (
          <div className="min-w-[220px]">
            <Link href={`/documents/${row.original.id}`} onClick={(e) => e.stopPropagation()} className="focus-ring block truncate rounded font-medium hover:text-primary">
              {row.original.title}
            </Link>
            <div className="text-xs text-fg-subtle">{row.original.type.name}</div>
          </div>
        ),
      },
      { id: 'number', header: t('colNumber'), meta: { className: 'tabular whitespace-nowrap' }, cell: ({ row }) => row.original.number ?? '—' },
      {
        id: 'status',
        header: t('colStatus'),
        cell: ({ row }) => (
          <div className="flex flex-col items-start gap-1">
            <DocStatusPill status={row.original.status} />
            {row.original.myPendingAction && <MyActionBadge action={row.original.myPendingAction} />}
          </div>
        ),
      },
      { id: 'created', header: t('colCreated'), meta: { className: 'tabular whitespace-nowrap text-fg-muted' }, cell: ({ row }) => formatDateTime(row.original.createdAt, locale) },
    ],
    [t, locale],
  );
  return (
    <DataTable
      label={t('label')}
      columns={columns}
      data={docs.data?.items}
      getRowId={(d) => d.id}
      isLoading={docs.isLoading}
      isFetching={docs.isFetching}
      error={docs.error}
      onRetry={() => docs.refetch()}
      onRowClick={(d) => router.push(`/documents/${d.id}`)}
      pagination={docs.data && { page, pageSize, total: docs.data.total, onPageChange: setPage, onPageSizeChange: setPageSize }}
      empty={<EmptyState compact icon={<FileText aria-hidden />} title={t('empty')} />}
    />
  );
}

function PersonalDocCard({ d }: { d: CandidateDocumentView }) {
  const t = useTranslations('employees.personal');
  const locale = useLocale();
  const fields = (Array.isArray(d.docType.fields) ? d.docType.fields : []) as PersonalDocumentField[];
  const shown = fields.filter((f) => d.values[f.key] !== undefined && d.values[f.key] !== null && d.values[f.key] !== '');
  const name = locale === 'kk' && d.docType.nameKk ? d.docType.nameKk : d.docType.name;
  const fmt = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDate(v, locale) : typeof v === 'boolean' ? (v ? '✓' : '—') : String(v));
  return (
    <Card>
      <CardHeader
        titleAs="h3"
        title={name}
        actions={<StatusPill tone={d.status === 'ACCEPTED' ? 'green' : d.status === 'RETURNED' ? 'orange' : 'gray'}>{t(`status_${d.status as 'ACCEPTED' | 'FILLED' | 'PENDING' | 'RETURNED'}`)}</StatusPill>}
      />
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        {shown.length > 0 ? (
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {shown.map((f) => (
              <div key={f.key} className="min-w-0">
                <dt className="flex items-center gap-1 text-xs text-fg-subtle">
                  {(locale === 'kk' && f.labelKk) || f.label || f.key}
                  {d.autoFilledKeys.includes(f.key) && <Wand2 className="size-3 text-purple-fg" aria-label={t('autoFilled')} />}
                </dt>
                <dd className="mt-0.5 break-words text-sm text-fg">{fmt(d.values[f.key])}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-fg-subtle">{t('noFields')}</p>
        )}
        {d.files.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {d.files.map((f) => (
              <li key={f.id}>
                <a href={f.url} target="_blank" rel="noopener" className="focus-ring flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-[13px] hover:bg-surface-hover">
                  <FileText className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-fg">{f.filename}</span>
                  <span className="shrink-0 text-xs text-fg-subtle">{formatBytes(f.size, locale)}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function PersonalTab({ employeeId }: { employeeId: string }) {
  const t = useTranslations('employees.personal');
  const q = usePersonalDocuments(employeeId);
  if (q.isLoading)
    return (
      <Card className="p-5">
        <SkeletonList rows={3} />
      </Card>
    );
  if (q.error)
    return (
      <Card>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </Card>
    );
  if (!q.data?.length)
    return (
      <Card>
        <EmptyState icon={<FolderOpen aria-hidden />} title={t('empty')} description={t('emptyHint')} />
      </Card>
    );
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {q.data.map((d) => (
        <PersonalDocCard key={d.id} d={d} />
      ))}
    </div>
  );
}

function VacationTab({ employeeId, canManage }: { employeeId: string; canManage: boolean }) {
  const t = useTranslations('employees.vacation');
  const locale = useLocale();
  const q = useVacationBalance(employeeId);
  const [open, setOpen] = useState(false);
  if (q.isLoading)
    return (
      <div className="grid gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  if (q.error || !q.data)
    return (
      <Card>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </Card>
    );
  const b = q.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t('available')} value={fmtNum(b.available, locale)} hint={t('perYear', { days: b.perYear })} tone={b.available < 0 ? 'danger' : 'default'} />
        <StatCard label={t('accrued')} value={fmtNum(b.accrued, locale)} />
        <StatCard label={t('used')} value={fmtNum(b.used, locale)} />
        <StatCard label={t('adjusted')} value={fmtNum(b.adjusted, locale)} />
      </div>
      <Card>
        <CardHeader
          title={t('ledger')}
          count={b.entries.length}
          actions={
            canManage && (
              <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
                <Plus aria-hidden />
                {t('adjust')}
              </Button>
            )
          }
        />
        {b.entries.length === 0 ? (
          <EmptyState compact title={t('noEntries')} description={t('noEntriesHint')} />
        ) : (
          <TableContainer>
            <Table aria-label={t('ledger')}>
              <THead>
                <TR>
                  <TH>{t('colDate')}</TH>
                  <TH>{t('colType')}</TH>
                  <TH className="text-right">{t('colDays')}</TH>
                  <TH>{t('colNote')}</TH>
                </TR>
              </THead>
              <TBody>
                {b.entries.map((x) => (
                  <TR key={x.id}>
                    <TD className="whitespace-nowrap tabular">{formatDate(x.date, locale)}</TD>
                    <TD>
                      <Badge tone={x.type === 'USAGE' ? 'orange' : x.type === 'ADJUSTMENT' ? 'purple' : 'green'}>{t(`type_${x.type}`)}</Badge>
                    </TD>
                    <TD className="text-right font-medium tabular">
                      {x.type === 'USAGE' ? '−' : x.days > 0 ? '+' : ''}
                      {fmtNum(x.type === 'USAGE' ? Math.abs(x.days) : x.days, locale)}
                    </TD>
                    <TD className="text-fg-muted">{x.note ?? '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        )}
      </Card>
      <p className="text-xs text-fg-subtle">{t('rule')}</p>
      <AdjustmentDialog employeeId={employeeId} open={open} onOpenChange={setOpen} />
    </div>
  );
}

export function EmployeeProfilePage({ id }: { id: string }) {
  const t = useTranslations('employees.profile');
  const ts = useTranslations('employees.status');
  const tn = useTranslations('nav.items');
  const { access } = useCurrentUser();
  const q = useEmployee(id);
  const [tab, setTab] = useState('profile');
  const [sub, setSub] = useState('general');
  const [dialog, setDialog] = useState<'edit' | 'transfer' | 'dismissal' | null>(null);

  if (q.isLoading)
    return (
      <div className="flex flex-col gap-4" aria-busy>
        <Skeleton className="h-4 w-40" />
        <div className="flex items-center gap-4">
          <Skeleton className="size-16 rounded-full" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  if (q.error || !q.data)
    return (
      <Card>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </Card>
    );
  const e = q.data;
  const canManage = Boolean(e.canManage) && can(access, 'employee.manage');
  const active = e.status === 'ACTIVE';

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: tn('employees'), href: '/employees' }, { label: e.fullName }]}
        title={
          <span className="flex items-center gap-3">
            {e.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={e.photoUrl} alt="" className="size-14 shrink-0 rounded-full border border-border object-cover" />
            ) : (
              <Avatar name={e.fullName} size="lg" className="size-14 text-base" />
            )}
            <span className="min-w-0">
              <span className="block">{e.fullName}</span>
              <span className="mt-1 flex flex-wrap items-center gap-2 text-sm font-normal text-fg-muted">
                {[e.position?.name, e.department?.name].filter(Boolean).join(' · ') || '—'}
                <StatusPill tone={active ? 'green' : 'gray'}>{ts(e.status)}</StatusPill>
                {e.iin && <span className="tabular">{t('iinShort', { iin: e.iin })}</span>}
              </span>
            </span>
          </span>
        }
        actions={
          <>
            {can(access, 'document.create') && active && (
              <Button variant="outline" asChild>
                <Link href={`/documents/new?employeeId=${e.id}&legalEntityId=${e.legalEntity.id}`}>
                  <FilePlus2 aria-hidden />
                  {t('newDocument')}
                </Link>
              </Button>
            )}
            {canManage && (
              <Button variant="outline" onClick={() => setDialog('edit')}>
                <Pencil aria-hidden />
                {t('edit')}
              </Button>
            )}
            {canManage && active && (
              <Button variant="outline" onClick={() => setDialog('transfer')}>
                <ArrowRightLeft aria-hidden />
                {t('transfer')}
              </Button>
            )}
            {canManage && active && (
              <Button variant="outline" className="text-red-fg" onClick={() => setDialog('dismissal')}>
                <UserMinus aria-hidden />
                {t('dismiss')}
              </Button>
            )}
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label={t('tabs')}>
          <TabsTrigger value="profile">{t('tabProfile')}</TabsTrigger>
          <TabsTrigger value="documents">{t('tabDocuments')}</TabsTrigger>
          <TabsTrigger value="personal">{t('tabPersonal')}</TabsTrigger>
          <TabsTrigger value="vacation">{t('tabVacation')}</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <Card className="p-4 sm:p-5">
            <Tabs value={sub} onValueChange={setSub}>
              <TabsList aria-label={t('tabProfile')} className="bg-transparent p-0">
                <TabsTrigger value="general">{t('subGeneral')}</TabsTrigger>
                <TabsTrigger value="work">{t('subWork')}</TabsTrigger>
                <TabsTrigger value="deputies" count={e.deputies.length}>
                  {t('subDeputies')}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="general" className="mt-5">
                <GeneralInfo e={e} />
              </TabsContent>
              <TabsContent value="work" className="mt-5">
                <WorkPlace e={e} />
              </TabsContent>
              <TabsContent value="deputies" className="mt-5">
                <DeputiesBlock e={e} />
              </TabsContent>
            </Tabs>
          </Card>
          {e.candidateId && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-fg-subtle">
              <ShieldCheck className="size-3.5" aria-hidden />
              {t('fromOnboarding')}
            </p>
          )}
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsTab employeeId={e.id} />
        </TabsContent>
        <TabsContent value="personal">
          <PersonalTab employeeId={e.id} />
        </TabsContent>
        <TabsContent value="vacation">
          <VacationTab employeeId={e.id} canManage={canManage} />
        </TabsContent>
      </Tabs>

      {canManage && (
        <>
          <EditEmployeeDialog employee={e} open={dialog === 'edit'} onOpenChange={(o) => setDialog(o ? 'edit' : null)} />
          <TransferDialog employee={e} open={dialog === 'transfer'} onOpenChange={(o) => setDialog(o ? 'transfer' : null)} />
          <DismissalDialog employee={e} open={dialog === 'dismissal'} onOpenChange={(o) => setDialog(o ? 'dismissal' : null)} />
        </>
      )}
    </div>
  );
}
