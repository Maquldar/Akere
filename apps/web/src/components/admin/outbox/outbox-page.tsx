'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { FlaskConical, Mail, MessageCircle, MessageSquareText, Send } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Badge, StatusPill } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { PageHeader } from '@/components/ui/page-header';
import { Sheet } from '@/components/ui/sheet';
import { EmptyState } from '@/components/ui/states';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RequireAccess } from '@/components/shell/require-access';
import { useOutbox } from '@/lib/api/hooks/org';
import type { ContactChannel, OutboxMessage } from '@/lib/api/types';
import { formatDateTime } from '@/lib/format';
import { hasRole } from '@/lib/permissions';

const channelIcon: Record<ContactChannel, typeof Mail> = { EMAIL: Mail, SMS: MessageSquareText, WHATSAPP: MessageCircle };
const channelTone = { EMAIL: 'blue', SMS: 'purple', WHATSAPP: 'green' } as const;

function ChannelBadge({ channel }: { channel: ContactChannel }) {
  const t = useTranslations('channels');
  const Icon = channelIcon[channel];
  return (
    <Badge tone={channelTone[channel]}>
      <Icon className="size-3" aria-hidden />
      {t(channel)}
    </Badge>
  );
}

export function OutboxPage() {
  const t = useTranslations('admin.outbox');
  const tch = useTranslations('channels');
  const locale = useLocale();
  const [channel, setChannel] = useState<'ALL' | ContactChannel>('ALL');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<OutboxMessage | null>(null);
  const q = useOutbox({ channel: channel === 'ALL' ? undefined : channel, page, pageSize });

  const columns = useMemo<ColumnDef<OutboxMessage, unknown>[]>(
    () => [
      {
        id: 'time',
        header: t('colTime'),
        meta: { label: t('colTime'), hideable: false, className: 'whitespace-nowrap tabular text-fg-muted' },
        cell: ({ row }) => formatDateTime(row.original.createdAt, locale),
      },
      { id: 'channel', header: t('colChannel'), meta: { label: t('colChannel') }, cell: ({ row }) => <ChannelBadge channel={row.original.channel} /> },
      {
        id: 'to',
        header: t('colTo'),
        meta: { label: t('colTo'), className: 'whitespace-nowrap tabular' },
        cell: ({ row }) => row.original.to,
      },
      {
        id: 'message',
        header: t('colMessage'),
        meta: { label: t('colMessage'), className: 'max-w-[420px]' },
        cell: ({ row }) => (
          <div className="min-w-[220px]">
            {row.original.subject && <div className="truncate font-medium text-fg">{row.original.subject}</div>}
            <div className="line-clamp-1 text-fg-muted">{row.original.body}</div>
          </div>
        ),
      },
      {
        id: 'status',
        header: t('colStatus'),
        meta: { label: t('colStatus') },
        cell: ({ row }) =>
          row.original.status === 'SENT' ? (
            <StatusPill tone="green">{t('sent')}</StatusPill>
          ) : (
            <StatusPill tone="red">{t('failed')}</StatusPill>
          ),
      },
    ],
    [t, locale],
  );

  return (
    <RequireAccess allow={(a) => hasRole(a, 'ADMIN')}>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="mb-4 flex items-start gap-3 rounded-xl border border-orange-border bg-orange-bg px-4 py-3 text-[13px] text-orange-fg">
        <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>
          <span className="font-semibold">{t('sandboxTitle')}</span> {t('sandboxText')}
        </p>
      </div>
      <Tabs
        value={channel}
        onValueChange={(v) => {
          setChannel(v as typeof channel);
          setPage(1);
        }}
        className="mb-3"
      >
        <TabsList aria-label={t('colChannel')}>
          <TabsTrigger value="ALL">{t('all')}</TabsTrigger>
          <TabsTrigger value="EMAIL">{tch('EMAIL')}</TabsTrigger>
          <TabsTrigger value="SMS">{tch('SMS')}</TabsTrigger>
          <TabsTrigger value="WHATSAPP">{tch('WHATSAPP')}</TabsTrigger>
        </TabsList>
      </Tabs>
      <DataTable
        label={t('title')}
        columns={columns}
        data={q.data?.items}
        getRowId={(r) => r.id}
        isLoading={q.isLoading}
        isFetching={q.isFetching}
        error={q.error}
        onRetry={() => q.refetch()}
        onRowClick={setSelected}
        columnVisibilityKey="admin-outbox"
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
        empty={<EmptyState compact icon={<Send aria-hidden />} title={t('empty')} description={t('emptyHint')} />}
      />
      <Sheet open={selected !== null} onOpenChange={(o) => !o && setSelected(null)} title={t('detailsTitle')}>
        {selected && (
          <div className="grid gap-4 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <ChannelBadge channel={selected.channel} />
              {selected.status === 'SENT' ? <StatusPill tone="green">{t('sent')}</StatusPill> : <StatusPill tone="red">{t('failed')}</StatusPill>}
              <span className="text-fg-subtle tabular">{formatDateTime(selected.createdAt, locale)}</span>
            </div>
            <div>
              <div className="section-label">{t('colTo')}</div>
              <div className="mt-0.5 break-all text-fg">{selected.to}</div>
            </div>
            {selected.subject && (
              <div>
                <div className="section-label">{t('subject')}</div>
                <div className="mt-0.5 font-medium text-fg">{selected.subject}</div>
              </div>
            )}
            <div>
              <div className="section-label">{t('body')}</div>
              <div className="mt-1 whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-muted p-3 text-fg">{selected.body}</div>
            </div>
            {selected.error && (
              <div role="alert" className="rounded-lg border border-red-border bg-red-bg p-3 text-red-fg">
                <div className="font-semibold">{t('error')}</div>
                <div className="mt-0.5 break-words">{selected.error}</div>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </RequireAccess>
  );
}
