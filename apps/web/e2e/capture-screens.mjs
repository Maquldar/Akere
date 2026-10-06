// Captures README screenshots from a running instance (default http://localhost:3000, demo mode on).
// Usage: node e2e/capture-screens.mjs [baseUrl]
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const OUT = new URL('../../../docs/screenshots/', import.meta.url).pathname;

async function loginAs(browser, email, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: 'ru-RU', deviceScaleFactor: 1 });
  const users = await (await ctx.request.get(`${BASE}/api/v1/auth/demo-users`)).json();
  const all = await (await ctx.request.get(`${BASE}/api/v1/auth/demo-users`)).json();
  const pick = (users.length ? users : all).find((u) => u.email === email) ?? null;
  // demo-users has no email field: map by known names instead
  const byName = { 'admin@dala.kz': 'Мукашев', 'hr@dala.kz': 'Сулейменова', 'ceo@dala.kz': 'Байсарин', 'r.alimov@dala.kz': 'Алимов', 'a.serikova@dala.kz': 'Серикова' };
  const user = pick ?? users.find((u) => u.fullName.startsWith(byName[email]));
  const res = await ctx.request.post(`${BASE}/api/v1/auth/demo-login`, { data: { userId: user.id }, headers: { 'x-requested-with': 'akere' } });
  if (!res.ok()) throw new Error(`demo login failed for ${email}: ${res.status()}`);
  return ctx;
}

async function shot(ctx, path, file, opts = {}) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/ru${path}`, { waitUntil: 'networkidle' });
  if (opts.click) {
    await page.getByText(opts.click, { exact: false }).first().click();
    await page.waitForLoadState('networkidle');
  }
  await page.waitForTimeout(opts.wait ?? 800);
  await page.screenshot({ path: `${OUT}${file}.png`, fullPage: false });
  console.log('✔', file);
  await page.close();
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
  await shot(anon, '/login', '01-login');

  const hr = await loginAs(browser, 'hr@dala.kz');
  await shot(hr, '', '02-home-hr');
  await shot(hr, '/candidates', '03-candidates');
  await shot(hr, '/time/timesheet', '06-timesheet-today');
  await shot(hr, '/time/timesheet?tab=t13', '07-timesheet-t13', { click: 'Форма Т-13' });
  await shot(hr, '/vnd', '09-vnd');
  await shot(hr, '/reports', '10-reports', { wait: 1500 });
  await shot(hr, '/esutd', '11-esutd');

  const ceo = await loginAs(browser, 'ceo@dala.kz');
  await shot(ceo, '/documents?box=inbox', '04-documents-inbox');
  const page = await ceo.newPage();
  await page.goto(`${BASE}/ru/documents?box=all`, { waitUntil: 'networkidle' });
  await page.locator('table tbody tr').first().click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}05-document-card.png` });
  console.log('✔ 05-document-card');

  const mgr = await loginAs(browser, 'r.alimov@dala.kz');
  await shot(mgr, '/time/planning', '08-planning');
  await shot(mgr, '/vacation-schedule', '12-vacation-schedule');

  const emp = await loginAs(browser, 'a.serikova@dala.kz', { width: 390, height: 844 });
  await shot(emp, '/time', '13-mobile-my-time');
  await shot(emp, '/requests/new?type=ANNUAL_LEAVE', '14-mobile-vacation-request');
} finally {
  await browser.close();
}
