import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db';
import { sha256 } from '../src/lib/crypto';
import { Client, createApp, makeTenant, resetDb, type TestApp } from './helpers';

let app: TestApp;
beforeAll(async () => {
  app = await createApp();
});
afterAll(() => app.close());
beforeEach(resetDb);

let k = 0;
async function setup() {
  const n = ++k;
  const t = await makeTenant();
  const admin = await t.person({ email: `admin${n}@pub.kz`, roles: [{ role: 'ADMIN' }], lastName: 'Админов' });
  const hr = await t.person({ email: `hr${n}@pub.kz`, roles: [{ role: 'HR' }], lastName: 'Кадрова' });
  const ca = new Client(app);
  await ca.login(`admin${n}@pub.kz`);
  const ch = new Client(app);
  await ch.login(`hr${n}@pub.kz`);
  return { t, admin, hr, c: { admin: ca, hr: ch } };
}

const call = (method: 'GET' | 'POST', url: string, key?: string, body?: unknown) =>
  app.inject({
    method, url: `/api/v1/public${url}`,
    headers: { ...(key ? { authorization: key.startsWith('Bearer') || key.startsWith('Basic') ? key : `Bearer ${key}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    payload: body ? JSON.stringify(body) : undefined,
  });

describe('API keys and public API', () => {
  it('manages keys (ADMIN only) and authenticates Bearer keys with scopes', async () => {
    const s = await setup();
    expect((await s.c.hr.post('/api/v1/api-keys', { name: 'x', scopes: ['employees:read'] })).statusCode).toBe(403);
    expect((await s.c.hr.get('/api/v1/api-keys')).statusCode).toBe(403);
    expect((await s.c.admin.post('/api/v1/api-keys', { name: 'x', scopes: [] })).statusCode).toBe(400);
    expect((await s.c.admin.post('/api/v1/api-keys', { name: 'x', scopes: ['admin:all'] })).statusCode).toBe(400);

    const created = await s.c.admin.post('/api/v1/api-keys', { name: '1С:ЗУП интеграция', scopes: ['employees:read', 'candidates:read', 'candidates:write', 'timesheet:read', 'documents:read'] });
    expect(created.statusCode).toBe(201);
    const { id, key, prefix } = created.json();
    expect(key).toMatch(/^ak_[0-9a-f]{12}_[0-9a-f]{48}$/);
    expect(key.startsWith(`ak_${prefix}_`)).toBe(true);
    const row = await prisma.apiKey.findUniqueOrThrow({ where: { id } });
    expect(row.keyHash).toBe(sha256(key));
    expect(row.keyHash).not.toContain(key.slice(16));
    const list = (await s.c.admin.get('/api/v1/api-keys')).json();
    expect(list).toEqual([expect.objectContaining({ id, name: '1С:ЗУП интеграция', prefix, lastUsedAt: null, revokedAt: null })]);
    expect(JSON.stringify(list)).not.toContain(key);

    const narrow = (await s.c.admin.post('/api/v1/api-keys', { name: 'Только табель', scopes: ['timesheet:read'] })).json().key as string;

    // Missing / malformed / invalid.
    expect((await call('GET', '/employees')).statusCode).toBe(401);
    expect((await call('GET', '/employees', 'Basic abc')).statusCode).toBe(401);
    expect((await call('GET', '/employees', 'ak_000000000000_' + '0'.repeat(48))).statusCode).toBe(401);
    expect((await call('GET', '/employees', key.slice(0, -1) + (key.endsWith('0') ? '1' : '0'))).json().error).toMatchObject({ code: 'UNAUTHENTICATED', message: 'Invalid API key' });
    // Wrong scope.
    const wrong = await call('GET', '/employees', narrow);
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().error.message).toContain('employees:read');
    // A session cookie is not accepted on the public API.
    expect((await s.c.admin.get('/api/v1/public/employees')).statusCode).toBe(401);

    // OK.
    const emps = await call('GET', '/employees?pageSize=10', key);
    expect(emps.statusCode).toBe(200);
    expect(emps.json()).toMatchObject({ total: 2, page: 1, pageSize: 10 });
    expect(emps.json().items[0]).toMatchObject({ fullName: expect.any(String), tabNumber: '000001', status: 'ACTIVE', legalEntity: { id: s.t.le.id } });
    expect((await prisma.apiKey.findUniqueOrThrow({ where: { id } })).lastUsedAt).toBeTruthy();

    // Revoked.
    expect((await s.c.admin.del(`/api/v1/api-keys/${id}`)).statusCode).toBe(204);
    const revoked = await call('GET', '/employees', key);
    expect(revoked.statusCode).toBe(401);
    expect(revoked.json().error.message).toBe('API key has been revoked');
    expect((await s.c.admin.get('/api/v1/api-keys')).json().find((x: { id: string }) => x.id === id).revokedAt).toBeTruthy();
    // Another tenant's admin cannot touch the key.
    const other = await setup();
    expect((await other.c.admin.del(`/api/v1/api-keys/${id}`)).statusCode).toBe(404);
  });

  it('serves candidates, mark-exported, timesheet and documents', async () => {
    const s = await setup();
    const key = (await s.c.admin.post('/api/v1/api-keys', { name: '1С', scopes: ['candidates:read', 'candidates:write', 'timesheet:read', 'documents:read'] })).json().key as string;
    const [accepted, fresh] = await Promise.all([
      prisma.candidate.create({ data: { tenantId: s.t.tenantId, legalEntityId: s.t.le.id, lastName: 'Ахметова', firstName: 'Дана', iin: '960714400123', status: 'ACCEPTED', tags: ['склад'] } }),
      prisma.candidate.create({ data: { tenantId: s.t.tenantId, legalEntityId: s.t.le.id, lastName: 'Новый', firstName: 'Кандидат', status: 'NEW' } }),
    ]);
    const list = await call('GET', '/candidates', key);
    expect(list.statusCode).toBe(200);
    expect(list.json().total).toBe(1);
    expect(list.json().items[0]).toMatchObject({ id: accepted.id, fullName: 'Ахметова Дана', iin: '960714400123', status: 'ACCEPTED', legalEntity: { bin: s.t.le.bin } });
    expect((await call('GET', '/candidates?tag=склад', key)).json().total).toBe(1);
    expect((await call('GET', '/candidates?tag=офис', key)).json().total).toBe(0);
    expect((await call('GET', '/candidates?status=NEW', key)).json().items[0].id).toBe(fresh.id);
    expect((await call('GET', '/candidates?updatedFrom=2999-01-01', key)).json().total).toBe(0);

    const marked = await call('POST', '/candidates/mark-exported', key, { candidateIds: [accepted.id, fresh.id] });
    expect(marked.statusCode).toBe(200);
    expect(marked.json()).toEqual({ updated: 1 });
    expect((await prisma.candidate.findUniqueOrThrow({ where: { id: accepted.id } })).status).toBe('EXPORTED');
    expect((await call('POST', '/candidates/mark-exported', key, {})).statusCode).toBe(400);

    const ts = await call('GET', '/timesheet?year=2026&month=9', key);
    expect(ts.statusCode).toBe(200);
    expect(ts.json()).toMatchObject({ year: 2026, month: 9 });
    expect(ts.json().days).toHaveLength(30);
    expect(ts.json().rows).toHaveLength(2);
    expect(ts.json().rows[0].tabNumber).toMatch(/^\d{6}$/);
    expect((await call('GET', '/timesheet?year=2026&month=13', key)).statusCode).toBe(400);

    const docType = await prisma.documentType.create({ data: { tenantId: s.t.tenantId, code: 'MEMO', name: 'Служебная записка', kind: 'GENERIC' } });
    await prisma.document.create({ data: { tenantId: s.t.tenantId, legalEntityId: s.t.le.id, documentTypeId: docType.id, kind: 'GENERIC', title: 'Записка', status: 'COMPLETED', authorId: s.hr.userId, number: 'СЗ-1' } });
    await prisma.document.create({ data: { tenantId: s.t.tenantId, legalEntityId: s.t.le.id, documentTypeId: docType.id, kind: 'GENERIC', title: 'Черновик', status: 'DRAFT', authorId: s.hr.userId } });
    const docs = (await call('GET', '/documents', key)).json();
    expect(docs.total).toBe(1);
    expect(docs.items[0]).toMatchObject({ title: 'Записка', number: 'СЗ-1', status: 'COMPLETED', type: { name: 'Служебная записка' } });
    expect((await call('GET', '/documents?status=DRAFT', key)).json().items[0].title).toBe('Черновик');
    expect((await call('GET', '/employees', key)).statusCode).toBe(403);
  });

  it('rate-limits each key to 60 requests per minute', async () => {
    const s = await setup();
    const a = (await s.c.admin.post('/api/v1/api-keys', { name: 'A', scopes: ['documents:read'] })).json().key as string;
    const b = (await s.c.admin.post('/api/v1/api-keys', { name: 'B', scopes: ['documents:read'] })).json().key as string;
    for (let i = 0; i < 60; i++) expect((await call('GET', '/documents?pageSize=1', a)).statusCode).toBe(200);
    const limited = await call('GET', '/documents?pageSize=1', a);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeTruthy();
    // Another key has its own bucket.
    expect((await call('GET', '/documents?pageSize=1', b)).statusCode).toBe(200);
  });
});
