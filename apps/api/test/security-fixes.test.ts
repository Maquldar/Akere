import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deflateRawSync, crc32 } from 'node:zlib';
import { prisma } from '../src/lib/db';
import { config, parseTrustProxy } from '../src/config';
import { issueOtp, verifyOtp } from '../src/lib/otp';
import { REDACTED_BODY } from '../src/adapters/messaging';
import { syncAcknowledgments } from '../src/modules/vnd/service';
import { completeStep, rejectDocument } from '../src/modules/documents/route-engine';
import { submitRequest } from '../src/modules/requests/service';
import { permissionsForRoles } from '@akere/shared';
import type { UserCtx } from '../src/lib/auth';
import { getVacationBalance } from '../src/modules/employees/service';
import { zipStats } from '../src/lib/zip';
import { buildImportTemplate } from '../src/modules/candidates/import';
import { Client, PASSWORD, SAMPLE_PDF, createApp, lastCode, makeTenant, resetDb, type TestApp } from './helpers';
import { createDoc, docSetup, qrSign, type DocSetup } from './documents-fixtures';

let app: TestApp;
beforeAll(async () => {
  app = await createApp();
});
afterAll(() => app.close());
beforeEach(resetDb);

const DAY = 86_400_000;
const iso = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

/** Second legal entity with one employee, plus an HR scoped to the first legal entity only. */
async function withSecondEntity(s: DocSetup) {
  const le2 = await prisma.legalEntity.create({ data: { tenantId: s.t.tenantId, name: 'ТОО Второе', bin: '190340104299' } });
  await prisma.department.create({ data: { tenantId: s.t.tenantId, legalEntityId: le2.id, name: 'Отдел 2' } });
  const emp2 = await s.t.person({ email: s.email('emp2le'), lastName: 'Другая', legalEntityId: le2.id });
  await s.t.person({ email: s.email('hrscoped'), lastName: 'Кадровик', roles: [{ role: 'HR', legalEntityId: s.t.le.id }] });
  const scoped = new Client(app);
  await scoped.login(s.email('hrscoped'));
  return { le2, emp2, scoped };
}

async function sendVnd(s: DocSetup, employeeIds: string[], requireSignature: 'true' | 'false') {
  const res = await s.c.hr.upload('/vnd', [{ filename: 'ВНД.pdf', content: SAMPLE_PDF, contentType: 'application/pdf' }], {
    title: 'Положение', legalEntityId: s.t.le.id, requireSignature,
  });
  expect(res.statusCode).toBe(201);
  const vnd = res.json();
  expect((await s.c.hr.post(`/vnd/${vnd.id}/recipients`, { employeeIds })).statusCode).toBe(200);
  expect((await s.c.hr.post(`/vnd/${vnd.id}/send`)).statusCode).toBe(200);
  return vnd as { id: string };
}

/** Tiny ZIP writer (deflate) for archive-limit tests. */
function makeZip(entries: { name: string; data: Buffer }[]) {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const comp = deflateRawSync(e.data);
    const crc = crc32(e.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(e.data.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(e.data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, comp);
    central.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

describe('H1 sick-leave attachments', () => {
  it('scoped HR cannot attach (and then read) another entity’s document PDF; own uploads still work', async () => {
    const s = await docSetup(app);
    const { emp2, scoped } = await withSecondEntity(s);
    const { le2 } = await prisma.employee.findUniqueOrThrow({ where: { id: emp2.employeeId }, select: { legalEntityId: true } }).then((e) => ({ le2: e.legalEntityId }));
    const doc2 = await s.c.hr.post('/documents', { documentTypeId: s.types.VACATION_APPLICATION, legalEntityId: le2, subjectEmployeeId: emp2.employeeId, data: {}, startRoute: false });
    expect(doc2.statusCode).toBe(201);
    const pdfFileId = (await prisma.document.findUniqueOrThrow({ where: { id: doc2.json().id } })).pdfFileId!;
    expect((await scoped.get(`/files/${pdfFileId}`)).statusCode).toBe(404);

    const body = { employeeId: s.emp.employeeId, number: 'SL-1', startDate: iso(-5), endDate: iso(-3), source: 'MANUAL', fileId: pdfFileId };
    expect((await scoped.post('/sick-leaves', body)).statusCode).toBe(404);
    expect((await scoped.get(`/files/${pdfFileId}`)).statusCode).toBe(404);
    // A file uploaded by someone else is refused too, even within scope.
    const others = (await s.c.emp.upload('/uploads', [{ filename: 'x.pdf', content: SAMPLE_PDF }])).json();
    expect((await scoped.post('/sick-leaves', { ...body, fileId: others.id })).statusCode).toBe(404);

    const mine = (await scoped.upload('/uploads', [{ filename: 'bl.pdf', content: SAMPLE_PDF }])).json();
    const created = await scoped.post('/sick-leaves', { ...body, fileId: mine.id });
    expect(created.statusCode).toBe(201);
    // …but the same scan cannot be reused on a second sick leave, nor swapped in for a document PDF via PATCH.
    expect((await scoped.post('/sick-leaves', { ...body, number: 'SL-2', startDate: iso(-20), endDate: iso(-19) })).statusCode).toBe(404);
    expect((await scoped.patch(`/sick-leaves/${created.json().id}`, { fileId: pdfFileId })).statusCode).toBe(404);
    expect((await scoped.patch(`/sick-leaves/${created.json().id}`, { note: 'ok' })).statusCode).toBe(200);
  });
});

describe('H2 acknowledgments are personal', () => {
  it('bulk-approve skips ВНД with USE_VND_ACKNOWLEDGE', async () => {
    const s = await docSetup(app);
    const vnd = await sendVnd(s, [s.emp.employeeId], 'true');
    const res = (await s.c.emp.post('/documents/bulk-approve', { documentIds: [vnd.id] })).json();
    expect(res).toEqual({ succeeded: [], failed: [{ id: vnd.id, reason: 'USE_VND_ACKNOWLEDGE' }] });
    expect((await prisma.vndRecipient.findFirstOrThrow({ where: { documentId: vnd.id } })).status).toBe('PENDING');
  });

  it('deputies and the HR pool cannot act on ACKNOWLEDGE steps; sync ignores acknowledgments on behalf', async () => {
    const s = await docSetup(app);
    const hr2 = await s.t.person({ email: s.email('hr2'), lastName: 'Второй', roles: [{ role: 'HR' }] });
    const cHr2 = new Client(app);
    await cHr2.login(s.email('hr2'));
    expect((await s.c.emp.post('/deputies', { deputyUserId: s.other.userId, startDate: iso(-1), endDate: iso(5) })).statusCode).toBe(201);
    const vnd = await sendVnd(s, [s.emp.employeeId, s.hr.employeeId, hr2.employeeId], 'false');

    // Deputy of the employee: no approve, no signing session.
    expect((await s.c.other.post(`/documents/${vnd.id}/approve`, {})).statusCode).toBe(422);
    expect((await qrSign(s.c.other, [vnd.id])).statusCode).not.toBe(200);
    // HR pool: hr2 cannot acknowledge for hr (only their own step).
    expect((await cHr2.post(`/documents/${vnd.id}/approve`, {})).statusCode).toBe(200);
    const steps = await prisma.routeStep.findMany({ where: { documentId: vnd.id } });
    const byUser = new Map(steps.map((x) => [x.assigneeUserId, x]));
    expect(byUser.get(hr2.userId)!.status).toBe('DONE');
    expect(byUser.get(s.hr.userId)!.status).toBe('PENDING');
    expect(byUser.get(s.emp.userId)!.status).toBe('PENDING');
    expect((await cHr2.post(`/documents/${vnd.id}/approve`, {})).statusCode).toBe(422);

    // A step completed on someone's behalf (legacy data) is not mirrored as the recipient's acknowledgment.
    const empStep = byUser.get(s.emp.userId)!;
    await prisma.routeStep.update({ where: { id: empStep.id }, data: { status: 'DONE', actedById: s.other.userId, actedAt: new Date() } });
    await prisma.signature.create({
      data: { tenantId: s.t.tenantId, documentId: vnd.id, routeStepId: empStep.id, signerUserId: s.other.userId, onBehalfOfUserId: s.emp.userId, method: 'CLICK', docHash: 'x', signatureB64: '', publicKeyPem: '', certSubject: 'x' },
    });
    await syncAcknowledgments(prisma, { documentId: vnd.id });
    await syncAcknowledgments(prisma, { tenantId: s.t.tenantId });
    const rec = await prisma.vndRecipient.findMany({ where: { documentId: vnd.id } });
    const status = new Map(rec.map((r) => [r.employeeId, r.status]));
    expect(status.get(s.emp.employeeId)).toBe('PENDING');
    expect(status.get(hr2.employeeId)).toBe('ACKNOWLEDGED');
  });
});

describe('H3 proxy trust, login lockout and OTP races', () => {
  it('parses TRUST_PROXY and ignores X-Forwarded-For by default', async () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('10.0.0.0/8, 127.0.0.1')).toEqual(['10.0.0.0/8', '127.0.0.1']);
    expect(config.TRUST_PROXY).toBe(false);

    const a = await createApp(); // fresh rate-limit store
    try {
      const c = new Client(a);
      let last = 0;
      for (let i = 0; i < 21; i++) {
        last = (await c.req('POST', '/auth/login', { login: 'nobody@nowhere.kz', password: 'x' }, { 'x-forwarded-for': `203.0.113.${i}` })).statusCode;
        if (i < 20) expect(last).toBe(401);
      }
      expect(last).toBe(429); // rotating X-Forwarded-For no longer yields a fresh limiter key
    } finally {
      await a.close();
    }
  });

  it('30 parallel wrong passwords lock the account after at most 5 password checks', async () => {
    const t = await makeTenant();
    const p = await t.person({ email: 'race@t.kz' });
    const a = await createApp();
    try {
      const c = new Client(a);
      const res = await Promise.all(Array.from({ length: 30 }, () => c.req('POST', '/auth/login', { login: 'race@t.kz', password: 'WrongPassword1' })));
      const codes = res.map((r) => r.statusCode);
      expect(codes.filter((x) => x === 401).length).toBeLessThanOrEqual(5);
      expect(codes.filter((x) => x !== 401).every((x) => x === 429)).toBe(true);
      const checks = await prisma.auditLog.count({ where: { entityId: p.userId, action: 'auth.login_failed' } });
      expect(checks).toBeLessThanOrEqual(5);
      const u = await prisma.user.findUniqueOrThrow({ where: { id: p.userId } });
      expect(u.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
      expect(u.failedLogins).toBe(5);
    } finally {
      await a.close();
    }
    const b = await createApp(); // fresh limiter store: only the account lock applies now
    try {
      // Locked: even the right password is refused without verification.
      const locked = await new Client(b).req('POST', '/auth/login', { login: 'race@t.kz', password: PASSWORD }, {});
      expect(locked.statusCode).toBe(429);
      expect(await prisma.auditLog.count({ where: { entityId: p.userId, action: 'auth.login_failed' } })).toBeLessThanOrEqual(5);
      // Lock expired → the count restarts and a correct password clears it.
      await prisma.user.update({ where: { id: p.userId }, data: { lockedUntil: new Date(Date.now() - 1000) } });
      const ok = await new Client(b).req('POST', '/auth/login', { login: 'race@t.kz', password: PASSWORD }, {});
      expect(ok.statusCode).toBe(200);
      expect(await prisma.user.findUniqueOrThrow({ where: { id: p.userId } })).toMatchObject({ failedLogins: 0, lockedUntil: null });
    } finally {
      await b.close();
    }
  });

  it('parallel OTP guesses never exceed 5 attempts and a code is consumed once', async () => {
    const t = await makeTenant();
    const target = '+77015550101';
    await issueOtp({ purpose: 'LOGIN_2FA', target, channel: 'SMS', tenantId: t.tenantId, lang: 'ru' });
    const code = await lastCode(target);
    const wrong = code === '000000' ? '111111' : '000000';
    const results = await Promise.all(Array.from({ length: 20 }, () => verifyOtp({ purpose: 'LOGIN_2FA', target, code: wrong })));
    expect(results.every((r) => r === false)).toBe(true);
    expect((await prisma.otpCode.findFirstOrThrow({ where: { target } })).attempts).toBe(5);
    expect(await verifyOtp({ purpose: 'LOGIN_2FA', target, code })).toBe(false); // exhausted

    await prisma.otpCode.deleteMany({ where: { target } });
    await issueOtp({ purpose: 'LOGIN_2FA', target, channel: 'SMS', tenantId: t.tenantId, lang: 'ru' });
    const code2 = await lastCode(target);
    const ok = await Promise.all(Array.from({ length: 5 }, () => verifyOtp({ purpose: 'LOGIN_2FA', target, code: code2 })));
    expect(ok.filter(Boolean)).toHaveLength(1);
  });
});

describe('M1–M3 concurrency', () => {
  it('parallel submits of two drafts exceeding the balance: exactly one succeeds', async () => {
    const s = await docSetup(app);
    const types = (await s.c.emp.get('/request-types')).json() as { id: string; code: string }[];
    const annual = types.find((x) => x.code === 'ANNUAL_LEAVE')!.id;
    const d1 = (await s.c.emp.post('/requests', { requestTypeId: annual, startDate: iso(30), endDate: iso(43), data: {}, submit: false })).json();
    const d2 = (await s.c.emp.post('/requests', { requestTypeId: annual, startDate: iso(60), endDate: iso(73), data: {}, submit: false })).json();
    const bal = await getVacationBalance(s.emp.employeeId);
    const target = d1.days + d2.days - 1; // each fits alone, both together do not
    await prisma.vacationLedger.create({ data: { tenantId: s.t.tenantId, employeeId: s.emp.employeeId, type: 'ADJUSTMENT', days: target - bal.available, date: new Date(), note: 'test' } });
    const res = await Promise.all([s.c.emp.post(`/requests/${d1.id}/submit`), s.c.emp.post(`/requests/${d2.id}/submit`)]);
    expect(res.map((r) => r.statusCode).sort()).toEqual([200, 422]);
    expect(await prisma.request.count({ where: { employeeId: s.emp.employeeId, status: 'IN_APPROVAL' } })).toBe(1);
  });

  it('parallel steps completed concurrently complete the document exactly once', async () => {
    const s = await docSetup(app);
    const vnd = await sendVnd(s, [s.emp.employeeId, s.other.employeeId, s.mgr.employeeId], 'false');
    const res = await Promise.all([s.c.emp, s.c.other, s.c.mgr].map((c) => c.post(`/vnd/${vnd.id}/acknowledge`, {})));
    expect(res.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect((await prisma.document.findUniqueOrThrow({ where: { id: vnd.id } })).status).toBe('COMPLETED');
    expect(await prisma.auditLog.count({ where: { entityId: vnd.id, action: 'document.completed' } })).toBe(1);
    expect(await prisma.vndRecipient.count({ where: { documentId: vnd.id, status: 'ACKNOWLEDGED' } })).toBe(3);
  });

  /** Runs `first` in a transaction held open after it finishes, starts `second`, then commits `first`. */
  async function interleave<A, B>(first: (tx: typeof prisma) => Promise<A>, second: (tx: typeof prisma) => Promise<B>) {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let ready!: () => void;
    const firstDone = new Promise<void>((r) => (ready = r));
    const pA = prisma.$transaction(async (tx) => {
      const out = await first(tx as typeof prisma);
      ready();
      await gate;
      return out;
    }, { timeout: 30_000 });
    pA.catch(() => ready());
    await firstDone;
    const pB = prisma.$transaction((tx) => second(tx as typeof prisma), { timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 300)); // without the document lock, `second` finishes here against uncommitted state
    release();
    return Promise.allSettled([pA, pB]);
  }

  it('interleaved completion of two parallel steps still completes the document (document row lock)', async () => {
    const s = await docSetup(app);
    const vnd = await sendVnd(s, [s.emp.employeeId, s.other.employeeId], 'false');
    const steps = await prisma.routeStep.findMany({ where: { documentId: vnd.id }, orderBy: { id: 'asc' } });
    const [a, b] = await interleave(
      (tx) => completeStep(tx, { stepId: steps[0]!.id, actorUserId: steps[0]!.assigneeUserId, method: 'CLICK' }),
      (tx) => completeStep(tx, { stepId: steps[1]!.id, actorUserId: steps[1]!.assigneeUserId, method: 'CLICK' }),
    );
    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('fulfilled');
    expect((await prisma.document.findUniqueOrThrow({ where: { id: vnd.id } })).status).toBe('COMPLETED');
    expect(await prisma.auditLog.count({ where: { entityId: vnd.id, action: 'document.completed' } })).toBe(1);
  });

  it('interleaved submits cannot double-spend the balance (per-employee advisory lock)', async () => {
    const s = await docSetup(app);
    const types = (await s.c.emp.get('/request-types')).json() as { id: string; code: string }[];
    const annual = types.find((x) => x.code === 'ANNUAL_LEAVE')!.id;
    const d1 = (await s.c.emp.post('/requests', { requestTypeId: annual, startDate: iso(30), endDate: iso(43), data: {}, submit: false })).json();
    const d2 = (await s.c.emp.post('/requests', { requestTypeId: annual, startDate: iso(60), endDate: iso(73), data: {}, submit: false })).json();
    const bal = await getVacationBalance(s.emp.employeeId);
    await prisma.vacationLedger.create({ data: { tenantId: s.t.tenantId, employeeId: s.emp.employeeId, type: 'ADJUSTMENT', days: d1.days + d2.days - 1 - bal.available, date: new Date(), note: 'test' } });
    const u: UserCtx = {
      kind: 'user', sessionId: 'test', userId: s.emp.userId, tenantId: s.t.tenantId, roles: ['EMPLOYEE'], grants: [{ role: 'EMPLOYEE', legalEntityId: null, canSign: false }],
      permissions: permissionsForRoles(['EMPLOYEE']), employeeId: s.emp.employeeId, locale: 'ru', pending2fa: false,
    };
    const [a, b] = await interleave((tx) => submitRequest(tx, u, d1.id), (tx) => submitRequest(tx, u, d2.id));
    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('rejected');
    expect(await prisma.request.count({ where: { employeeId: s.emp.employeeId, status: 'IN_APPROVAL' } })).toBe(1);
  });

  it('a reject racing a completed acknowledgment gets 409 instead of overwriting it', async () => {
    const s = await docSetup(app);
    const types = (await s.c.emp.get('/request-types')).json() as { id: string; code: string }[];
    const r = (await s.c.emp.post('/requests', { requestTypeId: types.find((x) => x.code === 'ANNUAL_LEAVE')!.id, startDate: iso(30), endDate: iso(35), data: {}, submit: true })).json();
    await s.c.mgr.post(`/documents/${r.applicationDocument.id}/approve`, {});
    await s.c.hr.post(`/documents/${r.applicationDocument.id}/approve`, {});
    const orderId = (await s.c.emp.get(`/requests/${r.id}`)).json().orderDocument.id;
    expect((await qrSign(s.c.ceo, [orderId], 'EGOV_BUSINESS')).statusCode).toBe(200);
    const ack = await prisma.routeStep.findFirstOrThrow({ where: { documentId: orderId, status: 'PENDING' } });
    const [a, b] = await interleave(
      (tx) => completeStep(tx, { stepId: ack.id, actorUserId: s.emp.userId, method: 'CLICK' }),
      (tx) => rejectDocument(tx, { stepId: ack.id, actorUserId: s.emp.userId, comment: 'нет' }),
    );
    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('rejected');
    expect(((b as PromiseRejectedResult).reason as { status: number }).status).toBe(409);
    expect((await prisma.document.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('COMPLETED');
    expect((await prisma.request.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('COMPLETED');
  });

  it('approve vs reject race leaves a consistent state', async () => {
    const s = await docSetup(app);
    const types = (await s.c.emp.get('/request-types')).json() as { id: string; code: string }[];
    const r = (await s.c.emp.post('/requests', { requestTypeId: types.find((x) => x.code === 'ANNUAL_LEAVE')!.id, startDate: iso(30), endDate: iso(35), data: {}, submit: true })).json();
    const appId = r.applicationDocument.id;
    await s.c.mgr.post(`/documents/${appId}/approve`, {});
    await s.c.hr.post(`/documents/${appId}/approve`, {});
    const orderId = (await s.c.emp.get(`/requests/${r.id}`)).json().orderDocument.id;
    expect((await qrSign(s.c.ceo, [orderId], 'EGOV_BUSINESS')).statusCode).toBe(200);
    const [a, b] = await Promise.all([s.c.emp.post(`/documents/${orderId}/approve`, {}), s.c.emp.post(`/documents/${orderId}/reject`, { comment: 'нет' })]);
    expect([a.statusCode, b.statusCode].filter((x) => x === 200)).toHaveLength(1);
    expect([a.statusCode, b.statusCode].every((x) => [200, 409, 422].includes(x))).toBe(true);
    const order = await prisma.document.findUniqueOrThrow({ where: { id: orderId }, include: { steps: true } });
    const req = await prisma.request.findUniqueOrThrow({ where: { id: r.id } });
    if (order.status === 'COMPLETED') {
      expect(req.status).toBe('COMPLETED');
      expect(order.steps.every((x) => x.status === 'DONE')).toBe(true);
    } else {
      expect(order.status).toBe('REJECTED');
      expect(req.status).not.toBe('COMPLETED');
    }
  });
});

describe('M4 OTP codes in the outbox', () => {
  it('redacts sensitive bodies when a real provider delivers them; sandbox keeps them outside production', async () => {
    const t = await makeTenant();
    const saved = { smtp: config.SMTP_URL, env: config.NODE_ENV, demo: config.DEMO_MODE };
    try {
      config.SMTP_URL = 'smtp://127.0.0.1:1'; // real transport configured (unreachable → FAILED, still recorded)
      await issueOtp({ purpose: 'PASSWORD_RESET', target: 'otp@t.kz', channel: 'EMAIL', tenantId: t.tenantId, lang: 'ru' });
      const mail = await prisma.outbox.findFirstOrThrow({ where: { to: 'otp@t.kz' } });
      expect(mail.body).toBe(REDACTED_BODY);
      expect(mail.body).not.toMatch(/\d{6}/);

      config.SMTP_URL = undefined;
      config.NODE_ENV = 'production';
      config.DEMO_MODE = false;
      await issueOtp({ purpose: 'LOGIN_2FA', target: '+77015550202', channel: 'SMS', tenantId: t.tenantId, lang: 'ru' });
      expect((await prisma.outbox.findFirstOrThrow({ where: { to: '+77015550202' } })).body).toBe(REDACTED_BODY);
    } finally {
      config.SMTP_URL = saved.smtp;
      config.NODE_ENV = saved.env;
      config.DEMO_MODE = saved.demo;
    }
    // Sandbox outside production: the outbox is the delivery channel.
    await issueOtp({ purpose: 'LOGIN_2FA', target: '+77015550303', channel: 'SMS', tenantId: t.tenantId, lang: 'ru' });
    expect(await lastCode('+77015550303')).toMatch(/^\d{6}$/);
  });
});

describe('M5 HR-event documents', () => {
  it('only HR creates contracts/personnel orders; transfer effects validate ids', async () => {
    const s = await docSetup(app);
    for (const code of ['TRANSFER_ORDER', 'DISMISSAL_ORDER', 'HIRE_ORDER', 'EMPLOYMENT_CONTRACT']) {
      await expect(createDoc(s, code, { client: s.c.mgr, startRoute: false })).rejects.toThrow(/403/);
    }
    const bulk = await s.c.mgr.post('/documents/bulk', { documentTypeId: s.types.DISMISSAL_ORDER, legalEntityId: s.t.le.id, subjectEmployeeIds: [s.emp.employeeId], data: {} });
    expect(bulk.statusCode).toBe(403);
    expect((await createDoc(s, 'VACATION_ORDER', { client: s.c.mgr, startRoute: false })).id).toBeTruthy();

    const foreign = await makeTenant('Чужая');
    const newPos = await prisma.position.create({ data: { tenantId: s.t.tenantId, name: 'Ведущий' } });
    const before = await prisma.employee.findUniqueOrThrow({ where: { id: s.mgr.employeeId } });
    // mgr → manager = emp (emp reports to mgr: a cycle), department of another tenant, valid position.
    const doc = await createDoc(s, 'TRANSFER_ORDER', {
      subject: s.mgr.employeeId, startRoute: true,
      data: { departmentId: foreign.dept.id, positionId: newPos.id, managerId: s.emp.employeeId, effectiveDate: iso(1) },
    });
    const done = await s.c.hr.upload(`/documents/${doc.id}/paper-signed`, [{ filename: 'scan.pdf', content: SAMPLE_PDF, contentType: 'application/pdf' }]);
    expect(done.json().status).toBe('COMPLETED');
    const after = await prisma.employee.findUniqueOrThrow({ where: { id: s.mgr.employeeId } });
    expect(after.positionId).toBe(newPos.id);
    expect(after.departmentId).toBe(before.departmentId);
    expect(after.managerId).toBe(before.managerId);
    const comments = (await s.c.hr.get(`/documents/${doc.id}/comments`)).json() as { text: string }[];
    expect(comments.some((c) => c.text.includes('departmentId') && c.text.includes('managerId'))).toBe(true);
  });
});

describe('M6 template preview', () => {
  it('requires read access to the subject employee', async () => {
    const s = await docSetup(app);
    const { emp2, scoped } = await withSecondEntity(s);
    const templateId = (await prisma.documentType.findUniqueOrThrow({ where: { id: s.types.HIRE_ORDER } })).templateId!;
    const out = await scoped.post(`/document-templates/${templateId}/preview`, { legalEntityId: s.t.le.id, subjectEmployeeId: emp2.employeeId, data: {} });
    expect(out.statusCode).toBe(404);
    const ok = await scoped.post(`/document-templates/${templateId}/preview`, { legalEntityId: s.t.le.id, subjectEmployeeId: s.emp.employeeId, data: {} });
    expect(ok.statusCode).toBe(200);
  });
});

describe('M7 multipart limits', () => {
  it('rejects extra file parts and oversized / zip-bomb imports with 413', async () => {
    const s = await docSetup(app);
    const two = await s.c.emp.upload('/uploads', [{ filename: 'a.pdf', content: SAMPLE_PDF }, { filename: 'b.pdf', content: SAMPLE_PDF }]);
    expect(two.statusCode).toBe(413);
    const doc = await createDoc(s, 'VACATION_APPLICATION');
    expect((await s.c.hr.upload(`/documents/${doc.id}/files`, [{ filename: 'a.pdf', content: SAMPLE_PDF }, { filename: 'b.pdf', content: SAMPLE_PDF }])).statusCode).toBe(413);
    const meta = JSON.stringify(Array.from({ length: 21 }, (_, i) => ({ documentTypeId: s.types.HIRE_ORDER, legalEntityId: s.t.le.id, title: `A${i}`, registeredAt: '2020-01-01' })));
    const many = await s.c.hr.upload('/documents/archive', Array.from({ length: 21 }, (_, i) => ({ field: 'files', filename: `${i}.pdf`, content: SAMPLE_PDF })), { meta });
    expect(many.statusCode).toBe(413);

    const imp = (content: Buffer) => s.c.hr.upload('/candidates/import?dryRun=true', [{ filename: 'c.xlsx', content }], { legalEntityId: s.t.le.id });
    expect((await imp(Buffer.alloc(2 * 1024 * 1024 + 10, 1))).statusCode).toBe(413);
    const bomb = makeZip([{ name: '[Content_Types].xml', data: Buffer.from('<Types/>') }, { name: 'xl/sharedStrings.xml', data: Buffer.alloc(25 * 1024 * 1024, 0x41) }]);
    expect(bomb.length).toBeLessThan(2 * 1024 * 1024);
    expect(zipStats(bomb)).toMatchObject({ entries: 2 });
    expect((await imp(bomb)).statusCode).toBe(413);
    const lots = makeZip(Array.from({ length: 1001 }, (_, i) => ({ name: i === 0 ? '[Content_Types].xml' : `xl/f${i}.xml`, data: Buffer.from('x') })));
    expect((await imp(lots)).statusCode).toBe(413);
    // The real template passes the archive checks.
    const tpl = await buildImportTemplate();
    expect(zipStats(tpl)!.uncompressedBytes).toBeLessThan(20 * 1024 * 1024);
    expect((await imp(tpl)).statusCode).toBe(200);
  });
});

describe('P3 / L1 documents', () => {
  it('bulk create caps at 50 and reports per-employee failures', async () => {
    const s = await docSetup(app);
    const { emp2 } = await withSecondEntity(s);
    const tooMany = await s.c.hr.post('/documents/bulk', { documentTypeId: s.types.VACATION_APPLICATION, legalEntityId: s.t.le.id, subjectEmployeeIds: Array.from({ length: 51 }, () => s.emp.employeeId), data: {} });
    expect(tooMany.statusCode).toBe(400);
    const res = await s.c.hr.post('/documents/bulk', { documentTypeId: s.types.VACATION_APPLICATION, legalEntityId: s.t.le.id, subjectEmployeeIds: [s.emp.employeeId, emp2.employeeId], data: {} });
    expect(res.statusCode).toBe(201);
    expect(res.json().documentIds).toHaveLength(1);
    expect(res.json().failed).toEqual([{ employeeId: emp2.employeeId, reason: 'SUBJECT_LEGAL_ENTITY_MISMATCH' }]);
  });

  it('concurrent manual registration of the same number: one wins, the other gets 409', async () => {
    const s = await docSetup(app);
    const a = await createDoc(s, 'VACATION_ORDER', { startRoute: false });
    const b = await createDoc(s, 'VACATION_ORDER', { startRoute: false });
    const res = await Promise.all([a, b].map((d) => s.c.hr.post(`/documents/${d.id}/register`, { number: '777-о' })));
    expect(res.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(res.find((r) => r.statusCode === 409)!.json().error.code).toBe('CONFLICT');
    await expect(prisma.document.update({ where: { id: b.id }, data: { number: '777-о' } }).then(() => prisma.document.update({ where: { id: a.id }, data: { number: '777-о' } }))).rejects.toThrow();
  });
});
