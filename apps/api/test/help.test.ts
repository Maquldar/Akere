import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HELP_CATEGORIES } from '@akere/shared';
import { prisma } from '../src/lib/db';
import { articles as ru } from '../src/modules/help/content/ru';
import { articles as kk } from '../src/modules/help/content/kk';
import { articles as en } from '../src/modules/help/content/en';
import { Client, createApp, makeTenant, resetDb, type TestApp } from './helpers';

let app: TestApp;
beforeAll(async () => {
  app = await createApp();
});
afterAll(() => app.close());
beforeEach(resetDb);

let k = 0;
async function login() {
  const n = ++k;
  const t = await makeTenant('Help Co');
  await t.person({ email: `help${n}@t.kz`, firstName: 'Айгуль', lastName: 'Справкина' });
  const c = new Client(app);
  await c.login(`help${n}@t.kz`);
  return { t, c };
}

describe('help', () => {
  it('ships the same localized articles in ru, kk and en covering every category', () => {
    expect(ru.length).toBeGreaterThanOrEqual(10);
    for (const list of [kk, en]) expect(list.map((a) => a.slug)).toEqual(ru.map((a) => a.slug));
    expect(new Set(ru.map((a) => a.category))).toEqual(new Set(HELP_CATEGORIES));
    for (const a of [...ru, ...kk, ...en]) expect(a.body.length).toBeGreaterThan(400);
  });

  it('localizes by ?lang / Accept-Language and searches', async () => {
    const { c } = await login();
    const all = await c.get('/help/articles');
    expect(all.statusCode).toBe(200);
    expect(all.json()).toHaveLength(ru.length);
    expect(all.json()[0]).toEqual({ slug: 'getting-started', title: 'Начало работы в Akere HR', body: expect.stringContaining('## Роли'), category: 'start' });
    expect((await c.req('GET', '/help/articles', undefined, { 'accept-language': 'en-US,en;q=0.9' })).json()[0].title).toBe('Getting started with Akere HR');
    expect((await c.req('GET', '/help/articles?lang=kk', undefined, { 'accept-language': 'en' })).json()[0].title).toBe('Akere HR жүйесінде жұмысты бастау');

    const esutd = (await c.get(`/help/articles?q=${encodeURIComponent('ЕСУТД')}`)).json();
    expect(esutd[0].slug).toBe('esutd');
    const ack = (await c.get(`/help/articles?q=${encodeURIComponent('лист ознакомления')}`)).json();
    expect(ack.map((a: { slug: string }) => a.slug)).toEqual(['vnd-acknowledgment']);
    expect((await c.get('/help/articles?q=api&lang=en')).json()[0].slug).toBe('public-api');
    expect((await c.get('/help/articles?q=zzqqxx')).json()).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/api/v1/help/articles' })).statusCode).toBe(401);
  });

  it('stores support tickets and emails the support address', async () => {
    const { c, t } = await login();
    const res = await c.post('/help/tickets', { subject: 'Не приходит QR-код', message: 'При подписании ВНД QR-код не появляется. Браузер Chrome 129.' });
    expect(res.statusCode).toBe(201);
    const ticket = await prisma.supportTicket.findUniqueOrThrow({ where: { id: res.json().id } });
    expect(ticket).toMatchObject({ tenantId: t.tenantId, subject: 'Не приходит QR-код' });
    const mail = await prisma.outbox.findFirstOrThrow({ where: { to: 'support@akere.local' }, orderBy: { createdAt: 'desc' } });
    expect(mail.subject).toContain('Не приходит QR-код');
    expect(mail.body).toContain('Справкина Айгуль');
    expect(mail.body).toContain('Help Co');
    expect((await c.post('/help/tickets', { subject: '', message: 'x' })).statusCode).toBe(400);
  });
});
