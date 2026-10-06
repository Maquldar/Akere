'use client';

import {
  BriefcaseBusiness, CalendarHeart, CalendarMinus2, FileBadge2, FileText, Palmtree, type LucideIcon,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { StatusPill, type Tone } from '@/components/ui/badge';
import { isApiError } from '@/lib/api/errors';
import type {
  DynamicField, PlanStatus, ReqDocumentStatus, ReqStepStatus, RequestStatus, RequestTypeView,
} from '@/lib/api/types-requests';
import { formatDate, parseApiDate } from '@/lib/format';

// ── Status tones ──

export const requestStatusTone: Record<RequestStatus, Tone> = {
  DRAFT: 'gray',
  IN_APPROVAL: 'blue',
  REWORK: 'orange',
  ORDER_SIGNING: 'purple',
  COMPLETED: 'green',
  REJECTED: 'red',
  CANCELLED: 'gray',
};

export const planStatusTone: Record<PlanStatus, Tone> = {
  NONE: 'gray',
  DRAFT: 'gray',
  SUBMITTED: 'orange',
  APPROVED: 'green',
  REJECTED: 'red',
};

export const docStatusTone: Record<ReqDocumentStatus, Tone> = {
  DRAFT: 'gray',
  IN_ROUTE: 'blue',
  REWORK: 'orange',
  COMPLETED: 'green',
  REJECTED: 'red',
  CANCELLED: 'gray',
};

export const stepStatusTone: Record<ReqStepStatus, Tone> = {
  WAITING: 'gray',
  PENDING: 'blue',
  DONE: 'green',
  REJECTED: 'red',
  RETURNED: 'orange',
  SKIPPED: 'gray',
};

export function RequestStatusPill({ status }: { status: RequestStatus }) {
  const t = useTranslations('requests.status');
  return <StatusPill tone={requestStatusTone[status] ?? 'gray'}>{t(status)}</StatusPill>;
}

export function PlanStatusPill({ status, variant }: { status: PlanStatus; variant?: 'pill' | 'dot' }) {
  const t = useTranslations('vacation.planStatus');
  return (
    <StatusPill tone={planStatusTone[status] ?? 'gray'} variant={variant}>
      {t(status)}
    </StatusPill>
  );
}

// ── Request types ──

const TYPE_ICONS: Record<string, LucideIcon> = {
  ANNUAL_LEAVE: Palmtree,
  UNPAID_LEAVE: CalendarMinus2,
  BUSINESS_TRIP: BriefcaseBusiness,
  SOCIAL_LEAVE: CalendarHeart,
  CERTIFICATE: FileBadge2,
};

export function typeIcon(code: string | undefined): LucideIcon {
  return (code && TYPE_ICONS[code]) || FileText;
}

/** Type name in the UI language (API sends `name` + `nameKk`). */
export function useTypeName() {
  const locale = useLocale();
  return (t: Pick<RequestTypeView, 'name' | 'nameKk'>) => (locale === 'kk' && t.nameKk ? t.nameKk : t.name);
}

export function useFieldLabel() {
  const locale = useLocale();
  return (f: DynamicField) => (locale === 'kk' && f.labelKk ? f.labelKk : f.label);
}

// ── Dates ──

const DAY_MS = 86_400_000;

export const isDateStr = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Inclusive calendar days between two YYYY-MM-DD dates (0 when invalid or reversed). */
export function calendarDays(start: string | null | undefined, end: string | null | undefined): number {
  if (!isDateStr(start) || !isDateStr(end) || end < start) return 0;
  return Math.round((parseApiDate(end).getTime() - parseApiDate(start).getTime()) / DAY_MS) + 1;
}

/** Today in Asia/Almaty as YYYY-MM-DD. */
export function todayStr(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function usePeriodText() {
  const locale = useLocale();
  return (start: string | null | undefined, end: string | null | undefined) => {
    if (!start && !end) return '—';
    if (start && end && start !== end) return `${formatDate(start, locale)} – ${formatDate(end, locale)}`;
    return formatDate(start ?? end, locale);
  };
}

export function formatDays(n: number, locale: string): string {
  return new Intl.NumberFormat(locale === 'kk' ? 'kk-KZ' : locale === 'en' ? 'en-GB' : 'ru-RU', { maximumFractionDigits: 2 }).format(n);
}

// ── Business-rule errors ──

type Overlap = { label?: string; startDate?: string; endDate?: string };

/** Friendly text for 422 BUSINESS_RULE errors of the requests module (falls back to the server message). */
export function useRequestErrorText() {
  const t = useTranslations('requests.errors');
  const tc = useTranslations('common');
  const locale = useLocale();
  return (e: unknown): string => {
    if (!isApiError(e)) return tc('error');
    if (e.code === 'BUSINESS_RULE') {
      const d = (e.details ?? {}) as { available?: number; requested?: number; overlaps?: Overlap[] };
      switch (e.rule) {
        case 'INSUFFICIENT_VACATION_BALANCE':
          return t('insufficientBalance', {
            available: formatDays(d.available ?? 0, locale),
            requested: formatDays(d.requested ?? 0, locale),
          });
        case 'OVERLAP': {
          const list = (d.overlaps ?? [])
            .map((o) => `${o.label ?? ''} ${o.startDate ? formatDate(o.startDate, locale) : ''}–${o.endDate ? formatDate(o.endDate, locale) : ''}`.trim())
            .join('; ');
          return list ? t('overlapWith', { list }) : t('overlap');
        }
        case 'PAST_START_DATE':
          return t('pastStart');
        case 'ATTACHMENT_REQUIRED':
          return t('attachmentRequired');
        case 'NO_LEAVE_DAYS':
          return t('noLeaveDays');
        case 'NO_EMPLOYEE_RECORD':
          return t('noEmployee');
        case 'TYPE_LOCKED':
          return t('typeLocked');
        default:
          return e.message;
      }
    }
    if (e.code === 'CONFLICT') return t('conflict');
    if (e.code === 'FORBIDDEN') return t('forbidden');
    if (e.code === 'FILE_TOO_LARGE') return t('fileTooLarge');
    if (e.code === 'UNSUPPORTED_FILE') return t('unsupportedFile');
    if (e.code === 'VALIDATION_ERROR') return t('validation');
    return e.message || tc('error');
  };
}
