import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { prisma } from '../src/lib/db';
import { getVacationBalance } from '../src/modules/employees/service';
import { runVacationReminders } from '../src/modules/vacation-schedule/service';
import { Client, createApp, resetDb, type TestApp } from './helpers';
import { docSetup, type DocSetup } from './documents-fixtures';

let app: TestApp;
beforeAll(async () => {
  app = await createApp();
});
afterAll(() => app.close());
beforeEach(resetDb);

const NEXT = new Date().getUTCFullYear() + 1;
const y = (md: string) => `${NEXT}-${md}`;

async function setup() {
  const s = await docSetup(app);
  // A second subordinate of the manager and an employee of the HR-only scope.
  const emp2 = await s.t.person({ email: `emp2-${s.t.tenantId}@t.kz`, firstName: 'Берик', lastName: 'Второв', managerEmployeeId: s.mgr.employeeId });
  const c2 = new Client(app);
  await c2.login(`emp2-${s.t.tenantId}@t.kz`);
  const camp = await s.c.hr.post('/vacation-schedule/campaigns', { year: NEXT, deadline: `${NEXT - 1}-12-15` });
  expect(camp.statusCode).toBe(201);
  return { ...s, emp2, c2, campaign: camp.json() as { id: string; year: number; status: string } };
}
type S = DocSetup & Awaited<ReturnType<typeof setup>>;

const put = (s: S, client: Client, employeeId: string, periods: [string, string][], submit = true) =>
  client.put(`/vacation-schedule/campaigns/${s.campaign.id}/plans/${employeeId}`, { periods: periods.map(([a, b]) => ({ startDate: y(a), endDate: y(b) })), submit });

describe('vacation schedule', () => {
  it('manages campaigns (HR only, unique year) and notifies employees when planning opens', async () => {
    const s = await setup();
    expect(s.campaign).toMatchObject({ year: NEXT, status: 'ACTIVE' });
    expect((await s.c.hr.post('/vacation-schedule/campaigns', { year: NEXT })).statusCode).toBe(409);
    expect((await s.c.mgr.post('/vacation-schedule/campaigns', { year: NEXT + 1 })).statusCode).toBe(403);
    expect(await prisma.notification.count({ where: { userId: s.emp.userId, type: 'vacation.campaign_opened' } })).toBe(1);
    const draft = (await s.c.hr.post('/vacation-schedule/campaigns', { year: NEXT + 1, status: 'DRAFT' })).json();
    expect((await s.c.emp.get('/vacation-schedule/campaigns')).json().map((c: { year: number }) => c.year)).toEqual([NEXT]);
    expect((await s.c.hr.get('/vacation-schedule/campaigns')).json().map((c: { year: number }) => c.year)).toEqual([NEXT + 1, NEXT]);
    expect((await s.c.emp.get(`/vacation-schedule/campaigns/${draft.id}/my-plan`)).statusCode).toBe(404);
    const closed = await s.c.hr.patch(`/vacation-schedule/campaigns/${s.campaign.id}`, { status: 'CLOSED' });
    expect(closed.json().status).toBe('CLOSED');
    expect((await put(s, s.c.emp, s.emp.employeeId, [['03-02', '03-15']])).json().error.details.rule).toBe('CAMPAIGN_NOT_ACTIVE');
  });

  it('validates plans: 14-day part, overlaps, year bounds and entitlement', async () => {
    const s = await setup();
    const my = (await s.c.emp.get(`/vacation-schedule/campaigns/${s.campaign.id}/my-plan`)).json();
    const bal = await getVacationBalance(s.emp.employeeId);
    expect(my).toMatchObject({ status: 'NONE', planned: 0, periods: [], entitlement: Math.floor(bal.available + 24) });

    const rule = async (periods: [string, string][]) => (await put(s, s.c.emp, s.emp.employeeId, periods)).json().error?.details?.rule;
    expect(await rule([['03-02', '03-11'], ['07-06', '07-15']])).toBe('MIN_PART_14');
    expect(await rule([['03-02', '03-20'], ['03-15', '03-25']])).toBe('OVERLAP');
    expect(await rule([[`12-25`, `12-31`], ['01-01', '01-01']])).toBeUndefined(); // valid: 8 days < 14 total
    expect((await s.c.emp.put(`/vacation-schedule/campaigns/${s.campaign.id}/plans/${s.emp.employeeId}`, { periods: [{ startDate: `${NEXT - 1}-12-28`, endDate: y('01-05') }], submit: false })).json().error.details.rule).toBe('PERIOD_OUTSIDE_YEAR');
    await prisma.employee.update({ where: { id: s.emp.employeeId }, data: { hireDate: new Date() } });
    expect(await rule([['03-02', '03-31']])).toBe('EXCEEDS_ENTITLEMENT'); // entitlement now 24
    expect((await s.c.emp.put(`/vacation-schedule/campaigns/${s.campaign.id}/plans/${s.emp.employeeId}`, { periods: [], submit: true })).json().error.details.rule).toBe('EMPTY_PLAN');

    // Public holidays inside a period are not counted.
    await prisma.holiday.create({ data: { date: new Date(`${y('03-08')}T00:00:00Z`), kind: 'HOLIDAY', name: 'Международный женский день' } });
    const ok = await put(s, s.c.emp, s.emp.employeeId, [['03-02', '03-16'], ['08-03', '08-12']]);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ status: 'SUBMITTED', entitlement: 24, planned: 24 });
    expect(ok.json().periods.map((p: { days: number }) => p.days)).toEqual([14, 10]);
    expect(await prisma.notification.count({ where: { userId: s.mgr.userId, type: 'vacation.plan_submitted' } })).toBe(2); // the valid 8-day plan above was submitted too
    // Someone outside the subtree cannot edit the plan.
    expect((await put(s, s.c.other, s.emp.employeeId, [['05-04', '05-17']])).statusCode).toBe(404);
  });

  it('bulk approval handles only submitted plans in scope ("selected 3, can approve 1")', async () => {
    const s = await setup();
    expect((await put(s, s.c.emp, s.emp.employeeId, [['04-06', '04-19']])).statusCode).toBe(200);
    expect((await put(s, s.c2, s.emp2.employeeId, [['06-01', '06-14']], false)).json().status).toBe('DRAFT');
    expect((await put(s, s.c.other, s.other.employeeId, [['09-07', '09-20']])).statusCode).toBe(200);

    const url = `/vacation-schedule/campaigns/${s.campaign.id}/approve`;
    const ids = [s.emp.employeeId, s.emp2.employeeId, s.other.employeeId];
    const dry = (await s.c.mgr.post(url, { employeeIds: ids, decision: 'APPROVE', dryRun: true })).json();
    expect(dry.succeeded).toEqual([s.emp.employeeId]);
    expect(dry.failed).toEqual([
      { employeeId: s.emp2.employeeId, reason: 'NOT_SUBMITTED:DRAFT' },
      { employeeId: s.other.employeeId, reason: 'OUT_OF_SCOPE' },
    ]);
    expect(await prisma.vacationPlan.count({ where: { status: 'APPROVED' } })).toBe(0);

    const grid1 = (await s.c.mgr.get(`/vacation-schedule/campaigns/${s.campaign.id}/grid?status=SUBMITTED`)).json();
    expect(grid1.items.map((r: { employee: { employeeId: string }; canApprove: boolean }) => [r.employee.employeeId, r.canApprove])).toEqual([[s.emp.employeeId, true]]);

    const res = (await s.c.mgr.post(url, { employeeIds: ids, decision: 'APPROVE', comment: 'Ок' })).json();
    expect(res.succeeded).toEqual([s.emp.employeeId]);
    expect(res.failed).toHaveLength(2);
    expect((await s.c.emp.get(`/vacation-schedule/campaigns/${s.campaign.id}/my-plan`)).json()).toMatchObject({ status: 'APPROVED', comment: 'Ок', canApprove: false });
    expect(await prisma.notification.count({ where: { userId: s.emp.userId, type: 'vacation.plan_approved' } })).toBe(1);
    // An approved plan is locked for the employee, editable by the manager.
    expect((await put(s, s.c.emp, s.emp.employeeId, [['05-04', '05-17']])).json().error.details.rule).toBe('PLAN_LOCKED');

    // HR rejects with a comment.
    expect((await s.c.hr.post(url, { employeeIds: [s.other.employeeId], decision: 'REJECT' })).json().error.details.rule).toBe('COMMENT_REQUIRED');
    const rej = (await s.c.hr.post(url, { employeeIds: [s.other.employeeId], decision: 'REJECT', comment: 'Пересекается с инвентаризацией' })).json();
    expect(rej.succeeded).toEqual([s.other.employeeId]);
    expect(await prisma.notification.count({ where: { userId: s.other.userId, type: 'vacation.plan_rejected' } })).toBe(1);
    expect((await s.c.emp.post(url, { employeeIds: ids, decision: 'APPROVE' })).statusCode).toBe(403);

    const campaigns = (await s.c.hr.get('/vacation-schedule/campaigns')).json();
    expect(campaigns[0].totals).toEqual({ employees: 6, submitted: 0, approved: 1 });
  });

  it('grid is scoped and filterable; export produces a Т-7 style workbook', async () => {
    const s = await setup();
    await put(s, s.c.emp, s.emp.employeeId, [['04-06', '04-19'], ['10-05', '10-14']]);
    const base = `/vacation-schedule/campaigns/${s.campaign.id}`;
    const names = (res: { json: () => { items: { employee: { employeeId: string } }[]; total: number } }) => res.json().items.map((r) => r.employee.employeeId);
    expect(names(await s.c.emp.get(`${base}/grid`))).toEqual([s.emp.employeeId]);
    expect(names(await s.c.mgr.get(`${base}/grid`)).sort()).toEqual([s.mgr.employeeId, s.emp.employeeId, s.emp2.employeeId].sort());
    expect((await s.c.hr.get(`${base}/grid?pageSize=2`)).json()).toMatchObject({ total: 6, pageSize: 2 });
    expect(names(await s.c.hr.get(`${base}/grid?status=NONE`))).not.toContain(s.emp.employeeId);
    expect(names(await s.c.hr.get(`${base}/grid?q=Работникова`))).toEqual([s.emp.employeeId]);
    expect((await s.c.hr.get(`${base}/grid?departmentId=${s.t.dept.id}`)).json().total).toBe(6);

    const x = await s.c.hr.get(`${base}/export`);
    expect(x.statusCode).toBe(200);
    expect(x.headers['content-type']).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.rawPayload as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(String(ws.getCell(2, 1).value)).toContain(`ГРАФИК ОТПУСКОВ на ${NEXT} год`);
    const rows: string[] = [];
    ws.eachRow((row) => rows.push((row.values as unknown[]).join('|')));
    const line = rows.find((r) => r.includes('Работникова'))!;
    expect(line).toContain(`06.04.${NEXT}|19.04.${NEXT}|14|05.10.${NEXT}|14.10.${NEXT}|10`);
    expect(line).toContain('24|На согласовании');
  });

  it('reminder job notifies the employee and manager 14 days before an approved period, once', async () => {
    const s = await setup();
    const now = new Date();
    const start = new Date(now.getTime() + 10 * 86_400_000);
    const end = new Date(now.getTime() + 23 * 86_400_000);
    const camp = await prisma.vacationCampaign.upsert({
      where: { tenantId_year: { tenantId: s.t.tenantId, year: start.getUTCFullYear() } },
      create: { tenantId: s.t.tenantId, year: start.getUTCFullYear(), status: 'ACTIVE' },
      update: {},
    });
    const day = (d: Date) => new Date(`${d.toISOString().slice(0, 10)}T00:00:00Z`);
    await prisma.vacationPlan.create({ data: { campaignId: camp.id, employeeId: s.emp.employeeId, status: 'APPROVED', periods: { create: [{ startDate: day(start), endDate: day(end), days: 14 }] } } });
    await prisma.vacationPlan.create({ data: { campaignId: camp.id, employeeId: s.emp2.employeeId, status: 'SUBMITTED', periods: { create: [{ startDate: day(start), endDate: day(end), days: 14 }] } } });
    await prisma.vacationPlan.create({ data: { campaignId: camp.id, employeeId: s.other.employeeId, status: 'APPROVED', periods: { create: [{ startDate: day(new Date(now.getTime() + 40 * 86_400_000)), endDate: day(new Date(now.getTime() + 53 * 86_400_000)), days: 14 }] } } });

    expect(await runVacationReminders(now)).toEqual({ notified: 1 });
    expect(await prisma.notification.count({ where: { userId: s.emp.userId, type: 'vacation.reminder' } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: s.mgr.userId, type: 'vacation.reminder' } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: s.emp2.userId, type: 'vacation.reminder' } })).toBe(0);
    expect(await runVacationReminders(now)).toEqual({ notified: 0 });
    expect(await prisma.vacationPlanPeriod.count({ where: { reminderSentAt: { not: null } } })).toBe(1);
  });
});
