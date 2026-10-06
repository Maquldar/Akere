import type { AbsenceKind, Prisma, PrismaClient, TimeMarkType } from '@prisma/client';
import { rng } from './kz';
import type { OrgCtx } from './org';
import {
  addDaysStr, buildCalendar, dateStrOf, datesInRange, isoWeekdayOf, isPublicHoliday, isWorkingDay, monthBounds, shiftInstants, todayLocal, type HolidayRow,
} from '../../src/lib/calendar';
import { haversineM } from '../../src/modules/time/compute';

/**
 * Time tracking demo data (F-37…F-43): shift templates from M4, published schedules for the
 * previous month → today + 2 weeks, realistic marks up to "now", absences + sick leaves, an open
 * shift and pending requests for the demo managers. "Today" is computed at seed time.
 */
export async function seedTime(prisma: PrismaClient, ctx: OrgCtx) {
  const r = rng(20261107);
  const tz = 'Asia/Almaty';
  const now = new Date();
  const today = todayLocal(tz, now);
  const { tenantId, people: P, locations } = ctx;
  const d0 = (s: string) => new Date(`${s}T00:00:00Z`);
  const between = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));

  // ── Templates (exactly as in M4) ──
  const tplDefs = [
    { key: 'dev', name: '5/2 Разработка', startTime: '10:00', endTime: '19:00', breakMinutes: 60, color: 'gray', locationId: locations.astana },
    { key: 'office', name: 'День офис', startTime: '09:00', endTime: '18:00', breakMinutes: 60, color: 'teal', locationId: null },
    { key: 'supMorning', name: 'Поддержка — утро', startTime: '08:00', endTime: '16:00', breakMinutes: 30, color: 'green', locationId: locations.astana },
    { key: 'supEvening', name: 'Поддержка — вечер', startTime: '13:00', endTime: '21:00', breakMinutes: 30, color: 'orange', locationId: locations.astana },
    { key: 'supFull', name: 'Поддержка — полный', startTime: '09:00', endTime: '21:00', breakMinutes: 60, color: 'blue', locationId: locations.astana },
    { key: 'early', name: 'Ранний день (внедрение)', startTime: '08:00', endTime: '17:00', breakMinutes: 60, color: 'purple', locationId: locations.astana },
    { key: 'wh', name: 'Склад 2/2', startTime: '08:00', endTime: '20:00', breakMinutes: 60, color: 'blue', locationId: locations.almaty },
  ] as const;
  const tpl: Record<string, { id: string; name: string; startTime: string; endTime: string; breakMinutes: number; color: string; locationId: string | null }> = {};
  for (const t of tplDefs) {
    const { key, ...data } = t;
    tpl[key] = await prisma.shiftTemplate.create({ data: { ...data, tenantId } });
  }

  // ── Range + calendar ──
  const prevMonth = (() => {
    const [y, m] = today.split('-').map(Number) as [number, number];
    return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
  })();
  const from = monthBounds(prevMonth.year, prevMonth.month).from;
  const to = addDaysStr(today, 14);
  const holidays = await prisma.holiday.findMany({ where: { date: { gte: d0(from), lte: d0(to) } } });
  const cal = buildCalendar(holidays.map((h): HolidayRow => ({ date: dateStrOf(h.date), kind: h.kind, name: h.name })));
  const days = datesInRange(from, to);
  const pastWorkdays = days.filter((d) => d < today && isWorkingDay(d, cal));
  const nextWeekday = (start: string, wd: number) => {
    let d = addDaysStr(start, 1);
    while (isoWeekdayOf(d) !== wd) d = addDaysStr(d, 1);
    return d;
  };
  const comingSaturday = nextWeekday(today, 6);

  const emp = (k: string) => P[k]!.employeeId;
  const usr = (k: string) => P[k]!.userId;
  const staff = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => `staff${a + i}`);

  // ── Absences (shifts are not planned on these days) ──
  type Abs = { key: string; kind: AbsenceKind; start: string; end: string; note?: string; sick?: { number: string; electronic: boolean } };
  const prevMid = addDaysStr(from, 9);
  const absences: Abs[] = [
    { key: 'staff3', kind: 'VACATION', start: prevMid, end: addDaysStr(prevMid, 9), note: 'Ежегодный оплачиваемый отпуск' },
    { key: 'saleslead', kind: 'BUSINESS_TRIP', start: addDaysStr(today, -9), end: addDaysStr(today, -7), note: 'Командировка (Стамбул)' },
    { key: 'staff5', kind: 'SICK', start: addDaysStr(today, -6), end: addDaysStr(today, -2), sick: { number: '0024781', electronic: false } },
    { key: 'staff13', kind: 'SICK', start: addDaysStr(from, 3), end: addDaysStr(from, 6), sick: { number: 'ЭЛН-0091532', electronic: true } },
    { key: 'staff1', kind: 'VACATION', start: nextWeekday(today, 1), end: addDaysStr(nextWeekday(today, 1), 4), note: 'Ежегодный оплачиваемый отпуск' },
    { key: 'dev1', kind: 'UNPAID', start: addDaysStr(today, 1), end: addDaysStr(today, 1), note: 'Отпуск без сохранения заработной платы' },
    { key: 'staff9', kind: 'BUSINESS_TRIP', start: addDaysStr(from, 14), end: addDaysStr(from, 16), note: 'Командировка (Алматы)' },
  ];
  for (const a of absences) {
    let sourceId: string | null = null;
    if (a.sick) {
      const sl = await prisma.sickLeave.create({
        data: {
          tenantId, employeeId: emp(a.key), number: a.sick.number, startDate: d0(a.start), endDate: d0(a.end), source: a.sick.electronic ? 'ELECTRONIC' : 'MANUAL',
          note: a.sick.electronic ? 'Импорт из реестра электронных больничных' : 'ОРВИ', createdById: usr('hr'),
        },
      });
      sourceId = sl.id;
    }
    await prisma.absence.create({
      data: {
        tenantId, employeeId: emp(a.key), kind: a.kind, startDate: d0(a.start), endDate: d0(a.end), source: a.sick ? 'SICK_LEAVE' : 'MANUAL', sourceId,
        note: a.sick ? `Больничный лист № ${a.sick.number}` : (a.note ?? null),
      },
    });
  }
  const absent = (key: string, d: string) => absences.some((a) => a.key === key && a.start <= d && a.end >= d);

  // ── Schedules ──
  const employees = await prisma.employee.findMany({ where: { tenantId, status: 'ACTIVE' }, select: { id: true, locationId: true } });
  const locOf = new Map(employees.map((e) => [e.id, e.locationId]));
  const groups: { keys: string[]; manager: string; plan: (key: string, idx: number, d: string, dayIdx: number) => string | null }[] = [
    { keys: ['devlead', 'dev1', ...staff(0, 7)], manager: 'devlead', plan: (_k, _i, d) => (isWorkingDay(d, cal) ? 'dev' : null) },
    { keys: ['ceo', 'admin', 'hr', 'accountant', 'saleslead', ...staff(8, 11), 'staff16', 'staff17'], manager: 'hr', plan: (_k, _i, d) => (isWorkingDay(d, cal) ? 'office' : null) },
    { keys: ['hr2', 'altynDirector', 'warehouseLead'], manager: 'hr2', plan: (_k, _i, d) => (isWorkingDay(d, cal) ? 'office' : null) },
    { keys: ['supportlead'], manager: 'supportlead', plan: (_k, _i, d) => (isWorkingDay(d, cal) ? 'early' : null) },
    {
      // Support rotates morning/evening weekly; holidays are covered by the full-day shift.
      keys: staff(12, 15), manager: 'supportlead',
      plan: (_k, i, d, dayIdx) => {
        if (isoWeekdayOf(d) > 5) return null;
        if (isPublicHoliday(d, cal)) return i === 0 ? 'supFull' : null;
        return (Math.floor(dayIdx / 7) + i) % 2 === 0 ? 'supMorning' : 'supEvening';
      },
    },
    { keys: staff(18, 23), manager: 'warehouseLead', plan: (_k, i, _d, dayIdx) => ((dayIdx + [0, 2, 1, 3, 0, 2][i]!) % 4 < 2 ? 'wh' : null) },
  ];
  const shiftRows: Prisma.ShiftCreateManyInput[] = [];
  for (const g of groups) {
    g.keys.forEach((key, i) => {
      days.forEach((d, dayIdx) => {
        const tk = g.plan(key, i, d, dayIdx);
        if (!tk || absent(key, d)) return;
        const t = tpl[tk]!;
        const { startAt, endAt } = shiftInstants(d, t.startTime, t.endTime, tz);
        shiftRows.push({
          tenantId, templateId: t.id, employeeId: emp(key), date: d0(d), startAt, endAt, breakMinutes: t.breakMinutes, title: t.name, color: t.color,
          status: 'PUBLISHED', locationId: t.locationId ?? locOf.get(emp(key)) ?? null, createdById: usr(g.manager),
        });
      });
    });
  }
  // Approved work on a day off last month (РВ in T-13).
  const prevSaturday = days.find((d) => d >= addDaysStr(from, 7) && isoWeekdayOf(d) === 6 && d < today)!;
  {
    const { startAt, endAt } = shiftInstants(prevSaturday, '10:00', '16:00', tz);
    shiftRows.push({ tenantId, employeeId: emp('staff2'), date: d0(prevSaturday), startAt, endAt, breakMinutes: 0, title: 'Работа в выходной', color: 'purple', status: 'PUBLISHED', locationId: locations.astana, createdById: usr('devlead') });
  }
  await prisma.shift.createMany({ data: shiftRows });

  // ── Marks ──
  const locs = await prisma.workLocation.findMany({ where: { tenantId } });
  const locById = new Map(locs.map((l) => [l.id, l]));
  const markRows: Prisma.TimeMarkCreateManyInput[] = [];
  const forcedNoOut = new Set<string>(); // employeeId|date
  const lastWorkday = pastWorkdays.at(-1)!;
  forcedNoOut.add(`${emp('staff0')}|${lastWorkday}`); // drives the pending correction request
  const demoNoMarksToday = new Set([emp('dev1')]); // the demo employee clocks in live

  const addMark = (employeeId: string, type: TimeMarkType, at: Date, locationId: string | null) => {
    if (at > now) return false;
    const l = locationId ? locById.get(locationId) : undefined;
    let lat: number | null = null, lng: number | null = null, distanceM: number | null = null;
    if (l) {
      lat = l.lat + (r() - 0.5) * 0.0016;
      lng = l.lng + (r() - 0.5) * 0.0024;
      distanceM = haversineM(lat, lng, l.lat, l.lng);
    }
    markRows.push({ tenantId, employeeId, type, at, lat, lng, accuracyM: l ? between(8, 35) : null, distanceM, verification: 'SKIPPED', source: 'SELF' });
    return true;
  };
  const min = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

  const shifts = await prisma.shift.findMany({ where: { tenantId, employeeId: { not: null }, date: { lte: d0(today) } }, orderBy: { startAt: 'asc' } });
  for (const s of shifts) {
    const e = s.employeeId!;
    const d = dateStrOf(s.date);
    if (s.startAt > now) continue;
    if (d === today && demoNoMarksToday.has(e)) continue;
    const roll = r();
    if (roll < 0.015 && d !== today && !forcedNoOut.has(`${e}|${d}`)) continue; // missing day → НН
    let inAt = min(s.startAt, -between(2, 15));
    if (roll > 0.94) inAt = min(s.startAt, between(7, 45)); // late
    if (!addMark(e, 'IN', inAt, s.locationId)) continue;
    const spanMin = (s.endAt.getTime() - s.startAt.getTime()) / 60_000;
    if (s.breakMinutes > 0 && r() < 0.9) {
      const bs = min(s.startAt, Math.floor(spanMin / 2) - 30 + between(-15, 15));
      if (addMark(e, 'BREAK_START', bs, s.locationId)) addMark(e, 'BREAK_END', min(bs, s.breakMinutes + between(-4, 5)), s.locationId);
    }
    if (forcedNoOut.has(`${e}|${d}`)) continue;
    const outRoll = r();
    if (outRoll < 0.02) continue; // forgot to mark leaving → NO_OUT
    let outAt = min(s.endAt, between(0, 9));
    if (outRoll > 0.9) outAt = min(s.endAt, between(30, 160)); // overtime (warehouse may run past 22:00 → night hours)
    else if (outRoll < 0.05) outAt = min(s.endAt, -between(20, 70)); // early leave
    if (d === today && outAt > now) continue; // still on shift
    addMark(e, 'OUT', outAt, s.locationId);
  }
  await prisma.timeMark.createMany({ data: markRows });

  // ── Open shift: weekend support duty ──
  {
    const t = tpl.supFull!;
    const { startAt, endAt } = shiftInstants(comingSaturday, t.startTime, t.endTime, tz);
    await prisma.shift.create({
      data: { tenantId, templateId: t.id, employeeId: null, date: d0(comingSaturday), startAt, endAt, breakMinutes: t.breakMinutes, title: 'Дежурство поддержки', color: 'blue', status: 'PUBLISHED', locationId: locations.astana, createdById: usr('supportlead') },
    });
  }

  // ── Time requests ──
  const subShift = await prisma.shift.findFirst({ where: { employeeId: emp('staff12'), date: { gt: d0(today) } }, orderBy: { date: 'asc' } });
  const sub = await prisma.user.findUniqueOrThrow({ where: { id: usr('staff13') } });
  const requests: Prisma.TimeRequestCreateManyInput[] = [
    { tenantId, employeeId: emp('staff0'), kind: 'CORRECTION', date: d0(lastWorkday), data: { out: '19:05', reason: 'Забыл отметить уход, ушёл после созвона с клиентом' } },
    { tenantId, employeeId: emp('dev1'), kind: 'DAY_OFF_WORK', date: d0(comingSaturday), data: { start: '10:00', end: '16:00', reason: 'Релиз мобильного приложения' } },
    // Decided in the past (history).
    { tenantId, employeeId: emp('staff2'), kind: 'DAY_OFF_WORK', date: d0(prevSaturday), data: { start: '10:00', end: '16:00', reason: 'Миграция базы данных' }, status: 'APPROVED', decidedById: usr('devlead'), decidedAt: new Date(`${addDaysStr(prevSaturday, -2)}T10:00:00Z`), comment: 'Согласовано' },
  ];
  if (subShift) {
    requests.push({
      tenantId, employeeId: emp('staff12'), kind: 'SUBSTITUTION', date: subShift.date,
      data: { shiftId: subShift.id, shiftTitle: subShift.title, substituteEmployeeId: emp('staff13'), substituteName: `${sub.lastName} ${sub.firstName}`, reason: 'Плановый приём у врача' },
    });
  }
  await prisma.timeRequest.createMany({ data: requests });

  // Last month's timesheet confirmed by one manager (shows "Подтверждение 1/N").
  await prisma.timesheetConfirmation.create({ data: { tenantId, managerEmployeeId: emp('devlead'), year: prevMonth.year, month: prevMonth.month } });

  return { time: { templates: Object.fromEntries(Object.entries(tpl).map(([k, v]) => [k, v.id])), shifts: shiftRows.length + 1, marks: markRows.length } };
}
