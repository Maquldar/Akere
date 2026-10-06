import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/**
 * P3 E2E: HR event → route → e-signing (NCALayer PIN and eGov QR sandbox) → acknowledgment → verification.
 * Runs against a web dev server (WEB_URL) proxying to the API with the seeded demo tenant.
 * Every run creates its own transfer orders (salary-only change, so the employee record is not modified).
 */

const PASSWORD = 'Akere2026demo';
const HR = 'hr@dala.kz';
const CEO = 'ceo@dala.kz';
const EMPLOYEE = 'a.serikova@dala.kz';
const EMPLOYEE_NAME = 'Серикова';

const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/screenshots/documents-${name}.png`, fullPage: false });

async function login(browser: Browser, email: string, viewport?: { width: number; height: number }) {
  const context = await browser.newContext(viewport ? { viewport } : {});
  const page = await context.newPage();
  await page.goto('/ru/login');
  await page.getByLabel('Эл. почта или телефон').fill(email);
  await page.getByRole('textbox', { name: 'Пароль', exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
  return { context, page };
}

async function apiLogin(request: APIRequestContext, email: string) {
  const res = await request.post('/api/v1/auth/login', { data: { login: email, password: PASSWORD }, headers: { 'X-Requested-With': 'akere' } });
  expect(res.ok()).toBeTruthy();
}

async function employeeId(request: APIRequestContext): Promise<string> {
  const res = await request.get(`/api/v1/employees?q=${encodeURIComponent(EMPLOYEE_NAME)}&status=ACTIVE`);
  expect(res.ok()).toBeTruthy();
  const page = (await res.json()) as { items: { id: string; email: string }[] };
  const e = page.items.find((x) => x.email === EMPLOYEE);
  expect(e).toBeTruthy();
  return e!.id;
}

test('transfer order: HR → CEO signs with NCALayer → employee acknowledges → signatures valid', async ({ browser }) => {
  test.setTimeout(300_000);
  const salary = String(400_000 + Math.floor(Math.random() * 100_000));

  // HR opens the employee e-dossier and starts a transfer.
  const hr = await login(browser, HR);
  const nav = hr.page.getByRole('navigation', { name: 'Основная навигация' });
  await nav.getByRole('link', { name: 'Сотрудники' }).click();
  await expect(hr.page.getByRole('heading', { name: 'Сотрудники', level: 1 })).toBeVisible();
  await hr.page.getByRole('searchbox', { name: 'Поиск сотрудников' }).fill(EMPLOYEE_NAME);
  const row = hr.page.getByRole('row').filter({ hasText: EMPLOYEE });
  await expect(row).toBeVisible();
  await shot(hr.page, '01-employees');
  await row.click();
  await expect(hr.page.getByRole('tab', { name: 'Профиль' })).toBeVisible();
  await expect(hr.page.getByRole('tab', { name: 'Заявки и документы' })).toBeVisible();
  await expect(hr.page.getByRole('tab', { name: 'Личные документы' })).toBeVisible();
  await hr.page.getByRole('tab', { name: 'Место работы' }).click();
  await expect(hr.page.getByText('Накоплено дней отпуска')).toBeVisible();
  await shot(hr.page, '02-employee-profile');

  await hr.page.getByRole('button', { name: 'Перевод' }).click();
  const transfer = hr.page.getByRole('dialog', { name: 'Перевод сотрудника' });
  await expect(transfer).toBeVisible();
  await transfer.getByLabel('Новый оклад, ₸').fill(salary);
  await transfer.getByLabel('Основание').fill('E2E: изменение оклада');
  await transfer.getByRole('button', { name: 'Сформировать приказ' }).click();
  await hr.page.waitForURL(/\/ru\/documents\/[a-z0-9]+$/);
  const docUrl = new URL(hr.page.url()).pathname;
  const docId = docUrl.split('/').pop()!;
  await expect(hr.page.getByRole('heading', { level: 1 })).toContainText('Приказ о переводе');
  await expect(hr.page.getByText('На согласовании').first()).toBeVisible();
  await expect(hr.page.getByTestId('route-step').first()).toHaveAttribute('data-status', 'PENDING');
  await shot(hr.page, '03-card-in-route');
  await hr.context.close();

  // CEO (signatory) signs from the inbox with the NCALayer PIN.
  const ceo = await login(browser, CEO);
  await ceo.page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: /Входящие/ }).click();
  await expect(ceo.page.getByRole('heading', { name: 'Входящие', level: 1 })).toBeVisible();
  const link = ceo.page.locator(`a[href$="/documents/${docId}"]`);
  await expect(link).toBeVisible();
  await shot(ceo.page, '04-inbox');
  await link.click();
  await expect(ceo.page.getByRole('region', { name: 'Ваше действие по документу' })).toContainText('Требуется подпись');
  await ceo.page.getByRole('button', { name: 'Подписать', exact: true }).click();
  const sign = ceo.page.getByRole('dialog');
  await expect(sign.getByText('Песочница')).toBeVisible();
  await expect(sign.getByRole('listitem').filter({ hasText: 'eGov mobile Business' })).toBeVisible();
  await shot(ceo.page, '05-sign-methods');
  await sign.getByRole('listitem').filter({ hasText: 'NCALayer' }).click();
  await sign.getByLabel('PIN-код ключа').fill('123456');
  await sign.getByRole('button', { name: 'Подписать с ЭЦП НУЦ' }).click();
  await expect(sign.getByText('Успешно подписано')).toBeVisible();
  await shot(ceo.page, '06-signed');
  await sign.getByRole('button', { name: 'Продолжить' }).click();
  await expect(ceo.page.getByTestId('route-step').first()).toHaveAttribute('data-status', 'DONE');
  await expect(ceo.page.getByText(/Подписано \d{2}\.\d{2}\.\d{4}/).first()).toBeVisible();
  await ceo.context.close();

  // The employee acknowledges.
  const emp = await login(browser, EMPLOYEE);
  await emp.page.goto(`/ru/documents/${docId}`);
  await expect(emp.page.getByRole('region', { name: 'Ваше действие по документу' })).toContainText('Требуется ознакомление');
  await emp.page.getByRole('button', { name: 'Ознакомиться', exact: true }).click();
  await expect(emp.page.getByText('Завершён').first()).toBeVisible();
  const verification = emp.page.getByTestId('signature-verification');
  await expect(verification).toContainText('Подписи действительны');
  await expect(verification).toContainText('NCALayer');
  await shot(emp.page, '07-completed');
  await emp.page.getByRole('tab', { name: 'Документ' }).click();
  await expect(emp.page.getByRole('button', { name: 'С подписями' })).toBeVisible();
  await emp.context.close();
});

test('eGov QR sandbox: session → phone page → Подписать → dialog shows success', async ({ browser }) => {
  test.setTimeout(240_000);
  // Prepare a fresh transfer order via the API (HR).
  const hrCtx = await browser.newContext();
  await apiLogin(hrCtx.request, HR);
  const empId = await employeeId(hrCtx.request);
  const res = await hrCtx.request.post(`/api/v1/employees/${empId}/events/transfer`, {
    data: { effectiveDate: new Date().toISOString().slice(0, 10), salary: 500_000 + Math.floor(Math.random() * 1000), reason: 'E2E QR' },
    headers: { 'X-Requested-With': 'akere' },
  });
  expect(res.status()).toBe(201);
  const docId = ((await res.json()) as { id: string }).id;

  const ceo = await login(browser, CEO);
  await ceo.page.goto(`/ru/documents/${docId}`);
  await ceo.page.getByRole('button', { name: 'Подписать', exact: true }).click();
  const dialog = ceo.page.getByRole('dialog');
  await dialog.getByRole('listitem').filter({ hasText: 'Для физических лиц' }).click();
  await expect(dialog.getByRole('img', { name: 'QR-код для подписания в eGov mobile' })).toBeVisible();
  await expect(dialog.getByText('Выберите «eGov QR»')).toBeVisible();
  await shot(ceo.page, '08-qr');
  const href = await dialog.getByRole('link', { name: 'Открыть на этом устройстве' }).getAttribute('href');
  expect(href).toMatch(/^\/ru\/sign\/.+/);

  // "Phone": the sandbox eGov page in the same browser context (same session).
  const phone = await ceo.context.newPage();
  await phone.setViewportSize({ width: 390, height: 800 });
  await phone.goto(href!);
  await expect(phone.getByRole('heading', { name: 'Подписать документы' })).toBeVisible();
  await expect(phone.getByText('Akere HR')).toBeVisible();
  await shot(phone, '09-egov-sandbox');
  await phone.getByRole('button', { name: 'Подписать', exact: true }).click();
  await expect(phone.getByText('Успешно подписано')).toBeVisible();
  await shot(phone, '10-egov-success');

  // The desktop dialog learns about it by polling.
  await expect(dialog.getByText('Успешно подписано')).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('button', { name: 'Продолжить' }).click();
  await expect(ceo.page.getByTestId('route-step').first()).toHaveAttribute('data-status', 'DONE');
  await ceo.context.close();

  // Clean up: HR cancels the order so the employee's inbox does not pile up.
  const cancel = await hrCtx.request.post(`/api/v1/documents/${docId}/cancel`, { data: { reason: 'E2E cleanup' }, headers: { 'X-Requested-With': 'akere' } });
  expect(cancel.ok()).toBeTruthy();
  await hrCtx.close();
});

test('registry, new document form and admin configuration render (HR, mobile width)', async ({ browser }) => {
  test.setTimeout(180_000);
  const hr = await login(browser, HR);
  await hr.page.goto('/ru/documents');
  await expect(hr.page.getByRole('heading', { name: 'Все документы', level: 1 })).toBeVisible();
  await expect(hr.page.getByRole('table', { name: 'Все документы' })).toBeVisible();
  await hr.page.goto('/ru/documents/new');
  await expect(hr.page.getByRole('heading', { name: 'Новый документ', level: 1 })).toBeVisible();
  await hr.page.goto('/ru/admin/routes');
  await expect(hr.page.getByRole('heading', { name: 'Маршруты', level: 1 })).toBeVisible();
  await hr.page.getByRole('button', { name: 'Новый маршрут' }).click();
  await expect(hr.page.getByRole('dialog', { name: 'Новый маршрут' })).toBeVisible();
  await shot(hr.page, '11-route-editor');
  await hr.page.keyboard.press('Escape');
  await hr.page.goto('/ru/admin/document-templates');
  await expect(hr.page.getByRole('heading', { name: 'Шаблоны документов', level: 1 })).toBeVisible();
  await hr.page.getByRole('link', { name: /Приказ о переводе/ }).first().click();
  await expect(hr.page.getByText('Переменные', { exact: true })).toBeVisible();
  await shot(hr.page, '12-template-editor');
  await hr.context.close();

  const mobile = await login(browser, HR, { width: 360, height: 780 });
  await mobile.page.goto('/ru/inbox');
  await expect(mobile.page.getByRole('heading', { name: 'Входящие', level: 1 })).toBeVisible();
  const overflow = await mobile.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await shot(mobile.page, '13-inbox-mobile');
  await mobile.context.close();
});
