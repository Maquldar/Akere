import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db';
import { createApp, resetDb, type TestApp } from './helpers';
import { at, makeMarks, makeShift, timeSetup, today } from './time-fixtures';
import { addDaysStr } from '../src/lib/calendar';

let app: TestApp;
beforeAll(async () => {
  app = await createApp();
});
afterAll(() => app.close());
beforeEach(resetDb);

describe('time requests', () => {
  it('correction: approve creates CORRECTION marks and fixes the day', async () => {
    const { c, t, emp1 } = await timeSetup(app);
    const y = addDaysStr(today(), -1);
    await makeShift(t.tenantId, emp1.employeeId, y, '09:00', '18:00');
    await makeMarks(t.tenantId, emp1.employeeId, y, ['IN', '09:00']); // forgot OUT
    expect((await c.e1.post('/time/requests', { kind: 'CORRECTION', date: addDaysStr(today(), 2), out: '18:00', reason: 'x' })).json().error.details.rule).toBe('DATE_IN_FUTURE');
    expect((await c.e1.post('/time/requests', { kind: 'CORRECTION', date: y, reason: 'x' })).statusCode).toBe(400);
    const r = await c.e1.post('/time/requests', { kind: 'CORRECTION', date: y, out: '18:00', reason: 'Забыл отметить уход' });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ kind: 'CORRECTION', status: 'PENDING', date: y, data: { out: '18:00' } });
    expect((await c.e1.post('/time/requests', { kind: 'CORRECTION', date: y, out: '18:00', reason: 'again' })).statusCode).toBe(409);
    expect((await c.mgr.get('/me/inbox-counts')).json().timeRequests).toBe(1);
    expect((await c.om.get('/me/inbox-counts')).json().timeRequests).toBe(0);
    expect((await c.e1.get('/me/inbox-counts')).json().timeRequests).toBe(0);
    expect((await c.mgr.get('/time/requests?scope=managed&status=PENDING')).json().total).toBe(1);
    expect((await c.om.get('/time/requests?scope=managed')).json().total).toBe(0);
    expect((await c.e1.get('/time/requests?scope=managed')).statusCode).toBe(403);
    expect((await c.om.post(`/time/requests/${r.json().id}/decide`, { decision: 'APPROVE' })).statusCode).toBe(403);
    expect((await c.e1.post(`/time/requests/${r.json().id}/decide`, { decision: 'APPROVE' })).statusCode).toBe(403);
    const dec = await c.mgr.post(`/time/requests/${r.json().id}/decide`, { decision: 'APPROVE', comment: 'ok' });
    expect(dec.statusCode).toBe(200);
    expect(dec.json()).toMatchObject({ status: 'APPROVED', comment: 'ok', decidedBy: { fullName: expect.stringContaining('Руководов') } });
    const marks = await prisma.timeMark.findMany({ where: { employeeId: emp1.employeeId }, orderBy: { at: 'asc' } });
    expect(marks.map((m) => [m.type, m.source])).toEqual([['IN', 'SELF'], ['OUT', 'CORRECTION']]);
    expect(marks[1]!.at.toISOString()).toBe(at(y, '18:00').toISOString());
    expect((await c.mgr.post(`/time/requests/${r.json().id}/decide`, { decision: 'REJECT' })).statusCode).toBe(409);
    expect(await prisma.notification.count({ where: { userId: emp1.userId, type: 'time.request_approved' } })).toBe(1);
    const board = (await c.mgr.get(`/time/board?date=${y}`)).json();
    expect(board.rows.find((x: { employee: { employeeId: string } }) => x.employee.employeeId === emp1.employeeId).status).toBe('NORMAL'); // 9h span minus the auto-deducted 1h break = plan
  });

  it('day-off work: approve creates a published "Работа в выходной" shift', async () => {
    const { c, emp1 } = await timeSetup(app);
    const d = addDaysStr(today(), 5);
    const r = (await c.e1.post('/time/requests', { kind: 'DAY_OFF_WORK', date: d, start: '10:00', end: '14:00', reason: 'Релиз' })).json();
    const rej = await c.mgr.post(`/time/requests/${r.id}/decide`, { decision: 'REJECT' });
    expect(rej.json().status).toBe('REJECTED');
    expect(await prisma.shift.count()).toBe(0);
    const r2 = (await c.e1.post('/time/requests', { kind: 'DAY_OFF_WORK', date: d, start: '10:00', end: '14:00', reason: 'Релиз' })).json();
    expect((await c.hr.post(`/time/requests/${r2.id}/decide`, { decision: 'APPROVE' })).json().status).toBe('APPROVED');
    const s = await prisma.shift.findFirstOrThrow({ where: { employeeId: emp1.employeeId } });
    expect(s).toMatchObject({ title: 'Работа в выходной', status: 'PUBLISHED', breakMinutes: 0 });
    expect(s.startAt.toISOString()).toBe(at(d, '10:00').toISOString());
    const mine = (await c.e1.get('/time/requests')).json();
    expect(mine.items.map((x: { status: string }) => x.status).sort()).toEqual(['APPROVED', 'REJECTED']);
  });

  it('substitution: approve reassigns the shift to the substitute', async () => {
    const { c, t, emp1, emp2, other } = await timeSetup(app);
    const d = addDaysStr(today(), 2);
    const shift = await makeShift(t.tenantId, emp1.employeeId, d);
    const foreign = await makeShift(t.tenantId, emp2.employeeId, addDaysStr(d, 1));
    expect((await c.e1.post('/time/requests', { kind: 'SUBSTITUTION', shiftId: foreign.id, substituteEmployeeId: emp2.employeeId, reason: 'x' })).statusCode).toBe(404);
    expect((await c.e1.post('/time/requests', { kind: 'SUBSTITUTION', shiftId: shift.id, substituteEmployeeId: emp1.employeeId, reason: 'x' })).statusCode).toBe(400);
    const r = await c.e1.post('/time/requests', { kind: 'SUBSTITUTION', shiftId: shift.id, substituteEmployeeId: other.employeeId, reason: 'Семейные обстоятельства' });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.substituteName).toContain('Чужой');
    expect(r.json().date).toBe(d);
    const dec = await c.mgr.post(`/time/requests/${r.json().id}/decide`, { decision: 'APPROVE' });
    expect(dec.json().status).toBe('APPROVED');
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } })).employeeId).toBe(other.employeeId);
    expect(await prisma.notification.count({ where: { userId: other.userId, type: 'time.substitution' } })).toBe(1);
  });
});
