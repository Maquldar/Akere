import ExcelJS from 'exceljs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db';
import { ensurePersonalDocCatalog } from '../src/modules/onboarding/service';
import { makeIin } from '../prisma/seed/kz';
import { Client, SAMPLE_PDF, createApp, makeTenant, resetDb, type TestApp } from './helpers';

let app: TestApp;
beforeAll(async () => {
  app = await createApp();
});
afterAll(() => app.close());
beforeEach(resetDb);

const iin = (n: number, male = true, year = 1994) => makeIin(new Date(Date.UTC(year, 4, 12)), male, n);
type DocType = { id: string; code: string; fields: { key: string }[] };

async function setup() {
  await ensurePersonalDocCatalog(prisma);
  const t = await makeTenant('Onb');
  const le2 = await prisma.legalEntity.create({ data: { tenantId: t.tenantId, name: 'ТОО Второе', bin: '190340104229' } });
  const dept2 = await prisma.department.create({ data: { tenantId: t.tenantId, legalEntityId: le2.id, name: 'Склад' } });
  await t.person({ email: 'admin@onb.kz', roles: [{ role: 'ADMIN' }] });
  const hrP = await t.person({ email: 'hr@onb.kz', roles: [{ role: 'HR', legalEntityId: t.le.id }], firstName: 'Жанара', lastName: 'Сулейменова' });
  await t.person({ email: 'hr2@onb.kz', roles: [{ role: 'HR', legalEntityId: le2.id }], legalEntityId: le2.id });
  await t.person({ email: 'emp@onb.kz' });
  const login = async (email: string) => {
    const c = new Client(app);
    await c.login(email);
    return c;
  };
  const [admin, hr, hr2, emp] = await Promise.all(['admin@onb.kz', 'hr@onb.kz', 'hr2@onb.kz', 'emp@onb.kz'].map(login));
  const types = (await hr!.get('/onboarding/personal-doc-types')).json() as DocType[];
  const T = (code: string) => types.find((x) => x.code === code)!;
  return { t, le2, dept2, admin: admin!, hr: hr!, hr2: hr2!, emp: emp!, hrUserId: hrP.userId, types, T };
}

const candidateBody = (legalEntityId: string, extra: Record<string, unknown> = {}) => ({
  legalEntityId, lastName: 'Сарсенов', firstName: 'Нурлан', middleName: 'Маратович', iin: iin(1), channels: ['EMAIL'], email: 'nurlan@example.kz', ...extra,
});

describe('onboarding templates', () => {
  it('serves the system catalogue and manages request templates and questionnaires', async () => {
    const { hr, emp, T, types } = await setup();
    expect(types.length).toBeGreaterThanOrEqual(19);
    await ensurePersonalDocCatalog(prisma); // idempotent
    expect(await prisma.personalDocType.count({ where: { tenantId: null } })).toBe(types.length);
    expect(T('ID_CARD').fields.some((f) => f.key === 'iin')).toBe(true);
    expect((await emp.get('/onboarding/personal-doc-types')).statusCode).toBe(403);

    const badQ = await hr.post('/onboarding/questionnaires', { name: 'Анкета', fields: [{ key: 'size', label: 'Размер', type: 'select', required: true }] });
    expect(badQ.statusCode).toBe(400);
    const q = await hr.post('/onboarding/questionnaires', { name: 'Анкета', fields: [{ key: 'emergency', label: 'Контакт ЧС', type: 'text', required: true }] });
    expect(q.statusCode).toBe(201);

    const badT = await hr.post('/onboarding/request-templates', { name: 'X', items: [{ personalDocTypeId: T('ID_CARD').id, required: true, fieldKeys: ['nope'] }] });
    expect(badT.statusCode).toBe(400);
    expect(badT.json().error.details.fieldErrors['items.0.fieldKeys']).toBeTruthy();
    const dupT = await hr.post('/onboarding/request-templates', { name: 'X', items: [{ personalDocTypeId: T('ID_CARD').id, required: true, fieldKeys: [] }, { personalDocTypeId: T('ID_CARD').id, required: false, fieldKeys: [] }] });
    expect(dupT.statusCode).toBe(400);

    const created = await hr.post('/onboarding/request-templates', {
      name: 'Стандартный', questionnaireTemplateId: q.json().id,
      items: [{ personalDocTypeId: T('ID_CARD').id, required: true, fieldKeys: ['iin', 'lastName'] }, { personalDocTypeId: T('PHOTO').id, required: true, fieldKeys: [] }],
    });
    expect(created.statusCode).toBe(201);
    const tpl = created.json();
    expect(tpl.questionnaire.name).toBe('Анкета');
    expect(tpl.items.map((i: { personalDocType: { code: string } }) => i.personalDocType.code)).toEqual(['ID_CARD', 'PHOTO']);

    const upd = await hr.patch(`/onboarding/request-templates/${tpl.id}`, { name: 'Стандартный v2', items: [{ personalDocTypeId: T('ADDRESS').id, required: true, fieldKeys: [] }] });
    expect(upd.json().items).toHaveLength(1);
    expect(upd.json().name).toBe('Стандартный v2');
    expect((await hr.get('/onboarding/request-templates')).json()).toHaveLength(1);
    expect((await hr.del(`/onboarding/request-templates/${tpl.id}`)).statusCode).toBe(204);
    expect((await hr.get(`/onboarding/request-templates/${tpl.id}`)).statusCode).toBe(404);
    expect((await hr.del(`/onboarding/questionnaires/${q.json().id}`)).statusCode).toBe(204);
  });
});

describe('candidates', () => {
  it('validates the candidate card (ИИН checksum, channels, contacts)', async () => {
    const { t, hr } = await setup();
    const noIin = await hr.post('/candidates', candidateBody(t.le.id, { iin: null }));
    expect(noIin.statusCode).toBe(400);
    expect(noIin.json().error.details.fieldErrors.iin).toBeTruthy();
    const badIin = await hr.post('/candidates', candidateBody(t.le.id, { iin: '940512300001' }));
    expect(badIin.statusCode).toBe(400);
    const noEmail = await hr.post('/candidates', candidateBody(t.le.id, { email: null }));
    expect(noEmail.json().error.details.fieldErrors.email).toBeTruthy();
    const noPhone = await hr.post('/candidates', candidateBody(t.le.id, { channels: ['SMS'] }));
    expect(noPhone.json().error.details.fieldErrors.phone).toBeTruthy();
    expect((await hr.post('/candidates', candidateBody(t.le.id, { channels: [] }))).statusCode).toBe(400);

    const ok = await hr.post('/candidates', candidateBody(t.le.id, { phone: '+7 701 555 44 33', channels: ['EMAIL', 'WHATSAPP'], tags: ['IT'] }));
    expect(ok.statusCode).toBe(201);
    const c = ok.json();
    expect(c).toMatchObject({ status: 'NEW', invitationStatus: 'NONE', docRequestStatus: 'NONE', birthDate: '1994-05-12', gender: 'MALE', phone: '+77015554433', fullName: 'Сарсенов Нурлан Маратович' });
    expect(c.responsible.fullName).toContain('Сулейменова');
    const dup = await hr.post('/candidates', candidateBody(t.le.id, { email: 'other@example.kz' }));
    expect(dup.statusCode).toBe(409);

    const foreign = await hr.post('/candidates', candidateBody(t.le.id, { iin: null, noIin: true, lastName: 'Каримов', email: 'k@example.kz' }));
    expect(foreign.statusCode).toBe(201);
    expect(foreign.json().noIin).toBe(true);

    const patched = await hr.patch(`/candidates/${c.id}`, { channels: ['SMS'], phone: null });
    expect(patched.statusCode).toBe(400);
    const p2 = await hr.patch(`/candidates/${c.id}`, { comment: 'Позвонить в понедельник', status: 'BLOCKED' });
    expect(p2.json()).toMatchObject({ comment: 'Позвонить в понедельник', status: 'BLOCKED' });
    expect((await prisma.auditLog.count({ where: { entityId: c.id, action: 'candidate.update' } }))).toBe(1);
  });

  it('lists with filters, search, sort and pagination; comments; delete rules', async () => {
    const { t, hr } = await setup();
    const names = ['Ахметов', 'Борисова', 'Валиев'];
    const ids: string[] = [];
    for (const [i, n] of names.entries()) {
      const r = await hr.post('/candidates', candidateBody(t.le.id, { lastName: n, iin: iin(10 + i, i !== 1), email: `c${i}@ex.kz`, tags: i === 2 ? ['Склад'] : [] }));
      ids.push(r.json().id);
    }
    await hr.patch(`/candidates/${ids[2]}`, { status: 'BLOCKED' });
    const page = (await hr.get('/candidates?sort=lastName&order=asc&pageSize=2')).json();
    expect(page.total).toBe(3);
    expect(page.items.map((x: { fullName: string }) => x.fullName.split(' ')[0])).toEqual(['Ахметов', 'Борисова']);
    expect((await hr.get('/candidates?status=BLOCKED')).json().total).toBe(1);
    expect((await hr.get('/candidates?status=NEW,BLOCKED')).json().total).toBe(3);
    expect((await hr.get('/candidates?q=бОрис')).json().items[0].fullName).toContain('Борисова');
    expect((await hr.get('/candidates?tag=Склад')).json().total).toBe(1);
    const today = new Date().toISOString().slice(0, 10);
    expect((await hr.get(`/candidates?updatedFrom=${today}&updatedTo=${today}`)).json().total).toBe(3);
    expect((await hr.get('/candidates?updatedTo=2020-01-01')).json().total).toBe(0);
    expect((await hr.get('/candidates?status=WRONG')).statusCode).toBe(400);

    expect((await hr.post(`/candidates/${ids[0]}/comments`, { text: '' })).statusCode).toBe(400);
    const cm = await hr.post(`/candidates/${ids[0]}/comments`, { text: 'Прошёл интервью' });
    expect(cm.statusCode).toBe(201);
    expect(cm.json().author.fullName).toContain('Сулейменова');
    expect((await hr.get(`/candidates/${ids[0]}/comments`)).json()).toHaveLength(1);
    const listed = (await hr.get('/candidates?sort=lastName&order=asc')).json().items[0];
    expect(listed.commentsCount).toBe(1);

    expect((await hr.del(`/candidates/${ids[1]}`)).statusCode).toBe(204);
    expect((await hr.del(`/candidates/${ids[2]}`)).statusCode).toBe(409); // BLOCKED, not NEW
  });

  it('enforces legal-entity scope and tenant isolation', async () => {
    const { t, le2, hr, hr2, admin, emp } = await setup();
    const c = (await hr.post('/candidates', candidateBody(t.le.id))).json();
    expect((await hr2.get(`/candidates/${c.id}`)).statusCode).toBe(404);
    expect((await hr2.patch(`/candidates/${c.id}`, { comment: 'x' })).statusCode).toBe(404);
    expect((await hr2.get('/candidates')).json().total).toBe(0);
    expect((await hr2.post('/candidates', candidateBody(t.le.id, { iin: iin(2), email: 'a@b.kz' }))).statusCode).toBe(403);
    expect((await hr.post('/candidates', candidateBody(le2.id, { iin: iin(3), email: 'b@b.kz' }))).statusCode).toBe(403);
    expect((await admin.get(`/candidates/${c.id}`)).statusCode).toBe(200);
    expect((await emp.get('/candidates')).statusCode).toBe(403);

    const other = await makeTenant('Other');
    await other.person({ email: 'admin@other.kz', roles: [{ role: 'ADMIN' }] });
    const oa = new Client(app);
    await oa.login('admin@other.kz');
    expect((await oa.get(`/candidates/${c.id}`)).statusCode).toBe(404);
    expect((await oa.get('/candidates')).json().total).toBe(0);
    expect((await oa.post('/candidates', candidateBody(t.le.id, { iin: iin(4), email: 'z@b.kz' }))).statusCode).toBe(404);
    const tpl = await prisma.requestTemplate.create({ data: { tenantId: other.tenantId, name: 'T', items: { create: [{ personalDocTypeId: (await prisma.personalDocType.findFirstOrThrow({ where: { code: 'IBAN' } })).id, fieldKeys: [] }] } } });
    const sent = (await oa.post('/candidates/request-documents', { candidateIds: [c.id], requestTemplateId: tpl.id })).json();
    expect(sent).toEqual({ sent: 0, skipped: [{ candidateId: c.id, reason: 'NOT_FOUND' }] });
  });

  it('imports candidates from the XLSX template with dry run and row-level errors', async () => {
    const { t, hr, le2 } = await setup();
    const tplRes = await hr.get('/candidates/import-template');
    expect(tplRes.statusCode).toBe(200);
    expect(tplRes.headers['content-type']).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tplRes.rawPayload as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Кандидаты')!;
    expect(ws.getRow(1).getCell(1).value).toBe('Фамилия*');
    expect(ws.getCell('G2').dataValidation?.type).toBe('list');

    const fill = (rows: (string | null)[][]) => {
      rows.forEach((r, i) => r.forEach((v, j) => (ws.getRow(i + 2).getCell(j + 1).value = v)));
    };
    // lastName, firstName, middleName, iin, noIin, birthDate, gender, channels, email, phone, tags, comment
    fill([
      ['Омаров', 'Данияр', 'Канатович', iin(21), 'Нет', '', 'Мужской', 'Email', 'omarov@ex.kz', '', 'Склад, Ночь', ''],
      ['Иванова', 'Анна', '', '123456789012', '', '', 'Женский', 'SMS', '', '87015551122', '', ''],
      ['Касымова', 'Динара', '', iin(22, false), '', '01.02.1995', 'Женский', 'Email + SMS', '', '+77015551133', '', ''],
      ['Ли', 'Виктор', '', '', 'Да', '15.03.1990', 'Мужской', 'WhatsApp', '', '+77015551144', '', 'Гражданин РФ'],
    ]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const upload = (q = '', le = t.le.id, content = buf) => hr.upload(`/candidates/import${q}`, [{ filename: 'import.xlsx', content }], { legalEntityId: le });

    const dry = await upload('?dryRun=true');
    expect(dry.statusCode).toBe(200);
    const errs = dry.json().errors as { row: number; field: string }[];
    expect(dry.json().created).toBe(0);
    expect(errs).toEqual(expect.arrayContaining([expect.objectContaining({ row: 3, field: 'iin' }), expect.objectContaining({ row: 4, field: 'email' })]));
    expect(errs.some((e) => e.row === 2 || e.row === 5)).toBe(false);
    expect((await upload()).json().created).toBe(0); // atomic: nothing created while errors remain
    expect((await upload('', le2.id)).statusCode).toBe(403);
    expect((await hr.upload('/candidates/import', [{ filename: 'x.pdf', content: SAMPLE_PDF }], { legalEntityId: t.le.id })).statusCode).toBe(415);

    ws.getRow(3).getCell(4).value = iin(23, false);
    ws.getRow(4).getCell(9).value = 'kasymova@ex.kz';
    const fixed = Buffer.from(await wb.xlsx.writeBuffer());
    const res = await upload('', t.le.id, fixed);
    expect(res.json()).toEqual({ created: 4, errors: [] });
    const omarov = await prisma.candidate.findFirstOrThrow({ where: { lastName: 'Омаров' } });
    expect(omarov.tags).toEqual(['Склад', 'Ночь']);
    expect(omarov.birthDate?.toISOString().slice(0, 10)).toBe('1994-05-12');
    const ivanova = await prisma.candidate.findFirstOrThrow({ where: { lastName: 'Иванова' } });
    expect(ivanova.phone).toBe('+77015551122');
    expect((await prisma.candidate.findFirstOrThrow({ where: { lastName: 'Ли' } })).noIin).toBe(true);
    // Re-import → duplicates by ИИН are reported
    const again = (await upload('?dryRun=true', t.le.id, fixed)).json();
    expect(again.errors.filter((e: { field: string }) => e.field === 'iin')).toHaveLength(3);
  });
});
