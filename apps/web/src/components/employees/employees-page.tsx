'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Search, Users } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { StatusPill } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/states';
import { RequireAccess } from '@/components/shell/require-access';
import { EmployeePicker } from '@/components/documents/employee-picker';
import { useRouter } from '@/i18n/navigation';
import { useEmployees } from '@/lib/api/hooks/documents';
import { useDepartments, useLegalEntities, usePositions } from '@/lib/api/hooks/org';
import type { EmployeeListItem, EmployeeStatus } from '@/lib/api/types-documents';
import { formatDate } from '@/lib/format';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { can } from '@/lib/permissions';

const ANY = 'any';

export function EmployeesPage() {
  const t = useTranslations('employees.list');
  const ts = useTranslations('employees.status');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [entity, setEntity] = useState(ANY);
  const [dept, setDept] = useState(ANY);
  const [position, setPosition] = useState(ANY);
  const [status, setStatus] = useState<string>('ACTIVE');
  const [manager, setManager] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const debouncedQ = useDebounced(q.trim(), 300);
  const entities = useLegalEntities();
  const deptEntity = entity !== ANY ? entity : entities.data?.length === 1 ? entities.data[0]!.id : undefined;
  const departments = useDepartments(deptEntity);
  const positions = usePositions();
  const list = useEmployees({
    q: debouncedQ || undefined,
    legalEntityId: entity === ANY ? undefined : entity,
    departmentId: dept === ANY ? undefined : dept,
    positionId: position === ANY ? undefined : position,
    status: status === ANY ? undefined : (status as EmployeeStatus),
    managerId: manager ?? undefined,
    page,
    pageSize,
  });
  const filtered = Boolean(debouncedQ || entity !== ANY || dept !== ANY || position !== ANY || status !== 'ACTIVE' || manager);
  const reset = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  const columns = useMemo<ColumnDef<EmployeeListItem, unknown>[]>(
    () => [
      {
        id: 'name',
        header: t('colName'),
        meta: { label: t('colName'), hideable: false },
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
      { id: 'tab', header: t('colTab'), meta: { label: t('colTab'), className: 'tabular whitespace-nowrap' }, cell: ({ row }) => row.original.tabNumber },
      {
        id: 'position',
        header: t('colPosition'),
        meta: { label: t('colPosition') },
        cell: ({ row }) => (
          <div className="min-w-[160px]">
            <div className="truncate">{row.original.position?.name ?? '—'}</div>
            <div className="truncate text-xs text-fg-subtle">{row.original.department?.name ?? ''}</div>
          </div>
        ),
      },
      { id: 'entity', header: t('colEntity'), meta: { label: t('colEntity'), className: 'text-fg-muted max-w-[200px] truncate' }, cell: ({ row }) => row.original.legalEntity.name },
      { id: 'manager', header: t('colManager'), meta: { label: t('colManager'), className: 'whitespace-nowrap text-fg-muted' }, cell: ({ row }) => row.original.manager?.shortName ?? '—' },
      {
        id: 'status',
        header: t('colStatus'),
        meta: { label: t('colStatus') },
        cell: ({ row }) => <StatusPill tone={row.original.status === 'ACTIVE' ? 'green' : 'gray'}>{ts(row.original.status)}</StatusPill>,
      },
      { id: 'hire', header: t('colHire'), meta: { label: t('colHire'), className: 'tabular whitespace-nowrap text-fg-muted' }, cell: ({ row }) => formatDate(row.original.hireDate, locale) },
    ],
    [t, ts, locale],
  );

  return (
    <RequireAccess allow={(a) => can(a, 'employee.read')}>
      <PageHeader title={t('title')} subtitle={list.data ? t('total', { count: list.data.total }) : t('subtitle')} />
      <DataTable
        label={t('title')}
        columns={columns}
        data={list.data?.items}
        getRowId={(e) => e.id}
        isLoading={list.isLoading}
        isFetching={list.isFetching}
        error={list.error}
        onRetry={() => list.refetch()}
        onRowClick={(e) => router.push(`/employees/${e.id}`)}
        columnVisibilityKey="employees"
        pagination={list.data && { page, pageSize, total: list.data.total, onPageChange: setPage, onPageSizeChange: reset(setPageSize) }}
        toolbar={
          <>
            <Input
              type="search"
              aria-label={t('search')}
              placeholder={t('searchPlaceholder')}
              leftIcon={<Search />}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              className="w-full sm:w-64"
            />
            {(entities.data?.length ?? 0) > 1 && (
              <Select
                aria-label={t('filterEntity')}
                className="w-full sm:w-52"
                value={entity}
                onValueChange={(v) => {
                  reset(setEntity)(v);
                  setDept(ANY);
                }}
                options={[{ value: ANY, label: t('allEntities') }, ...(entities.data ?? []).map((e) => ({ value: e.id, label: e.name }))]}
              />
            )}
            <Select
              aria-label={t('filterDepartment')}
              className="w-full sm:w-48"
              value={dept}
              disabled={!deptEntity}
              onValueChange={reset(setDept)}
              options={[{ value: ANY, label: t('allDepartments') }, ...(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))]}
            />
            <Select
              aria-label={t('filterPosition')}
              className="w-full sm:w-48"
              value={position}
              onValueChange={reset(setPosition)}
              options={[{ value: ANY, label: t('allPositions') }, ...(positions.data ?? []).map((p) => ({ value: p.id, label: p.name }))]}
            />
            <Select
              aria-label={t('filterStatus')}
              className="w-full sm:w-40"
              value={status}
              onValueChange={reset(setStatus)}
              options={[
                { value: 'ACTIVE', label: ts('ACTIVE') },
                { value: 'TERMINATED', label: ts('TERMINATED') },
                { value: ANY, label: t('allStatuses') },
              ]}
            />
            <EmployeePicker
              aria-label={t('filterManager')}
              className="w-full sm:w-56"
              value={manager}
              onChange={(v) => reset(setManager)(v)}
              placeholder={t('filterManager')}
            />
            {filtered && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setQ('');
                  setEntity(ANY);
                  setDept(ANY);
                  setPosition(ANY);
                  setStatus('ACTIVE');
                  setManager(null);
                  setPage(1);
                }}
              >
                {tc('resetFilters')}
              </Button>
            )}
          </>
        }
        empty={
          <EmptyState
            compact
            icon={<Users aria-hidden />}
            title={filtered ? tc('nothingFound') : t('empty')}
            description={filtered ? tc('tryOtherFilters') : undefined}
          />
        }
      />
    </RequireAccess>
  );
}
