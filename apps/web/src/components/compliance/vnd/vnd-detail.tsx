'use client';

import { CalendarClock, Download, FileSignature, Send, ShieldCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toaster';
import { RequireAccess } from '@/components/shell/require-access';
import { isApiError } from '@/lib/api/errors';
import { useSendVnd, useVnd } from '@/lib/api/hooks/compliance';
import type { VndDetail } from '@/lib/api/types-compliance';
import { formatDate, formatDateTime } from '@/lib/format';
import { can } from '@/lib/permissions';
import { PdfViewer } from '../pdf-viewer';
import { DownloadButton, VndStatusLabel } from '../status';
import { VndAcknowledgeDialog } from './vnd-acknowledge-dialog';
import { VndRecipients } from './vnd-recipients';

export function VndDetailPage({ id }: { id: string }) {
  const t = useTranslations('vnd');
  const td = useTranslations('vnd.detail');
  const tc = useTranslations('common');
  const locale = useLocale();
  const vnd = useVnd(id);
  const send = useSendVnd(id);
  const [tab, setTab] = useState('document');
  const [confirmSend, setConfirmSend] = useState(false);
  const [ackOpen, setAckOpen] = useState(false);

  if (vnd.isLoading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-[480px] w-full" />
      </div>
    );
  }
  if (vnd.error || !vnd.data) {
    return (
      <Card className="mt-4">
        <ErrorState error={vnd.error} onRetry={() => vnd.refetch()} />
      </Card>
    );
  }
  const d = vnd.data;
  const canManage = Boolean(d.canManage);
  const canAck = d.canAcknowledge ?? (d.status === 'IN_ROUTE' && d.myStatus === 'PENDING');
  const pct = d.total ? Math.round((d.acknowledged / d.total) * 100) : 0;

  const doSend = () =>
    send.mutate(undefined, {
      onSuccess: () => {
        toast.success(td('sent'));
        setConfirmSend(false);
      },
      onError: (e) => {
        setConfirmSend(false);
        if (isApiError(e) && e.rule === 'NO_RECIPIENTS') {
          toast.error(td('noRecipients'));
          setTab('recipients');
        } else toast.error(isApiError(e) ? e.message : tc('error'));
      },
    });

  const sheetName = `${td('sheetFile')}_${d.number ?? d.title}.xlsx`;

  return (
    <RequireAccess allow={(a) => can(a, 'vnd.read')}>
      <PageHeader
        breadcrumbs={[{ label: t('title'), href: '/vnd' }, { label: d.title }]}
        title={d.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <VndStatusLabel status={d.status} />
            {d.number && <span className="tabular">№{d.number}</span>}
            <span>{d.type.name}</span>
            <span>{d.legalEntity.name}</span>
          </span>
        }
        actions={
          <>
            {canAck && (
              <Button onClick={() => setAckOpen(true)}>
                <FileSignature />
                {td('acknowledge')}
              </Button>
            )}
            {canManage && d.status === 'DRAFT' && (
              <Button onClick={() => setConfirmSend(true)}>
                <Send />
                {td('send')}
              </Button>
            )}
            {(canManage || d.total > 0) && d.status !== 'DRAFT' && (
              <DownloadButton path={`/vnd/${d.id}/sheet`} filename={sheetName}>
                <Download aria-hidden />
                {td('sheet')}
              </DownloadButton>
            )}
          </>
        }
      />

      {d.myStatus === 'ACKNOWLEDGED' && (
        <div role="status" className="mb-4 flex items-center gap-2 rounded-lg border border-green-border bg-green-bg px-3 py-2 text-[13px] text-green-fg">
          <ShieldCheck className="size-4 shrink-0" aria-hidden />
          {td('youAcknowledged')}
        </div>
      )}
      {canAck && (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-orange-border bg-orange-bg px-3 py-2 text-[13px] text-orange-fg">
          <FileSignature className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">{d.dueAt ? td('ackRequiredDue', { date: formatDate(d.dueAt, locale) }) : td('ackRequired')}</span>
        </div>
      )}

      <SummaryCard d={d} pct={pct} />

      <Tabs value={tab} onValueChange={setTab} className="mt-5">
        <TabsList aria-label={td('tabsLabel')}>
          <TabsTrigger value="document">{td('tabDocument')}</TabsTrigger>
          {canManage && <TabsTrigger value="recipients">{td('tabRecipients', { count: d.total })}</TabsTrigger>}
        </TabsList>
        <TabsContent value="document">
          <Card>
            <CardBody>
              <DocumentPreview d={d} />
            </CardBody>
          </Card>
        </TabsContent>
        {canManage && (
          <TabsContent value="recipients">
            <VndRecipients vnd={d} />
          </TabsContent>
        )}
      </Tabs>

      <ConfirmDialog
        open={confirmSend}
        onOpenChange={setConfirmSend}
        tone="primary"
        title={td('sendTitle')}
        description={d.total ? td('sendText', { count: d.total }) : td('noRecipients')}
        confirmLabel={td('send')}
        onConfirm={doSend}
        loading={send.isPending}
      />
      {canAck && <VndAcknowledgeDialog open={ackOpen} onOpenChange={setAckOpen} vnd={d} />}
    </RequireAccess>
  );
}

function SummaryCard({ d, pct }: { d: VndDetail; pct: number }) {
  const td = useTranslations('vnd.detail');
  const locale = useLocale();
  const items: { label: string; value: React.ReactNode }[] = [
    { label: td('author'), value: d.author.fullName },
    { label: td('sentAt'), value: d.sentAt ? formatDateTime(d.sentAt, locale) : td('notSent') },
    {
      label: td('dueAt'),
      value: d.dueAt ? (
        <span className="inline-flex items-center gap-1">
          <CalendarClock className="size-3.5 text-fg-subtle" aria-hidden />
          {formatDate(d.dueAt, locale)}
        </span>
      ) : (
        '—'
      ),
    },
    {
      label: td('method'),
      value: d.requireSignature === false ? <Badge tone="gray">{td('methodClick')}</Badge> : <Badge tone="blue">{td('methodSign')}</Badge>,
    },
  ];
  return (
    <Card>
      <CardBody className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          {items.map((i) => (
            <div key={i.label} className="min-w-0">
              <dt className="text-xs text-fg-subtle">{i.label}</dt>
              <dd className="mt-0.5 truncate text-sm font-medium text-fg">{i.value}</dd>
            </div>
          ))}
        </dl>
        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-fg-subtle">{td('progress')}</span>
            <span className="text-sm font-semibold tabular text-fg" data-testid="vnd-progress">
              {d.acknowledged} <span className="font-medium text-fg-subtle">/ {d.total}</span>
            </span>
          </div>
          <div
            className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-active"
            role="progressbar"
            aria-label={td('progress')}
            aria-valuemin={0}
            aria-valuemax={d.total || 1}
            aria-valuenow={d.acknowledged}
          >
            <div className={pct === 100 ? 'h-full rounded-full bg-green-solid' : 'h-full rounded-full bg-primary'} style={{ width: `${pct}%` }} />
          </div>
          <span className="mt-1 block text-xs text-fg-subtle tabular">{td('progressPct', { pct })}</span>
        </div>
      </CardBody>
    </Card>
  );
}

function DocumentPreview({ d }: { d: VndDetail }) {
  const td = useTranslations('vnd.detail');
  const isPdf = (d.fileName ?? '').toLowerCase().endsWith('.pdf');
  const previewUrl = isPdf ? d.fileUrl : (d.pdfUrl ?? null);
  return (
    <div className="grid gap-4">
      {!isPdf && d.fileUrl && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-[13px]">
          <span className="min-w-0 flex-1 text-fg-muted">{td('docxNote', { name: d.fileName ?? 'docx' })}</span>
          <Button asChild variant="outline" size="sm">
            <a href={`${d.fileUrl}?download=1`}>
              <Download aria-hidden />
              {td('downloadOriginal')}
            </a>
          </Button>
        </div>
      )}
      {d.signedPdfUrl && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-green-border bg-green-bg px-3 py-2.5 text-[13px] text-green-fg">
          <ShieldCheck className="size-4" aria-hidden />
          <span className="flex-1">{td('signedAvailable')}</span>
          <Button asChild variant="outline" size="sm">
            <a href={d.signedPdfUrl} target="_blank" rel="noopener noreferrer">
              {td('openSigned')}
            </a>
          </Button>
        </div>
      )}
      {previewUrl ? <PdfViewer url={previewUrl} title={isPdf ? (d.fileName ?? d.title) : td('coverTitle')} /> : <p className="text-sm text-fg-muted">{td('noPreview')}</p>}
    </div>
  );
}
