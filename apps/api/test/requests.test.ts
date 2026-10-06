import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db';
import { getVacationBalance } from '../src/modules/employees/service';
import { purgeUploads } from '../src/modules/uploads/service';
import { SAMPLE_PDF, createApp, resetDb, type TestApp } from './helpers';
import { docSetup, qrSign, type DocSetup } from './documents-fixtures';

let app: TestApp;
beforeAll(async () => {
  app = await createApp();
});
afterAll(() => app.close());
beforeEach(resetDb);

const DAY = 86_400_000;
const iso = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const d0 = (s: string) => new Date(`${s}T00:00:00Z`);

async function types(s: DocSetup) {
  const list = (await s.c.emp.get('/request-types')).json() as { id: string; code: string; hasDates: boolean; requiresAttachment: boolean }[];
  return Object.fromEntries(list.map((t) => [t.code, t]));
}

async function create(s: DocSetup, body: Record<string, unknown>, client = s.c.emp) {
  return client.post('/requests', { data: {}, submit: true, ...body });
}

describe('requests: vacation flow', () => {
  it('runs request → manager → HR → order → signatory → acknowledgment → COMPLETED with absence and ledger', async () => {
    const s = await docSetup(app);
    const t = await types(s);
    expect(Object.keys(t)).toEqual(['ANNUAL_LEAVE', 'UNPAID_LEAVE', 'BUSINESS_TRIP', 'SOCIAL_LEAVE', 'CERTIFICATE']);
    expect(t.CERTIFICATE!.hasDates).toBe(false);
    const before = await getVacationBalance(s.emp.employeeId);

    const res = await create(s, { requestTypeId: t.ANNUAL_LEAVE!.id, startDate: iso(30), endDate: iso(43), data: { comment: 'По графику' } });
    expect(res.statusCode).toBe(201);
    const r = res.json();
    expect(r.status).toBe('IN_APPROVAL');
    expect(r.days).toBe(14);
    expect(r.applicationDocument.status).toBe('IN_ROUTE');
    expect(r.applicationDocument.data).toMatchObject({ startDate: iso(30), endDate: iso(43), days: 14, comment: 'По графику' });
    expect(r.applicationDocument.steps.map((x: { assignee: { id: string } }) => x.assignee.id)).toEqual([s.mgr.userId, s.hr.userId]);
    expect((await s.c.mgr.get('/me/inbox-counts')).json().requests).toBe(1);

    const appId = r.applicationDocument.id;
    expect((await s.c.mgr.post(`/documents/${appId}/approve`, { comment: 'Согласовано' })).statusCode).toBe(200);
    expect((await s.c.mgr.get('/me/inbox-counts')).json().requests).toBe(0);
    expect((await s.c.hr.post(`/documents/${appId}/approve`, {})).statusCode).toBe(200);

    let d = (await s.c.emp.get(`/requests/${r.id}`)).json();
    expect(d.status).toBe('ORDER_SIGNING');
    expect(d.orderDocument.kind).toBe('ORDER');
    expect(d.orderDocument.status).toBe('IN_ROUTE');
    expect(d.orderDocument.data).toMatchObject({ startDate: iso(30), days: 14 });
    expect(d.orderDocument.links.some((l: { relation: string; document: { id: string } }) => l.relation === 'ORDER_FOR' && l.document.id === appId)).toBe(true);
    const orderId = d.orderDocument.id;
    expect(d.orderDocument.steps.map((x: { action: string; assignee: { id: string } }) => [x.action, x.assignee.id])).toEqual([['SIGN', s.ceo.userId], ['ACKNOWLEDGE', s.emp.userId]]);

    expect((await qrSign(s.c.ceo, [orderId], 'EGOV_BUSINESS')).statusCode).toBe(200);
    expect((await s.c.emp.get(`/requests/${r.id}`)).json().status).toBe('ORDER_SIGNING');
    expect((await s.c.emp.post(`/documents/${orderId}/approve`, {})).statusCode).toBe(200);

    d = (await s.c.emp.get(`/requests/${r.id}`)).json();
    expect(d.status).toBe('COMPLETED');
    expect(d.completedAt).toBeTruthy();
    expect(d.timeline.map((x: { label: string }) => x.label)).toEqual(expect.arrayContaining([
      'Заявка создана', 'Заявка отправлена на согласование', 'Согласовано: Согласовано', 'Согласовано', 'Сформирован приказ', 'Приказ подписан', 'Работник ознакомлен с приказом', 'Заявка исполнена',
    ]));
    const absences = await prisma.absence.findMany({ where: { employeeId: s.emp.employeeId } });
    expect(absences).toHaveLength(1);
    expect(absences[0]).toMatchObject({ kind: 'VACATION', source: 'REQUEST', sourceId: r.id, startDate: d0(iso(30)), endDate: d0(iso(43)) });
    const ledger = await prisma.vacationLedger.findMany({ where: { employeeId: s.emp.employeeId, type: 'USAGE' } });
    expect(ledger.map((l) => Number(l.days))).toEqual([14]);
    const after = await getVacationBalance(s.emp.employeeId);
    expect(after.available).toBe(before.available - 14);
    expect(await prisma.notification.count({ where: { userId: s.emp.userId, type: 'request.status' } })).toBe(2);
  });

  it('rejects requests exceeding the vacation balance (including days reserved by pending requests)', async () => {
    const s = await docSetup(app);
    const t = await types(s);
    // Hired ~6 months ago → 12 days accrued.
    const now = new Date();
    const hire = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 6, Math.min(now.getUTCDate(), 28)));
    await prisma.employee.update({ where: { id: s.emp.employeeId }, data: { hireDate: hire } });
    const bal = await getVacationBalance(s.emp.employeeId);
    expect(bal.available).toBe(12);

    const big = await create(s, { requestTypeId: t.ANNUAL_LEAVE!.id, startDate: iso(20), endDate: iso(33) });
    expect(big.statusCode).toBe(422);
    expect(big.json().error.details).toMatchObject({ rule: 'INSUFFICIENT_VACATION_BALANCE', available: 12, requested: 14 });

    expect((await create(s, { requestTypeId: t.ANNUAL_LEAVE!.id, startDate: iso(20), endDate: iso(27) })).statusCode).toBe(201);
    const second = await create(s, { requestTypeId: t.ANNUAL_LEAVE!.id, startDate: iso(40), endDate: iso(44) });
    expect(second.json().error.details).toMatchObject({ rule: 'INSUFFICIENT_VACATION_BALANCE', available: 4, requested: 5 });

    const preview = (await s.c.emp.post('/requests/preview', { requestTypeId: t.ANNUAL_LEAVE!.id, startDate: iso(40), endDate: iso(44), data: {} })).json();
    expect(preview.balanceAfter).toBe(-1);
    expect(preview.warnings.join(' ')).toMatch(/Недостаточно дней отпуска/);
    expect(preview.warnings.join(' ')).toMatch(/не менее 14 календарных дней/);
    // Unpaid leave does not touch the balance.
    expect((await create(s, { requestTypeId: t.UNPAID_LEAVE!.id, startDate: iso(40), endDate: iso(60), data: { reason: 'Семейные обстоятельства' } })).statusCode).toBe(201);
  });

  it('rejects overlaps with other requests and absences; drafts and cancelled requests do not block', async () => {
    const s = await docSetup(app);
    const t = await types(s);
    const draft = await create(s, { requestTypeId: t.ANNUAL_LEAVE!.id, startDate: iso(10), endDate: iso(23), submit: false });
    expect(draft.json().status).toBe('DRAFT');
    const first = await create(s, { requestTypeId: t.ANNUAL_LEAVE!.id, startDate: iso(10), endDate: iso(23) });
    expect(first.statusCode).toBe(201);
    const trip = await create(s, { requestTypeId: t.BUSINESS_TRIP!.id, startDate: iso(20), endDate: iso(25), data: { destination: 'г. Алматы', purpose: 'Встреча' } });
    expect(trip.statusCode).toBe(422);
    expect(trip.json().error.details.rule).toBe('OVERLAP');

    await prisma.absence.create({ data: { tenantId: s.t.tenantId, employeeId: s.emp.employeeId, kind: 'SICK', startDate: d0(iso(50)), endDate: d0(iso(55)), source: 'MANUAL' } });
    const sick = await create(s, { requestTypeId: t.UNPAID_LEAVE!.id, startDate: iso(54), endDate: iso(58), data: { reason: 'Личное' } });
    expect(sick.json().error.details.rule).toBe('OVERLAP');

    // Cancelling frees the dates and cancels the application document.
    const cancelled = await s.c.emp.post(`/requests/${first.json().id}/cancel`);
    expect(cancelled.json().status).toBe('CANCELLED');
    expect(cancelled.json().applicationDocument.status).toBe('CANCELLED');
    expect((await s.c.emp.post(`/requests/${draft.json().id}/submit`)).json().status).toBe('IN_APPROVAL');
    expect((await s.c.emp.post(`/requests/${first.json().id}/cancel`)).statusCode).toBe(409);
  });

  it('excludes public holidays from leave days but not from business trips; preview renders the PDF', async () => {
    const s = await docSetup(app);
    const t = await types(s);
    await prisma.holiday.createMany({ data: [
      { date: d0(iso(32)), kind: 'HOLIDAY', name: 'Тестовый праздник' },
      { date: d0(iso(33)), kind: 'TRANSFER_DAY_OFF', name: 'Перенос' },
    ] });
    const p = (await s.c.emp.post('/requests/preview', { requestTypeId: t.ANNUAL_LEAVE!.id, startDate: iso(30), endDate: iso(44), data: {} })).json();
    expect(p.days).toBe(14);
    expect(p.pdfDataUrl).toMatch(/^data:application\/pdf;base64,JVBER/);
    expect(p.warnings.join(' ')).toMatch(/Тестовый праздник/);
    const r = (await create(s, { requestTypeId: t.ANNUAL_LEAVE!.id, startDate: iso(30), endDate: iso(44) })).json();
    expect(r.days).toBe(14);
    expect(r.applicationDocument.data.days).toBe(14);
    const trip = (await s.c.emp.post('/requests/preview', { requestTypeId: t.BUSINESS_TRIP!.id, startDate: iso(30), endDate: iso(34), data: { destination: 'Шымкент', purpose: 'Переговоры' } })).json();
    expect(trip.days).toBe(5);
    expect(trip.balanceAfter).toBeNull();
    // Only holidays → no leave days.
    const zero = await create(s, { requestTypeId: t.UNPAID_LEAVE!.id, startDate: iso(32), endDate: iso(32), data: { reason: 'x' } });
    expect(zero.json().error.details.rule).toBe('NO_LEAVE_DAYS');
  });

  it('return → REWORK → edit and resubmit restarts the route; reject → REJECTED', async () => {
    const s = await docSetup(app);
    const t = await types(s);
    const r = (await create(s, { requestTypeId: t.BUSINESS_TRIP!.id, startDate: iso(15), endDate: iso(17), data: { destination: 'Алматы', purpose: 'Конференция', transport: 'Авиа' } })).json();
    const appId = r.applicationDocument.id;
    expect(r.applicationDocument.data).toMatchObject({ destination: 'Алматы', purpose: 'Конференция', transport: 'Авиа', days: 3 });
    expect((await s.c.mgr.post(`/documents/${appId}/return`, { comment: 'Уточните цель' })).statusCode).toBe(200);
    let d = (await s.c.emp.get(`/requests/${r.id}`)).json();
    expect(d.status).toBe('REWORK');
    expect(d.canEdit).toBe(true);
    expect(d.timeline.map((x: { label: string }) => x.label)).toContain('Возвращено на доработку: Уточните цель');

    const patched = await s.c.emp.patch(`/requests/${r.id}`, { requestTypeId: t.BUSINESS_TRIP!.id, startDate: iso(15), endDate: iso(18), data: { destination: 'Алматы', purpose: 'Конференция Kolesa Conf' }, submit: true });
    expect(patched.statusCode).toBe(200);
    d = patched.json();
    expect(d.status).toBe('IN_APPROVAL');
    expect(d.days).toBe(4);
    expect(d.applicationDocument.id).toBe(appId);
    expect(d.applicationDocument.status).toBe('IN_ROUTE');
    expect(d.applicationDocument.data.purpose).toBe('Конференция Kolesa Conf');
    expect(d.timeline.map((x: { label: string }) => x.label)).toContain('Заявка повторно отправлена после доработки');

    expect((await s.c.mgr.post(`/documents/${appId}/reject`, { comment: 'Нет бюджета' })).statusCode).toBe(200);
    d = (await s.c.emp.get(`/requests/${r.id}`)).json();
    expect(d.status).toBe('REJECTED');
    expect(d.canCancel).toBe(false);
    expect((await s.c.emp.patch(`/requests/${r.id}`, { requestTypeId: t.BUSINESS_TRIP!.id, data: {} })).statusCode).toBe(409);
  });

  it('certificate request completes when HR approves, with no order and no absence', async () => {
    const s = await docSetup(app);
    const t = await types(s);
    const r = (await create(s, { requestTypeId: t.CERTIFICATE!.id, startDate: iso(3), endDate: iso(4), data: { purpose: 'Посольство', copies: '2' } })).json();
    expect(r.startDate).toBeNull();
    expect(r.days).toBeNull();
    expect(r.data).toEqual({ purpose: 'Посольство', copies: 2 });
    expect(r.applicationDocument.steps.map((x: { assignee: { id: string } }) => x.assignee.id)).toEqual([s.hr.userId]);
    expect((await s.c.hr.post(`/documents/${r.applicationDocument.id}/approve`, {})).statusCode).toBe(200);
    const d = (await s.c.emp.get(`/requests/${r.id}`)).json();
    expect(d.status).toBe('COMPLETED');
    expect(d.orderDocument).toBeNull();
    expect(await prisma.absence.count({ where: { employeeId: s.emp.employeeId } })).toBe(0);
  });

  it('cancelling the application document from the documents module cancels the request', async () => {
    const s = await docSetup(app);
    const t = await types(s);
    const r = (await create(s, { requestTypeId: t.CERTIFICATE!.id, data: { purpose: 'Банк', copies: '1' } })).json();
    const res = await s.c.hr.post(`/documents/${r.applicationDocument.id}/cancel`, { reason: 'Дубликат' });
    expect(res.statusCode).toBe(200);
    expect((await s.c.emp.get(`/requests/${r.id}`)).json().status).toBe('CANCELLED');
  });

  it('validates required fields, attachments, past dates and date order', async () => {
    const s = await docSetup(app);
    const t = await types(s);
    const noReason = await create(s, { requestTypeId: t.UNPAID_LEAVE!.id, startDate: iso(5), endDate: iso(6) });
    expect(noReason.statusCode).toBe(400);
    expect(noReason.json().error.details.fieldErrors['data.reason']).toBeTruthy();
    expect((await create(s, { requestTypeId: t.UNPAID_LEAVE!.id, startDate: iso(6), endDate: iso(5), data: { reason: 'x' } })).statusCode).toBe(400);
    expect((await create(s, { requestTypeId: t.UNPAID_LEAVE!.id, data: { reason: 'x' } })).json().error.details.fieldErrors.startDate).toBeTruthy();

    const past = await create(s, { requestTypeId: t.UNPAID_LEAVE!.id, startDate: iso(-3), endDate: iso(-1), data: { reason: 'x' } });
    expect(past.json().error.details.rule).toBe('PAST_START_DATE');
    // HR may file backdated requests for themselves.
    expect((await create(s, { requestTypeId: t.UNPAID_LEAVE!.id, startDate: iso(-3), endDate: iso(-1), data: { reason: 'x' } }, s.c.hr)).statusCode).toBe(201);

    const social = { requestTypeId: t.SOCIAL_LEAVE!.id, startDate: iso(20), endDate: iso(40), data: { leaveKind: 'учебный отпуск' } };
    expect((await create(s, social)).json().error.details.rule).toBe('ATTACHMENT_REQUIRED');
    expect((await create(s, { ...social, data: { leaveKind: 'неизвестный' } })).statusCode).toBe(400);
    const up = await s.c.emp.upload('/uploads', [{ filename: 'справка-вызов.pdf', content: SAMPLE_PDF }]);
    expect(up.statusCode).toBe(201);
    const fileId = up.json().id;
    // Someone else's upload cannot be attached.
    const foreign = await s.c.other.upload('/uploads', [{ filename: 'x.pdf', content: SAMPLE_PDF }]);
    expect((await create(s, { ...social, attachmentFileIds: [foreign.json().id] })).statusCode).toBe(400);
    const ok = await create(s, { ...social, attachmentFileIds: [fileId] });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().attachments.map((f: { id: string }) => f.id)).toEqual([fileId]);
    // Attachment access: owner, manager, HR — not unrelated employees.
    expect((await s.c.mgr.get(`/files/${fileId}`)).statusCode).toBe(200);
    expect((await s.c.hr.get(`/files/${fileId}`)).statusCode).toBe(200);
    expect((await s.c.other.get(`/files/${fileId}`)).statusCode).toBe(404);
    expect((await s.c.emp.upload('/uploads', [{ filename: 'a.txt', content: Buffer.from('hello') }])).statusCode).toBe(415);
  });

  it('purges unlinked uploads older than 24 h and keeps linked ones', async () => {
    const s = await docSetup(app);
    const t = await types(s);
    const a = (await s.c.emp.upload('/uploads', [{ filename: 'a.pdf', content: SAMPLE_PDF }])).json();
    const b = (await s.c.emp.upload('/uploads', [{ filename: 'b.pdf', content: SAMPLE_PDF }])).json();
    const fresh = (await s.c.emp.upload('/uploads', [{ filename: 'c.pdf', content: SAMPLE_PDF }])).json();
    await create(s, { requestTypeId: t.UNPAID_LEAVE!.id, startDate: iso(5), endDate: iso(6), data: { reason: 'x' }, attachmentFileIds: [b.id], submit: false });
    const old = new Date(Date.now() - 25 * 3_600_000);
    await prisma.storedFile.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { createdAt: old } });
    expect(await purgeUploads()).toEqual({ deleted: 1 });
    expect(await prisma.storedFile.findUnique({ where: { id: a.id } })).toBeNull();
    expect(await prisma.storedFile.findUnique({ where: { id: b.id } })).not.toBeNull();
    expect(await prisma.storedFile.findUnique({ where: { id: fresh.id } })).not.toBeNull();
  });

  it('scopes reads and lists: owner, manager subtree, HR; others get 404', async () => {
    const s = await docSetup(app);
    const t = await types(s);
    const draft = (await create(s, { requestTypeId: t.ANNUAL_LEAVE!.id, startDate: iso(60), endDate: iso(73), submit: false })).json();
    const r = (await create(s, { requestTypeId: t.ANNUAL_LEAVE!.id, startDate: iso(30), endDate: iso(43) })).json();
    expect((await s.c.other.get(`/requests/${r.id}`)).statusCode).toBe(404);
    expect((await s.c.mgr.get(`/requests/${r.id}`)).statusCode).toBe(200);
    expect((await s.c.hr.get(`/requests/${r.id}`)).statusCode).toBe(200);
    expect((await s.c.ceo.get(`/requests/${r.id}`)).statusCode).toBe(200); // manager of the manager
    expect((await s.c.mgr.get(`/requests/${draft.id}`)).statusCode).toBe(404); // drafts are private
    expect((await s.c.other.post(`/requests/${r.id}/cancel`)).statusCode).toBe(404);
    expect((await s.c.mgr.post(`/requests/${r.id}/cancel`)).statusCode).toBe(403);

    const ids = (res: { json: () => { items: { id: string }[] } }) => res.json().items.map((x) => x.id);
    expect(ids(await s.c.emp.get('/requests')).sort()).toEqual([draft.id, r.id].sort());
    expect(ids(await s.c.mgr.get('/requests?scope=team'))).toEqual([r.id]);
    expect(ids(await s.c.mgr.get('/requests?scope=mine'))).toEqual([]);
    expect(ids(await s.c.hr.get('/requests?scope=all'))).toEqual([r.id]);
    expect(ids(await s.c.hr.get(`/requests?scope=all&status=COMPLETED`))).toEqual([]);
    expect(ids(await s.c.other.get('/requests?scope=team'))).toEqual([]);
    expect((await s.c.other.get('/requests?scope=all')).statusCode).toBe(403);
    expect((await s.c.hr.get(`/requests?scope=all&employeeId=${s.other.employeeId}`)).json().total).toBe(0);
  });
});
