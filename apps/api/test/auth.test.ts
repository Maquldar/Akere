import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db';
import { Client, PASSWORD, createApp, lastCode, makeTenant, resetDb, type TestApp } from './helpers';

let app: TestApp;
beforeAll(async () => {
  app = await createApp();
});
afterAll(() => app.close());
beforeEach(resetDb);

describe('auth', () => {
  it('logs in with password, returns me, and logs out', async () => {
    const t = await makeTenant();
    await t.person({ email: 'hr@test.kz', roles: [{ role: 'HR' }] });
    const c = new Client(app);
    const res = await c.login('hr@test.kz');
    expect(res.status).toBe('OK');
    expect(res.me.permissions).toContain('candidate.manage');
    expect((await c.get('/auth/me')).statusCode).toBe(200);
    expect((await c.post('/auth/logout')).statusCode).toBe(204);
    expect((await c.get('/auth/me')).statusCode).toBe(401);
  });

  it('rejects wrong password with a generic message and locks after 5 failures', async () => {
    const t = await makeTenant();
    await t.person({ email: 'u@test.kz' });
    const c = new Client(app);
    for (let i = 0; i < 5; i++) {
      const r = await c.req('POST', '/auth/login', { login: 'u@test.kz', password: 'wrong-pass-1' }, { 'x-forwarded-for': `10.0.0.${i}` });
      expect(r.statusCode).toBe(401);
      expect(r.json().error.code).toBe('UNAUTHENTICATED');
    }
    const locked = await c.req('POST', '/auth/login', { login: 'u@test.kz', password: PASSWORD }, { 'x-forwarded-for': '10.0.0.99' });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('RATE_LIMITED');
  });

  it('does not reveal unknown accounts', async () => {
    const c = new Client(app);
    const r = await c.post('/auth/login', { login: 'nobody@test.kz', password: 'whatever123' });
    expect(r.statusCode).toBe(401);
    expect((await c.post('/auth/password/forgot', { login: 'nobody@test.kz' })).statusCode).toBe(204);
  });

  it('requires the CSRF header on mutations', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { login: 'a@b.kz', password: 'x' } });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('CSRF');
  });

  it('completes 2FA with an OTP code', async () => {
    const t = await makeTenant();
    const p = await t.person({ email: 'tfa@test.kz' });
    await prisma.user.update({ where: { id: p.userId }, data: { twoFactorEnabled: true } });
    const c = new Client(app);
    const first = await c.login('tfa@test.kz');
    expect(first.status).toBe('OTP_REQUIRED');
    expect((await c.get('/auth/me')).statusCode).toBe(401); // pending session is not a login
    expect((await c.post('/auth/login/otp', { code: '000000' })).statusCode).toBe(400);
    const ok = await c.post('/auth/login/otp', { code: await lastCode('tfa@test.kz') });
    expect(ok.statusCode).toBe(200);
    expect((await c.get('/auth/me')).statusCode).toBe(200);
  });

  it('resets the password with an emailed code and kills old sessions', async () => {
    const t = await makeTenant();
    await t.person({ email: 'reset@test.kz' });
    const old = new Client(app);
    await old.login('reset@test.kz');
    const c = new Client(app);
    expect((await c.post('/auth/password/forgot', { login: 'reset@test.kz' })).statusCode).toBe(204);
    const weak = await c.post('/auth/password/reset', { login: 'reset@test.kz', code: '123456', newPassword: 'short' });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().error.details.fieldErrors.newPassword).toBeTruthy();
    const code = await lastCode('reset@test.kz');
    expect((await c.post('/auth/password/reset', { login: 'reset@test.kz', code, newPassword: 'NewSecret2026x' })).statusCode).toBe(204);
    expect((await old.get('/auth/me')).statusCode).toBe(401);
    await c.login('reset@test.kz', 'NewSecret2026x');
    // A code works once.
    expect((await c.post('/auth/password/reset', { login: 'reset@test.kz', code, newPassword: 'Another2026xx' })).statusCode).toBe(400);
  });

  it('changes the password when the current one is correct', async () => {
    const t = await makeTenant();
    await t.person({ email: 'ch@test.kz' });
    const c = new Client(app);
    await c.login('ch@test.kz');
    expect((await c.post('/auth/password/change', { currentPassword: 'nope', newPassword: 'Brandnew2026' })).statusCode).toBe(400);
    expect((await c.post('/auth/password/change', { currentPassword: PASSWORD, newPassword: 'Brandnew2026' })).statusCode).toBe(204);
    await new Client(app).login('ch@test.kz', 'Brandnew2026');
  });

  it('lists demo users and logs in as one in demo mode only', async () => {
    const t = await makeTenant();
    const p = await t.person({ email: 'demo@test.kz' });
    await prisma.user.update({ where: { id: p.userId }, data: { demoListed: true } });
    await t.person({ email: 'hidden@test.kz' });
    const c = new Client(app);
    const list = (await c.get('/auth/demo-users')).json();
    expect(list).toHaveLength(1);
    expect((await c.post('/auth/demo-login', { userId: list[0].id })).statusCode).toBe(200);
    const hidden = await prisma.user.findUniqueOrThrow({ where: { email: 'hidden@test.kz' } });
    expect((await new Client(app).post('/auth/demo-login', { userId: hidden.id })).statusCode).toBe(404);
  });

  it('deactivated users cannot use existing sessions', async () => {
    const t = await makeTenant();
    const p = await t.person({ email: 'gone@test.kz' });
    const c = new Client(app);
    await c.login('gone@test.kz');
    await prisma.user.update({ where: { id: p.userId }, data: { isActive: false } });
    expect((await c.get('/auth/me')).statusCode).toBe(401);
  });
});
