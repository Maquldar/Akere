import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db';
import { storage } from '../src/adapters/storage';
import { setSigningPin, signBytes, verifyBytes } from '../src/adapters/signing';
import { createApp, resetDb, type TestApp } from './helpers';
import { createDoc, docSetup, qrSign } from './documents-fixtures';

let app: TestApp;
beforeAll(async () => {
  app = await createApp();
});
afterAll(() => app.close());
beforeEach(resetDb);

const tokenOf = (qrUrl: string) => new URL(qrUrl).pathname.split('/').pop()!;

describe('signing sessions', () => {
  it('signs via the eGov mobile QR flow and verifies the signature', async () => {
    const s = await docSetup(app);
    const doc = await createDoc(s, 'HIRE_ORDER');
    const created = await s.c.ceo.post('/signing/sessions', { documentIds: [doc.id], method: 'EGOV_MOBILE' });
    expect(created.statusCode).toBe(201);
    const session = created.json();
    expect(session).toMatchObject({ method: 'EGOV_MOBILE', status: 'PENDING', documentIds: [doc.id], signedCount: 0 });
    expect(session.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(session.qrUrl).toMatch(/\/ru\/sign\/[\w-]{20,}$/);
    expect(new Date(session.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(5 * 60_000);
    const token = tokenOf(session.qrUrl);
    expect(await prisma.signingSession.count({ where: { tokenHash: token } })).toBe(0); // stored hashed

    expect((await s.c.hr.get(`/signing/qr/${token}`)).statusCode).toBe(404); // another user's session
    const page = (await s.c.ceo.get(`/signing/qr/${token}`)).json();
    expect(page.documents).toEqual([{ id: doc.id, title: doc.title, number: doc.number }]);

    const confirmed = await s.c.ceo.post(`/signing/qr/${token}/confirm`, { decision: 'SIGN' });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({ status: 'COMPLETED', signedCount: 1, qrDataUrl: null });
    expect((await s.c.ceo.get(`/signing/sessions/${session.id}`)).json().status).toBe('COMPLETED');
    expect((await s.c.ceo.post(`/signing/qr/${token}/confirm`, { decision: 'SIGN' })).statusCode).toBe(409);

    const sig = await prisma.signature.findFirstOrThrow({ where: { documentId: doc.id } });
    expect(sig.method).toBe('EGOV_MOBILE');
    expect(sig.docHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sig.certSubject).toContain('CN=Директоров Тимур');
    const key = await prisma.userKey.findUniqueOrThrow({ where: { userId: s.ceo.userId } });
    expect(key.encPrivateKey).not.toContain('PRIVATE KEY');

    // Employee acknowledges, then the full verification passes; tampering with the PDF breaks it.
    expect((await qrSign(s.c.emp, [doc.id])).statusCode).toBe(200);
    const ok = (await s.c.hr.get(`/documents/${doc.id}/signatures/verify`)).json();
    expect(ok.valid).toBe(true);
    expect(ok.signatures.map((x: { signer: { id: string }; valid: boolean }) => [x.signer.id, x.valid])).toEqual([[s.ceo.userId, true], [s.emp.userId, true]]);
    const d = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } });
    const file = await prisma.storedFile.findUniqueOrThrow({ where: { id: d.pdfFileId! } });
    const bytes = await storage.get(file.key);
    const tampered = Buffer.from(bytes);
    const i = tampered.length - 20;
    tampered[i] = tampered[i]! ^ 0xff;
    await storage.put(file.key, tampered, file.mime);
    const bad = (await s.c.hr.get(`/documents/${doc.id}/signatures/verify`)).json();
    expect(bad.valid).toBe(false);
    expect(bad.signatures.every((x: { valid: boolean }) => !x.valid)).toBe(true);
  });

  it('refuses sessions without pending steps and EGOV_BUSINESS without signing authority', async () => {
    const s = await docSetup(app);
    const doc = await createDoc(s, 'EMPLOYMENT_CONTRACT');
    const none = await s.c.emp.post('/signing/sessions', { documentIds: [doc.id], method: 'EGOV_MOBILE' }); // employee step still WAITING
    expect(none.statusCode).toBe(422);
    expect(none.json().error.details.rule).toBe('NOTHING_TO_SIGN');
    expect((await s.c.other.post('/signing/sessions', { documentIds: [doc.id], method: 'EGOV_MOBILE' })).json().error.details.rule).toBe('NOTHING_TO_SIGN');
    await qrSign(s.c.ceo, [doc.id], 'EGOV_BUSINESS');
    const biz = await s.c.emp.post('/signing/sessions', { documentIds: [doc.id], method: 'EGOV_BUSINESS' });
    expect(biz.statusCode).toBe(422);
    expect(biz.json().error.details.rule).toBe('NOT_SIGNATORY');
    // Declining cancels the session and leaves the step pending.
    const sess = (await s.c.emp.post('/signing/sessions', { documentIds: [doc.id], method: 'EGOV_MOBILE' })).json();
    const declined = (await s.c.emp.post(`/signing/qr/${tokenOf(sess.qrUrl)}/confirm`, { decision: 'DECLINE' })).json();
    expect(declined.status).toBe('CANCELLED');
    expect((await s.c.emp.get(`/documents/${doc.id}`)).json().myPendingAction).toBe('SIGN');
    // Expired sessions cannot be confirmed.
    const late = (await s.c.emp.post('/signing/sessions', { documentIds: [doc.id], method: 'EGOV_MOBILE' })).json();
    await prisma.signingSession.update({ where: { id: late.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await s.c.emp.post(`/signing/qr/${tokenOf(late.qrUrl)}/confirm`, { decision: 'SIGN' })).json().error.details.rule).toBe('SESSION_EXPIRED');
    expect((await s.c.emp.get(`/signing/sessions/${late.id}`)).json().status).toBe('EXPIRED');
  });

  it('signs in bulk with NCALayer after checking the PIN', async () => {
    const s = await docSetup(app);
    const a = await createDoc(s, 'HIRE_ORDER');
    const b = await createDoc(s, 'TRANSFER_ORDER', { data: { effectiveDate: '2026-11-01', reason: 'Заявление' } });
    const sess = (await s.c.ceo.post('/signing/sessions', { documentIds: [a.id, b.id], method: 'NCALAYER' })).json();
    expect(sess.qrUrl).toBeNull();
    const wrong = await s.c.ceo.post(`/signing/sessions/${sess.id}/ncalayer`, { pin: '000000' });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json().error.details.rule).toBe('INVALID_PIN');
    const ok = await s.c.ceo.post(`/signing/sessions/${sess.id}/ncalayer`, { pin: '123456' });
    expect(ok.json()).toMatchObject({ status: 'COMPLETED', signedCount: 2 });
    expect((await s.c.emp.get('/me/inbox-counts')).json().documents).toBe(2);

    await setSigningPin(s.emp.userId, '4321');
    const s2 = (await s.c.emp.post('/signing/sessions', { documentIds: [a.id], method: 'NCALAYER' })).json();
    expect((await s.c.emp.post(`/signing/sessions/${s2.id}/ncalayer`, { pin: '123456' })).statusCode).toBe(422);
    expect((await s.c.emp.post(`/signing/sessions/${s2.id}/ncalayer`, { pin: '4321' })).json().signedCount).toBe(1);
    expect((await s.c.hr.get(`/documents/${a.id}`)).json().status).toBe('COMPLETED');
    expect((await s.c.emp.post(`/signing/sessions/${s2.id}/cancel`)).statusCode).toBe(204);
  });

  it('adapter signatures verify only against the exact bytes', async () => {
    const s = await docSetup(app);
    const bytes = Buffer.from('%PDF-1.4 test document');
    const sig = await signBytes(s.hr.userId, bytes, { fullName: 'Кадрова Жанара', iin: '900101400123', method: 'EGOV_MOBILE' });
    expect(verifyBytes(bytes, sig)).toBe(true);
    expect(verifyBytes(Buffer.from('%PDF-1.4 test documenT'), sig)).toBe(false);
    expect(verifyBytes(bytes, { ...sig, signatureB64: Buffer.from('x').toString('base64') })).toBe(false);
  });
});
