'use client';

import {
  AlertTriangle, BadgeDollarSign, CalendarClock, CalendarPlus, CalendarX2, ChevronRight, Clock, Coffee, FilePenLine, LogIn, LogOut,
  MapPin, Palmtree, PartyPopper, Plane, Play, Plus, Repeat2, Stethoscope,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, type ReactNode } from 'react';
import { Badge, StatusPill } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Tooltip } from '@/components/ui/popover';
import { Skeleton, SkeletonList } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { useCurrentUser } from '@/components/shell/me-context';
import { Link } from '@/i18n/navigation';
import { isApiError } from '@/lib/api/errors';
import { useClaimShift, useCreateMark, useMyDay, useMyWeek } from '@/lib/api/hooks/time';
import type { AbsenceKind, MarkResult, MyDay, MyWeek, ShiftView, TimeMarkType, TimeRequestKind } from '@/lib/api/types-time';
import { dayPart, formatLongDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { getPosition, isGeoError } from './geo';
import { IdentityDialog } from './identity-dialog';
import { TimeRequestDialog } from './request-dialog';
import { ApprovalPill, ShiftChip, useDuration, useNow, useRequestSummary } from './shared';
import { absenceTone, dayNum, fromDateStr, shiftMinutes, shiftRange, spanTitle, timeOf, todayStr, weekdayShort } from './time-utils';

export const absenceIcon: Record<AbsenceKind, typeof Palmtree> = {
  VACATION: Palmtree,
  UNPAID: BadgeDollarSign,
  SICK: Stethoscope,
  BUSINESS_TRIP: Plane,
  OTHER: CalendarX2,
};

export const requestIcon: Record<TimeRequestKind, typeof Palmtree> = {
  CORRECTION: FilePenLine,
  DAY_OFF_WORK: CalendarPlus,
  SUBSTITUTION: Repeat2,
};

function Greeting() {
  const th = useTranslations('home');
  const locale = useLocale();
  const { me } = useCurrentUser();
  const now = useNow(60_000);
  return (
    <div className="mb-6 sm:mb-8">
      <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.015em] text-fg sm:text-[28px]">
        {th(`greeting.${now ? dayPart(now) : 'day'}`, { name: me.firstName })}
      </h1>
      <p className="mt-1 min-h-5 text-sm text-fg-muted">{now ? formatLongDate(now, locale) : ''}</p>
    </div>
  );
}

function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="focus-ring inline-flex items-center gap-0.5 rounded text-[13px] font-medium text-fg-muted hover:text-fg">
      {children}
      <ChevronRight className="size-4" aria-hidden />
    </Link>
  );
}

// ───────────────────────── Моя смена ─────────────────────────

function Stat({ label, value, sub, subTone }: { label: string; value: string; sub?: string | null; subTone?: 'red' | 'orange' }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface-muted px-3 py-2.5">
      <div className="text-xs text-fg-subtle">{label}</div>
      <div className="mt-0.5 text-[17px] font-semibold text-fg tabular">{value}</div>
      {sub && <div className={cn('text-xs font-medium tabular', subTone === 'red' ? 'text-red-fg' : 'text-orange-fg')}>{sub}</div>}
    </div>
  );
}

function ShiftCard({ day, fetchedAt }: { day: MyDay; fetchedAt: number }) {
  const t = useTranslations('time.my');
  const locale = useLocale();
  const dur = useDuration();
  const now = useNow(15_000);
  const createMark = useCreateMark();
  const [identity, setIdentity] = useState<'IN' | 'OUT' | null>(null);
  const [correction, setCorrection] = useState(false);
  const shift = day.shift;
  const marks = useMemo(() => [...day.marks].sort((a, b) => a.at.localeCompare(b.at)), [day.marks]);
  const firstIn = marks.find((m) => m.type === 'IN');
  const lastOut = [...marks].reverse().find((m) => m.type === 'OUT');
  const lastBreak = [...marks].reverse().find((m) => m.type === 'BREAK_START');
  const live = day.status === 'ON_SHIFT' || day.status === 'ON_BREAK';
  const elapsed = now && day.status === 'ON_SHIFT' ? Math.max(0, (now.getTime() - fetchedAt) / 60_000) : 0;
  const worked = day.workedMinutes + elapsed;
  const planned = shift ? shiftMinutes(shift) : 8 * 60;
  const remaining = shift && now ? Math.max(0, (new Date(shift.endAt).getTime() - now.getTime()) / 60_000) : null;
  const breakFor = day.status === 'ON_BREAK' && lastBreak && now ? (now.getTime() - new Date(lastBreak.at).getTime()) / 60_000 : 0;
  // Before the first mark: lateness grows live until the shift ends (M4 "Опоздание 7ч 25м").
  const pendingLate =
    shift && now && (day.status === 'NOT_STARTED' || day.status === 'NO_MARKS') && !firstIn && now.getTime() < new Date(shift.endAt).getTime()
      ? Math.max(0, (now.getTime() - new Date(shift.startAt).getTime()) / 60_000)
      : 0;
  const lateMinutes = firstIn ? day.lateMinutes : pendingLate > 5 ? pendingLate : 0;

  const doBreak = async (type: Extract<TimeMarkType, 'BREAK_START' | 'BREAK_END'>) => {
    let fix = {};
    try {
      fix = await getPosition(8_000);
    } catch (e) {
      if (day.settings.requireGeofence && day.settings.location) {
        toast.error(isGeoError(e) && e === 'denied' ? t('geoDenied') : t('geoUnavailable'));
        return;
      }
    }
    createMark.mutate(
      { type, ...fix },
      {
        onSuccess: (r) => toast.success(type === 'BREAK_START' ? t('toastBreakStart', { time: timeOf(r.mark.at, locale) }) : t('toastBreakEnd', { time: timeOf(r.mark.at, locale) })),
        onError: (e) => {
          if (isApiError(e) && e.rule === 'OUTSIDE_GEOFENCE') toast.error(t('outsideGeofence'));
          else if (isApiError(e) && e.rule === 'GEOLOCATION_REQUIRED') toast.error(t('geoDenied'));
          else toast.error(isApiError(e) ? e.message : t('markFailed'));
        },
      },
    );
  };

  const onMarked = (r: MarkResult) => {
    if (r.mark.type === 'IN') toast.success(t('toastIn', { time: timeOf(r.mark.at, locale) }));
    else toast.success(t('toastOut'), { description: t('toastOutTotal', { total: dur(r.day.workedMinutes) }) });
  };

  const header = (
    <CardHeader
      title={t('shiftTitle')}
      actions={shift ? <Badge tone="gray" className="max-w-[180px] bg-surface" title={shift.title}>{shift.title}</Badge> : undefined}
    />
  );

  const progress = (
    <div className="mt-4">
      <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
        <span className="text-fg-muted">{t('workedOf', { worked: dur(worked), planned: dur(planned) })}</span>
        <span className="text-fg-subtle tabular">{Math.min(100, Math.round((worked / Math.max(1, planned)) * 100))}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-active" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round((worked / Math.max(1, planned)) * 100))} aria-label={t('progressLabel')}>
        <div className="h-full rounded-full bg-green-solid transition-[width]" style={{ width: `${Math.min(100, (worked / Math.max(1, planned)) * 100)}%` }} />
      </div>
    </div>
  );

  const schedule = shift && (
    <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
      <div className="rounded-md bg-surface-muted px-2 py-1.5">
        <dt className="text-fg-subtle">{t('start')}</dt>
        <dd className="font-semibold text-fg tabular">{timeOf(shift.startAt, locale)}</dd>
      </div>
      <div className="rounded-md bg-surface-muted px-2 py-1.5">
        <dt className="text-fg-subtle">{t('break')}</dt>
        <dd className="font-semibold text-fg tabular">{dur(shift.breakMinutes)}</dd>
      </div>
      <div className="rounded-md bg-surface-muted px-2 py-1.5">
        <dt className="text-fg-subtle">{t('end')}</dt>
        <dd className="font-semibold text-fg tabular">{timeOf(shift.endAt, locale)}</dd>
      </div>
    </dl>
  );

  let body: ReactNode;
  if (live) {
    body = (
      <>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[32px] font-semibold leading-none tracking-tight text-fg tabular">{dur(worked)}</span>
              <span className={cn('relative flex size-2.5', day.status === 'ON_BREAK' && 'opacity-60')} aria-hidden>
                {day.status === 'ON_SHIFT' && <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-solid opacity-60" />}
                <span className={cn('relative inline-flex size-2.5 rounded-full', day.status === 'ON_BREAK' ? 'bg-orange-solid' : 'bg-green-solid')} />
              </span>
            </div>
            <p className="mt-1.5 text-[13px] text-fg-muted">
              {day.status === 'ON_BREAK' ? t('onBreakFor', { duration: dur(breakFor) }) : remaining !== null ? t('untilEnd', { duration: dur(remaining) }) : t('onShift')}
            </p>
          </div>
          {firstIn && (
            <div className="text-right text-xs text-fg-subtle">
              {t('inAt')}
              <div className="text-[15px] font-semibold text-fg tabular">{timeOf(firstIn.at, locale)}</div>
            </div>
          )}
        </div>
        {progress}
        <div className="mt-4 grid grid-cols-2 gap-2">
          {day.status === 'ON_BREAK' ? (
            <Button variant="outline" size="lg" onClick={() => doBreak('BREAK_END')} loading={createMark.isPending}>
              <Play />
              {t('endBreak')}
            </Button>
          ) : (
            <Button variant="outline" size="lg" onClick={() => doBreak('BREAK_START')} loading={createMark.isPending}>
              <Coffee />
              {t('startBreak')}
            </Button>
          )}
          <Button size="lg" onClick={() => setIdentity('OUT')} disabled={day.status === 'ON_BREAK'}>
            <LogOut />
            {t('clockOut')}
          </Button>
        </div>
      </>
    );
  } else if (day.status === 'FINISHED' || (day.status === 'NO_OUT' && firstIn)) {
    body = (
      <>
        {day.status === 'NO_OUT' && (
          <StatusPill tone="red" className="mb-3">
            {t('noOut')}
          </StatusPill>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Stat label={t('worked')} value={dur(day.workedMinutes)} />
          <Stat label={t('breaks')} value={dur(day.breakMinutes)} />
          <Stat
            label={t('inAt')}
            value={firstIn ? timeOf(firstIn.at, locale) : '—'}
            sub={day.lateMinutes > 0 ? t('late', { duration: dur(day.lateMinutes) }) : null}
            subTone="red"
          />
          <Stat
            label={t('outAt')}
            value={lastOut ? timeOf(lastOut.at, locale) : '—'}
            sub={day.earlyLeaveMinutes > 0 ? t('early', { duration: dur(day.earlyLeaveMinutes) }) : null}
          />
        </div>
        <div className="mt-4 flex flex-col gap-1.5">
          {day.status === 'NO_OUT' && (
            <Button size="lg" onClick={() => setIdentity('OUT')}>
              <LogOut />
              {t('clockOut')}
            </Button>
          )}
          <Button variant="outline" size="lg" onClick={() => setCorrection(true)}>
            <FilePenLine />
            {t('requestCorrection')}
          </Button>
          {day.status === 'FINISHED' && (
            <Button variant="ghost" size="sm" onClick={() => setIdentity('IN')}>
              <LogIn />
              {t('clockInAgain')}
            </Button>
          )}
        </div>
      </>
    );
  } else if (day.status === 'ABSENT') {
    body = <EmptyState compact icon={<CalendarX2 aria-hidden />} title={t('absentToday')} description={t('absentTodayHint')} />;
  } else {
    // NOT_STARTED / NO_MARKS / DAY_OFF
    body = (
      <>
        {shift ? (
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-blue-border bg-blue-bg text-blue-fg">
              <Clock className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              {day.status === 'NO_MARKS' && !pendingLate ? (
                <Badge tone="red" className="mb-1 gap-1 rounded-md">
                  <AlertTriangle className="size-3" aria-hidden />
                  {t('noMarks')}
                </Badge>
              ) : lateMinutes > 0 ? (
                <Badge tone="red" className="mb-1 gap-1 rounded-md">
                  <AlertTriangle className="size-3" aria-hidden />
                  {t('late', { duration: dur(lateMinutes) })}
                </Badge>
              ) : null}
              <div className="text-[26px] font-semibold leading-tight tracking-tight text-fg tabular">
                {timeOf(shift.startAt, locale)} – {timeOf(shift.endAt, locale)}
              </div>
              {shift.location && (
                <p className="mt-0.5 flex items-center gap-1 text-xs text-fg-subtle">
                  <MapPin className="size-3" aria-hidden />
                  <span className="truncate">{shift.location.name}</span>
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-muted text-fg-subtle">
              <CalendarClock className="size-5" aria-hidden />
            </span>
            <div>
              <div className="text-[17px] font-semibold text-fg">{t('dayOff')}</div>
              <p className="text-xs text-fg-subtle">{t('dayOffHint')}</p>
            </div>
          </div>
        )}
        {schedule}
        <Button size="lg" className="mt-4 w-full" variant={shift ? 'primary' : 'outline'} onClick={() => setIdentity('IN')}>
          <Play />
          {t('clockIn')}
        </Button>
        {day.status === 'NO_MARKS' && (
          <Button variant="ghost" size="sm" className="mt-1.5 w-full" onClick={() => setCorrection(true)}>
            <FilePenLine />
            {t('requestCorrection')}
          </Button>
        )}
      </>
    );
  }

  return (
    <Card className="flex flex-col">
      {header}
      <CardBody className="flex-1">{body}</CardBody>
      {identity && <IdentityDialog open onOpenChange={(o) => !o && setIdentity(null)} type={identity} settings={day.settings} onSuccess={onMarked} />}
      <TimeRequestDialog
        open={correction}
        onOpenChange={setCorrection}
        defaultKind="CORRECTION"
        defaultDate={day.date}
        defaultIn={firstIn ? timeOf(firstIn.at, locale) : shift ? timeOf(shift.startAt, locale) : undefined}
        defaultOut={lastOut ? timeOf(lastOut.at, locale) : shift ? timeOf(shift.endAt, locale) : undefined}
      />
    </Card>
  );
}

// ───────────────────────── Расписание ─────────────────────────

function ScheduleCard({ day }: { day: MyDay }) {
  const t = useTranslations('time.my');
  const ta = useTranslations('time.absenceKind');
  const locale = useLocale();
  const items = day.upcoming.slice(0, 6);
  return (
    <Card className="flex flex-col">
      <CardHeader title={t('scheduleTitle')} actions={<CardLink href="/time/schedule?tab=team">{t('all')}</CardLink>} />
      <ul className="flex-1 divide-y divide-border px-4 sm:px-5">
        {items.length === 0 && <li className="py-6 text-center text-sm text-fg-subtle">{t('noUpcoming')}</li>}
        {items.map((u) => {
          const label = `${weekdayShort(u.date, locale)} ${dayNum(u.date)}`;
          let middle: ReactNode;
          let right: ReactNode = null;
          if (u.absence) {
            const Icon = absenceIcon[u.absence.kind];
            middle = (
              <StatusPill tone={absenceTone[u.absence.kind]} className="gap-1 [&>span:first-child]:hidden">
                <Icon className="size-3.5" aria-hidden />
                {ta(u.absence.kind)}
              </StatusPill>
            );
          } else if (u.shift) {
            middle = (
              <span className="inline-flex max-w-full items-center truncate rounded-full border border-border-strong px-2.5 py-0.5 text-[13px] text-fg tabular" title={u.shift.title}>
                {shiftRange(u.shift, locale)}
              </span>
            );
            right = <span className="hidden truncate text-[13px] text-fg-muted sm:inline">{u.shift.title}</span>;
          } else if (u.holiday) {
            middle = (
              <span className="inline-flex items-center gap-1 text-[13px] text-purple-fg">
                <PartyPopper className="size-3.5" aria-hidden />
                {u.holiday}
              </span>
            );
          } else middle = <span className="text-[13px] text-fg-subtle">{t('dayOffShort')}</span>;
          return (
            <li key={u.date} className="flex min-h-[50px] items-center gap-3 py-2">
              <span className={cn('w-14 shrink-0 text-[14px] font-medium tabular', u.shift || u.absence ? 'text-fg' : 'text-fg-subtle')}>{label}</span>
              <span className="min-w-0 flex-1">{middle}</span>
              {right && <span className="max-w-[45%] min-w-0 text-right">{right}</span>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ───────────────────────── Эта неделя ─────────────────────────

export function WeekTiles({ week, size = 'md' }: { week: MyWeek; size?: 'md' | 'lg' }) {
  const t = useTranslations('time.my');
  const ta = useTranslations('time.absenceKind');
  const locale = useLocale();
  const dur = useDuration();
  const today = todayStr();
  return (
    <ul className="grid grid-cols-7 gap-1.5">
      {week.days.map((d) => {
        const Icon = d.absenceKind ? absenceIcon[d.absenceKind] : d.kind === 'HOLIDAY' ? PartyPopper : null;
        const done = d.kind === 'WORK' && d.workedMinutes > 0;
        const tone = d.absenceKind ? absenceTone[d.absenceKind] : null;
        const tile = cn(
          'flex w-full items-center justify-center rounded-md border',
          size === 'lg' ? 'h-14' : 'aspect-[4/5] max-h-12',
          d.kind === 'WORK' && (done ? 'border-green-border bg-shift-green' : 'border-blue-border bg-shift-blue'),
          d.kind === 'ABSENCE' && tone === 'red' && 'border-red-border bg-red-bg text-red-fg',
          d.kind === 'ABSENCE' && tone === 'orange' && 'border-orange-border bg-orange-bg text-orange-fg',
          d.kind === 'ABSENCE' && tone === 'green' && 'border-green-border bg-green-bg text-green-fg',
          d.kind === 'ABSENCE' && tone === 'blue' && 'border-blue-border bg-blue-bg text-blue-fg',
          d.kind === 'ABSENCE' && tone === 'gray' && 'border-border bg-gray-bg text-gray-fg',
          (d.kind === 'OFF' || d.kind === 'HOLIDAY') && 'border-border text-purple-fg [background:repeating-linear-gradient(135deg,var(--color-surface-hover)_0_4px,var(--color-surface)_4px_8px)]',
          d.date === today && 'ring-2 ring-primary/40 ring-offset-1',
        );
        const tip =
          d.kind === 'ABSENCE' && d.absenceKind
            ? ta(d.absenceKind)
            : d.kind === 'WORK'
              ? t('tileWork', { worked: dur(d.workedMinutes), planned: dur(d.plannedMinutes) })
              : d.kind === 'HOLIDAY'
                ? t('holiday')
                : d.workedMinutes > 0
                  ? t('tileWork', { worked: dur(d.workedMinutes), planned: dur(0) })
                  : t('dayOffShort');
        return (
          <li key={d.date} className="flex min-w-0 flex-col items-center gap-1">
            <Tooltip content={tip}>
              <span className={tile} tabIndex={0} aria-label={`${weekdayShort(d.date, locale)} ${dayNum(d.date)}: ${tip}`}>
                {Icon && <Icon className="size-4" aria-hidden />}
                {!Icon && size === 'lg' && d.kind === 'WORK' && (
                  <span className="text-[11px] font-semibold text-fg tabular">{dur(d.workedMinutes || d.plannedMinutes)}</span>
                )}
              </span>
            </Tooltip>
            <span className={cn('text-[11px] font-medium uppercase', d.date === today ? 'text-primary' : 'text-fg-subtle')}>{weekdayShort(d.date, locale)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function WeekCard() {
  const t = useTranslations('time.my');
  const locale = useLocale();
  const dur = useDuration();
  const week = useMyWeek();
  return (
    <Card className="flex flex-col">
      <CardHeader
        title={t('weekTitle')}
        actions={week.data ? <span className="text-[13px] text-fg-muted tabular">{spanTitle(week.data.from, week.data.to, locale)}</span> : undefined}
      />
      <CardBody className="flex flex-1 flex-col">
        {week.isLoading && <Skeleton className="h-28 w-full" />}
        {week.isError && <ErrorState error={week.error} onRetry={() => week.refetch()} compact />}
        {week.data && (
          <>
            <p className="mb-4 flex items-baseline gap-1.5">
              <span className="text-[22px] font-semibold text-fg tabular">{dur(week.data.workedMinutes, { zero: t('zeroHours') })}</span>
              <span className="text-sm text-fg-subtle">{t('ofPlanned', { planned: dur(week.data.plannedMinutes, { zero: t('zeroHours') }) })}</span>
            </p>
            <WeekTiles week={week.data} />
          </>
        )}
        <div className="mt-auto pt-5">
          <Button variant="outline" className="w-full" asChild>
            <Link href="/time/schedule">{t('allHours')}</Link>
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

// ───────────────────────── Мои запросы ─────────────────────────

function RequestsCard({ day }: { day: MyDay }) {
  const t = useTranslations('time.my');
  const tk = useTranslations('time.requestKind');
  const summary = useRequestSummary();
  const [creating, setCreating] = useState(false);
  return (
    <Card>
      <CardHeader
        title={t('requestsTitle')}
        count={day.requests.length || undefined}
        actions={
          <>
            <Button variant="ghost" size="icon-sm" onClick={() => setCreating(true)} aria-label={t('newRequest')}>
              <Plus />
            </Button>
            <CardLink href="/time/schedule?tab=requests">{t('all')}</CardLink>
          </>
        }
      />
      {day.requests.length === 0 ? (
        <EmptyState
          compact
          icon={<FilePenLine aria-hidden />}
          title={t('noRequests')}
          action={
            <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
              <Plus />
              {t('newRequest')}
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-border px-2 py-1">
          {day.requests.slice(0, 4).map((r) => {
            const Icon = requestIcon[r.kind];
            return (
              <li key={r.id}>
                <Link href="/time/schedule?tab=requests" className="focus-ring flex items-center gap-3 rounded-lg px-2 py-3 hover:bg-surface-hover sm:px-3">
                  <Icon className="size-4 shrink-0 text-purple-fg" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">{tk(r.kind)}</span>
                    <span className="block truncate text-xs text-fg-subtle">{summary(r)}</span>
                  </span>
                  <ApprovalPill status={r.status} />
                  <ChevronRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <TimeRequestDialog open={creating} onOpenChange={setCreating} />
    </Card>
  );
}

// ───────────────────────── Открытые смены ─────────────────────────

export function OpenShiftItem({ shift }: { shift: ShiftView }) {
  const t = useTranslations('time.my');
  const locale = useLocale();
  const dur = useDuration();
  const { me } = useCurrentUser();
  const claim = useClaimShift();
  const mine = shift.claims.find((c) => c.employee.id === me.id);
  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <div className="flex w-11 shrink-0 flex-col items-center rounded-lg border border-border bg-surface-muted py-1">
        <span className="text-[10px] font-medium uppercase text-fg-subtle">{weekdayShort(shift.date, locale)}</span>
        <span className="text-[17px] font-semibold leading-5 text-fg tabular">{fromDateStr(shift.date).getUTCDate()}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-fg">{shift.title}</div>
        <div className="truncate text-xs text-fg-subtle tabular">
          {shiftRange(shift, locale)} · {dur(shiftMinutes(shift) + shift.breakMinutes)}
          {shift.location ? ` · ${shift.location.name}` : ''}
        </div>
      </div>
      {mine ? (
        <ApprovalPill status={mine.status} variant="pill" />
      ) : (
        <Button
          size="sm"
          loading={claim.isPending}
          onClick={() =>
            claim.mutate(shift.id, {
              onSuccess: () => toast.success(t('claimed')),
              onError: (e) =>
                toast.error(
                  isApiError(e) && e.rule === 'ALREADY_SCHEDULED' ? t('alreadyScheduled') : isApiError(e) && e.rule === 'SHIFT_IN_PAST' ? t('shiftInPast') : isApiError(e) ? e.message : t('claimFailed'),
                ),
            })
          }
        >
          {t('claim')}
        </Button>
      )}
    </li>
  );
}

function OpenShiftsCard({ day }: { day: MyDay }) {
  const t = useTranslations('time.my');
  return (
    <Card>
      <CardHeader title={t('openShiftsTitle')} count={day.openShifts.length || undefined} />
      {day.openShifts.length === 0 ? (
        <EmptyState compact icon={<CalendarClock aria-hidden />} title={t('noOpenShifts')} />
      ) : (
        <ul className="divide-y divide-border">
          {day.openShifts.slice(0, 5).map((s) => (
            <OpenShiftItem key={s.id} shift={s} />
          ))}
        </ul>
      )}
    </Card>
  );
}

export function MyTimePage() {
  const t = useTranslations('time.my');
  const { me } = useCurrentUser();
  const day = useMyDay();

  if (!me.employee) {
    return (
      <div className="mx-auto w-full max-w-6xl">
        <Greeting />
        <Card>
          <EmptyState icon={<Clock aria-hidden />} title={t('noEmployee')} description={t('noEmployeeHint')} />
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <Greeting />
      {day.isLoading && (
        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Card key={i} className="p-5">
              <SkeletonList rows={3} />
            </Card>
          ))}
        </div>
      )}
      {day.isError && (
        <Card>
          <ErrorState error={day.error} onRetry={() => day.refetch()} />
        </Card>
      )}
      {day.data && (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <ShiftCard day={day.data} fetchedAt={day.dataUpdatedAt} />
            <ScheduleCard day={day.data} />
            <WeekCard />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <RequestsCard day={day.data} />
            <OpenShiftsCard day={day.data} />
          </div>
        </div>
      )}
    </div>
  );
}

export { ShiftChip };
