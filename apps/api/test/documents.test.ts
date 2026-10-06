import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { prisma } from '../src/lib/db';
import { emit } from '../src/lib/hooks';
import { runDocumentReminders } from '../src/modules/documents/hooks';
import { Client, SAMPLE_PDF, createApp, makeTenant, resetDb, type TestApp } from './helpers';
import { createDoc, docSetup, qrSign } from './documents-fixtures';

let app: TestApp;
beforeAll(async () => {
  app = await createApp();
});
afterAll(() => app.close());
beforeEach(resetDb);

const yy = String(new Date().getUTCFullYear()).slice(2);
const isoDay = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe('route engine', () => {
  it('runs a contract route (signatory → employee), numbers it and completes with a signed PDF', async () => {
    const s = await docSetup(app);
    const doc = await createDoc(s, 'EMPLOYMENT_CONTRACT');
    expect(doc.status).toBe('IN_ROUTE');
    expect(doc.number).toBe(`ТД-1/${new Date().getUTCFullYear()}`);
    expect(doc.title).toMatch(/^Трудовой договор — Работникова ?Ә.$/);
    expect(doc.steps.map((x: { action: string; status: string; assignee: { id: string } }) => [x.action, x.status, x.assignee.id])).toEqual([
      ['SIGN', 'PENDING', s.ceo.userId], ['SIGN', 'WAITING', s.emp.userId],
    ]);
    expect(doc.steps[0].dueAt).toBeTruthy();

    const inbox = (await s.c.ceo.get('/documents?box=inbox')).json();
    expect(inbox.items.map((d: { id: string }) => d.id)).toEqual([doc.id]);
    expect(inbox.items[0].myPendingAction).toBe('SIGN');
    expect((await s.c.ceo.get('/me/inbox-counts')).json().documents).toBe(1);
    expect(await prisma.notification.count({ where: { userId: s.ceo.userId, type: 'document.pending' } })).toBe(1);

    // Viewing marks viewedAt on my pending step.
    const viewed = (await s.c.ceo.get(`/documents/${doc.id}`)).json();
    expect(viewed.steps[0].viewedAt).toBeTruthy();

    expect((await qrSign(s.c.ceo, [doc.id], 'EGOV_BUSINESS')).statusCode).toBe(200);
    expect((await s.c.ceo.get('/me/inbox-counts')).json().documents).toBe(0);
    expect((await s.c.emp.get('/me/inbox-counts')).json().documents).toBe(1);
    expect((await qrSign(s.c.emp, [doc.id])).statusCode).toBe(200);

    const done = (await s.c.hr.get(`/documents/${doc.id}`)).json();
    expect(done.status).toBe('COMPLETED');
    expect(done.steps.map((x: { signatureMethod: string }) => x.signatureMethod)).toEqual(['EGOV_BUSINESS', 'EGOV_MOBILE']);
    expect(done.signedPdfUrl).toBe(`/api/v1/documents/${doc.id}/pdf?signed=true`);
    const original = await s.c.hr.get(`/documents/${doc.id}/pdf`);
    const signed = await s.c.hr.get(`/documents/${doc.id}/pdf?signed=true`);
    expect(signed.headers['content-type']).toBe('application/pdf');
    const pages = async (b: Buffer) => (await PDFDocument.load(b)).getPageCount();
    expect(await pages(signed.rawPayload)).toBe((await pages(original.rawPayload)) + 1);
    expect(await prisma.notification.count({ where: { userId: s.hr.userId, type: 'document.completed' } })).toBe(1);
    expect((await s.c.hr.get(`/documents/${doc.id}/signatures/verify`)).json().valid).toBe(true);
  });

  it('activates parallel steps together and the next order only when all are done', async () => {
    const s = await docSetup(app);
    const route = (await s.c.hr.post('/route-templates', {
      name: 'Параллельное согласование',
      steps: [
        { order: 1, action: 'APPROVE', rule: 'USER', userId: s.mgr.userId, dueDays: 1 },
        { order: 1, action: 'APPROVE', rule: 'SIGNATORY', dueDays: 2 },
        { order: 2, action: 'APPROVE', rule: 'ROLE_HR' },
      ],
    })).json();
    const type = await s.c.hr.post('/document-types', { code: 'MEMO', name: 'Служебная записка', kind: 'GENERIC', numberPattern: 'СЗ-{seq}/{MM}', routeTemplateId: route.id, esutdRequired: false, isActive: true });
    expect(type.statusCode).toBe(201);
    s.types.MEMO = type.json().id;
    const doc = await createDoc(s, 'MEMO');
    expect(doc.number).toMatch(/^СЗ-1\/\d{2}$/);
    expect(doc.steps.map((x: { status: string }) => x.status)).toEqual(['PENDING', 'PENDING', 'WAITING']);

    expect((await s.c.mgr.post(`/documents/${doc.id}/approve`, { comment: 'Согласовано' })).statusCode).toBe(200);
    let d = (await s.c.hr.get(`/documents/${doc.id}`)).json();
    expect(d.steps.map((x: { status: string }) => x.status)).toEqual(['DONE', 'PENDING', 'WAITING']);
    expect(d.steps[0].comment).toBe('Согласовано');
    expect(d.steps[0].signatureMethod).toBe('CLICK');
    // Second approval by the same user is a no-op error.
    expect((await s.c.mgr.post(`/documents/${doc.id}/approve`, {})).json().error.details.rule).toBe('NOTHING_TO_APPROVE');

    await s.c.ceo.post(`/documents/${doc.id}/approve`, {});
    d = (await s.c.hr.get(`/documents/${doc.id}`)).json();
    expect(d.steps[2]).toMatchObject({ status: 'PENDING', assignee: { id: s.hr.userId } });
    expect(d.myPendingAction).toBe('APPROVE');
    await s.c.hr.post(`/documents/${doc.id}/approve`, {});
    expect((await s.c.hr.get(`/documents/${doc.id}`)).json().status).toBe('COMPLETED');
  });

  it('returns for rework, resets steps, allows editing and restarts from order 1', async () => {
    const s = await docSetup(app);
    const doc = await createDoc(s, 'VACATION_APPLICATION');
    expect(doc.steps[0]).toMatchObject({ action: 'APPROVE', assignee: { id: s.mgr.userId }, status: 'PENDING' });
    expect((await s.c.hr.patch(`/documents/${doc.id}`, { title: 'X' })).json().error.details.rule).toBe('NOT_EDITABLE');

    const ret = await s.c.mgr.post(`/documents/${doc.id}/return`, { comment: 'Уточните даты' });
    expect(ret.statusCode).toBe(200);
    expect(ret.json().status).toBe('REWORK');
    expect(ret.json().steps.map((x: { status: string }) => x.status)).toEqual(['RETURNED', 'WAITING']);
    expect(ret.json().canEdit).toBe(false); // manager is not the author
    expect(await prisma.notification.count({ where: { userId: s.hr.userId, type: 'document.returned' } })).toBe(1);
    expect((await s.c.hr.get(`/documents/${doc.id}/comments`)).json()[0].text).toContain('Уточните даты');

    const edited = await s.c.hr.patch(`/documents/${doc.id}`, { data: { startDate: '2026-11-09', endDate: '2026-11-22', days: 14 } });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().data.startDate).toBe('2026-11-09');
    expect(edited.json().pdfUrl).toBeTruthy();

    const restarted = (await s.c.hr.post(`/documents/${doc.id}/start`)).json();
    expect(restarted.status).toBe('IN_ROUTE');
    expect(restarted.number).toBe(doc.number);
    expect(restarted.steps.map((x: { status: string }) => x.status)).toEqual(['PENDING', 'WAITING']);
    await s.c.mgr.post(`/documents/${doc.id}/approve`, {});
    await s.c.hr.post(`/documents/${doc.id}/approve`, {});
    expect((await s.c.hr.get(`/documents/${doc.id}`)).json().status).toBe('COMPLETED');
  });

  it('rejects a document and ends the route', async () => {
    const s = await docSetup(app);
    const doc = await createDoc(s, 'VACATION_APPLICATION');
    expect((await s.c.other.post(`/documents/${doc.id}/reject`, { comment: 'нет' })).statusCode).toBe(404);
    const rej = (await s.c.mgr.post(`/documents/${doc.id}/reject`, { comment: 'Пиковый период' })).json();
    expect(rej.status).toBe('REJECTED');
    expect(rej.steps.map((x: { status: string }) => x.status)).toEqual(['REJECTED', 'SKIPPED']);
    expect((await s.c.hr.post(`/documents/${doc.id}/approve`, {})).statusCode).toBe(422);
    expect(await prisma.notification.count({ where: { userId: s.hr.userId, type: 'document.rejected' } })).toBe(1);
    expect((await s.c.hr.post(`/documents/${doc.id}/cancel`, { reason: 'x' })).statusCode).toBe(409);
  });

  it('lets an active deputy act on behalf of the assignee', async () => {
    const s = await docSetup(app);
    const doc = await createDoc(s, 'HIRE_ORDER');
    expect((await s.c.other.get(`/documents/${doc.id}`)).statusCode).toBe(404);
    const dep = await s.c.ceo.post('/deputies', { deputyUserId: s.other.userId, startDate: isoDay(-1), endDate: isoDay(5) });
    expect(dep.statusCode).toBe(201);
    expect(dep.json().active).toBe(true);

    const inbox = (await s.c.other.get('/documents?box=inbox')).json();
    expect(inbox.items.map((d: { id: string }) => d.id)).toEqual([doc.id]);
    expect(inbox.items[0].myPendingAction).toBe('SIGN');
    expect((await s.c.other.get('/me/inbox-counts')).json().documents).toBe(1);
    expect((await qrSign(s.c.other, [doc.id])).statusCode).toBe(200);

    const d = (await s.c.hr.get(`/documents/${doc.id}`)).json();
    expect(d.steps[0]).toMatchObject({ status: 'DONE', actedBy: { id: s.other.userId }, onBehalfOf: { id: s.ceo.userId } });
    const sig = await prisma.signature.findFirstOrThrow({ where: { documentId: doc.id } });
    expect(sig).toMatchObject({ signerUserId: s.other.userId, onBehalfOfUserId: s.ceo.userId });
  });
});

describe('numbering and registration', () => {
  it('numbers by sequence, rejects duplicate manual numbers and supports backdating', async () => {
    const s = await docSetup(app);
    const a = await createDoc(s, 'HIRE_ORDER');
    const b = await createDoc(s, 'TRANSFER_ORDER'); // same pattern, separate sequence per type
    const c = await createDoc(s, 'HIRE_ORDER');
    expect([a.number, b.number, c.number]).toEqual([`1-к/${yy}`, `1-к/${yy}`, `2-к/${yy}`]);

    const draft = await createDoc(s, 'HIRE_ORDER', { startRoute: false });
    expect(draft.number).toBeNull();
    expect(draft.canRegister).toBe(true);
    expect((await s.c.hr.post(`/documents/${draft.id}/register`, { number: a.number })).statusCode).toBe(409);
    const reg = (await s.c.hr.post(`/documents/${draft.id}/register`, { number: '77-к/26', registeredAt: '2026-09-01' })).json();
    expect(reg).toMatchObject({ number: '77-к/26', registeredAt: '2026-09-01', backdated: true });
    expect((await s.c.hr.post(`/documents/${draft.id}/register`, { registeredAt: isoDay(3) })).json().error.details.rule).toBe('FUTURE_REGISTRATION_DATE');
    expect((await s.c.mgr.post(`/documents/${draft.id}/register`, { number: '1' })).statusCode).toBe(403);
    // Starting keeps the manual number; the next automatic one continues the sequence.
    expect((await s.c.hr.post(`/documents/${draft.id}/start`)).json().number).toBe('77-к/26');
    expect((await createDoc(s, 'HIRE_ORDER')).number).toBe(`3-к/${yy}`);
  });
});

describe('visibility and registry', () => {
  it('scopes documents to participants, HR, subject and their managers', async () => {
    const s = await docSetup(app);
    const doc = await createDoc(s, 'EMPLOYMENT_CONTRACT');
    const draft = await createDoc(s, 'HIRE_ORDER', { startRoute: false });
    expect((await s.c.other.get(`/documents/${doc.id}`)).statusCode).toBe(404);
    expect((await s.c.other.get(`/documents/${doc.id}/pdf`)).statusCode).toBe(404);
    expect((await s.c.other.get('/documents')).json().total).toBe(0);
    expect((await s.c.emp.get(`/documents/${doc.id}`)).statusCode).toBe(200); // subject
    expect((await s.c.emp.get(`/documents/${draft.id}`)).statusCode).toBe(404); // drafts stay with the author/HR
    expect((await s.c.mgr.get(`/documents/${doc.id}`)).statusCode).toBe(200); // subject's manager
    expect((await s.c.hr.get('/documents?box=all')).json().total).toBe(2);
    expect((await s.c.hr.get('/documents?box=drafts')).json().items.map((d: { id: string }) => d.id)).toEqual([draft.id]);
    expect((await s.c.hr.get('/documents?box=outbox')).json().items.map((d: { id: string }) => d.id)).toEqual([doc.id]);
    // File access follows document visibility.
    const pdfFileId = (await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).pdfFileId!;
    expect((await s.c.emp.get(`/files/${pdfFileId}`)).statusCode).toBe(200);
    expect((await s.c.other.get(`/files/${pdfFileId}`)).statusCode).toBe(404);
    // Search and filters.
    expect((await s.c.hr.get(`/documents?q=${encodeURIComponent('работникова')}`)).json().total).toBe(2);
    expect((await s.c.hr.get(`/documents?q=${encodeURIComponent(doc.number)}`)).json().items[0].id).toBe(doc.id);
    expect((await s.c.hr.get(`/documents?status=DRAFT&documentTypeId=${s.types.HIRE_ORDER}`)).json().total).toBe(1);
    expect((await s.c.hr.get('/documents?kind=CONTRACT&sort=number&order=asc')).json().total).toBe(1);
    // Employees cannot create documents; managers only for their subtree.
    expect((await s.c.emp.post('/documents', { documentTypeId: s.types.HIRE_ORDER, legalEntityId: s.t.le.id, data: {}, startRoute: false })).statusCode).toBe(403);
    expect((await createDoc(s, 'VACATION_ORDER', { client: s.c.mgr, startRoute: false })).author.id).toBe(s.mgr.userId);
    await expect(createDoc(s, 'VACATION_ORDER', { client: s.c.mgr, subject: s.other.employeeId })).rejects.toThrow(/403/);
  });

  it('bulk-creates and bulk-approves documents', async () => {
    const s = await docSetup(app);
    const emp2 = await s.t.person({ email: s.email('emp2'), lastName: 'Второва', managerEmployeeId: s.mgr.employeeId });
    const bulk = await s.c.hr.post('/documents/bulk', {
      documentTypeId: s.types.VACATION_APPLICATION, legalEntityId: s.t.le.id, subjectEmployeeIds: [s.emp.employeeId, emp2.employeeId],
      data: { startDate: '2026-12-01', endDate: '2026-12-14', days: 14 }, startRoute: true,
    });
    expect(bulk.statusCode).toBe(201);
    const ids: string[] = bulk.json().documentIds;
    expect(ids).toHaveLength(2);
    const contract = await createDoc(s, 'EMPLOYMENT_CONTRACT');
    const res = (await s.c.mgr.post('/documents/bulk-approve', { documentIds: [...ids, contract.id] })).json();
    expect(res.succeeded.sort()).toEqual([...ids].sort());
    expect(res.failed).toEqual([{ id: contract.id, reason: 'NOTHING_TO_APPROVE' }]);
    const after = (await s.c.hr.get('/documents?box=inbox')).json();
    expect(after.total).toBe(2); // now pending for HR
  });

  it('completes a document signed on paper from an uploaded scan', async () => {
    const s = await docSetup(app);
    const doc = await createDoc(s, 'EMPLOYMENT_CONTRACT');
    expect((await s.c.mgr.upload(`/documents/${doc.id}/paper-signed`, [{ filename: 'scan.pdf', content: SAMPLE_PDF }])).statusCode).toBe(403);
    const res = await s.c.hr.upload(`/documents/${doc.id}/paper-signed`, [{ filename: 'scan.pdf', content: SAMPLE_PDF, contentType: 'application/pdf' }], { registeredAt: '2026-09-15' });
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d).toMatchObject({ status: 'COMPLETED', paperSigned: true, backdated: true, registeredAt: '2026-09-15' });
    expect(d.steps.every((x: { status: string; signatureMethod: string }) => x.status === 'DONE' && x.signatureMethod === 'PAPER')).toBe(true);
    expect(d.steps[1].onBehalfOf.id).toBe(s.emp.userId);
    expect(d.files[0].name).toContain('scan.pdf');
    expect((await s.c.hr.get(`/documents/${doc.id}/pdf?signed=true`)).rawPayload.equals(SAMPLE_PDF)).toBe(true);
    const v = (await s.c.hr.get(`/documents/${doc.id}/signatures/verify`)).json();
    expect(v.valid).toBe(true);
    expect(v.signatures.map((x: { method: string }) => x.method)).toEqual(['PAPER', 'PAPER']);
  });
});

describe('reminders', () => {
  it('notifies due-soon and overdue steps once per day and flags overdue documents', async () => {
    const s = await docSetup(app);
    const doc = await createDoc(s, 'HIRE_ORDER');
    const step = await prisma.routeStep.findFirstOrThrow({ where: { documentId: doc.id, status: 'PENDING' } });
    await prisma.routeStep.update({ where: { id: step.id }, data: { dueAt: new Date(Date.now() + 2 * 3_600_000) } });
    await prisma.routeStep.updateMany({ where: { documentId: doc.id, status: 'WAITING' }, data: { dueAt: new Date(Date.now() - 3_600_000) } });
    expect(await runDocumentReminders()).toEqual({ notified: 1 }); // WAITING steps are ignored
    expect(await runDocumentReminders()).toEqual({ notified: 0 }); // once per day
    expect(await prisma.notification.count({ where: { userId: s.ceo.userId, type: 'document.due_soon' } })).toBe(1);

    await prisma.routeStep.update({ where: { id: step.id }, data: { dueAt: new Date(Date.now() - 3_600_000), reminderSentAt: new Date(Date.now() - 25 * 3_600_000) } });
    expect(await runDocumentReminders()).toEqual({ notified: 1 });
    expect(await prisma.notification.count({ where: { userId: s.ceo.userId, type: 'document.overdue' } })).toBe(1);
    const list = (await s.c.hr.get('/documents?overdue=true')).json();
    expect(list.items.map((d: { id: string; overdue: boolean }) => [d.id, d.overdue])).toEqual([[doc.id, true]]);
    expect((await s.c.hr.get('/documents?overdue=false')).json().total).toBe(0);
  });
});

describe('employee.hired', () => {
  it('generates the hire order and employment contract (creating missing types) and starts their routes', async () => {
    const t = await makeTenant('Hire Co');
    await t.person({ email: 'boss@hire.kz', roles: [{ role: 'MANAGER', legalEntityId: t.le.id, canSign: true }] });
    const hr = await t.person({ email: 'hr@hire.kz', roles: [{ role: 'HR' }] });
    const newbie = await t.person({ email: 'new@hire.kz', lastName: 'Новичков' });
    const payload = { tenantId: t.tenantId, employeeId: newbie.employeeId, actorUserId: hr.userId, salary: 380000, probationMonths: 3, generateDocuments: true, documentIds: [] as string[] };
    await prisma.$transaction((tx) => emit('employee.hired', payload, tx), { timeout: 60_000 });
    expect(payload.documentIds).toHaveLength(2);
    const docs = await prisma.document.findMany({ where: { id: { in: payload.documentIds } }, include: { documentType: true, steps: true } });
    expect(docs.map((d) => d.documentType.code).sort()).toEqual(['EMPLOYMENT_CONTRACT', 'HIRE_ORDER']);
    expect(docs.every((d) => d.status === 'IN_ROUTE' && d.number && d.pdfFileId && d.steps.length === 2)).toBe(true);
    expect(docs.find((d) => d.documentType.code === 'EMPLOYMENT_CONTRACT')!.documentType.esutdRequired).toBe(true);
    expect(await prisma.documentLink.count({ where: { relation: 'BASED_ON' } })).toBe(1);

    const skip = { ...payload, generateDocuments: false, documentIds: [] as string[] };
    await emit('employee.hired', skip);
    expect(skip.documentIds).toHaveLength(0);
    const hrClient = new Client(app);
    await hrClient.login('hr@hire.kz');
    expect((await hrClient.get('/documents?box=outbox')).json().total).toBe(2);
  });
});
