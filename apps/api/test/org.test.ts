import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db';
import { Client, createApp, makeTenant, resetDb, type TestApp } from './helpers';

let app: TestApp;
beforeAll(async () => {
  app = await createApp();
});
afterAll(() => app.close());
beforeEach(resetDb);

async function setup() {
  const t = await makeTenant();
  await t.person({ email: 'admin@test.kz', roles: [{ role: 'ADMIN' }] });
  await t.person({ email: 'hr@test.kz', roles: [{ role: 'HR' }] });
  const admin = new Client(app);
  await admin.login('admin@test.kz');
  const hr = new Client(app);
  await hr.login('hr@test.kz');
  return { t, admin, hr };
}

describe('organization', () => {
  it('admin manages legal entities; HR can read but not write', async () => {
    const { admin, hr } = await setup();
    const bad = await admin.post('/org/legal-entities', { name: 'ТОО Х', bin: '123456789012' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.details.fieldErrors.bin).toBeTruthy();
    const created = await admin.post('/org/legal-entities', { name: 'ТОО «Новая»', bin: '000740001307' });
    expect(created.statusCode).toBe(201);
    expect((await hr.post('/org/legal-entities', { name: 'ТОО Y', bin: '000740001307' })).statusCode).toBe(403);
    const list = (await hr.get('/org/legal-entities')).json();
    expect(list.map((x: { name: string }) => x.name)).toContain('ТОО «Новая»');
    const dup = await admin.post('/org/legal-entities', { name: 'Дубль', bin: '000740001307' });
    expect(dup.statusCode).toBe(409);
  });

  it('builds a department tree and prevents cycles and deleting non-empty departments', async () => {
    const { t, admin } = await setup();
    const a = (await admin.post('/org/departments', { legalEntityId: t.le.id, name: 'A' })).json();
    const b = (await admin.post('/org/departments', { legalEntityId: t.le.id, name: 'B', parentId: a.id })).json();
    const cyc = await admin.patch(`/org/departments/${a.id}`, { parentId: b.id });
    expect(cyc.statusCode).toBe(409);
    expect((await admin.del(`/org/departments/${a.id}`)).statusCode).toBe(409); // has child B
    expect((await admin.del(`/org/departments/${t.dept.id}`)).statusCode).toBe(409); // has employees
    expect((await admin.del(`/org/departments/${b.id}`)).statusCode).toBe(204);
  });

  it('isolates tenants', async () => {
    const { admin } = await setup();
    const other = await makeTenant('Other');
    expect((await admin.patch(`/org/legal-entities/${other.le.id}`, { name: 'hack' })).statusCode).toBe(404);
    const names = (await admin.get('/org/legal-entities')).json().map((x: { name: string }) => x.name);
    expect(names).not.toContain('ТОО Other');
  });

  it('creates users with scoped roles, sends an invite and protects the admin from locking themselves out', async () => {
    const { t, admin } = await setup();
    const res = await admin.post('/org/users', {
      email: 'New.User@test.kz', phone: '+7 701 111 22 33', firstName: 'Алия', lastName: 'Новая',
      roles: [{ role: 'HR', legalEntityId: t.le.id, canSign: false }], sendInvite: true,
    });
    expect(res.statusCode).toBe(201);
    const u = res.json();
    expect(u.email).toBe('new.user@test.kz');
    expect(u.phone).toBe('+77011112233');
    expect(await prisma.outbox.count({ where: { to: 'new.user@test.kz' } })).toBe(1);
    const page = (await admin.get('/org/users?role=HR')).json();
    expect(page.total).toBe(2);
    const me = (await admin.get('/auth/me')).json();
    expect((await admin.patch(`/org/users/${me.id}`, { isActive: false })).statusCode).toBe(409);
    const deact = await admin.patch(`/org/users/${u.id}`, { isActive: false });
    expect(deact.json().isActive).toBe(false);
    const audit = (await admin.get('/org/audit?entityType=User')).json();
    expect(audit.items.some((a: { action: string }) => a.action === 'users.update')).toBe(true);
  });

  it('manages positions and geofenced locations with validation', async () => {
    const { admin } = await setup();
    expect((await admin.post('/org/positions', { name: 'Юрист' })).statusCode).toBe(201);
    expect((await admin.post('/org/locations', { name: 'Офис', lat: 200, lng: 71, radiusM: 100 })).statusCode).toBe(400);
    const loc = await admin.post('/org/locations', { name: 'Офис', lat: 51.09, lng: 71.41, radiusM: 150 });
    expect(loc.statusCode).toBe(201);
    expect((await admin.get('/org/seats')).json().activeEmployees).toBe(2);
  });
});

describe('notifications and files', () => {
  it('lists and marks notifications as read', async () => {
    const { t, hr } = await setup();
    const me = (await hr.get('/auth/me')).json();
    await prisma.notification.createMany({
      data: [1, 2, 3].map((i) => ({ tenantId: t.tenantId, userId: me.id, type: 'test', title: `N${i}` })),
    });
    expect((await hr.get('/me/notifications?unread=true')).json().total).toBe(3);
    expect((await hr.get('/auth/me')).json().unreadNotifications).toBe(3);
    await hr.post('/me/notifications/read', {});
    expect((await hr.get('/me/notifications?unread=true')).json().total).toBe(0);
  });

  it('denies access to files the user does not own', async () => {
    const { t, hr } = await setup();
    const f = await prisma.storedFile.create({ data: { tenantId: t.tenantId, key: 'x/y.pdf', filename: 'y.pdf', mime: 'application/pdf', size: 1, sha256: 'x' } });
    expect((await hr.get(`/files/${f.id}`)).statusCode).toBe(404);
    expect((await new Client(app).get(`/files/${f.id}`)).statusCode).toBe(401);
  });

  it('reports health', async () => {
    const r = await new Client(app).get('/health');
    expect(r.json()).toMatchObject({ status: 'ok', db: 'ok' });
  });
});
