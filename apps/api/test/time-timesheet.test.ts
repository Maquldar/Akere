import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { prisma } from '../src/lib/db';
import { createApp, resetDb, type TestApp } from './helpers';
import { makeMarks, makeShift, timeSetup, today, TZ } from './time-fixtures';
import { addDaysStr, datesInRange, isoWeekdayOf, localMinuteOfDay, monthBounds } from '../src/lib/calendar';

let app: TestApp;
beforeAll(async () => {
  app = await createApp();
});
afterAll(() => app.close());
beforeEach(resetDb);

const d0 = (s: string) => new Date(`${s}T00:00:00Z`);

describe('timesheet', () => {
  it('today board: KPIs, statuses and timeline segments', async () => {
    const { c, t, mgr, emp1, emp2, other } = await timeSetup(app);
    const emp3 = await t.person({ email: 'e3@t.kz', managerEmployeeId: mgr.employeeId, lastName: 'Вторая' });
    const y = addDaysStr(today(), -1);
    for (const e of [emp1, emp2, emp3, other]) await makeShift(t.tenantId, e.employeeId, y, '09:00', '18:00');
    await makeMarks(t.tenantId, emp1.employeeId, y, ['IN', '09:02'], ['BREAK_START', '13:00'], ['BREAK_END', '14:00'], ['OUT', '18:00']);
    await makeMarks(t.tenantId, emp2.employeeId, y, ['IN', '09:30'], ['BREAK_START', '13:00'], ['BREAK_END', '14:00'], ['OUT', '21:00']);
    await makeMarks(t.tenantId, emp3.employeeId, y, ['IN', '08:55']);
    const b = (await c.mgr.get(`/time/board?date=${y}`)).json();
    expect(b.rows).toHaveLength(3); // other team excluded
    const by = (id: string) => b.rows.find((r: { employee: { employeeId: string } }) => r.employee.employeeId === id);
    expect(by(emp1.employeeId)).toMatchObject({ status: 'NORMAL', workedMinutes: 478, plannedMinutes: 480 });
    expect(by(emp2.employeeId)).toMatchObject({ status: 'LATE', workedMinutes: 630, deviationMinutes: 150 });
    expect(by(emp2.employeeId).segments.map((s: { kind: string }) => s.kind)).toEqual(['work', 'break', 'work', 'overtime']);
    expect(by(emp3.employeeId).status).toBe('NO_OUT');
    expect(b.kpi).toMatchObject({ onShiftNow: 0, scheduledToday: 3, totalShifts: 3, closedShifts: 2, needAttention: 2, noMarks: 0, overtimeMinutes: 150, factMinutes: 1108, deltaToPlanMinutes: 148 });
    expect((await c.mgr.get(`/time/board?date=${y}&status=NO_OUT`)).json().rows).toHaveLength(1);
    expect((await c.e1.get('/time/board')).statusCode).toBe(403);

    // Live: one on shift, one without marks (only when the window fits into today's local day).
    const now = new Date();
    const m = localMinuteOfDay(now, TZ);
    if (m > 5 * 60 && m < 19 * 60) {
      const d = today();
      for (const e of [emp1, emp2]) {
        await prisma.shift.create({ data: { tenantId: t.tenantId, employeeId: e.employeeId, date: d0(d), startAt: new Date(now.getTime() - 4 * 3_600_000), endAt: new Date(now.getTime() + 4 * 3_600_000), breakMinutes: 60, title: 'Поддержка', status: 'PUBLISHED', createdById: 'x' } });
      }
      await prisma.timeMark.create({ data: { tenantId: t.tenantId, employeeId: emp1.employeeId, type: 'IN', at: new Date(now.getTime() - 4 * 3_600_000 + 60_000) } });
      const live = (await c.mgr.get('/time/board')).json();
      expect(live.kpi).toMatchObject({ onShiftNow: 1, scheduledToday: 2, needAttention: 1, noMarks: 1 });
      expect(live.rows.find((r: { employee: { employeeId: string } }) => r.employee.employeeId === emp1.employeeId).status).toBe('ON_SHIFT');
    }
  });

  it('T-13: codes from marks and absences, totals, confirmation and Excel export', async () => {
    const { c, t, emp1, emp2 } = await timeSetup(app);
    const now = new Date(`${today()}T00:00:00Z`);
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const year = prev.getUTCFullYear();
    const month = prev.getUTCMonth() + 1;
    const { from, to } = monthBounds(year, month);
    const all = datesInRange(from, to);
    const weekdays = all.filter((d) => isoWeekdayOf(d) <= 5);
    const saturday = all.find((d) => isoWeekdayOf(d) === 6)!;
    const holiday = weekdays[10]!;
    await prisma.holiday.create({ data: { date: d0(holiday), kind: 'HOLIDAY', name: 'Тестовый праздник' } });
    const workdays = weekdays.filter((d) => d !== holiday);
    const [nn, ot, vac1, vac2, ...rest] = workdays;
    // emp1: vacation on 2 days, no marks on 1, overtime on 1, normal elsewhere, plus Saturday work w/o shift.
    await prisma.absence.create({ data: { tenantId: t.tenantId, employeeId: emp1.employeeId, kind: 'VACATION', startDate: d0(vac1!), endDate: d0(vac2!), source: 'REQUEST' } });
    for (const d of workdays) if (d !== vac1 && d !== vac2) await makeShift(t.tenantId, emp1.employeeId, d, '09:00', '18:00');
    for (const d of rest) await makeMarks(t.tenantId, emp1.employeeId, d, ['IN', '08:58'], ['BREAK_START', '13:00'], ['BREAK_END', '14:00'], ['OUT', '18:02']);
    await makeMarks(t.tenantId, emp1.employeeId, ot!, ['IN', '09:00'], ['BREAK_START', '13:00'], ['BREAK_END', '14:00'], ['OUT', '21:30']);
    await makeMarks(t.tenantId, emp1.employeeId, saturday, ['IN', '20:00'], ['OUT', '+00:00']); // 4h on a day off, 2h of them at night
    // emp2: sick leave via API (creates the absence), business trip, unpaid leave.
    const sl = await c.hr.post('/sick-leaves', { employeeId: emp2.employeeId, number: 'БЛ-1', startDate: workdays[0], endDate: workdays[1], source: 'MANUAL' });
    expect(sl.statusCode).toBe(201);
    await prisma.absence.create({ data: { tenantId: t.tenantId, employeeId: emp2.employeeId, kind: 'BUSINESS_TRIP', startDate: d0(workdays[2]!), endDate: d0(workdays[2]!), source: 'MANUAL' } });
    await prisma.absence.create({ data: { tenantId: t.tenantId, employeeId: emp2.employeeId, kind: 'UNPAID', startDate: d0(workdays[3]!), endDate: d0(workdays[3]!), source: 'MANUAL' } });

    const res = await c.hr.get(`/time/t13?year=${year}&month=${month}`);
    expect(res.statusCode).toBe(200);
    const sheet = res.json();
    expect(sheet.days).toHaveLength(all.length);
    expect(sheet.days[all.indexOf(holiday)]).toMatchObject({ isHoliday: true, isWeekend: true });
    const row1 = sheet.rows.find((r: { employee: { employeeId: string } }) => r.employee.employeeId === emp1.employeeId);
    type Cell = { day: number; hours: number | null; codes: string[]; deviation: boolean };
    const cell = (row: { cells: Cell[] }, d: string) => row.cells[all.indexOf(d)]!;
    expect(row1.normHours).toBe(workdays.length * 8);
    expect(cell(row1, nn!)).toMatchObject({ hours: 0, codes: ['НН'], deviation: true });
    expect(cell(row1, ot!)).toMatchObject({ hours: 11.5, codes: ['Я', 'С'], deviation: true });
    expect(cell(row1, vac1!).codes).toEqual(['О']);
    expect(cell(row1, rest[0]!)).toMatchObject({ hours: 8, codes: ['Я'], deviation: false });
    expect(cell(row1, saturday)).toMatchObject({ hours: 4, codes: ['РВ', 'Н'] });
    expect(cell(row1, holiday).codes).toEqual(['П']);
    const sunday = all.find((d) => isoWeekdayOf(d) === 7)!;
    expect(cell(row1, sunday).codes).toEqual(['В']);
    expect(row1.planHours).toBe((workdays.length - 2) * 8);
    expect(row1.overtime15).toBe(2);
    expect(row1.overtime2).toBe(5.5); // 1.5h beyond 2h on the overtime day + 4h on Saturday
    expect(row1.deviations).toBe(3); // НН, overtime day, unplanned Saturday work
    const row2 = sheet.rows.find((r: { employee: { employeeId: string } }) => r.employee.employeeId === emp2.employeeId);
    expect([0, 1, 2, 3].map((i) => cell(row2, workdays[i]!).codes)).toEqual([['Б'], ['Б'], ['К'], ['БС']]);
    expect(sheet.totals.factHours).toBe(row1.factHours);
    expect(sheet.totals.perDay[all.indexOf(ot!)]).toBe(11.5);
    expect(sheet.deviationsTotal).toBeGreaterThanOrEqual(2);
    expect(sheet.confirmation).toEqual({ confirmed: 0, total: 2, mine: null });

    // Manager sees only their subtree and confirms.
    const mgrSheet = (await c.mgr.get(`/time/t13?year=${year}&month=${month}`)).json();
    expect(mgrSheet.rows.map((r: { employee: { employeeId: string } }) => r.employee.employeeId).sort()).toEqual([emp1.employeeId, emp2.employeeId].sort());
    expect(mgrSheet.confirmation).toEqual({ confirmed: 0, total: 1, mine: false });
    const conf = await c.mgr.post('/time/t13/confirm', { year, month });
    expect(conf.json()).toEqual({ confirmed: 1, total: 2 });
    expect((await c.mgr.get(`/time/t13?year=${year}&month=${month}`)).json().confirmation).toEqual({ confirmed: 1, total: 1, mine: true });
    expect((await c.hr.post('/time/t13/confirm', { year, month })).json().error.details.rule).toBe('NO_SUBORDINATES');
    // Employee sees only their own row.
    expect((await c.e1.get(`/time/t13?year=${year}&month=${month}`)).json().rows).toHaveLength(1);

    // Export (HR only).
    expect((await c.mgr.get(`/time/t13/export?year=${year}&month=${month}`)).statusCode).toBe(403);
    const x = await c.hr.get(`/time/t13/export?year=${year}&month=${month}`);
    expect(x.statusCode).toBe(200);
    expect(x.headers['content-type']).toContain('spreadsheetml');
    expect(x.headers['content-disposition']).toContain('.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.rawPayload as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(String(ws.getCell(1, 1).value)).toContain('Т-13');
    expect(String(ws.getCell(2, 1).value)).toContain('Организация');
    expect(ws.getCell(6, 1).value).toBe('№ п/п');
    expect(ws.getCell(6, 5).value).toBe(1);
    const names: string[] = [];
    ws.eachRow((r) => names.push(String(r.getCell(2).value ?? '')));
    expect(names.some((n) => n.startsWith('Аманов'))).toBe(true);
    expect(names).toContain('Выходной день');
    expect(names).toContain('ИТОГО');
  });
});
