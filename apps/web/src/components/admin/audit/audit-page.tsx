'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { FilterX, ScrollText } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { DataTable } from '@/components/ui/data-table';
import { DateRangeInput, type DateRange } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Sheet } from '@/components/ui/sheet';
import { EmptyState } from '@/components/ui/states';
import { RequireAccess } from '@/components/shell/require-access';
import { useAudit, searchUsers } from '@/lib/api/hooks/org';
import type { AuditEntry } from '@/lib/api/types';
import { formatDateTime } from '@/lib/format';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { can } from '@/lib/permissions';

function actionTone(action: string) {
  const a = action.toLowerCase();
  if (/(delete|remove|revoke|reject|deactivat|fail)/.test(a)) return 'red' as const;
  if (/(create|add|sign|approve|activat|login)/.test(a)) return 'green' as const;
  if (/(update|edit|change|patch)/.test(a)) return 'blue' as const;
  return 'gray' as const;
}

export function AuditPage() {
  const t = useTranslations('admin.audit');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [range, setRange] = useState<DateRange>({});
  const [actor, setActor] = useState<{ id: string; label: string } | null>(null);
  const [entityType, setEntityType] = useState('');
  const [entityId, setEntityId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const dType = useDebounced(entityType.trim(), 300);
  const dId = useDebounced(entityId.trim(), 300);

  const q = useAudit({
    from: range.from,
    to: range.to,
    actorId: actor?.id,
    entityType: dType || undefined,
    entityId: dId || undefined,
    page,
    pageSize,
  });
  const hasFilters = Boolean(range.from || range.to || actor || dType || dId);
  const reset = () => {
    setRange({});
    setActor(null);
    setEntityType('');
    setEntityId('');
    setPage(1);
  };

  const columns = useMemo<ColumnDef<AuditEntry, unknown>[]>(
    () => [
      {
        id: 'time',
        header: t('colTime'),
        meta: {
          label: t('colTime'),
          hideable: false,
          className: 'whitespace-nowrap tabular text-fg-muted',
          filter: (
            <DateRangeInput
              inputSize="sm"
              value={range}
              onChange={(r) => {
                setRange(r);
                setPage(1);
              }}
              className="min-w-[260px]"
            />
          ),
        },
        cell: ({ row }) => formatDateTime(row.original.createdAt, locale),
      },
      {
        id: 'actor',
        header: t('colActor'),
        meta: {
          label: t('colActor'),
          filter: (
            <Combobox
              size="sm"
              aria-label={t('filterActor')}
              placeholder={t('anyActor')}
              className="min-w-[200px]"
              value={actor?.id ?? null}
              selectedOption={actor ? { value: actor.id, label: actor.label } : null}
              loadOptions={searchUsers}
              onChange={(v, o) => {
                setActor(v && o ? { id: v, label: o.label } : null);
                setPage(1);
              }}
            />
          ),
        },
        cell: ({ row }) =>
          row.original.actor ? (
            <div className="flex min-w-[180px] items-center gap-2">
              <Avatar name={row.original.actor.fullName} size="xs" />
              <span className="truncate">{row.original.actor.fullName}</span>
            </div>
          ) : (
            <span className="text-fg-subtle">{t('system')}</span>
          ),
      },
      {
        id: 'action',
        header: t('colAction'),
        meta: { label: t('colAction') },
        cell: ({ row }) => (
          <Badge tone={actionTone(row.original.action)} className="font-mono text-[11px]">
            {row.original.action}
          </Badge>
        ),
      },
      {
        id: 'entity',
        header: t('colEntity'),
        meta: {
          label: t('colEntity'),
          filter: (
            <div className="flex min-w-[260px] gap-1.5">
              <Input
                inputSize="sm"
                aria-label={t('filterEntityType')}
                placeholder={t('entityTypePlaceholder')}
                value={entityType}
                onChange={(e) => {
                  setEntityType(e.target.value);
                  setPage(1);
                }}
              />
              <Input
                inputSize="sm"
                aria-label={t('filterEntityId')}
                placeholder="ID"
                value={entityId}
                onChange={(e) => {
                  setEntityId(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          ),
        },
        cell: ({ row }) => (
          <div className="min-w-[160px]">
            <div className="font-medium">{row.original.entityType}</div>
            {row.original.entityId && <div className="truncate font-mono text-[11px] text-fg-subtle">{row.original.entityId}</div>}
          </div>
        ),
      },
      {
        id: 'ip',
        header: t('colIp'),
        meta: { label: t('colIp'), className: 'font-mono text-xs text-fg-muted whitespace-nowrap' },
        cell: ({ row }) => row.original.ip ?? '—',
      },
      {
        id: 'details',
        header: () => <span className="sr-only">{t('details')}</span>,
        meta: { hideable: false, className: 'text-right' },
        cell: ({ row }) => (
          <Button variant="ghost" size="sm" onClick={() => setSelected(row.original)}>
            {t('details')}
          </Button>
        ),
      },
    ],
    [t, locale, range, actor, entityType, entityId],
  );

  return (
    <RequireAccess allow={(a) => can(a, 'audit.read')}>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          hasFilters && (
            <Button variant="outline" onClick={reset}>
              <FilterX />
              {tc('resetFilters')}
            </Button>
          )
        }
      />
      <DataTable
        label={t('title')}
        columns={columns}
        data={q.data?.items}
        getRowId={(r) => r.id}
        isLoading={q.isLoading}
        isFetching={q.isFetching}
        error={q.error}
        onRetry={() => q.refetch()}
        columnVisibilityKey="admin-audit"
        pagination={
          q.data && {
            page,
            pageSize,
            total: q.data.total,
            onPageChange: setPage,
            onPageSizeChange: (s) => {
              setPageSize(s);
              setPage(1);
            },
          }
        }
        empty={
          <EmptyState
            compact
            icon={<ScrollText aria-hidden />}
            title={hasFilters ? tc('nothingFound') : t('empty')}
            description={hasFilters ? tc('tryOtherFilters') : t('emptyHint')}
          />
        }
      />
      <Sheet open={selected !== null} onOpenChange={(o) => !o && setSelected(null)} title={t('detailsTitle')}>
        {selected && (
          <dl className="grid gap-4 text-[13px]">
            {(
              [
                [t('colTime'), formatDateTime(selected.createdAt, locale)],
                [t('colActor'), selected.actor?.fullName ?? t('system')],
                [t('colAction'), selected.action],
                [t('colEntity'), selected.entityType],
                ['ID', selected.entityId ?? '—'],
                [t('colIp'), selected.ip ?? '—'],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <dt className="section-label">{k}</dt>
                <dd className="mt-0.5 break-all text-fg">{v}</dd>
              </div>
            ))}
            <div>
              <dt className="section-label">{t('meta')}</dt>
              <dd className="mt-1">
                <pre className="max-h-[50dvh] overflow-auto rounded-lg border border-border bg-surface-muted p-3 font-mono text-xs text-fg">
                  {JSON.stringify(selected.meta ?? null, null, 2)}
                </pre>
              </dd>
            </div>
          </dl>
        )}
      </Sheet>
    </RequireAccess>
  );
}
