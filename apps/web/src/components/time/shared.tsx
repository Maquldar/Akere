'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { StatusPill, type Tone } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { AbsenceView, ApprovalStatus, ShiftView, TimeRequestView } from '@/lib/api/types-time';
import { absenceTone, hm, shiftChipClass, shiftRange, spanTitle } from './time-utils';

/** "9ч 29м" / "45м" / "8ч". */
export function useDuration() {
  const t = useTranslations('time.common');
  return useCallback(
    (minutes: number | null | undefined, opts: { sign?: boolean; zero?: string } = {}) => {
      if (minutes === null || minutes === undefined) return '—';
      const { h, m } = hm(minutes);
      if (h === 0 && m === 0) return opts.zero ?? t('durationM', { m: 0 });
      const body = h === 0 ? t('durationM', { m }) : m === 0 ? t('durationH', { h }) : t('durationHM', { h, m });
      if (!opts.sign) return body;
      return `${minutes < 0 ? '−' : '+'}${body}`;
    },
    [t],
  );
}

/** Ticks every `ms` (client only) for live timers. */
export function useNow(ms = 30_000): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Colored shift chip (M4 "5/2 Разработка 10:00–19:00"). Drafts are dashed. */
export function ShiftChip({
  shift,
  onClick,
  compact,
  className,
  extra,
}: {
  shift: Pick<ShiftView, 'title' | 'color' | 'startAt' | 'endAt' | 'status'>;
  onClick?: () => void;
  compact?: boolean;
  className?: string;
  extra?: ReactNode;
}) {
  const t = useTranslations('time.common');
  const locale = useLocale();
  const c = shiftChipClass[shift.color];
  const draft = shift.status === 'DRAFT';
  const content = (
    <>
      <span className={cn('absolute inset-y-1 left-1 w-[3px] rounded-full', c.bar)} aria-hidden />
      <span className="block min-w-0 truncate text-[12.5px] font-semibold leading-4 text-fg">{shift.title}</span>
      {!compact && (
        <span className="flex items-center gap-1.5 text-[11.5px] leading-4 text-fg-muted tabular">
          {shiftRange(shift, locale)}
          {draft && <span className="rounded bg-surface/80 px-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">{t('draft')}</span>}
        </span>
      )}
      {extra}
    </>
  );
  const cls = cn(
    'relative flex w-full min-w-0 flex-col items-start rounded-md border py-1 pl-3 pr-2 text-left',
    c.bg,
    draft && 'border-dashed',
    onClick && 'focus-ring cursor-pointer transition-shadow hover:shadow-[0_1px_4px_rgb(16_24_40/0.12)]',
    className,
  );
  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick} aria-label={`${shift.title}, ${shiftRange(shift, locale)}${draft ? `, ${t('draft')}` : ''}`}>
        {content}
      </button>
    );
  }
  return <div className={cls}>{content}</div>;
}

/** Absence span chip ("Больничный 10 — 14 июн"). */
export function AbsenceChip({ absence, className }: { absence: AbsenceView; className?: string }) {
  const t = useTranslations('time.absenceKind');
  const locale = useLocale();
  const tone = absenceTone[absence.kind];
  const bg: Record<Tone, string> = {
    red: 'bg-red-bg border-red-border text-red-fg',
    blue: 'bg-blue-bg border-blue-border text-blue-fg',
    green: 'bg-green-bg border-green-border text-green-fg',
    orange: 'bg-orange-bg border-orange-border text-orange-fg',
    gray: 'bg-gray-bg border-gray-border text-gray-fg',
    purple: 'bg-purple-bg border-purple-border text-purple-fg',
    teal: 'bg-teal-bg border-teal-border text-teal-fg',
  };
  const bar: Record<Tone, string> = {
    red: 'bg-red-solid', blue: 'bg-blue-solid', green: 'bg-green-solid', orange: 'bg-orange-solid', gray: 'bg-gray-solid', purple: 'bg-purple-solid', teal: 'bg-teal-solid',
  };
  return (
    <div
      className={cn('relative flex min-w-0 flex-col rounded-md border py-1 pl-3 pr-2', bg[tone], className)}
      title={absence.note ?? undefined}
    >
      <span className={cn('absolute inset-y-1 left-1 w-[3px] rounded-full', bar[tone])} aria-hidden />
      <span className="truncate text-[12.5px] font-semibold leading-4">{t(absence.kind)}</span>
      <span className="truncate text-[11.5px] leading-4 opacity-80 tabular">{spanTitle(absence.startDate, absence.endDate, locale)}</span>
    </div>
  );
}

export const approvalTone: Record<ApprovalStatus, Tone> = { PENDING: 'orange', APPROVED: 'green', REJECTED: 'red' };

export function ApprovalPill({ status, variant = 'dot' }: { status: ApprovalStatus; variant?: 'dot' | 'pill' }) {
  const t = useTranslations('time.approval');
  return (
    <StatusPill tone={approvalTone[status]} variant={variant}>
      {t(status)}
    </StatusPill>
  );
}

/** One-line description of a time request's payload. */
export function useRequestSummary() {
  const t = useTranslations('time.requests');
  return useCallback(
    (r: TimeRequestView) => {
      const d = r.data as Record<string, string | undefined>;
      if (r.kind === 'CORRECTION') {
        const parts = [d.in ? t('summaryIn', { time: d.in }) : null, d.out ? t('summaryOut', { time: d.out }) : null].filter(Boolean);
        return parts.join(' · ');
      }
      if (r.kind === 'DAY_OFF_WORK') return t('summaryRange', { start: d.start ?? '', end: d.end ?? '' });
      return t('summarySubstitution', { shift: d.shiftTitle ?? '', name: d.substituteName ?? '' });
    },
    [t],
  );
}

/** "‹ Сегодня ›" control used by every period view. */
export function PeriodNav({
  onPrev,
  onNext,
  onToday,
  todayLabel,
  className,
  floating,
}: {
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  todayLabel?: string;
  className?: string;
  floating?: boolean;
}) {
  const t = useTranslations('time.common');
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-lg border border-border bg-surface',
        floating ? 'p-1 shadow-pop' : 'shadow-card',
        className,
      )}
      role="group"
      aria-label={t('periodNav')}
    >
      <Button variant="ghost" size="icon-sm" onClick={onPrev} aria-label={t('prev')}>
        <ChevronLeft />
      </Button>
      <Button variant="ghost" size="sm" onClick={onToday} className="px-3 font-medium">
        {todayLabel ?? t('today')}
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={onNext} aria-label={t('next')}>
        <ChevronRight />
      </Button>
    </div>
  );
}

/** Small uppercase label used as a section title inside cards. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('section-label', className)}>{children}</div>;
}

/** Tab state in `?tab=` (shallow replaceState, like the admin pages). */
export function useTabParam<T extends string>(tabs: readonly T[], fallback: T): [T, (v: string) => void] {
  const search = useSearchParams();
  const raw = search.get('tab') ?? '';
  const current = (tabs as readonly string[]).includes(raw) ? (raw as T) : fallback;
  const set = useCallback((v: string) => {
    const params = new URLSearchParams(window.location.search);
    params.set('tab', v);
    window.history.replaceState(null, '', `?${params.toString()}`);
  }, []);
  return [current, set];
}
