'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Camera, ImageOff } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Badge, StatusPill, type Tone } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';
import { DataTable } from '@/components/ui/data-table';
import { DatePicker } from '@/components/ui/date-picker';
import { Sheet } from '@/components/ui/sheet';
import { searchEmployeeOptions, useMarks } from '@/lib/api/hooks/time';
import type { TimeMarkView } from '@/lib/api/types-time';
import { formatDate, formatDateTime } from '@/lib/format';
import { timeOf, todayStr } from './time-utils';

const verificationTone: Record<TimeMarkView['verification'], Tone> = { PASSED: 'green', FAILED: 'red', SKIPPED: 'gray' };
const typeTone: Record<TimeMarkView['type'], Tone> = { IN: 'green', OUT: 'blue', BREAK_START: 'orange', BREAK_END: 'teal' };

function Selfie({ url, alt, size = 36 }: { url: string | null; alt: string; size?: number }) {
  if (!url) {
    return (
      <span className="inline-flex items-center justify-center rounded-md border border-border bg-surface-muted text-fg-subtle" style={{ width: size, height: size }}>
        <ImageOff className="size-4" aria-hidden />
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} loading="lazy" className="rounded-md border border-border object-cover" style={{ width: size, height: size }} />;
}

/** "Отметки": raw marks with selfie thumbnails; a row opens the photo + geodata. */
export function MarksTab() {
  const t = useTranslations('time.marks');
  const tt = useTranslations('time.markType');
  const tv = useTranslations('time.verification');
  const locale = useLocale();
  const [date, setDate] = useState(() => todayStr());
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [open, setOpen] = useState<TimeMarkView | null>(null);
  const marks = useMarks({ date: date || undefined, employeeId: employeeId ?? undefined, page, pageSize });

  const columns = useMemo<ColumnDef<TimeMarkView, unknown>[]>(
    () => [
      {
        id: 'selfie',
        header: () => <span className="sr-only">{t('colSelfie')}</span>,
        meta: { label: t('colSelfie'), className: 'w-12' },
        cell: ({ row }) => <Selfie url={row.original.selfieUrl} alt={t('selfieOf', { name: row.original.employee.fullName })} />,
      },
      {
        id: 'employee',
        header: t('colEmployee'),
        meta: { label: t('colEmployee'), hideable: false },
        cell: ({ row }) => (
          <div className="min-w-[180px]">
            <div className="font-medium text-fg">{row.original.employee.shortName}</div>
            {row.original.employee.position && <div className="text-xs text-fg-subtle">{row.original.employee.position}</div>}
          </div>
        ),
      },
      { id: 'type', header: t('colType'), meta: { label: t('colType') }, cell: ({ row }) => <Badge tone={typeTone[row.original.type]}>{tt(row.original.type)}</Badge> },
      {
        id: 'at',
        header: t('colTime'),
        meta: { label: t('colTime'), className: 'whitespace-nowrap tabular' },
        cell: ({ row }) => (
          <span>
            <span className="font-semibold text-fg">{timeOf(row.original.at, locale)}</span>
            {!date && <span className="ml-1.5 text-fg-subtle">{formatDate(row.original.at, locale)}</span>}
          </span>
        ),
      },
      {
        id: 'distance',
        header: t('colDistance'),
        meta: { label: t('colDistance'), className: 'whitespace-nowrap tabular' },
        cell: ({ row }) => (row.original.distanceM === null ? <span className="text-fg-subtle">—</span> : t('meters', { value: row.original.distanceM })),
      },
      {
        id: 'verification',
        header: t('colVerification'),
        meta: { label: t('colVerification') },
        cell: ({ row }) => (
          <StatusPill tone={verificationTone[row.original.verification]} variant="dot">
            {tv(row.original.verification)}
          </StatusPill>
        ),
      },
      {
        id: 'source',
        header: t('colSource'),
        meta: { label: t('colSource') },
        cell: ({ row }) => (row.original.source === 'CORRECTION' ? <Badge tone="purple">{t('sourceCorrection')}</Badge> : <span className="text-fg-muted">{t('sourceSelf')}</span>),
      },
    ],
    [t, tt, tv, locale, date],
  );

  return (
    <>
      <DataTable
        label={t('tableLabel')}
        columns={columns}
        data={marks.data?.items}
        getRowId={(r) => r.id}
        isLoading={marks.isLoading}
        isFetching={marks.isFetching}
        error={marks.error}
        onRetry={() => marks.refetch()}
        onRowClick={setOpen}
        columnVisibilityKey="time-marks"
        pagination={
          marks.data
            ? { page, pageSize, total: marks.data.total, onPageChange: setPage, onPageSizeChange: (s) => { setPageSize(s); setPage(1); } }
            : undefined
        }
        toolbar={
          <>
            <DatePicker
              inputSize="sm"
              className="w-40"
              aria-label={t('date')}
              value={date}
              onChange={(v) => {
                setDate(v);
                setPage(1);
              }}
            />
            <Combobox
              size="sm"
              className="w-64"
              aria-label={t('employee')}
              placeholder={t('allEmployees')}
              value={employeeId}
              clearable
              loadOptions={searchEmployeeOptions}
              onChange={(v) => {
                setEmployeeId(v);
                setPage(1);
              }}
            />
          </>
        }
      />
      <Sheet open={Boolean(open)} onOpenChange={(o) => !o && setOpen(null)} title={open ? `${tt(open.type)} · ${open.employee.shortName}` : ''} description={open ? formatDateTime(open.at, locale) : undefined}>
        {open && (
          <div className="flex flex-col gap-5">
            {open.selfieUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={open.selfieUrl} alt={t('selfieOf', { name: open.employee.fullName })} className="aspect-square w-full rounded-xl border border-border object-cover" />
            ) : (
              <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong bg-surface-muted text-fg-subtle">
                <Camera className="size-8" aria-hidden />
                <span className="text-sm">{t('noSelfie')}</span>
              </div>
            )}
            <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-2.5 text-[13px]">
              <dt className="text-fg-subtle">{t('colEmployee')}</dt>
              <dd className="flex items-center gap-2 font-medium text-fg">
                <Avatar name={open.employee.fullName} size="xs" />
                {open.employee.fullName}
              </dd>
              <dt className="text-fg-subtle">{t('colType')}</dt>
              <dd>
                <Badge tone={typeTone[open.type]}>{tt(open.type)}</Badge>
              </dd>
              <dt className="text-fg-subtle">{t('colTime')}</dt>
              <dd className="font-medium text-fg tabular">{formatDateTime(open.at, locale)}</dd>
              <dt className="text-fg-subtle">{t('colDistance')}</dt>
              <dd className="text-fg tabular">{open.distanceM === null ? t('noGeo') : t('meters', { value: open.distanceM })}</dd>
              <dt className="text-fg-subtle">{t('colVerification')}</dt>
              <dd>
                <StatusPill tone={verificationTone[open.verification]}>{tv(open.verification)}</StatusPill>
                {open.verificationNote && <p className="mt-1 text-xs text-fg-muted">{open.verificationNote}</p>}
              </dd>
              <dt className="text-fg-subtle">{t('colSource')}</dt>
              <dd className="text-fg">{open.source === 'CORRECTION' ? t('sourceCorrection') : t('sourceSelf')}</dd>
            </dl>
          </div>
        )}
      </Sheet>
    </>
  );
}
