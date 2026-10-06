import { prisma } from '../src/lib/db';
import { ensureDocumentType } from '../src/modules/documents/defaults';
import { Client, makeTenant, type TestApp } from './helpers';

let n = 0;

/**
 * A tenant with: CEO (MANAGER, signatory), HR, a manager reporting to the CEO, an employee reporting to the manager,
 * an unrelated employee; the built-in document types; logged-in clients (unique emails avoid login rate limits).
 */
export async function docSetup(app: TestApp) {
  const k = ++n;
  const t = await makeTenant();
  await prisma.legalEntity.update({ where: { id: t.le.id }, data: { directorName: 'Директоров Тимур Ерланович', address: 'г. Астана, ул. Тестовая, 1' } });
  const email = (x: string) => `${x}${k}@t.kz`;
  const ceo = await t.person({ email: email('ceo'), firstName: 'Тимур', lastName: 'Директоров', roles: [{ role: 'MANAGER', legalEntityId: t.le.id, canSign: true }] });
  const hr = await t.person({ email: email('hr'), firstName: 'Жанара', lastName: 'Кадрова', roles: [{ role: 'HR' }] });
  const mgr = await t.person({ email: email('mgr'), firstName: 'Руслан', lastName: 'Руководов', roles: [{ role: 'MANAGER' }], managerEmployeeId: ceo.employeeId });
  const emp = await t.person({ email: email('emp'), firstName: 'Әлия', lastName: 'Работникова', managerEmployeeId: mgr.employeeId });
  const other = await t.person({ email: email('other'), firstName: 'Пётр', lastName: 'Посторонний' });
  const types: Record<string, string> = {};
  for (const code of ['EMPLOYMENT_CONTRACT', 'HIRE_ORDER', 'TRANSFER_ORDER', 'DISMISSAL_ORDER', 'VACATION_APPLICATION', 'VACATION_ORDER']) {
    types[code] = (await ensureDocumentType(t.tenantId, code)).id;
  }
  const login = async (who: string) => {
    const c = new Client(app);
    await c.login(email(who));
    return c;
  };
  const c = { ceo: await login('ceo'), hr: await login('hr'), mgr: await login('mgr'), emp: await login('emp'), other: await login('other') };
  return { t, ceo, hr, mgr, emp, other, types, c, email };
}
export type DocSetup = Awaited<ReturnType<typeof docSetup>>;

/** Creates a document via the API and returns its detail. */
export async function createDoc(s: DocSetup, code: string, opts: { subject?: string; startRoute?: boolean; data?: Record<string, unknown>; client?: Client; dueAt?: string } = {}) {
  const res = await (opts.client ?? s.c.hr).post('/documents', {
    documentTypeId: s.types[code], legalEntityId: s.t.le.id, subjectEmployeeId: opts.subject ?? s.emp.employeeId,
    data: opts.data ?? { startDate: '2026-11-02', endDate: '2026-11-15', days: 14, salary: 450000, probationMonths: 3 },
    startRoute: opts.startRoute ?? true, ...(opts.dueAt ? { dueAt: opts.dueAt } : {}),
  });
  if (res.statusCode !== 201) throw new Error(`create failed ${res.statusCode} ${res.body}`);
  return res.json();
}

/** Signs all pending SIGN/ACKNOWLEDGE steps of the client on the document via an eGov mobile QR session. */
export async function qrSign(client: Client, documentIds: string[], method: 'EGOV_MOBILE' | 'EGOV_BUSINESS' = 'EGOV_MOBILE') {
  const s = await client.post('/signing/sessions', { documentIds, method });
  if (s.statusCode !== 201) return s;
  const token = new URL(s.json().qrUrl).pathname.split('/').pop()!;
  return client.post(`/signing/qr/${token}/confirm`, { decision: 'SIGN' });
}
