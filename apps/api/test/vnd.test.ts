import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { prisma } from '../src/lib/db';
import { Client, SAMPLE_PDF, createApp, resetDb, type TestApp } from './helpers';
import { docSetup, qrSign, type DocSetup } from './documents-fixtures';

let app: TestApp;
beforeAll(async () => {
  app = await createApp();
});
afterAll(() => app.close());
beforeEach(resetDb);

const yy = String(new Date().getUTCFullYear()).slice(2);

async function createVnd(c: Client, s: DocSetup, fields: Record<string, string> = {}) {
  const res = await c.upload('/vnd', [{ filename: 'Правила ВТР.pdf', content: SAMPLE_PDF, contentType: 'application/pdf' }], {
    title: 'Правила внутреннего трудового распорядка', legalEntityId: s.t.le.id, ...fields,
  });
  return res;
}

describe('ВНД', () => {
  it('runs the full flow: create → recipients by department → send → acknowledge with ЭЦП → sheet → completed', async () => {
    const s = await docSetup(app);
    // Sub-department: the employee sits in a child of the main department.
    const sub = await prisma.department.create({ data: { tenantId: s.t.tenantId, legalEntityId: s.t.le.id, parentId: s.t.dept.id, name: 'Сектор' } });
    await prisma.employee.update({ where: { id: s.emp.employeeId }, data: { departmentId: sub.id } });
    // An inactive employee is never added.
    const gone = await s.t.person({ email: `gone${Date.now()}@t.kz`, lastName: 'Уволенный' });
    await prisma.employee.update({ where: { id: gone.employeeId }, data: { status: 'TERMINATED', terminationDate: new Date('2026-01-01T00:00:00Z') } });

    const created = await createVnd(s.c.hr, s, { dueAt: '2026-12-31' });
    expect(created.statusCode).toBe(201);
    const vnd = created.json();
    expect(vnd).toMatchObject({ status: 'DRAFT', number: null, acknowledged: 0, total: 0, requireSignature: true, type: { name: 'Внутренний нормативный документ' } });
    expect(vnd.fileUrl).toMatch(/^\/api\/v1\/files\//);

    const added = await s.c.hr.post(`/vnd/${vnd.id}/recipients`, { departmentIds: [s.t.dept.id] });
    expect(added.statusCode).toBe(200);
    expect(added.json().added).toBe(5); // ceo, hr, mgr, emp (sub-department), other — not the terminated one
    expect((await s.c.hr.post(`/vnd/${vnd.id}/recipients`, { employeeIds: [s.emp.employeeId], allOfLegalEntity: true })).json().added).toBe(0);

    // Drafts are invisible to recipients.
    expect((await s.c.emp.get(`/vnd/${vnd.id}`)).statusCode).toBe(404);
    expect((await s.c.emp.get('/vnd/my')).json()).toEqual([]);

    // Remove "other" while still a draft.
    const recipients = (await s.c.hr.get(`/vnd/${vnd.id}/recipients?pageSize=50`)).json();
    expect(recipients.total).toBe(5);
    const otherRow = recipients.items.find((r: { employee: { employeeId: string } }) => r.employee.employeeId === s.other.employeeId);
    expect((await s.c.hr.del(`/vnd/${vnd.id}/recipients/${otherRow.id}`)).statusCode).toBe(204);

    const sent = await s.c.hr.post(`/vnd/${vnd.id}/send`);
    expect(sent.statusCode).toBe(200);
    expect(sent.json()).toMatchObject({ status: 'IN_ROUTE', number: `ВНД-1/${yy}`, acknowledged: 0, total: 4 });
    expect(sent.json().sentAt).toBeTruthy();
    expect((await s.c.hr.post(`/vnd/${vnd.id}/send`)).statusCode).toBe(409);
    expect(await prisma.notification.count({ where: { userId: s.emp.userId, type: 'vnd.pending' } })).toBe(1);

    // Employee view: badge, my list, detail, file access.
    expect((await s.c.emp.get('/me/inbox-counts')).json().vnd).toBe(1);
    const my = (await s.c.emp.get('/vnd/my?status=PENDING')).json();
    expect(my.map((x: { id: string; myStatus: string }) => [x.id, x.myStatus])).toEqual([[vnd.id, 'PENDING']]);
    const detail = (await s.c.emp.get(`/vnd/${vnd.id}`)).json();
    expect(detail).toMatchObject({ myStatus: 'PENDING', canAcknowledge: true, canManage: false });
    expect((await s.c.emp.get(detail.fileUrl)).statusCode).toBe(200);
    expect((await s.c.other.get(detail.fileUrl)).statusCode).toBe(404);
    expect((await s.c.other.get(`/vnd/${vnd.id}`)).statusCode).toBe(404);
    // The employee sees only their own row of the sheet.
    expect((await s.c.emp.get(`/vnd/${vnd.id}/recipients`)).json().total).toBe(1);

    // ЭЦП is required: a plain click is refused.
    const click = await s.c.emp.post(`/vnd/${vnd.id}/acknowledge`, {});
    expect(click.statusCode).toBe(422);
    expect(click.json().error.details.rule).toBe('SIGNATURE_REQUIRED');

    // Sign through the standard signing session (eGov QR), then confirm the acknowledgment with the session id.
    const signed = await qrSign(s.c.emp, [vnd.id]);
    expect(signed.statusCode).toBe(200);
    const ack = await s.c.emp.post(`/vnd/${vnd.id}/acknowledge`, { signingSessionId: signed.json().id });
    expect(ack.statusCode).toBe(200);
    expect(ack.json()).toMatchObject({ myStatus: 'ACKNOWLEDGED', acknowledged: 1, total: 4, status: 'IN_ROUTE' });
    expect((await s.c.emp.post(`/vnd/${vnd.id}/acknowledge`, { signingSessionId: signed.json().id })).statusCode).toBe(200); // idempotent
    expect((await s.c.emp.post(`/vnd/${vnd.id}/acknowledge`, {})).statusCode).toBe(409);
    expect((await s.c.emp.get('/me/inbox-counts')).json().vnd).toBe(0);
    const rec = await prisma.vndRecipient.findUniqueOrThrow({ where: { documentId_employeeId: { documentId: vnd.id, employeeId: s.emp.employeeId } } });
    expect(rec.signatureId).toBeTruthy();
    expect((await prisma.signature.findUniqueOrThrow({ where: { id: rec.signatureId! } })).method).toBe('EGOV_MOBILE');

    // Someone else's session cannot be used.
    expect((await s.c.mgr.post(`/vnd/${vnd.id}/acknowledge`, { signingSessionId: signed.json().id })).statusCode).toBe(404);

    // A comment shows up in the counter.
    await s.c.hr.post(`/documents/${vnd.id}/comments`, { text: 'Просьба ознакомиться до конца недели' });

    // The registry: tabs and counters.
    const inProgress = (await s.c.hr.get('/vnd?tab=in_progress')).json();
    expect(inProgress.items[0]).toMatchObject({ id: vnd.id, acknowledged: 1, total: 4, commentsCount: 1 });
    expect((await s.c.hr.get('/vnd?tab=completed')).json().total).toBe(0);

    // The rest acknowledge (signing alone is enough — recipient rows are synced from the signatures).
    for (const c of [s.c.ceo, s.c.hr]) expect((await qrSign(c, [vnd.id])).statusCode).toBe(200);
    expect((await s.c.hr.get(`/vnd/${vnd.id}`)).json()).toMatchObject({ acknowledged: 3, status: 'IN_ROUTE' });
    expect((await qrSign(s.c.mgr, [vnd.id])).statusCode).toBe(200);

    const done = (await s.c.hr.get(`/vnd/${vnd.id}`)).json();
    expect(done).toMatchObject({ status: 'COMPLETED', acknowledged: 4, total: 4 });
    expect(done.signedPdfUrl).toBeTruthy();
    expect((await s.c.hr.get('/vnd?tab=completed')).json().items.map((x: { id: string }) => x.id)).toEqual([vnd.id]);

    // Acknowledgment sheet.
    const sheet = await s.c.hr.get(`/vnd/${vnd.id}/sheet`);
    expect(sheet.statusCode).toBe(200);
    expect(sheet.headers['content-type']).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(sheet.rawPayload as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.getRow(4).values).toEqual([undefined, '№', 'Получатель', 'Подразделение', 'Должность', 'Статус', 'Дата ознакомления']);
    const rows = [5, 6, 7, 8].map((n) => ws.getRow(n).values as unknown[]);
    expect(rows.every((r) => r[5] === 'Ознакомлен' && typeof r[6] === 'string' && (r[6] as string).length > 0)).toBe(true);
    expect(rows.map((r) => r[3])).toContain('Сектор');
  });

  it('enforces permissions and supports click acknowledgment when ЭЦП is not required', async () => {
    const s = await docSetup(app);
    expect((await createVnd(s.c.emp, s)).statusCode).toBe(403);
    expect((await createVnd(s.c.mgr, s)).statusCode).toBe(403);
    const bad = await s.c.hr.upload('/vnd', [{ filename: 'x.png', content: Buffer.from('not a pdf') }], { title: 'X', legalEntityId: s.t.le.id });
    expect(bad.statusCode).toBe(415);

    const vnd = (await createVnd(s.c.hr, s, { requireSignature: 'false' })).json();
    expect((await s.c.mgr.post(`/vnd/${vnd.id}/recipients`, { allOfLegalEntity: true })).statusCode).toBe(403);
    expect((await s.c.hr.post(`/vnd/${vnd.id}/send`)).json().error.details.rule).toBe('NO_RECIPIENTS');
    expect((await s.c.hr.post(`/vnd/${vnd.id}/recipients`, {})).statusCode).toBe(400);
    expect((await s.c.hr.post(`/vnd/${vnd.id}/recipients`, { employeeIds: [s.emp.employeeId, s.other.employeeId] })).json().added).toBe(2);
    expect((await s.c.hr.post(`/vnd/${vnd.id}/send`)).statusCode).toBe(200);

    // Simple acknowledgment.
    const ack = await s.c.emp.post(`/vnd/${vnd.id}/acknowledge`, {});
    expect(ack.statusCode).toBe(200);
    expect(ack.json()).toMatchObject({ myStatus: 'ACKNOWLEDGED', acknowledged: 1, total: 2 });
    expect((await prisma.signature.findFirstOrThrow({ where: { documentId: vnd.id, signerUserId: s.emp.userId } })).method).toBe('CLICK');

    // Non-recipient cannot acknowledge.
    expect((await s.c.mgr.post(`/vnd/${vnd.id}/acknowledge`, {})).statusCode).toBe(404);

    // Removing the last pending recipient completes the ВНД; acknowledged ones cannot be removed.
    const rows = (await s.c.hr.get(`/vnd/${vnd.id}/recipients`)).json().items as { id: string; status: string; employee: { employeeId: string } }[];
    const ackRow = rows.find((r) => r.status === 'ACKNOWLEDGED')!;
    const pendingRow = rows.find((r) => r.status === 'PENDING')!;
    expect((await s.c.hr.del(`/vnd/${vnd.id}/recipients/${ackRow.id}`)).statusCode).toBe(409);
    expect((await s.c.hr.del(`/vnd/${vnd.id}/recipients/${pendingRow.id}`)).statusCode).toBe(204);
    expect((await s.c.hr.get(`/vnd/${vnd.id}`)).json()).toMatchObject({ status: 'COMPLETED', acknowledged: 1, total: 1 });

    // Adding a new recipient to a completed ВНД reopens it.
    expect((await s.c.hr.post(`/vnd/${vnd.id}/recipients`, { employeeIds: [s.mgr.employeeId] })).json().added).toBe(1);
    expect((await s.c.hr.get(`/vnd/${vnd.id}`)).json()).toMatchObject({ status: 'IN_ROUTE', acknowledged: 1, total: 2 });
    expect((await s.c.mgr.get('/vnd/my')).json()[0]).toMatchObject({ id: vnd.id, myStatus: 'PENDING' });

    // Search and date filters.
    expect((await s.c.hr.get('/vnd?q=распорядка')).json().total).toBe(1);
    expect((await s.c.hr.get('/vnd?q=несуществующий')).json().total).toBe(0);
    expect((await s.c.hr.get('/vnd?dateFrom=2000-01-01&dateTo=2000-01-02')).json().total).toBe(0);
  });
});
