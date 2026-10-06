import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { prisma } from '../src/lib/db';
import { DEFAULT_TZ, todayLocal } from '../src/lib/calendar';
import { ensureDocumentType } from '../src/modules/documents/defaults';
import { Client, createApp, makeTenant, resetDb, type TestApp } from './helpers';

let app: TestApp;
beforeAll(async () => {
  app = await createApp();
});
afterAll(() => app.close());
beforeEach(resetDb);

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
let k = 0;

/** Legal entity 1: HR, manager with two reports, three more employees (one dismissed); legal entity 2: one employee. */
async function fixture() {
  const n = ++k;
  const t = await makeTenant();
  const le2 = await prisma.legalEntity.create({ data: { tenantId: t.tenantId, name: 'ТОО Второе', bin: '160940055210' } });
  const sub = await prisma.department.create({ data: { tenantId: t.tenantId, legalEntityId: t.le.id, name: 'Склад' } });
  const mail = (x: string) => `${x}${n}@rep.kz`;
  const admin = await t.person({ email: mail('admin'), roles: [{ role: 'ADMIN' }] });
  const hr = await t.person({ email: mail('hr'), roles: [{ role: 'HR', legalEntityId: t.le.id }] });
  const mgr = await t.person({ email: mail('mgr'), roles: [{ role: 'MANAGER' }] });
  const sub1 = await t.person({ email: mail('sub1'), managerEmployeeId: mgr.employeeId });
  const sub2 = await t.person({ email: mail('sub2'), managerEmployeeId: mgr.employeeId });
  const x1 = await t.person({ email: mail('x1') });
  const x2 = await t.person({ email: mail('x2') });
  const x3 = await t.person({ email: mail('x3') });
  const y = await t.person({ email: mail('y'), legalEntityId: le2.id });
  await prisma.employee.update({ where: { id: admin.employeeId }, data: { legalEntityId: le2.id } });
  await prisma.employee.update({ where: { id: sub2.employeeId }, data: { hireDate: d('2026-03-15'), departmentId: sub.id } });
  await prisma.employee.update({ where: { id: x1.employeeId }, data: { hireDate: d('2026-03-02') } });
  await prisma.employee.update({ where: { id: x2.employeeId }, data: { hireDate: d('2026-05-20') } });
  await prisma.employee.update({ where: { id: x3.employeeId }, data: { status: 'TERMINATED', terminationDate: d('2026-05-31') } });
  await prisma.employee.update({ where: { id: y.employeeId }, data: { hireDate: d('2026-03-10') } });

  // Completed transfer order for sub1, effective 1 June.
  const transferType = await ensureDocumentType(t.tenantId, 'TRANSFER_ORDER');
  await prisma.document.create({
    data: {
      tenantId: t.tenantId, legalEntityId: t.le.id, documentTypeId: transferType.id, kind: 'ORDER', title: 'Приказ о переводе', status: 'COMPLETED',
      authorId: hr.userId, subjectEmployeeId: sub1.employeeId, data: { effectiveDate: '2026-06-01' },
      createdAt: new Date('2026-04-08T09:00:00Z'), completedAt: new Date('2026-04-10T09:00:00Z'),
    },
  });
  // Candidates and absences.
  await prisma.candidate.createMany({
    data: [
      { tenantId: t.tenantId, legalEntityId: t.le.id, lastName: 'А', firstName: 'А', status: 'NEW' },
      { tenantId: t.tenantId, legalEntityId: t.le.id, lastName: 'Б', firstName: 'Б', status: 'NEW' },
      { tenantId: t.tenantId, legalEntityId: t.le.id, lastName: 'В', firstName: 'В', status: 'ACCEPTED' },
      { tenantId: t.tenantId, legalEntityId: le2.id, lastName: 'Г', firstName: 'Г', status: 'NEW' },
    ],
  });
  const today = new Date(todayLocal(DEFAULT_TZ) + 'T00:00:00Z'); // the dashboard uses the tenant's local date
  await prisma.absence.createMany({
    data: [
      { tenantId: t.tenantId, employeeId: sub1.employeeId, kind: 'VACATION', startDate: new Date(today.getTime() - 2 * 86_400_000), endDate: new Date(today.getTime() + 5 * 86_400_000), source: 'MANUAL' },
      { tenantId: t.tenantId, employeeId: x1.employeeId, kind: 'SICK', startDate: today, endDate: today, source: 'MANUAL' },
      { tenantId: t.tenantId, employeeId: y.employeeId, kind: 'BUSINESS_TRIP', startDate: today, endDate: today, source: 'MANUAL' },
    ],
  });
  const login = async (x: string) => {
    const c = new Client(app);
    await c.login(mail(x));
    return c;
  };
  return { t, le2, sub, c: { admin: await login('admin'), hr: await login('hr'), mgr: await login('mgr'), sub1: await login('sub1') } };
}

describe('reports', () => {
  it('computes headcount, movements and the dashboard within HR scope', async () => {
    const f = await fixture();
    const hc = (await f.c.hr.get('/reports/headcount?date=2026-09-30')).json();
    expect(hc.total).toBe(6); // hr, mgr, sub1, sub2, x1, x2 (x3 dismissed; le2 outside the HR scope)
    expect(hc.byDepartment).toEqual([
      { department: { id: f.t.dept.id, name: 'Отдел' }, count: 5 },
      { department: { id: f.sub.id, name: 'Склад' }, count: 1 },
    ]);
    expect(hc.byPosition[0].count).toBe(6);
    expect((await f.c.hr.get('/reports/headcount?date=2026-03-01')).json().total).toBe(4); // hr, mgr, sub1, x3 (x1 starts on 2 March)

    const mv = (await f.c.hr.get('/reports/movements?from=2026-01-01&to=2026-06-30')).json();
    expect(mv.months).toEqual([
      { month: '2026-01', hired: 0, dismissed: 0, transferred: 0 },
      { month: '2026-02', hired: 0, dismissed: 0, transferred: 0 },
      { month: '2026-03', hired: 2, dismissed: 0, transferred: 0 },
      { month: '2026-04', hired: 0, dismissed: 0, transferred: 0 },
      { month: '2026-05', hired: 1, dismissed: 1, transferred: 0 },
      { month: '2026-06', hired: 0, dismissed: 0, transferred: 1 },
    ]);

    const db = (await f.c.hr.get('/reports/dashboard?from=2026-03-01&to=2026-05-31')).json();
    expect(db).toMatchObject({
      headcount: 6, hiredInPeriod: 3, dismissedInPeriod: 1, turnoverPct: 20,
      candidates: { NEW: 2, IN_PROGRESS: 0, ACCEPTED: 1, EXPORTED: 0, BLOCKED: 0 },
      documents: { inRoute: 0, overdue: 0, completedInPeriod: 1, avgCompletionHours: 48 },
      requests: { pending: 0, completedInPeriod: 0 },
      vnd: { inProgress: 0, completionPct: 0 },
      esutd: { notSent: 0, errors: 0 },
      absencesToday: { vacation: 1, sick: 1, businessTrip: 0 },
    });

    // HR cannot report on another legal entity; ADMIN sees the whole tenant.
    expect((await f.c.hr.get(`/reports/headcount?legalEntityId=${f.le2.id}`)).statusCode).toBe(403);
    expect((await f.c.admin.get('/reports/headcount?date=2026-09-30')).json().total).toBe(8);
    expect((await f.c.admin.get(`/reports/dashboard?legalEntityId=${f.le2.id}`)).json().absencesToday.businessTrip).toBe(1);
  });

  it('limits managers to their subtree and employees get 403', async () => {
    const f = await fixture();
    expect((await f.c.mgr.get('/reports/headcount?date=2026-09-30')).json().total).toBe(2);
    const mv = (await f.c.mgr.get('/reports/movements?from=2026-03-01&to=2026-06-30')).json();
    expect(mv.months.map((m: { hired: number; transferred: number }) => [m.hired, m.transferred])).toEqual([[1, 0], [0, 0], [0, 0], [0, 1]]);
    const db = (await f.c.mgr.get('/reports/dashboard?from=2026-03-01&to=2026-05-31')).json();
    expect(db).toMatchObject({ headcount: 2, hiredInPeriod: 1, dismissedInPeriod: 0, candidates: { NEW: 0, ACCEPTED: 0 }, absencesToday: { vacation: 1, sick: 0 } });
    expect((await f.c.sub1.get('/reports/dashboard')).statusCode).toBe(403);
    expect((await f.c.sub1.get('/reports/headcount/export')).statusCode).toBe(403);
  });

  it('exports xlsx reports', async () => {
    const f = await fixture();
    for (const report of ['headcount', 'movements', 'documents', 'vnd']) {
      const res = await f.c.hr.get(`/reports/${report}/export?from=2026-01-01&to=2026-06-30&date=2026-09-30`);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain('attachment');
    }
    const res = await f.c.hr.get('/reports/headcount/export?date=2026-09-30');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.rawPayload as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('По подразделениям')!;
    expect(ws.getRow(4).values).toEqual([undefined, 'Подразделение', 'Численность']);
    expect(ws.getRow(5).values).toEqual([undefined, 'Отдел', 5]);
    expect(ws.getRow(7).values).toEqual([undefined, 'Итого', 6]);
    const docs = await f.c.hr.get('/reports/documents/export?from=2026-04-01&to=2026-04-30');
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(docs.rawPayload as unknown as ArrayBuffer);
    expect(wb2.worksheets[0]!.getRow(5).getCell(4).value).toBe('Приказ о переводе');
    expect((await f.c.hr.get('/reports/unknown/export')).statusCode).toBe(400);
  });
});
