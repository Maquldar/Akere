import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db';
import { createApp, resetDb, SAMPLE_PDF, type TestApp } from './helpers';
import { timeSetup, today } from './time-fixtures';
import { addDaysStr } from '../src/lib/calendar';
import { saveFile } from '../src/lib/files';

let app: TestApp;
beforeAll(async () => {
  app = await createApp();
});
afterAll(() => app.close());
beforeEach(resetDb);

describe('sick leaves and absences', () => {
  it('CRUD keeps the SICK absence in sync', async () => {
    const { c, t, emp1, hr } = await timeSetup(app);
    const s = addDaysStr(today(), -10);
    const e = addDaysStr(today(), -6);
    const file = await saveFile({ tenantId: t.tenantId, buffer: SAMPLE_PDF, filename: 'bl.pdf', allowed: ['pdf'], uploadedById: hr.userId });
    expect((await c.e1.post('/sick-leaves', { employeeId: emp1.employeeId, number: 'X', startDate: s, endDate: e })).statusCode).toBe(403);
    expect((await c.mgr.post('/sick-leaves', { employeeId: emp1.employeeId, number: 'X', startDate: s, endDate: e })).statusCode).toBe(403);
    expect((await c.hr.post('/sick-leaves', { employeeId: emp1.employeeId, number: 'X', startDate: e, endDate: s })).statusCode).toBe(400);
    const res = await c.hr.post('/sick-leaves', { employeeId: emp1.employeeId, number: '0012345', startDate: s, endDate: e, source: 'MANUAL', fileId: file.id, note: 'ОРВИ' });
    expect(res.statusCode).toBe(201);
    const sl = res.json();
    expect(sl).toMatchObject({ number: '0012345', days: 5, source: 'MANUAL', note: 'ОРВИ', employee: { fullName: expect.stringContaining('Аманов') } });
    expect(sl.file.id).toBe(file.id);
    const abs = await prisma.absence.findMany({ where: { employeeId: emp1.employeeId } });
    expect(abs).toHaveLength(1);
    expect(abs[0]).toMatchObject({ kind: 'SICK', source: 'SICK_LEAVE', sourceId: sl.id });
    expect((await c.hr.post('/sick-leaves', { employeeId: emp1.employeeId, number: '0012345', startDate: today(), endDate: today() })).statusCode).toBe(409);
    expect((await c.hr.post('/sick-leaves', { employeeId: emp1.employeeId, number: 'other', startDate: e, endDate: today() })).statusCode).toBe(409); // overlap

    const upd = await c.hr.patch(`/sick-leaves/${sl.id}`, { endDate: addDaysStr(e, 2) });
    expect(upd.json().days).toBe(7);
    const abs2 = await prisma.absence.findFirstOrThrow({ where: { sourceId: sl.id } });
    expect(abs2.endDate.toISOString().slice(0, 10)).toBe(addDaysStr(e, 2));

    // Reading: employee self, manager subtree, other manager nothing.
    expect((await c.e1.get('/sick-leaves')).json().total).toBe(1);
    expect((await c.e2.get('/sick-leaves')).json().total).toBe(0);
    expect((await c.mgr.get('/sick-leaves')).json().total).toBe(1);
    expect((await c.om.get('/sick-leaves')).json().total).toBe(0);
    expect((await c.e1.get(`/files/${file.id}`)).statusCode).toBe(200);
    expect((await c.mgr.get(`/files/${file.id}`)).statusCode).toBe(200);
    expect((await c.om.get(`/files/${file.id}`)).statusCode).toBe(404);

    const absList = (await c.mgr.get(`/absences?from=${s}&to=${today()}`)).json();
    expect(absList).toHaveLength(1);
    expect(absList[0]).toMatchObject({ kind: 'SICK', source: 'SICK_LEAVE', employeeId: emp1.employeeId, startDate: s });
    expect((await c.om.get('/absences')).json()).toHaveLength(0);
    expect((await c.e2.get('/absences')).json()).toHaveLength(0);
    expect((await c.hr.get('/absences?kind=VACATION')).json()).toHaveLength(0);
    expect((await c.hr.get(`/absences?to=${addDaysStr(s, -1)}`)).json()).toHaveLength(0);

    expect((await c.hr.del(`/sick-leaves/${sl.id}`)).statusCode).toBe(204);
    expect(await prisma.absence.count({ where: { sourceId: sl.id } })).toBe(0);
    expect((await c.hr.del(`/sick-leaves/${sl.id}`)).statusCode).toBe(404);
  });

  it('syncs electronic sick leaves idempotently', async () => {
    const { c } = await timeSetup(app);
    const first = await c.hr.post('/sick-leaves/sync');
    expect(first.statusCode).toBe(200);
    expect(first.json().imported).toBe(2);
    expect((await c.hr.post('/sick-leaves/sync')).json().imported).toBe(0);
    const list = (await c.hr.get('/sick-leaves')).json();
    expect(list.total).toBe(2);
    expect(list.items.every((x: { source: string }) => x.source === 'ELECTRONIC')).toBe(true);
    expect(await prisma.absence.count({ where: { kind: 'SICK', source: 'SICK_LEAVE' } })).toBe(2);
    expect((await c.mgr.post('/sick-leaves/sync')).statusCode).toBe(403);
  });
});
