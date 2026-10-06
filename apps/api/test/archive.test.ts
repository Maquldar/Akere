import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db';
import { ensureDocumentType } from '../src/modules/documents/defaults';
import { SAMPLE_PDF, SAMPLE_PNG, createApp, resetDb, type TestApp } from './helpers';
import { createDoc, docSetup } from './documents-fixtures';

let app: TestApp;
beforeAll(async () => {
  app = await createApp();
});
afterAll(() => app.close());
beforeEach(resetDb);

describe('electronic archive', () => {
  it('registers paper documents with per-item errors and does not shadow /documents/:id', async () => {
    const s = await docSetup(app);
    const archiveType = (await ensureDocumentType(s.t.tenantId, 'ARCHIVE')).id;
    const meta = [
      { documentTypeId: s.types.EMPLOYMENT_CONTRACT, legalEntityId: s.t.le.id, title: 'Трудовой договор (бумажный оригинал)', number: 'ТД-7/2019', registeredAt: '2019-08-05', subjectEmployeeId: s.emp.employeeId },
      { documentTypeId: archiveType, legalEntityId: s.t.le.id, title: 'Приказ о приёме (скан)', registeredAt: '2018-04-02' },
      { documentTypeId: archiveType, legalEntityId: s.t.le.id, registeredAt: '2018-04-02' }, // no title
      { documentTypeId: s.types.EMPLOYMENT_CONTRACT, legalEntityId: s.t.le.id, title: 'Дубликат номера', number: 'ТД-7/2019', registeredAt: '2019-09-01' },
      { documentTypeId: archiveType, legalEntityId: s.t.le.id, title: 'Из будущего', registeredAt: '2999-01-01' },
    ];
    const res = await s.c.hr.upload('/documents/archive', [
      { field: 'files', filename: 'td-7.pdf', content: SAMPLE_PDF },
      { field: 'files', filename: 'order.png', content: SAMPLE_PNG },
      { field: 'files', filename: 'x.pdf', content: SAMPLE_PDF },
      { field: 'files', filename: 'dup.pdf', content: SAMPLE_PDF },
      { field: 'files', filename: 'future.pdf', content: SAMPLE_PDF },
    ], { meta: JSON.stringify(meta) });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.documentIds).toHaveLength(2);
    expect(body.errors.map((e: { index: number }) => e.index)).toEqual([2, 3, 4]);
    expect(body.errors[0].message).toContain('title');
    expect(body.errors[1].message).toContain('already used');

    const [first, second] = await Promise.all(body.documentIds.map((id: string) => prisma.document.findUniqueOrThrow({ where: { id }, include: { files: { include: { versions: true } } } })));
    expect(first).toMatchObject({ kind: 'ARCHIVE', status: 'COMPLETED', paperSigned: true, number: 'ТД-7/2019', backdated: false, subjectEmployeeId: s.emp.employeeId });
    expect(first!.registeredAt!.toISOString().slice(0, 10)).toBe('2019-08-05');
    expect(first!.signedPdfFileId).toBeTruthy();
    expect(first!.files[0]!.versions[0]!.version).toBe(1);
    expect(second!.number).toBe('А-1/2018'); // auto-numbered with the type pattern for the registration year
    expect(second!.pdfFileId).toBeNull(); // image scan: attachment only

    // Route clash check: the static /documents/archive route coexists with /documents/:id.
    const detail = await s.c.hr.get(`/documents/${first!.id}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ kind: 'ARCHIVE', status: 'COMPLETED', paperSigned: true, number: 'ТД-7/2019' });
    expect(detail.json().files[0].versions[0].file.filename).toBe('td-7.pdf');
    const normal = await createDoc(s, 'VACATION_ORDER');
    expect((await s.c.hr.get(`/documents/${normal.id}`)).statusCode).toBe(200);
    expect((await s.c.hr.get('/documents/archive')).statusCode).toBe(404); // GET falls through to /documents/:id → unknown id
    const box = (await s.c.hr.get('/documents?box=archive')).json();
    expect(box.items.map((d: { id: string }) => d.id).sort()).toEqual([...body.documentIds].sort());

    // The subject employee can read their archived contract.
    expect((await s.c.emp.get(`/documents/${first!.id}`)).statusCode).toBe(200);
    // ЕСУТД ignores archive documents.
    expect((await s.c.hr.get('/esutd')).json().total).toBe(0);
  });

  it('validates the request and requires document.manage', async () => {
    const s = await docSetup(app);
    const meta = JSON.stringify([{ documentTypeId: s.types.HIRE_ORDER, legalEntityId: s.t.le.id, title: 'X', registeredAt: '2020-01-01' }]);
    expect((await s.c.emp.upload('/documents/archive', [{ field: 'files', filename: 'a.pdf', content: SAMPLE_PDF }], { meta })).statusCode).toBe(403);
    expect((await s.c.mgr.upload('/documents/archive', [{ field: 'files', filename: 'a.pdf', content: SAMPLE_PDF }], { meta })).statusCode).toBe(403);
    expect((await s.c.hr.upload('/documents/archive', [{ field: 'files', filename: 'a.pdf', content: SAMPLE_PDF }], { meta: 'not json' })).statusCode).toBe(400);
    const missing = (await s.c.hr.upload('/documents/archive', [], { meta })).json();
    expect(missing).toEqual({ documentIds: [], errors: [{ index: 0, message: 'File is missing for this item' }] });
    const wrongEmployee = await s.c.hr.upload('/documents/archive', [
      { field: 'files[]', filename: 'a.pdf', content: SAMPLE_PDF }, { field: 'files[]', filename: 'b.pdf', content: SAMPLE_PDF },
    ], { meta: JSON.stringify([{ documentTypeId: s.types.HIRE_ORDER, legalEntityId: s.t.le.id, title: 'X', registeredAt: '2020-01-01', subjectEmployeeId: 'nope' }]) });
    expect(wrongEmployee.json().errors).toEqual([{ index: 0, message: 'Employee not found' }, { index: 1, message: 'File has no matching meta item' }]);
  });
});
