import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { prisma } from '../src/lib/db';
import { buildTemplateContext, formatDateRu, formatMoney, renderTemplatePdf, renderText } from '../src/lib/templates';
import { formatNumber } from '../src/modules/documents/numbering';
import { SAMPLE_PDF, SAMPLE_PNG, createApp, resetDb, type TestApp } from './helpers';
import { createDoc, docSetup } from './documents-fixtures';

let app: TestApp;
beforeAll(async () => {
  app = await createApp();
});
afterAll(() => app.close());
beforeEach(resetDb);

describe('template rendering', () => {
  it('formats RU dates, money and number patterns', () => {
    expect(formatDateRu('2026-10-06')).toBe('06 октября 2026 г.');
    expect(formatDateRu(new Date('2027-01-01T00:00:00Z'))).toBe('01 января 2027 г.');
    expect(formatMoney(450000)).toBe('450 000 ₸');
    expect(formatMoney(1234567.5)).toBe('1 234 567,50 ₸');
    expect(formatNumber('{seq}-{MM}/{YY}', 12, new Date('2024-06-03T00:00:00Z'))).toBe('12-06/24');
    expect(formatNumber('ТД-{seq}/{YYYY}', 3, new Date('2026-10-06T00:00:00Z'))).toBe('ТД-3/2026');
  });

  it('fills variables from the legal entity, employee, document and data', async () => {
    const s = await docSetup(app);
    const ctx = await buildTemplateContext({
      legalEntityId: s.t.le.id, subjectEmployeeId: s.emp.employeeId, authorUserId: s.hr.userId,
      document: { number: '5-к/26', registeredAt: new Date('2026-10-06T00:00:00Z') }, data: { salary: 350000, startDate: '2026-11-02', flag: true },
    });
    expect(renderText('{{legalEntity.name}}, БИН {{legalEntity.bin}}, {{legalEntity.directorShort}}', ctx)).toBe(`${s.t.le.name}, БИН ${s.t.le.bin}, Директоров Т.Е.`);
    expect(renderText('{{employee.fullName}} таб. {{employee.tabNumber}} с {{employee.hireDate}}', ctx)).toBe(`Работникова Әлия таб. ${ctx.employee!.tabNumber} с 10 января 2024 г.`);
    expect(renderText('№ {{document.number}} от {{document.date}}; {{data.salary|money}}; {{data.startDate}} / {{data.startDate|short}}; {{data.flag}}', ctx))
      .toBe('№ 5-к/26 от 06 октября 2026 г.; 350 000 ₸; 02 ноября 2026 г. / 02.11.2026; Да');
    expect(renderText('Отпуск с {{data.startDate}}.', ctx)).toBe('Отпуск с 02 ноября 2026 г.');
    expect(renderText('{{data.missing}}|{{data.missing|optional}}|{{author.fullName}}', ctx)).toBe('________||Кадрова Жанара');
    const pdf = await renderTemplatePdf([{ type: 'heading', text: 'Договор {{document.number}}' }, { type: 'paragraph', text: 'Оклад {{data.salary|money}}' }], ctx);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
  });
});

describe('configuration endpoints', () => {
  it('manages templates with preview and exposes variables', async () => {
    const s = await docSetup(app);
    const vars = (await s.c.mgr.get('/document-templates/variables')).json();
    expect(vars.some((v: { key: string }) => v.key === 'employee.iin')).toBe(true);
    expect((await s.c.mgr.get('/document-templates')).statusCode).toBe(403);
    const bad = await s.c.hr.post('/document-templates', { name: 'X', body: [{ type: 'unknown' }] });
    expect(bad.statusCode).toBe(400);
    const tpl = await s.c.hr.post('/document-templates', {
      name: 'Справка с места работы',
      body: [{ type: 'heading', text: 'СПРАВКА' }, { type: 'paragraph', text: 'Дана {{employee.fullName}} в том, что работает в {{legalEntity.name}}.' }, { type: 'fields', rows: [{ label: 'Должность', value: '{{employee.position}}' }] }, { type: 'spacer' }, { type: 'signatures', parties: [{ label: 'Руководитель', name: '{{legalEntity.director}}' }] }],
    });
    expect(tpl.statusCode).toBe(201);
    const patched = await s.c.hr.patch(`/document-templates/${tpl.json().id}`, { name: 'Справка' });
    expect(patched.json().name).toBe('Справка');
    const preview = await s.c.hr.post(`/document-templates/${tpl.json().id}/preview`, { legalEntityId: s.t.le.id, subjectEmployeeId: s.emp.employeeId, data: {} });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['content-type']).toBe('application/pdf');
    expect(preview.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('manages route templates and document types; routes in use cannot be deleted', async () => {
    const s = await docSetup(app);
    expect((await s.c.hr.post('/route-templates', { name: 'R', steps: [{ order: 1, action: 'SIGN', rule: 'USER' }] })).statusCode).toBe(400);
    const r = (await s.c.hr.post('/route-templates', { name: 'Одна подпись', steps: [{ order: 1, action: 'SIGN', rule: 'SIGNATORY', dueDays: 1 }] })).json();
    expect(r.usedBy).toBe(0);
    const type = (await s.c.hr.post('/document-types', { code: 'CERT', name: 'Справка', kind: 'GENERIC', numberPattern: 'С-{seq}', routeTemplateId: r.id, esutdRequired: false, isActive: true })).json();
    expect(type.routeTemplate).toEqual({ id: r.id, name: 'Одна подпись' });
    expect((await s.c.hr.post('/document-types', { code: 'CERT', name: 'Дубль', kind: 'GENERIC', numberPattern: '{seq}', esutdRequired: false, isActive: true })).statusCode).toBe(409);
    expect((await s.c.hr.post('/document-types', { code: 'BAD', name: 'Без seq', kind: 'GENERIC', numberPattern: 'N-1' })).statusCode).toBe(400);
    expect((await s.c.hr.del(`/route-templates/${r.id}`)).statusCode).toBe(409);
    expect((await s.c.mgr.get('/document-types?kind=GENERIC')).json().map((t: { code: string }) => t.code)).toEqual(['CERT']);
    await s.c.hr.patch(`/document-types/${type.id}`, { isActive: false, routeTemplateId: null });
    expect((await s.c.hr.get('/document-types?active=false')).json()).toHaveLength(1);
    expect((await s.c.hr.del(`/route-templates/${r.id}`)).statusCode).toBe(204);
    expect((await s.c.hr.post('/documents', { documentTypeId: type.id, legalEntityId: s.t.le.id, data: {}, startRoute: false })).json().error.details.rule).toBe('DOCUMENT_TYPE_INACTIVE');
  });
});

describe('document card', () => {
  it('handles attachments with versions, comments, links, cancel and draft deletion', async () => {
    const s = await docSetup(app);
    const doc = await createDoc(s, 'HIRE_ORDER');
    const contract = await createDoc(s, 'EMPLOYMENT_CONTRACT', { startRoute: false });

    const f1 = await s.c.hr.upload(`/documents/${doc.id}/files`, [{ filename: 'приложение.pdf', content: SAMPLE_PDF }]);
    expect(f1.statusCode).toBe(201);
    expect(f1.json()).toMatchObject({ name: 'приложение.pdf', currentVersion: 1 });
    const f2 = await s.c.hr.upload(`/documents/${doc.id}/files`, [{ filename: 'v2.png', content: SAMPLE_PNG }], { documentFileId: f1.json().id });
    expect(f2.json().currentVersion).toBe(2);
    expect(f2.json().versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect((await s.c.other.upload(`/documents/${doc.id}/files`, [{ filename: 'x.pdf', content: SAMPLE_PDF }])).statusCode).toBe(404);
    expect((await s.c.hr.upload(`/documents/${doc.id}/files`, [{ filename: 'x.txt', content: Buffer.from('hello') }])).statusCode).toBe(415);
    const fileId = f2.json().versions[0].file.id;
    expect((await s.c.emp.get(`/files/${fileId}`)).statusCode).toBe(200);
    expect((await s.c.hr.get(`/documents/${doc.id}/files`)).json()).toHaveLength(1);

    const cm = await s.c.emp.post(`/documents/${doc.id}/comments`, { text: 'Ознакомлюсь завтра' });
    expect(cm.statusCode).toBe(201);
    expect((await s.c.hr.get(`/documents/${doc.id}/comments`)).json()[0]).toMatchObject({ text: 'Ознакомлюсь завтра', author: { id: s.emp.userId } });

    const link = await s.c.hr.post(`/documents/${doc.id}/links`, { toId: contract.id, relation: 'BASED_ON' });
    expect(link.statusCode).toBe(201);
    expect((await s.c.hr.post(`/documents/${doc.id}/links`, { toId: contract.id, relation: 'BASED_ON' })).statusCode).toBe(409);
    const detail = (await s.c.hr.get(`/documents/${contract.id}`)).json();
    expect(detail.links).toEqual([{ id: link.json().id, relation: 'BASED_ON', direction: 'to', document: { id: doc.id, title: doc.title, number: doc.number, status: 'IN_ROUTE' } }]);
    expect(detail.commentsCount).toBe(0);
    expect((await s.c.hr.del(`/documents/${doc.id}/links/${link.json().id}`)).statusCode).toBe(204);

    expect((await s.c.hr.del(`/documents/${doc.id}`)).statusCode).toBe(409);
    const cancelled = (await s.c.hr.post(`/documents/${doc.id}/cancel`, { reason: 'Ошибка в данных' })).json();
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.steps.every((x: { status: string }) => x.status === 'SKIPPED')).toBe(true);
    expect((await s.c.ceo.get('/me/inbox-counts')).json().documents).toBe(0);
    expect((await s.c.hr.del(`/documents/${contract.id}`)).statusCode).toBe(204);
    expect(await prisma.document.count({ where: { id: contract.id } })).toBe(0);
  });
});
