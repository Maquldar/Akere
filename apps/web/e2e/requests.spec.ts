import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/**
 * P4 E2E: employee request → manager → HR → order signing; vacation plan → manager bulk approval.
 * Runs against a web dev server (WEB_URL) proxying to the API in DEMO_MODE (seeded demo users).
 * Every run creates its own records (random future dates; a fresh campaign when needed) and cancels
 * the request at the end so the vacation balance is not consumed.
 */

const PASSWORD = 'Akere2026demo';
const EMPLOYEE = 'a.serikova@dala.kz';
const MANAGER = 'r.alimov@dala.kz';
const HR = 'hr@dala.kz';

const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/screenshots/requests-${name}.png`, fullPage: false });

type StorageState = Awaited<ReturnType<import('@playwright/test').BrowserContext['storageState']>>;
/** Sessions are reused across tests: the API rate-limits logins (5 / 15 min per login + IP). */
const sessions = new Map<string, StorageState>();

async function login(browser: Browser, email: string, viewport?: { width: number; height: number }) {
  const cached = sessions.get(email);
  const context = await browser.newContext({ ...(viewport ? { viewport } : {}), ...(cached ? { storageState: cached } : {}) });
  const page = await context.newPage();
  if (!cached) {
    await page.goto('/ru/login');
    await page.getByLabel('Эл. почта или телефон').fill(email);
    await page.getByRole('textbox', { name: 'Пароль', exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await page.waitForURL((u) => !u.pathname.includes('/login'), { waitUntil: 'commit' });
    await expect(page.locator('#main')).toBeVisible();
    sessions.set(email, await context.storageState());
  }
  return { context, page };
}

async function apiLogin(request: APIRequestContext, email: string) {
  const res = await request.post('/api/v1/auth/login', {
    data: { login: email, password: PASSWORD },
    headers: { 'X-Requested-With': 'akere' },
  });
  expect(res.ok()).toBeTruthy();
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** A random 3-day window in 2027–2028 so repeated runs do not overlap. */
function randomPeriod() {
  const start = new Date(Date.UTC(2027, 0, 4) + Math.floor(Math.random() * 600) * 86_400_000);
  const end = new Date(start.getTime() + 2 * 86_400_000);
  return { start: iso(start), end: iso(end) };
}

async function approveOnRequestPage(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByText(/Ваше согласование/)).toBeVisible();
  await page.getByRole('button', { name: 'Согласовать', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Согласовать', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/Ваше согласование/)).toBeHidden();
}

test('annual leave request: employee → manager → HR → order signing', async ({ browser }) => {
  test.setTimeout(240_000);
  const { start, end } = randomPeriod();

  // Employee files the request.
  const emp = await login(browser, EMPLOYEE);
  await emp.page.goto('/ru');
  await expect(emp.page.getByRole('heading', { name: 'Популярные сервисы' })).toBeVisible();
  await emp.page.getByRole('link', { name: /Оформить отпуск/ }).click();
  await expect(emp.page).toHaveURL(/\/requests\/new\?type=ANNUAL_LEAVE/);
  await expect(emp.page.getByRole('tab', { name: 'Заполнение' })).toBeVisible();
  await expect(emp.page.getByText('Накоплено дней отпуска')).toBeVisible();
  await emp.page.getByLabel('Дата начала').fill(start);
  await emp.page.getByLabel('Дата окончания').fill(end);
  await expect(emp.page.getByTestId('request-days')).toHaveText(/^3/);
  await expect(emp.page.getByText(/Останется после/)).toBeVisible();
  await shot(emp.page, '01-new-fill');

  await emp.page.getByRole('tab', { name: 'Предпросмотр' }).click();
  await expect(emp.page.getByRole('heading', { name: 'Проверка' })).toBeVisible();
  await expect(emp.page.getByTestId('pdf-preview').locator('canvas').first()).toBeVisible();
  await shot(emp.page, '02-new-preview');

  await emp.page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(emp.page).toHaveURL(/\/requests\/[a-z0-9]+$/);
  await expect(emp.page.getByText('На согласовании').first()).toBeVisible();
  const requestUrl = new URL(emp.page.url()).pathname;
  await shot(emp.page, '03-detail-employee');

  // Manager sees it in team requests and approves.
  const mgr = await login(browser, MANAGER);
  await mgr.page.goto('/ru/requests/team');
  await expect(mgr.page.getByRole('heading', { name: 'Заявки команды', level: 1 })).toBeVisible();
  await expect(mgr.page.getByRole('table').getByText(/Серикова/).first()).toBeVisible();
  await shot(mgr.page, '04-team');
  await approveOnRequestPage(mgr.page, requestUrl);
  await mgr.context.close();

  // HR approves.
  const hr = await login(browser, HR);
  await approveOnRequestPage(hr.page, requestUrl);
  await expect(hr.page.getByText('Подписание приказа').first()).toBeVisible();
  await hr.context.close();

  // Employee sees ORDER_SIGNING with the order card.
  await emp.page.goto(requestUrl);
  await expect(emp.page.getByText('Подписание приказа').first()).toBeVisible();
  await expect(emp.page.getByRole('heading', { name: 'Приказ', exact: true })).toBeVisible();
  await shot(emp.page, '05-detail-order-signing');

  // Cleanup: cancel so the vacation balance is not consumed by test runs.
  await emp.page.getByRole('button', { name: 'Отменить заявку' }).click();
  await emp.page.getByRole('dialog').getByRole('button', { name: 'Отменить заявку' }).click();
  await expect(emp.page.getByText('Отменена').first()).toBeVisible();
  await emp.context.close();
});

test('vacation plan: employee submits → manager bulk approves', async ({ browser, playwright, baseURL }) => {
  test.setTimeout(180_000);

  // Setup: an ACTIVE campaign where the employee's plan is not approved yet (create one if needed).
  const hrApi = await playwright.request.newContext({ baseURL });
  await apiLogin(hrApi, HR);
  const empApi = await playwright.request.newContext({ baseURL });
  await apiLogin(empApi, EMPLOYEE);
  const campaigns = (await (await hrApi.get('/api/v1/vacation-schedule/campaigns')).json()) as { id: string; year: number; status: string }[];
  let year: number | null = null;
  for (const c of campaigns.filter((x) => x.status === 'ACTIVE').sort((a, b) => b.year - a.year)) {
    const plan = await empApi.get(`/api/v1/vacation-schedule/campaigns/${c.id}/my-plan`);
    if (plan.ok() && ((await plan.json()) as { status: string }).status !== 'APPROVED') {
      year = c.year;
      break;
    }
  }
  if (year === null) {
    year = Math.max(2027, ...campaigns.map((c) => c.year + 1));
    const res = await hrApi.post('/api/v1/vacation-schedule/campaigns', { data: { year }, headers: { 'X-Requested-With': 'akere' } });
    expect(res.status()).toBe(201);
  }
  await hrApi.dispose();
  await empApi.dispose();

  // Employee plans 14 days and submits.
  const emp = await login(browser, EMPLOYEE);
  await emp.page.goto('/ru/vacation-schedule');
  await expect(emp.page.getByRole('heading', { name: 'График отпусков', level: 1 })).toBeVisible();
  await emp.page.getByRole('combobox', { name: 'Год планирования' }).click();
  await emp.page.getByRole('option', { name: `${year} год` }).click();
  const card = emp.page.getByTestId('my-plan');
  await expect(card).toBeVisible();
  await expect(card.getByText(`Мой план на ${year} год`)).toBeVisible();
  // Reset the editor to a single 14-day period.
  while ((await card.getByRole('button', { name: /Удалить период/ }).count()) > 0) {
    await card.getByRole('button', { name: /Удалить период/ }).first().click();
  }
  await card.getByRole('button', { name: 'Добавить период' }).click();
  await card.getByLabel('Начало периода 1').fill(`${year}-07-06`);
  await card.getByLabel('Окончание периода 1').fill(`${year}-07-19`);
  await expect(card.getByTestId('planned-meter')).toContainText('14');
  await card.getByRole('button', { name: /Отправить/ }).click();
  await expect(card.getByText('На согласовании').first()).toBeVisible();
  await shot(emp.page, '06-vacation-employee');
  await emp.context.close();

  // Manager selects the row and bulk-approves.
  const mgr = await login(browser, MANAGER);
  await mgr.page.goto('/ru/vacation-schedule');
  await mgr.page.getByRole('combobox', { name: 'Год планирования' }).click();
  await mgr.page.getByRole('option', { name: `${year} год` }).click();
  await mgr.page.getByRole('searchbox', { name: 'Поиск по ФИО' }).fill('Серикова');
  await expect(mgr.page.locator('tbody tr')).toHaveCount(1);
  const row = mgr.page.locator('tr', { hasText: 'Серикова' }).first();
  await expect(row.getByText('На согласовании')).toBeVisible();
  await row.getByRole('checkbox').click();
  await expect(mgr.page.getByText(/Выбрано: 1, из них можно согласовать: 1/)).toBeVisible();
  await shot(mgr.page, '07-vacation-grid-selected');
  await mgr.page.getByRole('region', { name: 'Действия с выбранными' }).getByRole('button', { name: 'Согласовать' }).click();
  const dialog = mgr.page.getByRole('dialog');
  await expect(dialog.getByTestId('approve-summary')).toContainText('1');
  await dialog.getByRole('button', { name: 'Согласовать', exact: true }).click();
  await expect(dialog.getByTestId('approve-result')).toContainText('Обработан 1 план');
  await dialog.getByRole('button', { name: 'Закрыть' }).last().click();
  await expect(row.getByText('Утверждён')).toBeVisible();
  await shot(mgr.page, '08-vacation-grid-approved');
  await mgr.context.close();
});

test('requests pages fit a 360px phone', async ({ browser }) => {
  const emp = await login(browser, EMPLOYEE, { width: 360, height: 780 });
  for (const path of ['/ru/requests', '/ru/requests/new?type=ANNUAL_LEAVE', '/ru/vacation-schedule']) {
    await emp.page.goto(path);
    await emp.page.waitForLoadState('networkidle');
    const overflow = await emp.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
  await emp.page.goto('/ru/requests/new?type=ANNUAL_LEAVE');
  await expect(emp.page.getByRole('heading', { name: 'Новая заявка', level: 1 })).toBeVisible();
  await expect(emp.page.getByText('Накоплено дней отпуска')).toBeVisible();
  await shot(emp.page, '09-mobile-new');
  await emp.context.close();
});
