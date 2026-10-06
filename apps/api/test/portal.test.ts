import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db';
import { ensurePersonalDocCatalog } from '../src/modules/onboarding/service';
import { makeIin } from '../prisma/seed/kz';
import { Client, SAMPLE_PDF, SAMPLE_PNG, createApp, lastCode, makeTenant, resetDb, type TestApp } from './helpers';

let app: TestApp;
beforeAll(async () => {
  app = await createApp();
});
afterAll(() => app.close());
beforeEach(resetDb);

type Doc = { id: string; status: string; docType: { code: string }; values: Record<string, unknown>; autoFilledKeys: string[]; files: { id: string; url: string; mime: string }[] };
const iin = (n: number, male = true) => makeIin(new Date(Date.UTC(1992, 10, 3)), male, n);

async function setup() {
  await ensurePersonalDocCatalog(prisma);
  const t = await makeTenant('Portal');
  const le2 = await prisma.legalEntity.create({ data: { tenantId: t.tenantId, name: 'ТОО Второе', bin: '190340104229' } });
  const hrP = await t.person({ email: 'hr@portal.kz', roles: [{ role: 'HR', legalEntityId: t.le.id }] });
  await t.person({ email: 'hr2@portal.kz', roles: [{ role: 'HR', legalEntityId: le2.id }], legalEntityId: le2.id });
  const manager = await t.person({ email: 'boss@portal.kz', roles: [{ role: 'MANAGER' }] });
  const hr = new Client(app);
  await hr.login('hr@portal.kz');
  const hr2 = new Client(app);
  await hr2.login('hr2@portal.kz');
  const types = (await hr.get('/onboarding/personal-doc-types')).json() as { id: string; code: string }[];
  const T = (code: string) => types.find((x) => x.code === code)!.id;
  const q = (await hr.post('/onboarding/questionnaires', { name: 'Анкета', fields: [{ key: 'emergency', label: 'Контакт ЧС', type: 'text', required: true }, { key: 'kids', label: 'Дети', type: 'number', required: false }] })).json();
  const tpl = (await hr.post('/onboarding/request-templates', {
    name: 'Стандартный пакет', questionnaireTemplateId: q.id,
    items: [
      { personalDocTypeId: T('ID_CARD'), required: true, fieldKeys: [] },
      { personalDocTypeId: T('ADDRESS'), required: true, fieldKeys: [] },
      { personalDocTypeId: T('MED_075'), required: true, fieldKeys: [] },
      { personalDocTypeId: T('PHOTO'), required: true, fieldKeys: [] },
      { personalDocTypeId: T('IBAN'), required: true, fieldKeys: [] },
      { personalDocTypeId: T('MILITARY_ID'), required: false, fieldKeys: [] },
    ],
  })).json();
  return { t, le2, hr, hr2, hrUserId: hrP.userId, manager, tpl, T };
}

async function invite(hr: Client, legalEntityId: string, tplId: string, extra: Record<string, unknown> = {}) {
  const c = (await hr.post('/candidates', { legalEntityId, lastName: 'Абилова', firstName: 'Динара', middleName: 'Султановна', iin: iin(1, false), channels: ['EMAIL', 'SMS'], email: 'dinara@example.kz', phone: '+77011234567', ...extra })).json();
  const sent = await hr.post('/candidates/request-documents', { candidateIds: [c.id], requestTemplateId: tplId });
  expect(sent.json()).toEqual({ sent: 1, skipped: [] });
  return c as { id: string; email: string; phone: string };
}

async function portalLogin(login: string) {
  const p = new Client(app);
  const rc = await p.post('/portal/auth/request-code', { login });
  expect(rc.statusCode).toBe(200);
  const v = await p.post('/portal/auth/verify', { login, code: await lastCode(login.toLowerCase()) });
  expect(v.statusCode).toBe(200);
  return p;
}

const doc = (r: { documents: Doc[] }, code: string) => r.documents.find((d) => d.docType.code === code)!;

describe('candidate onboarding end to end', () => {
  it('HR request → portal OTP → autofill 511 → submit → RETURN → resubmit → ACCEPT → hire → export', async () => {
    const { t, hr, hr2, hrUserId, manager, tpl } = await setup();
    const c = await invite(hr, t.le.id, tpl.id);
    let detail = (await hr.get(`/candidates/${c.id}`)).json();
    expect(detail).toMatchObject({ status: 'IN_PROGRESS', invitationStatus: 'SENT', docRequestStatus: 'SENT' });
    const invites = await prisma.outbox.findMany({ where: { to: { in: [c.email, c.phone] } } });
    expect(invites.map((m) => m.channel).sort()).toEqual(['EMAIL', 'SMS']);
    expect(invites.find((m) => m.channel === 'EMAIL')!.body).toContain('/ru/portal?login=dinara%40example.kz');
    expect((await hr.post('/candidates/request-documents', { candidateIds: [c.id], requestTemplateId: tpl.id })).json().skipped[0].reason).toBe('REQUEST_IN_PROGRESS');
    expect((await hr.post(`/candidates/${c.id}/resend-invite`)).statusCode).toBe(204);
    expect((await hr.del(`/candidates/${c.id}`)).statusCode).toBe(409);

    // Portal login by phone uses the SMS channel; the code is single-use.
    const p = new Client(app);
    const rc = (await p.post('/portal/auth/request-code', { login: '8 701 123 45 67' })).json();
    expect(rc).toEqual({ channel: 'SMS', maskedTarget: '+770*****67' });
    expect((await p.post('/portal/auth/verify', { login: '+77011234567', code: '000000' })).statusCode).toBe(400);
    const code = await lastCode('+77011234567');
    const me = await p.post('/portal/auth/verify', { login: '+77011234567', code });
    expect(me.json()).toMatchObject({ candidateId: c.id, fullName: 'Абилова Динара Султановна', legalEntity: 'ТОО Portal', locale: 'ru' });
    expect((await new Client(app).post('/portal/auth/verify', { login: '+77011234567', code })).statusCode).toBe(400);
    expect((await hr.get(`/candidates/${c.id}`)).json().invitationStatus).toBe('ACCEPTED');
    expect((await p.get('/candidates')).statusCode).toBe(401); // candidate session is not a staff session

    let req = (await p.get('/portal/request')).json();
    expect(req.documents).toHaveLength(6);
    expect(req.questionnaire.fields).toHaveLength(2);

    const missing = await p.post('/portal/request/submit');
    expect(missing.statusCode).toBe(422);
    expect(missing.json().error.details.rule).toBe('REQUIRED_MISSING');
    const codes = missing.json().error.details.missing.map((m: { code: string }) => m.code);
    expect(codes).toEqual(expect.arrayContaining(['ID_CARD', 'ADDRESS', 'MED_075', 'PHOTO', 'IBAN', 'emergency']));
    expect(codes).not.toContain('MILITARY_ID');

    // Autofill: consent SMS (RU + KZ), reply 511.
    expect((await p.post('/portal/request/autofill/reply', { reply: '511' })).statusCode).toBe(409);
    const consent = (await p.post('/portal/request/autofill/consent')).json();
    expect(consent.status).toBe('REQUESTED');
    expect(consent.smsPreview).toContain('511');
    expect(consent.smsPreview).toContain('512');
    expect(consent.smsPreview).toContain('ЖСН');
    req = (await p.post('/portal/request/autofill/reply', { reply: '511' })).json();
    expect(req.consentStatus).toBe('GRANTED');
    const idCard = doc(req, 'ID_CARD');
    expect(idCard.values).toMatchObject({ iin: iin(1, false), lastName: 'Абилова', birthDate: '1992-11-03', gender: 'Женский', citizenship: 'Республика Казахстан' });
    expect(idCard.autoFilledKeys).toContain('docNumber');
    expect(idCard.status).toBe('FILLED');
    expect(idCard.files[0]!.url).toBe(`/api/v1/portal/files/${idCard.files[0]!.id}`);
    expect(idCard.files[0]!.mime).toBe('application/pdf');
    expect(doc(req, 'PHOTO').files[0]!.mime).toBe('image/png');
    expect(doc(req, 'ADDRESS').values.country).toBe('Казахстан');
    expect(doc(req, 'IBAN').status).toBe('PENDING');
    expect((await hr.get(`/candidates/${c.id}`)).json().docRequestStatus).toBe('FILLING');
    const pdf = await p.get(idCard.files[0]!.url);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');

    // Manual fields with validation; editing an auto-filled key drops its marker.
    const bad = await p.patch(`/portal/request/documents/${doc(req, 'IBAN').id}`, { values: { bank: 'Kaspi', foo: 'x' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.details.fieldErrors['values.foo']).toBeTruthy();
    const iban = await p.patch(`/portal/request/documents/${doc(req, 'IBAN').id}`, { values: { bank: 'АО «Kaspi Bank»', iban: 'KZ86125KZT5004100100', bic: 'CASPKZKA' } });
    expect(iban.json().status).toBe('FILLED');
    const edited = await p.patch(`/portal/request/documents/${idCard.id}`, { values: { birthPlace: 'г. Тараз' } });
    expect(edited.json().autoFilledKeys).not.toContain('birthPlace');
    expect((await p.patch('/portal/request/questionnaire', { answers: { kids: 'many' } })).statusCode).toBe(400);
    expect((await p.patch('/portal/request/questionnaire', { answers: { emergency: 'Абилов Султан, +77019998877', kids: 2 } })).json().questionnaireAnswers).toEqual({ emergency: 'Абилов Султан, +77019998877', kids: 2 });

    const submitted = await p.post('/portal/request/submit');
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json().status).toBe('UPLOADED');
    detail = (await hr.get(`/candidates/${c.id}`)).json();
    expect(detail).toMatchObject({ docRequestStatus: 'UPLOADED', checkStatus: 'ON_REVIEW' });
    expect(await prisma.notification.count({ where: { userId: hrUserId, type: 'candidate.submitted' } })).toBe(1);
    expect((await p.patch(`/portal/request/documents/${doc(req, 'IBAN').id}`, { values: { bic: 'X' } })).statusCode).toBe(409);

    // HR review: RETURN needs a comment and documents.
    let hrReq = (await hr.get(`/candidates/${c.id}/request`)).json();
    expect(hrReq.documents[0].files[0].url).toMatch(/^\/api\/v1\/files\//);
    expect((await hr.get(hrReq.documents[0].files[0].url)).statusCode).toBe(200);
    expect((await hr2.get(hrReq.documents[0].files[0].url)).statusCode).toBe(404);
    expect((await hr2.get(`/candidates/${c.id}/request`)).statusCode).toBe(404);
    expect((await hr.post(`/candidates/${c.id}/request/review`, { decision: 'RETURN' })).statusCode).toBe(400);
    const addressId = doc(hrReq, 'ADDRESS').id;
    const ret = await hr.post(`/candidates/${c.id}/request/review`, { decision: 'RETURN', comment: 'Уточните номер квартиры', returnDocIds: [addressId] });
    expect(ret.json()).toMatchObject({ docRequestStatus: 'RETURNED', status: 'IN_PROGRESS' });
    expect((await prisma.outbox.findFirst({ where: { to: c.email }, orderBy: { createdAt: 'desc' } }))!.body).toContain('Уточните номер квартиры');

    req = (await p.get('/portal/request')).json();
    expect(req.status).toBe('RETURNED');
    expect(doc(req, 'ADDRESS')).toMatchObject({ status: 'RETURNED', returnComment: 'Уточните номер квартиры' });
    expect((await p.patch(`/portal/request/documents/${doc(req, 'IBAN').id}`, { values: { bic: 'X' } })).statusCode).toBe(409);
    expect((await p.patch(`/portal/request/documents/${addressId}`, { values: { apartment: '42' } })).statusCode).toBe(200);
    expect((await p.post('/portal/request/submit')).json().status).toBe('UPLOADED');

    // HR fixes a field and accepts.
    expect((await hr.patch(`/candidates/${c.id}/request/documents/${doc(hrReq, 'MED_075').id}`, { values: { conclusion: 'Годен' } })).json().values.conclusion).toBe('Годен');
    const hrFile = await hr.upload(`/candidates/${c.id}/request/documents/${doc(hrReq, 'MILITARY_ID').id}/files`, [{ filename: 'voen.pdf', content: SAMPLE_PDF }]);
    expect(hrFile.statusCode).toBe(201);
    const acc = await hr.post(`/candidates/${c.id}/request/review`, { decision: 'ACCEPT', checkStatus: 'RECOMMENDED' });
    expect(acc.json()).toMatchObject({ status: 'ACCEPTED', docRequestStatus: 'COMPLETED', checkStatus: 'RECOMMENDED' });
    hrReq = (await hr.get(`/candidates/${c.id}/request`)).json();
    expect(hrReq.documents.every((d: Doc) => d.status === 'ACCEPTED')).toBe(true);
    expect((await hr.post(`/candidates/${c.id}/request/review`, { decision: 'ACCEPT' })).statusCode).toBe(409);

    // Export (default selection = ACCEPTED) without marking.
    const json = await hr.post('/candidates/export', { format: 'json', markExported: false });
    expect(json.headers['content-disposition']).toContain('attachment');
    const rec = json.json().candidates[0];
    expect(rec).toMatchObject({ iin: iin(1, false), birthDate: '1992-11-03', gender: 'FEMALE', email: 'dinara@example.kz' });
    expect(rec.address).toContain('кв. 42');
    expect(rec.idDocument.type).toBe('Удостоверение личности гражданина РК');
    expect(rec.iban.iban).toBe('KZ86125KZT5004100100');
    const xml = await hr.post('/candidates/export', { format: 'xml', markExported: false, candidateIds: [c.id] });
    expect(xml.body).toContain('<Iin>');
    const xlsx = await hr.post('/candidates/export', { format: 'xlsx', markExported: true, candidateIds: [c.id] });
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    detail = (await hr.get(`/candidates/${c.id}`)).json();
    expect(detail.status).toBe('EXPORTED');
    expect(detail.exportedAt).toBeTruthy();

    // Hire.
    const badHire = await hr.post(`/candidates/${c.id}/hire`, { legalEntityId: t.le.id, departmentId: t.dept.id, positionId: t.position.id, hireDate: '2026-11-01', salary: -1, generateDocuments: false });
    expect(badHire.statusCode).toBe(400);
    const hired = await hr.post(`/candidates/${c.id}/hire`, {
      legalEntityId: t.le.id, departmentId: t.dept.id, positionId: t.position.id, managerId: manager.employeeId, hireDate: '2026-11-01', salary: 450000, probationMonths: 3, generateDocuments: false,
    });
    expect(hired.statusCode).toBe(201);
    expect(hired.json().documentIds).toEqual(expect.any(Array));
    const emp = await prisma.employee.findUniqueOrThrow({ where: { id: hired.json().employeeId }, include: { user: { include: { roles: true } } } });
    expect(emp).toMatchObject({ iin: iin(1, false), gender: 'FEMALE', tabNumber: '000004', managerId: manager.employeeId });
    expect(emp.birthDate?.toISOString().slice(0, 10)).toBe('1992-11-03');
    expect(emp.photoFileId).toBe(doc(hrReq, 'PHOTO').files[0]!.id);
    expect((emp.personal as { address: string; citizenship: string }).citizenship).toBe('Республика Казахстан');
    expect(emp.user.email).toBe('dinara@example.kz');
    expect(emp.user.roles.map((r) => r.role)).toEqual(['EMPLOYEE']);
    expect((await hr.get(`/candidates/${c.id}`)).json().employeeId).toBe(emp.id);
    expect((await hr.post(`/candidates/${c.id}/hire`, { legalEntityId: t.le.id, departmentId: t.dept.id, positionId: t.position.id, hireDate: '2026-11-01', salary: 1, generateDocuments: false })).statusCode).toBe(409);
    expect((await p.get('/portal/me')).statusCode).toBe(401); // portal access ends after hire
    expect(await prisma.auditLog.count({ where: { entityId: c.id, action: { startsWith: 'candidate.' } } })).toBeGreaterThan(5);
  });

  it('keeps candidates isolated: no enumeration, own files only, NO_IIN, deny 512, blocked', async () => {
    const { t, hr, tpl } = await setup();
    const unknown = await new Client(app).post('/portal/auth/request-code', { login: 'ghost@example.kz' });
    expect(unknown.json()).toEqual({ channel: 'EMAIL', maskedTarget: 'gh***@example.kz' });
    expect(await prisma.outbox.count({ where: { to: 'ghost@example.kz' } })).toBe(0);
    expect((await new Client(app).get('/portal/request')).statusCode).toBe(401);

    const a = await invite(hr, t.le.id, tpl.id);
    const b = await invite(hr, t.le.id, tpl.id, { lastName: 'Ли', firstName: 'Виктор', middleName: null, iin: null, noIin: true, channels: ['EMAIL'], email: 'lee@example.kz', phone: null });
    const pa = await portalLogin(a.email);
    const pb = await portalLogin('LEE@example.kz');

    const reqA = (await pa.get('/portal/request')).json();
    const up = await pa.upload(`/portal/request/documents/${doc(reqA, 'PHOTO').id}/files`, [{ filename: 'me.png', content: SAMPLE_PNG }]);
    expect(up.statusCode).toBe(201);
    const fileUrl = up.json().url as string;
    expect(fileUrl).toMatch(/^\/api\/v1\/portal\/files\//);
    expect((await pa.upload(`/portal/request/documents/${doc(reqA, 'PHOTO').id}/files`, [{ filename: 'x.exe', content: Buffer.from('MZ fake binary') }])).statusCode).toBe(415);
    expect((await pa.get(fileUrl)).statusCode).toBe(200);
    expect((await pa.get(`/files/${up.json().id}`)).statusCode).toBe(200); // generic route via the registered checker
    expect((await pb.get(fileUrl)).statusCode).toBe(404);
    expect((await pb.get(`/files/${up.json().id}`)).statusCode).toBe(404);
    expect((await pb.patch(`/portal/request/documents/${doc(reqA, 'IBAN').id}`, { values: { bank: 'x' } })).statusCode).toBe(404);
    expect((await pb.del(`/portal/request/documents/${doc(reqA, 'PHOTO').id}/files/${up.json().id}`)).statusCode).toBe(404);
    expect((await pa.del(`/portal/request/documents/${doc(reqA, 'PHOTO').id}/files/${up.json().id}`)).statusCode).toBe(204);
    expect((await pa.get(fileUrl)).statusCode).toBe(404);
    expect((await hr.get(`/candidates/${a.id}`)).json().docRequestStatus).toBe('FILLING');

    const noIin = await pb.post('/portal/request/autofill/consent');
    expect(noIin.statusCode).toBe(422);
    expect(noIin.json().error.details.rule).toBe('NO_IIN');

    await pa.post('/portal/request/autofill/consent');
    const denied = (await pa.post('/portal/request/autofill/reply', { reply: '512' })).json();
    expect(denied.consentStatus).toBe('DENIED');
    expect(doc(denied, 'ID_CARD').values).toEqual({});

    // REJECT blocks the candidate and ends the portal session.
    const rej = await hr.post(`/candidates/${b.id}/request/review`, { decision: 'REJECT', comment: 'Не прошёл проверку' });
    expect(rej.json()).toMatchObject({ status: 'BLOCKED', checkStatus: 'NOT_RECOMMENDED' });
    expect((await pb.get('/portal/me')).statusCode).toBe(401);
    await new Client(app).post('/portal/auth/request-code', { login: 'lee@example.kz' });
    expect(await prisma.otpCode.count({ where: { target: 'lee@example.kz' } })).toBe(1); // no new code for a blocked candidate

    // Hire is only possible for accepted candidates.
    const h = await hr.post(`/candidates/${a.id}/hire`, { legalEntityId: t.le.id, departmentId: t.dept.id, positionId: t.position.id, hireDate: '2026-11-01', salary: 1, generateDocuments: false });
    expect(h.statusCode).toBe(422);
    expect(h.json().error.details.rule).toBe('CANDIDATE_NOT_ACCEPTED');
  });

  it('rate limits portal code requests', async () => {
    const { t, hr, tpl } = await setup();
    const c = await invite(hr, t.le.id, tpl.id, { email: 'flood@example.kz', iin: iin(7, false) });
    const p = new Client(app);
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await p.post('/portal/auth/request-code', { login: c.email })).statusCode);
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses[6]).toBe(429);
  });
});
