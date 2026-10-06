import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db';
import { createApp, resetDb, type TestApp } from './helpers';
import { makeShift, timeSetup, today } from './time-fixtures';
import { addDaysStr, startOfWeek } from '../src/lib/calendar';

let app: TestApp;
beforeAll(async () => {
  app = await createApp();
});
afterAll(() => app.close());
beforeEach(resetDb);

async function template(c: Awaited<ReturnType<typeof timeSetup>>['c']['mgr'], body: Record<string, unknown> = {}) {
  const res = await c.post('/time/shift-templates', { name: '5/2 Разработка', startTime: '10:00', endTime: '19:00', breakMinutes: 60, color: 'gray', ...body });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; name: string };
}

describe('shift planning', () => {
  it('manages shift templates (employees read, soft deactivate)', async () => {
    const { c, location } = await timeSetup(app);
    expect((await c.e1.post('/time/shift-templates', { name: 'X', startTime: '09:00', endTime: '18:00' })).statusCode).toBe(403);
    const tpl = await template(c.mgr, { locationId: location.id });
    expect((await c.mgr.post('/time/shift-templates', { name: 'Bad', startTime: '25:00', endTime: '18:00' })).statusCode).toBe(400);
    const list = (await c.e1.get('/time/shift-templates')).json();
    expect(list[0]).toMatchObject({ name: '5/2 Разработка', startTime: '10:00', color: 'gray', location: { name: 'Офис' }, isActive: true });
    expect((await c.mgr.patch(`/time/shift-templates/${tpl.id}`, { color: 'teal' })).json().color).toBe('teal');
    expect((await c.mgr.del(`/time/shift-templates/${tpl.id}`)).statusCode).toBe(204);
    expect((await c.e1.get('/time/shift-templates')).json()).toHaveLength(0);
    expect((await c.mgr.get('/time/shift-templates?all=true')).json()[0].isActive).toBe(false);
  });

  it('creates DRAFT shifts with UTC instants, prevents doubles and respects manager scope', async () => {
    const { c, emp1, other } = await timeSetup(app);
    const tpl = await template(c.mgr);
    const d = addDaysStr(today(), 7);
    const res = await c.mgr.post('/time/shifts', { employeeId: emp1.employeeId, date: d, templateId: tpl.id });
    expect(res.statusCode).toBe(201);
    const s = res.json();
    expect(s).toMatchObject({ status: 'DRAFT', title: '5/2 Разработка', breakMinutes: 60, date: d });
    expect(s.startAt).toBe(new Date(`${d}T05:00:00.000Z`).toISOString());
    expect((await c.mgr.post('/time/shifts', { employeeId: emp1.employeeId, date: d, startTime: '08:00', endTime: '12:00' })).statusCode).toBe(409);
    // Night shift crosses midnight and belongs to its start date.
    const night = (await c.mgr.post('/time/shifts', { employeeId: emp1.employeeId, date: addDaysStr(d, 1), startTime: '20:00', endTime: '08:00', breakMinutes: 60 })).json();
    expect(night.endAt).toBe(new Date(`${addDaysStr(d, 2)}T03:00:00.000Z`).toISOString());
    expect(night.date).toBe(addDaysStr(d, 1));
    // Other manager's employee: 403; unknown employee: 404; employees can't plan.
    expect((await c.mgr.post('/time/shifts', { employeeId: other.employeeId, date: d, templateId: tpl.id })).statusCode).toBe(403);
    expect((await c.mgr.post('/time/shifts', { employeeId: 'nope', date: d, templateId: tpl.id })).statusCode).toBe(404);
    expect((await c.e1.post('/time/shifts', { employeeId: emp1.employeeId, date: d, templateId: tpl.id })).statusCode).toBe(403);
    expect((await c.om.patch(`/time/shifts/${s.id}`, { title: 'hack' })).statusCode).toBe(403);
    expect((await c.om.del(`/time/shifts/${s.id}`)).statusCode).toBe(403);
    const upd = (await c.mgr.patch(`/time/shifts/${s.id}`, { startTime: '11:00' })).json();
    expect(upd.startAt).toBe(new Date(`${d}T06:00:00.000Z`).toISOString());
    expect(upd.endAt).toBe(s.endAt);
    expect((await c.mgr.del(`/time/shifts/${s.id}`)).statusCode).toBe(204);
  });

  it('generates 5/2 skipping holidays and absences, and 2/2 from an offset', async () => {
    const { c, emp1, emp2, t } = await timeSetup(app);
    const tpl = await template(c.mgr);
    const mon = startOfWeek(addDaysStr(today(), 14));
    await prisma.holiday.create({ data: { date: new Date(`${addDaysStr(mon, 2)}T00:00:00Z`), kind: 'HOLIDAY', name: 'Праздник' } });
    await prisma.absence.create({ data: { tenantId: t.tenantId, employeeId: emp2.employeeId, kind: 'VACATION', startDate: new Date(`${addDaysStr(mon, 3)}T00:00:00Z`), endDate: new Date(`${addDaysStr(mon, 4)}T00:00:00Z`), source: 'MANUAL' } });
    const r = await c.mgr.post('/time/shifts/pattern', { employeeIds: [emp1.employeeId, emp2.employeeId], templateId: tpl.id, pattern: '5/2', from: mon, to: addDaysStr(mon, 6), skipHolidays: true, replace: false });
    expect(r.statusCode).toBe(201);
    // emp1: Mon, Tue, Thu, Fri (Wed holiday) = 4; emp2: Mon, Tue (Wed holiday, Thu–Fri vacation) = 2
    expect(r.json()).toEqual({ created: 6, skipped: 4 });
    const e1Dates = (await prisma.shift.findMany({ where: { employeeId: emp1.employeeId }, orderBy: { date: 'asc' } })).map((s) => s.date.toISOString().slice(0, 10));
    expect(e1Dates).toEqual([mon, addDaysStr(mon, 1), addDaysStr(mon, 3), addDaysStr(mon, 4)]);
    // Re-running without replace skips existing days.
    expect((await c.mgr.post('/time/shifts/pattern', { employeeIds: [emp1.employeeId], templateId: tpl.id, pattern: '5/2', from: mon, to: addDaysStr(mon, 6), skipHolidays: true, replace: false })).json().created).toBe(0);
    // 2/2 with offset 1 and replace: day0 = index1 (work), day1 = index2 (off), day2-3 off/… pattern W O O W W O O
    const warehouse = await template(c.mgr, { name: 'Склад 2/2', startTime: '08:00', endTime: '20:00' });
    const r2 = await c.mgr.post('/time/shifts/pattern', { employeeIds: [emp1.employeeId], templateId: warehouse.id, pattern: '2/2', from: mon, to: addDaysStr(mon, 6), startOffset: 1, skipHolidays: false, replace: true });
    expect(r2.json()).toEqual({ created: 3, skipped: 0 });
    const shifts = await prisma.shift.findMany({ where: { employeeId: emp1.employeeId }, orderBy: { date: 'asc' } });
    expect(shifts.map((s) => s.date.toISOString().slice(0, 10))).toEqual([mon, addDaysStr(mon, 3), addDaysStr(mon, 4)]);
    expect(shifts.every((s) => s.title === 'Склад 2/2')).toBe(true);
    // Custom cycle requires `cycle`; scope is enforced.
    expect((await c.mgr.post('/time/shifts/pattern', { employeeIds: [emp1.employeeId], templateId: tpl.id, pattern: 'custom', from: mon, to: mon, skipHolidays: false, replace: false })).statusCode).toBe(400);
    expect((await c.om.post('/time/shifts/pattern', { employeeIds: [emp1.employeeId], templateId: tpl.id, pattern: '5/2', from: mon, to: mon, skipHolidays: false, replace: false })).statusCode).toBe(403);
  });

  it('publishes drafts: employees only see published shifts, managers see drafts', async () => {
    const { c, emp1, emp2, mgr } = await timeSetup(app);
    const tpl = await template(c.mgr);
    const mon = startOfWeek(addDaysStr(today(), 7));
    await c.mgr.post('/time/shifts/pattern', { employeeIds: [emp1.employeeId, emp2.employeeId], templateId: tpl.id, pattern: '5/2', from: mon, to: addDaysStr(mon, 6), skipHolidays: false, replace: false });
    const team = (await c.e1.get(`/time/schedule?from=${mon}&to=${addDaysStr(mon, 6)}`)).json();
    expect(team.rows.length).toBeGreaterThanOrEqual(2);
    expect(team.rows.every((r: { shifts: unknown[] }) => r.shifts.length === 0)).toBe(true);
    expect(team.hasDrafts).toBe(false);
    expect((await c.e1.get(`/time/schedule?from=${mon}&to=${addDaysStr(mon, 6)}&scope=managed`)).statusCode).toBe(403);
    const managed = (await c.mgr.get(`/time/schedule?from=${mon}&to=${addDaysStr(mon, 6)}&scope=managed`)).json();
    expect(managed.rows.map((r: { employee: { employeeId: string } }) => r.employee.employeeId).sort()).toEqual([emp1.employeeId, emp2.employeeId].sort());
    expect(managed.hasDrafts).toBe(true);
    expect(managed.rows[0]).toMatchObject({ plannedHours: 40, targetHours: 40 });
    // Other manager sees nothing of this team.
    expect((await c.om.get(`/time/schedule?from=${mon}&to=${addDaysStr(mon, 6)}&scope=managed`)).json().rows.map((r: { employee: { employeeId: string } }) => r.employee.employeeId)).not.toContain(emp1.employeeId);
    const pub = await c.mgr.post('/time/shifts/publish', { from: mon, to: addDaysStr(mon, 6) });
    expect(pub.json()).toEqual({ published: 10 });
    expect(await prisma.notification.count({ where: { userId: emp1.userId, type: 'time.schedule_published' } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: mgr.userId, type: 'time.schedule_published' } })).toBe(0);
    const after = (await c.e1.get(`/time/schedule?from=${mon}&to=${addDaysStr(mon, 6)}`)).json();
    const row = after.rows.find((r: { employee: { employeeId: string } }) => r.employee.employeeId === emp1.employeeId);
    expect(row.shifts).toHaveLength(5);
    expect(row.plannedHours).toBe(40);
    // Copy the week forward (drafts again).
    const copy = await c.mgr.post('/time/shifts/copy-week', { fromWeekStart: mon, toWeekStart: addDaysStr(mon, 7) });
    expect(copy.json()).toEqual({ created: 10 });
    expect(await prisma.shift.count({ where: { status: 'DRAFT' } })).toBe(10);
    expect((await c.mgr.post('/time/shifts/copy-week', { fromWeekStart: mon, toWeekStart: addDaysStr(mon, 7) })).json()).toEqual({ created: 0 });
  });

  it('open shifts: employee claims, manager approves', async () => {
    const { c, t, emp1, emp2, mgr } = await timeSetup(app);
    const d = addDaysStr(today(), 3);
    const open = (await c.mgr.post('/time/shifts', { employeeId: null, date: d, startTime: '09:00', endTime: '21:00', title: 'Дежурство поддержки' })).json();
    expect(open.employeeId).toBeNull();
    expect((await c.e1.post(`/time/shifts/${open.id}/claim`)).statusCode).toBe(404); // still a draft
    await c.mgr.post('/time/shifts/publish', { from: d, to: d });
    const claimed = await c.e1.post(`/time/shifts/${open.id}/claim`);
    expect(claimed.statusCode).toBe(201);
    expect(claimed.json().claims[0].status).toBe('PENDING');
    expect((await c.e1.post(`/time/shifts/${open.id}/claim`)).statusCode).toBe(409);
    await makeShift(t.tenantId, emp2.employeeId, d);
    expect((await c.e2.post(`/time/shifts/${open.id}/claim`)).json().error.details.rule).toBe('ALREADY_SCHEDULED');
    expect(await prisma.notification.count({ where: { userId: mgr.userId, type: 'time.shift_claimed' } })).toBe(1);
    const claimId = claimed.json().claims[0].id;
    expect((await c.om.post(`/time/shifts/${open.id}/claims/${claimId}/decide`, { decision: 'APPROVE' })).statusCode).toBe(403);
    const dec = await c.mgr.post(`/time/shifts/${open.id}/claims/${claimId}/decide`, { decision: 'APPROVE' });
    expect(dec.statusCode).toBe(200);
    expect(dec.json().employeeId).toBe(emp1.employeeId);
    expect(dec.json().claims[0].status).toBe('APPROVED');
    expect((await c.e1.get('/time/me/today')).json().openShifts).toHaveLength(0);
  });
});
