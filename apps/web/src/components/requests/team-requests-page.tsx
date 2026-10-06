'use client';

import { ListChecks } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { DataTable } from '@/components/ui/data-table';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { SkeletonList } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RequireAccess } from '@/components/shell/require-access';
import { useCurrentUser } from '@/components/shell/me-context';
import { useRouter } from '@/i18n/navigation';
import { searchEmployees, useRequests, useRequestTypes } from '@/lib/api/hooks/requests';
import { REQUEST_STATUSES, type RequestScope, type RequestStatus } from '@/lib/api/types-requests';
import { can, hasRole } from '@/lib/permissions';
import { RequestCards, useRequestColumns } from './my-requests-page';
import { useTypeName } from './shared';

const ANY = 'any';

export function TeamRequestsPage() {
  const t = useTranslations('requests.team');
  const ts = useTranslations('requests.status');
  const tc = useTranslations('common');
  const router = useRouter();
  const typeName = useTypeName();
  const { access } = useCurrentUser();
  const isHr = hasRole(access, 'HR', 'ADMIN');
  const canTeam = access.isManager;
  const [scope, setScope] = useState<RequestScope>(isHr ? 'all' : 'team');
  const [status, setStatus] = useState<string>(ANY);
  const [typeId, setTypeId] = useState<string>(ANY);
  const [employee, setEmployee] = useState<ComboOption | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const types = useRequestTypes();
  const filter = {
    scope,
    status: status === ANY ? undefined : (status as RequestStatus),
    requestTypeId: typeId === ANY ? undefined : typeId,
    employeeId: employee?.value,
    page,
    pageSize,
  };
  const list = useRequests(filter);
  const columns = useRequestColumns(true);
  const filtered = status !== ANY || typeId !== ANY || employee !== null;
  const reset = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  const filters = (
    <>
      <Select
        aria-label={t('filterStatus')}
        className="w-full sm:w-52"
        value={status}
        onValueChange={reset(setStatus)}
        options={[
          { value: ANY, label: t('allStatuses') },
          ...REQUEST_STATUSES.filter((s) => s !== 'DRAFT').map((s) => ({ value: s, label: ts(s) })),
        ]}
      />
      <Select
        aria-label={t('filterType')}
        className="w-full sm:w-64"
        value={typeId}
        onValueChange={reset(setTypeId)}
        options={[{ value: ANY, label: t('allTypes') }, ...(types.data ?? []).map((ty) => ({ value: ty.id, label: typeName(ty) }))]}
      />
      <Combobox
        aria-label={t('filterEmployee')}
        className="w-full sm:w-64"
        value={employee?.value ?? null}
        selectedOption={employee}
        onChange={(_v, o) => reset(setEmployee)(o)}
        loadOptions={searchEmployees}
        placeholder={t('allEmployees')}
        clearable
      />
    </>
  );
  const empty = (
    <EmptyState
      compact
      icon={<ListChecks aria-hidden />}
      title={filtered ? tc('nothingFound') : t('empty')}
      description={filtered ? tc('tryOtherFilters') : t('emptyHint')}
    />
  );

  return (
    <RequireAccess allow={(a) => can(a, 'request.read') && (hasRole(a, 'HR', 'ADMIN') || a.isManager)}>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      {isHr && canTeam && (
        <Tabs
          value={scope}
          onValueChange={(v) => {
            setScope(v as RequestScope);
            setPage(1);
          }}
          className="mb-4"
        >
          <TabsList aria-label={t('scopeLabel')}>
            <TabsTrigger value="team">{t('scopeTeam')}</TabsTrigger>
            <TabsTrigger value="all">{t('scopeAll')}</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      <div className="hidden md:block">
        <DataTable
          label={t('title')}
          columns={columns}
          data={list.data?.items}
          getRowId={(r) => r.id}
          isLoading={list.isLoading}
          isFetching={list.isFetching}
          error={list.error}
          onRetry={() => list.refetch()}
          onRowClick={(r) => router.push(`/requests/${r.id}`)}
          columnVisibilityKey="requests-team"
          toolbar={filters}
          pagination={
            list.data && {
              page,
              pageSize,
              total: list.data.total,
              onPageChange: setPage,
              onPageSizeChange: (s) => {
                setPageSize(s);
                setPage(1);
              },
            }
          }
          empty={empty}
        />
      </div>
      <div className="flex flex-col gap-3 md:hidden">
        {filters}
        {list.isLoading && <SkeletonList rows={4} className="rounded-xl border border-border bg-surface p-4" />}
        {list.isError && !list.data && <ErrorState error={list.error} onRetry={() => list.refetch()} compact />}
        {list.data && list.data.items.length === 0 && <div className="rounded-xl border border-border bg-surface">{empty}</div>}
        {list.data && list.data.items.length > 0 && <RequestCards items={list.data.items} showEmployee />}
        {list.data && list.data.total > pageSize && <Pagination page={page} pageSize={pageSize} total={list.data.total} onPageChange={setPage} />}
      </div>
    </RequireAccess>
  );
}
