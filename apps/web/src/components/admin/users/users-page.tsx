'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, Pencil, Plus, Search, ShieldCheck, UserCheck, UserX, UsersRound } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Badge, StatusPill } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { ConfirmDialog } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Tooltip } from '@/components/ui/popover';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { RequireAccess } from '@/components/shell/require-access';
import { ROLES, roleTone } from '@/components/shell/roles';
import { isApiError } from '@/lib/api/errors';
import { useLegalEntities, useSaveUser, useUsers } from '@/lib/api/hooks/org';
import type { Role, UserAdmin } from '@/lib/api/types';
import { formatDateTime } from '@/lib/format';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { can } from '@/lib/permissions';
import { UserDialog } from './user-dialog';

const ANY = 'any';

export function UsersPage() {
  const t = useTranslations('admin.users');
  const tc = useTranslations('common');
  const tr = useTranslations('roles');
  const locale = useLocale();
  const [q, setQ] = useState('');
  const [role, setRole] = useState<string>(ANY);
  const [status, setStatus] = useState<string>('active');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const debouncedQ = useDebounced(q.trim(), 300);
  const filter = {
    q: debouncedQ || undefined,
    role: role === ANY ? undefined : (role as Role),
    active: status === ANY ? undefined : status === 'active',
    page,
    pageSize,
  };
  const users = useUsers(filter);
  const entities = useLegalEntities();
  const save = useSaveUser();
  const [editing, setEditing] = useState<UserAdmin | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toDeactivate, setToDeactivate] = useState<UserAdmin | null>(null);

  const entityName = useMemo(() => new Map((entities.data ?? []).map((e) => [e.id, e.name])), [entities.data]);

  const setActive = (u: UserAdmin, isActive: boolean) =>
    save.mutate(
      { id: u.id, input: { isActive } },
      {
        onSuccess: () => {
          toast.success(isActive ? t('activated', { name: u.fullName }) : t('deactivated', { name: u.fullName }));
          setToDeactivate(null);
        },
        onError: (e) => toast.error(isApiError(e) ? e.message : tc('error')),
      },
    );

  const columns = useMemo<ColumnDef<UserAdmin, unknown>[]>(
    () => [
      {
        id: 'user',
        header: t('colUser'),
        meta: { label: t('colUser'), hideable: false },
        cell: ({ row }) => (
          <div className="flex min-w-[220px] items-center gap-2.5">
            <Avatar name={row.original.fullName} />
            <div className="min-w-0">
              <div className="truncate font-medium text-fg">{row.original.fullName}</div>
              <div className="truncate text-xs text-fg-subtle">{row.original.email}</div>
            </div>
          </div>
        ),
      },
      {
        id: 'phone',
        header: t('colPhone'),
        meta: { label: t('colPhone'), className: 'whitespace-nowrap tabular' },
        cell: ({ row }) => row.original.phone ?? '—',
      },
      {
        id: 'roles',
        header: t('colRoles'),
        meta: { label: t('colRoles') },
        cell: ({ row }) => (
          <div className="flex min-w-[180px] flex-wrap gap-1">
            {row.original.roles.map((r, i) => {
              const scope = r.legalEntityId ? entityName.get(r.legalEntityId) : null;
              const label = scope ? `${tr(r.role)} · ${scope}` : tr(r.role);
              return (
                <Badge key={i} tone={roleTone[r.role]} title={label} className="max-w-[240px]">
                  {r.canSign && <ShieldCheck className="size-3 shrink-0" aria-label={t('canSign')} />}
                  <span className="truncate">{label}</span>
                </Badge>
              );
            })}
          </div>
        ),
      },
      {
        id: 'status',
        header: t('colStatus'),
        meta: { label: t('colStatus') },
        cell: ({ row }) =>
          row.original.isActive ? <StatusPill tone="green">{t('active')}</StatusPill> : <StatusPill tone="gray">{t('inactive')}</StatusPill>,
      },
      {
        id: 'lastLogin',
        header: t('colLastLogin'),
        meta: { label: t('colLastLogin'), className: 'whitespace-nowrap tabular text-fg-muted' },
        cell: ({ row }) => (row.original.lastLoginAt ? formatDateTime(row.original.lastLoginAt, locale) : t('never')),
      },
      {
        id: 'employee',
        header: t('colEmployee'),
        meta: { label: t('colEmployee') },
        cell: ({ row }) =>
          row.original.employeeId ? (
            <Tooltip content={t('hasEmployee')}>
              <span className="inline-flex text-green-fg">
                <UserCheck className="size-4" aria-label={t('hasEmployee')} />
              </span>
            </Tooltip>
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{tc('actions')}</span>,
        meta: { hideable: false, className: 'w-12 text-right' },
        cell: ({ row }) => {
          const u = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={tc('actionsFor', { name: u.fullName })}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  onSelect={() => {
                    setEditing(u);
                    setDialogOpen(true);
                  }}
                >
                  <Pencil aria-hidden />
                  {tc('edit')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {u.isActive ? (
                  <DropdownMenuItem danger onSelect={() => setToDeactivate(u)}>
                    <UserX aria-hidden />
                    {t('deactivate')}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => setActive(u, true)}>
                    <UserCheck aria-hidden />
                    {t('activate')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, tc, tr, locale, entityName],
  );

  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  return (
    <RequireAccess allow={(a) => can(a, 'users.manage')}>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus />
            {t('add')}
          </Button>
        }
      />
      <DataTable
        label={t('title')}
        columns={columns}
        data={users.data?.items}
        getRowId={(u) => u.id}
        isLoading={users.isLoading}
        isFetching={users.isFetching}
        error={users.error}
        onRetry={() => users.refetch()}
        columnVisibilityKey="admin-users"
        pagination={
          users.data && {
            page,
            pageSize,
            total: users.data.total,
            onPageChange: setPage,
            onPageSizeChange: resetPage(setPageSize),
          }
        }
        toolbar={
          <>
            <Input
              type="search"
              aria-label={t('searchLabel')}
              placeholder={t('searchPlaceholder')}
              leftIcon={<Search />}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              className="w-full sm:w-72"
            />
            <Select
              aria-label={t('filterRole')}
              className="w-full sm:w-48"
              value={role}
              onValueChange={resetPage(setRole)}
              options={[{ value: ANY, label: t('allRoles') }, ...ROLES.map((r) => ({ value: r, label: tr(r) }))]}
            />
            <Select
              aria-label={t('filterStatus')}
              className="w-full sm:w-44"
              value={status}
              onValueChange={resetPage(setStatus)}
              options={[
                { value: 'active', label: t('statusActive') },
                { value: 'inactive', label: t('statusInactive') },
                { value: ANY, label: t('statusAll') },
              ]}
            />
          </>
        }
        empty={
          <EmptyState
            compact
            icon={<UsersRound aria-hidden />}
            title={debouncedQ || role !== ANY ? tc('nothingFound') : t('empty')}
            description={debouncedQ || role !== ANY ? tc('tryOtherFilters') : t('emptyHint')}
          />
        }
      />
      <UserDialog open={dialogOpen} onOpenChange={setDialogOpen} user={editing} />
      <ConfirmDialog
        open={toDeactivate !== null}
        onOpenChange={(o) => !o && setToDeactivate(null)}
        title={t('deactivateTitle')}
        description={toDeactivate ? t('deactivateText', { name: toDeactivate.fullName }) : undefined}
        confirmLabel={t('deactivate')}
        onConfirm={() => toDeactivate && setActive(toDeactivate, false)}
        loading={save.isPending}
      />
    </RequireAccess>
  );
}
