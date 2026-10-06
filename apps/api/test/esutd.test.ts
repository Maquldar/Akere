import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db';
import { processEsutdQueue } from '../src/modules/esutd/service';
import { setEsutdSandboxFailure } from '../src/adapters/esutd';
import { registeredJobs } from '../src/jobs';
import { createApp, resetDb, type TestApp } from './helpers';
import { createDoc, docSetup, qrSign, type DocSetup } from './documents-fixtures';

let app: TestApp;
beforeAll(async () => {
  app = await createApp();
});
afterAll(() => app.close());
beforeEach(resetDb);
afterEach(() => setEsutdSandboxFailure(null));

async function completedContract(s: DocSetup) {
  const doc = await createDoc(s, 'EMPLOYMENT_CONTRACT');
  expect((await qrSign(s.c.ceo, [doc.id], 'EGOV_BUSINESS')).statusCode).toBe(200);
  expect((await qrSign(s.c.emp, [doc.id])).statusCode).toBe(200);
  expect((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).status).toBe('COMPLETED');
  return doc.id as string;
}

describe('ЕСУТД', () => {
  it('lists completed contracts as NOT_SENT, validates, queues, sends, fails and retries', async () => {
    const s = await docSetup(app);
    expect(registeredJobs().some((j) => j.name === 'esutd-queue' && j.cron === '* * * * *')).toBe(true);
    const id = await completedContract(s);

    // The completion hook created the registry row.
    const list = (await s.c.hr.get('/esutd')).json();
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({ documentId: id, status: 'NOT_SENT', type: { name: 'Трудовой договор' }, sentAt: null, externalId: null });
    expect(list.items[0].employee.id).toBe(s.emp.userId);
    expect(list.items[0].signer.id).toBe(s.ceo.userId);
    expect((await s.c.hr.get('/esutd/count')).json()).toEqual({ notSent: 1, errors: 0 });
    expect((await s.c.hr.get('/me/inbox-counts')).json().esutd).toBe(1);

    // The employee has no ИИН → validation error stored on the row.
    const first = (await s.c.hr.post('/esutd/submit', { documentIds: [id] })).json();
    expect(first.succeeded).toEqual([]);
    expect(first.failed[0].reason).toContain('ИИН');
    expect((await s.c.hr.get('/esutd?status=ERROR')).json().items[0].error).toContain('ИИН');
    expect((await s.c.hr.get('/esutd/count')).json()).toEqual({ notSent: 0, errors: 1 });

    // Fix the ИИН, resubmit (ERROR → QUEUED), the sandbox rejects once.
    await prisma.employee.update({ where: { id: s.emp.employeeId }, data: { iin: '900101300123' } });
    expect((await s.c.hr.post('/esutd/submit', { documentIds: [id] })).json()).toEqual({ succeeded: [id], failed: [] });
    expect((await s.c.hr.post('/esutd/submit', { documentIds: [id] })).json().failed).toEqual([{ id, reason: 'ALREADY_QUEUED' }]);
    expect((await s.c.hr.get('/esutd?status=QUEUED')).json().total).toBe(1);
    setEsutdSandboxFailure(() => 'ЕСУТД: сервис временно недоступен (код 503). Повторите отправку позже.');
    expect(await processEsutdQueue()).toEqual({ sent: 0, errors: 1 });
    const errored = (await s.c.hr.get('/esutd')).json().items[0];
    expect(errored).toMatchObject({ status: 'ERROR', error: 'ЕСУТД: сервис временно недоступен (код 503). Повторите отправку позже.' });

    // Retry succeeds.
    setEsutdSandboxFailure(() => null);
    expect((await s.c.hr.post('/esutd/submit', { documentIds: [id] })).json().succeeded).toEqual([id]);
    expect(await processEsutdQueue()).toEqual({ sent: 1, errors: 0 });
    const sent = (await s.c.hr.get('/esutd')).json().items[0];
    expect(sent.status).toBe('SENT');
    expect(sent.externalId).toMatch(/^ESUTD-\d{4}-[0-9A-F]{10}$/);
    expect(sent.sentAt).toBeTruthy();
    expect(sent.error).toBeNull();
    expect((await prisma.esutdSubmission.findUniqueOrThrow({ where: { documentId: id } })).attempts).toBe(2);
    expect((await s.c.hr.post('/esutd/submit', { documentIds: [id] })).json().failed).toEqual([{ id, reason: 'ALREADY_SENT' }]);
    expect((await s.c.hr.get('/esutd/count')).json()).toEqual({ notSent: 0, errors: 0 });

    // The document detail shows the ЕСУТД status.
    expect((await s.c.hr.get(`/documents/${id}`)).json().esutd).toMatchObject({ status: 'SENT', error: null });
  });

  it('backfills older documents, rejects ineligible ones and is HR-only', async () => {
    const s = await docSetup(app);
    const id = await completedContract(s);
    // Simulate a document completed before the hook existed.
    await prisma.esutdSubmission.deleteMany({ where: { documentId: id } });
    expect((await s.c.hr.get('/esutd/count')).json().notSent).toBe(1);
    expect((await s.c.hr.get('/esutd')).json().items[0]).toMatchObject({ documentId: id, status: 'NOT_SENT' });

    const order = await createDoc(s, 'VACATION_ORDER');
    const draft = await createDoc(s, 'EMPLOYMENT_CONTRACT', { startRoute: false });
    const res = (await s.c.hr.post('/esutd/submit', { documentIds: [order.id, draft.id, 'missing-id'] })).json();
    expect(res.succeeded).toEqual([]);
    expect(res.failed).toEqual([
      { id: order.id, reason: 'NOT_COMPLETED' },
      { id: draft.id, reason: 'NOT_COMPLETED' },
      { id: 'missing-id', reason: 'NOT_FOUND' },
    ]);

    expect((await s.c.emp.get('/esutd')).statusCode).toBe(403);
    expect((await s.c.mgr.post('/esutd/submit', { documentIds: [id] })).statusCode).toBe(403);
    expect((await s.c.mgr.get('/esutd/count')).statusCode).toBe(403);
    expect((await s.c.mgr.get('/me/inbox-counts')).json().esutd).toBe(0);
  });

  it('fails about 5 % of submissions deterministically in the sandbox', async () => {
    const { esutd } = await import('../src/adapters/esutd');
    let failures = 0;
    for (let i = 0; i < 400; i++) {
      const r = await esutd.submit({
        documentId: `doc${i}`, documentKind: 'CONTRACT', documentType: 'Трудовой договор', number: `ТД-${i}/2026`, date: '2026-10-01',
        employer: { bin: '190340104211', name: 'ТОО' }, employee: { iin: '900101300123', fullName: 'Тестов Иван', position: null },
        contract: { startDate: '2026-10-01', endDate: null, salary: 1 }, attempt: 1,
      });
      if (!r.ok) failures++;
    }
    expect(failures).toBeGreaterThan(5);
    expect(failures).toBeLessThan(45);
    const again = await esutd.submit({
      documentId: 'doc1', documentKind: 'CONTRACT', documentType: 'x', number: '1', date: '2026-10-01', employer: { bin: '190340104211', name: 'ТОО' },
      employee: { iin: '123', fullName: 'X', position: null }, contract: { startDate: '2026-10-01', endDate: null, salary: null }, attempt: 1,
    });
    expect(again).toMatchObject({ ok: false });
  });
});
