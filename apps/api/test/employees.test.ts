import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db';
import { fullMonthsBetween, getVacationBalance } from '../src/modules/employees/service';
import { createApp, resetDb, type TestApp } from './helpers';
import { docSetup, qrSign } from './documents-fixtures';

let app: TestApp;
beforeAll(async () => {
  app = await createApp();
});
afterAll(() => app.close());
beforeEach(resetDb);

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const isoDay = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe('vacation balance', () => {
  it('accrues per full month worked and applies usage and adjustments', async () => {
    expect(fullMonthsBetween(d('2024-01-10'), d('2024-02-09'))).toBe(0);
    expect(fullMonthsBetween(d('2024-01-10'), d('2024-02-10'))).toBe(1);
    expect(fullMonthsBetween(d('2024-01-10'), d('2026-10-06'))).toBe(32);
    expect(fullMonthsBetween(d('2026-10-06'), d('2024-01-10'))).toBe(0);

    const s = await docSetup(app);
    const emp = s.emp.employeeId; // hired 2024-01-10, 24 days/year
    await prisma.vacationLedger.createMany({
      data: [
        { tenantId: s.t.tenantId, employeeId: emp, type: 'USAGE', days: 14, date: d('2025-07-01'), note: 'Отпуск' },
        { tenantId: s.t.tenantId, employeeId: emp, type: 'ADJUSTMENT', days: 2.5, date: d('2025-01-01'), note: 'Перенос' },
      ],
    });
    const b = await getVacationBalance(emp, prisma, d('2026-10-06'));
    expect(b).toMatchObject({ accrued: 64, used: 14, adjusted: 2.5, available: 52.5, perYear: 24 });
    expect(b.entries).toHaveLength(2);
    await prisma.employee.update({ where: { id: emp }, data: { vacationDaysPerYear: 30 } });
    expect((await getVacationBalance(emp, prisma, d('2024-08-15'))).accrued).toBe(17.5); // 30 × 7 / 12

    // API: HR adjusts, the employee reads their own balance, outsiders get 404, employees cannot adjust.
    const adj = await s.c.hr.post(`/employees/${emp}/vacation-adjustments`, { days: -3, date: '2026-10-01', note: 'Корректировка' });
    expect(adj.statusCode).toBe(201);
    expect(adj.json().adjusted).toBe(-0.5);
    const own = (await s.c.emp.get(`/employees/${emp}/vacation-balance`)).json();
    const months = fullMonthsBetween(d('2024-01-10'), d(isoDay()));
    expect(own.accrued).toBe(Math.round(((30 * months) / 12) * 100) / 100);
    expect(own.available).toBe(Math.round((own.accrued - 0.5 - 14) * 100) / 100);
    expect((await s.c.other.get(`/employees/${emp}/vacation-balance`)).statusCode).toBe(404);
    expect((await s.c.emp.post(`/employees/${emp}/vacation-adjustments`, { days: 5, date: '2026-10-01', note: 'x' })).statusCode).toBe(403);
  });
});

describe('employees directory and profile', () => {
  it('scopes the list, shows the e-dossier and lets HR update', async () => {
    const s = await docSetup(app);
    expect((await s.c.hr.get('/employees')).json().total).toBe(5);
    const mine = (await s.c.mgr.get('/employees')).json();
    expect(mine.items.map((e: { id: string }) => e.id).sort()).toEqual([s.mgr.employeeId, s.emp.employeeId].sort());
    expect((await s.c.other.get('/employees')).json().total).toBe(1);
    expect((await s.c.hr.get(`/employees?q=${encodeURIComponent('работ')}`)).json().items[0].id).toBe(s.emp.employeeId);
    expect((await s.c.hr.get(`/employees?managerId=${s.mgr.employeeId}`)).json().total).toBe(1);
    expect((await s.c.mgr.get(`/employees/options?q=${encodeURIComponent('Посторон')}`)).json()[0].id).toBe(s.other.employeeId);

    await s.c.emp.post('/deputies', { deputyUserId: s.mgr.userId, startDate: isoDay(), endDate: isoDay(10) });
    const p = (await s.c.mgr.get(`/employees/${s.emp.employeeId}`)).json();
    expect(p).toMatchObject({ id: s.emp.employeeId, hireDate: '2024-01-10', vacationDaysPerYear: 24, roles: ['EMPLOYEE'], candidateId: null, canManage: false });
    expect(p.manager.id).toBe(s.mgr.userId);
    expect(p.deputies[0].deputy.id).toBe(s.mgr.userId);
    expect((await s.c.other.get(`/employees/${s.emp.employeeId}`)).statusCode).toBe(404);
    expect((await s.c.emp.get(`/employees/${s.emp.employeeId}/personal-documents`)).json()).toEqual([]);

    expect((await s.c.mgr.patch(`/employees/${s.emp.employeeId}`, { tabNumber: '999' })).statusCode).toBe(403);
    const upd = await s.c.hr.patch(`/employees/${s.emp.employeeId}`, { tabNumber: 'T-777', vacationDaysPerYear: 30, personal: { address: 'г. Алматы' } });
    expect(upd.json()).toMatchObject({ tabNumber: 'T-777', vacationDaysPerYear: 30, personal: { address: 'г. Алматы' } });
    expect((await s.c.hr.patch(`/employees/${s.mgr.employeeId}`, { managerId: s.emp.employeeId })).json().error.details.rule).toBe('MANAGER_CYCLE');
    expect((await s.c.hr.patch(`/employees/${s.emp.employeeId}`, { tabNumber: '000001' })).statusCode).toBe(409);
  });

  it('manages deputies with ownership rules', async () => {
    const s = await docSetup(app);
    expect((await s.c.emp.post('/deputies', { deputyUserId: s.emp.userId, startDate: isoDay(), endDate: isoDay(1) })).json().error.details.rule).toBe('SELF_DEPUTY');
    expect((await s.c.emp.post('/deputies', { principalUserId: s.mgr.userId, deputyUserId: s.emp.userId, startDate: isoDay(), endDate: isoDay(1) })).statusCode).toBe(403);
    expect((await s.c.emp.post('/deputies', { deputyUserId: s.mgr.userId, startDate: isoDay(2), endDate: isoDay(1) })).statusCode).toBe(400);
    const dep = (await s.c.emp.post('/deputies', { deputyUserId: s.other.userId, startDate: isoDay(3), endDate: isoDay(8) })).json();
    expect(dep.active).toBe(false);
    expect((await s.c.other.get('/deputies?mine=true')).json().map((x: { id: string }) => x.id)).toEqual([dep.id]);
    expect((await s.c.hr.get('/deputies')).json()).toHaveLength(1);
    expect((await s.c.mgr.get('/deputies')).json()).toHaveLength(0);
    expect((await s.c.other.del(`/deputies/${dep.id}`)).statusCode).toBe(403);
    expect((await s.c.emp.del(`/deputies/${dep.id}`)).statusCode).toBe(204);
  });
});

describe('HR events', () => {
  it('transfer: generates the order and applies the new position/department when it completes', async () => {
    const s = await docSetup(app);
    const dept = await prisma.department.create({ data: { tenantId: s.t.tenantId, legalEntityId: s.t.le.id, name: 'Отдел продаж' } });
    const pos = await prisma.position.create({ data: { tenantId: s.t.tenantId, name: 'Старший менеджер' } });
    expect((await s.c.hr.post(`/employees/${s.emp.employeeId}/events/transfer`, { effectiveDate: '2026-11-01' })).statusCode).toBe(400);
    const res = await s.c.hr.post(`/employees/${s.emp.employeeId}/events/transfer`, { effectiveDate: '2026-11-01', departmentId: dept.id, positionId: pos.id, managerId: s.ceo.employeeId, salary: 600000 });
    expect(res.statusCode).toBe(201);
    const doc = res.json();
    expect(doc).toMatchObject({ status: 'IN_ROUTE', kind: 'ORDER', subject: { id: s.emp.userId } });
    expect(doc.data).toMatchObject({ toDepartment: 'Отдел продаж', toPosition: 'Старший менеджер', fromDepartment: 'Отдел', salary: 600000 });
    expect(doc.steps.map((x: { action: string }) => x.action)).toEqual(['SIGN', 'ACKNOWLEDGE']);

    await qrSign(s.c.ceo, [doc.id], 'EGOV_BUSINESS');
    let emp = await prisma.employee.findUniqueOrThrow({ where: { id: s.emp.employeeId } });
    expect(emp.positionId).toBe(s.t.position.id); // not applied before completion
    expect((await s.c.emp.post(`/documents/${doc.id}/approve`, {})).json().status).toBe('COMPLETED');
    emp = await prisma.employee.findUniqueOrThrow({ where: { id: s.emp.employeeId } });
    expect(emp).toMatchObject({ positionId: pos.id, departmentId: dept.id, managerId: s.ceo.employeeId });
  });

  it('dismissal: generates the order; on completion the employee is terminated and loses access', async () => {
    const s = await docSetup(app);
    expect((await s.c.mgr.post(`/employees/${s.emp.employeeId}/events/dismissal`, { effectiveDate: '2026-10-31', reason: 'Заявление', article: 'пп. 5 п. 1 ст. 49 ТК РК' })).statusCode).toBe(403);
    const res = await s.c.hr.post(`/employees/${s.emp.employeeId}/events/dismissal`, { effectiveDate: '2026-10-31', reason: 'Заявление работника', article: 'по инициативе работника (статья 56 ТК РК)' });
    expect(res.statusCode).toBe(201);
    const doc = res.json();
    expect(doc.type.name).toBe('Приказ об увольнении');
    expect(doc.data.compensationDays).toBeGreaterThan(0);
    await qrSign(s.c.ceo, [doc.id]);
    expect((await qrSign(s.c.emp, [doc.id])).statusCode).toBe(200);
    const emp = await prisma.employee.findUniqueOrThrow({ where: { id: s.emp.employeeId }, include: { user: true } });
    expect(emp.status).toBe('TERMINATED');
    expect(emp.terminationDate?.toISOString().slice(0, 10)).toBe('2026-10-31');
    expect(emp.user.isActive).toBe(false);
    expect((await s.c.emp.get('/auth/me')).statusCode).toBe(401);
    expect((await s.c.hr.post(`/employees/${s.emp.employeeId}/events/dismissal`, { effectiveDate: '2026-10-31', reason: 'x', article: 'y' })).statusCode).toBe(409);
    const docs = (await s.c.hr.get(`/employees/${s.emp.employeeId}/documents`)).json();
    expect(docs.items.map((x: { id: string }) => x.id)).toEqual([doc.id]);
  });
});
