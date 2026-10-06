import { expect, request as pwRequest, test, type Page } from '@playwright/test';

/**
 * Candidate onboarding end to end (SPEC F-01…F-13): HR creates a request template and a candidate,
 * requests documents, the candidate signs in to the portal with the OTP from the outbox, autofills
 * via the digital personal file (511), submits; HR accepts and hires.
 * Run: WEB_URL=http://localhost:3102 pnpm exec playwright test e2e/onboarding.spec.ts
 */
const PASSWORD = 'Akere2026demo';
const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/screenshots/onboarding-${name}.png`, fullPage: false });

/** Random ИИН with a valid checksum (born 1990-1999, male). */
function randomIin(): string {
  for (;;) {
    const yy = String(90 + Math.floor(Math.random() * 10));
    const mm = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
    const dd = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');
    const rest = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    const base = `${yy}${mm}${dd}3${rest}`;
    const d = base.split('').map(Number);
    let sum = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].reduce((s, w, i) => s + w * d[i]!, 0) % 11;
    if (sum === 10) sum = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2].reduce((s, w, i) => s + w * d[i]!, 0) % 11;
    if (sum < 10) return `${base}${sum}`;
  }
}

async function login(page: Page, email: string) {
  await page.goto('/ru/login');
  await page.getByLabel('Эл. почта или телефон').fill(email);
  await page.getByRole('textbox', { name: 'Пароль', exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible({ timeout: 90_000 });
}

async function pickOption(page: Page, label: string | RegExp, option: string | RegExp) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).first().click();
}

/** Reads the latest portal sign-in code sent to `to` from the sandbox outbox (admin API). */
async function otpFromOutbox(baseURL: string, to: string): Promise<string> {
  const api = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { 'X-Requested-With': 'akere' } });
  const res = await api.post('/api/v1/auth/login', { data: { login: 'admin@dala.kz', password: PASSWORD } });
  expect(res.ok()).toBeTruthy();
  let code: string | null = null;
  for (let i = 0; i < 20 && !code; i++) {
    const list = await (await api.get('/api/v1/org/outbox', { params: { channel: 'EMAIL', page: 1, pageSize: 50 } })).json();
    const msg = (list.items as { to: string; body: string }[]).find((m) => m.to === to && /\b\d{6}\b/.test(m.body) && /Akere HR/.test(m.body));
    code = msg?.body.match(/\b(\d{6})\b/)?.[1] ?? null;
    if (!code) await new Promise((r) => setTimeout(r, 500));
  }
  await api.dispose();
  if (!code) throw new Error(`No OTP in outbox for ${to}`);
  return code;
}

test('candidate onboarding: template → candidate → request → portal autofill → accept → hire', async ({ page, browser, baseURL }) => {
  test.setTimeout(360_000);
  const stamp = Date.now().toString(36);
  const email = `e2e.cand.${stamp}@example.kz`;
  const lastName = 'Тестов';
  const firstName = `Кандидат${stamp.slice(-4)}`;
  const templateName = `E2E шаблон ${stamp}`;

  // ── HR: request template (F-04) ──
  await login(page, 'hr@dala.kz');
  await page.goto('/ru/onboarding/request-templates/new');
  await expect(page.getByRole('heading', { name: 'Новый шаблон', level: 1 })).toBeVisible();
  await page.getByLabel('Название шаблона').fill(templateName);
  await page.getByRole('checkbox', { name: /Удостоверение личности гражданина РК/ }).click();
  await page.getByRole('checkbox', { name: /Адрес по прописке/ }).click();
  await shot(page, '01-template-editor');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Шаблоны запросов', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: templateName })).toBeVisible();

  // ── HR: new candidate (F-02) ──
  await page.goto('/ru/candidates');
  await expect(page.getByRole('heading', { name: 'Кандидаты', level: 1 })).toBeVisible();
  await expect(page.getByText(/Всего кандидатов: \d+/)).toBeVisible();
  await page.waitForLoadState('networkidle');
  await shot(page, '02-registry');
  await page.getByRole('link', { name: 'Новый кандидат' }).first().click();
  await expect(page.getByRole('heading', { name: 'Новый кандидат', level: 1 })).toBeVisible();
  await page.getByRole('textbox', { name: /^Фамилия/ }).fill(lastName);
  await page.getByRole('textbox', { name: /^Имя/ }).fill(firstName);
  await page.getByRole('textbox', { name: /^ИИН/ }).fill(randomIin());
  await page.getByRole('textbox', { name: /^Электронный адрес/ }).fill(email);
  await page.getByRole('button', { name: 'Сохранить', exact: true }).first().click();
  await expect(page).toHaveURL(/\/ru\/candidates\/[a-z0-9]+$/);
  await expect(page.getByRole('heading', { name: `${lastName} ${firstName}`, level: 1 })).toBeVisible();
  const candidateUrl = page.url();

  // ── HR: request documents (F-06) ──
  await page.getByRole('button', { name: 'Запросить документы' }).click();
  const dlg = page.getByRole('dialog', { name: 'Запросить документы' });
  await expect(dlg).toBeVisible();
  await pickOption(page, 'Шаблон запроса', new RegExp(templateName));
  await dlg.getByRole('button', { name: 'Отправить' }).click();
  await expect(dlg.getByText('Отправлено запросов: 1')).toBeVisible();
  await dlg.getByRole('button', { name: 'Закрыть' }).first().click();
  await expect(page.getByText('Отправлено', { exact: true }).first()).toBeVisible();

  // ── Candidate: portal (F-07, F-08) on a phone-sized screen ──
  const portalCtx = await browser.newContext({ baseURL, viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
  const portal = await portalCtx.newPage();
  await portal.goto(`/ru/portal?login=${encodeURIComponent(email)}`);
  await expect(portal.getByRole('heading', { name: 'Вход в кабинет кандидата' })).toBeVisible();
  await expect(portal.getByLabel('Электронный адрес или телефон')).toHaveValue(email);
  await portal.getByRole('button', { name: 'Получить код' }).click();
  await expect(portal.getByText(/Код отправлен/)).toBeVisible();
  const code = await otpFromOutbox(baseURL!, email);
  await portal.getByLabel('Код из сообщения').fill(code);
  await expect(portal.getByRole('heading', { name: new RegExp(`Добро пожаловать, ${lastName} ${firstName}`) })).toBeVisible();
  await expect(portal.getByRole('heading', { name: 'Цифровое личное дело' })).toBeVisible();
  await portal.waitForLoadState('networkidle');
  await shot(portal, '03-portal-cabinet-360');
  const overflow = await portal.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await portal.getByRole('button', { name: 'Заполнить автоматически' }).click();
  const sms = portal.getByRole('dialog', { name: 'Согласие на получение данных' });
  await expect(sms).toBeVisible();
  await expect(sms.getByText('1414', { exact: true })).toBeVisible();
  await shot(portal, '04-portal-sms-360');
  await sms.getByRole('button', { name: 'Ответить 511 (ДА)' }).click();
  await expect(sms.getByText('Документы загружены')).toBeVisible();
  await sms.getByRole('button', { name: 'Продолжить' }).click();
  await expect(portal.getByText(/Готово 2 из 2/)).toBeVisible();
  await portal.getByRole('button', { name: 'Подтвердить готовность' }).click();
  await expect(portal.getByRole('heading', { name: 'Документы отправлены на проверку' })).toBeVisible();
  await shot(portal, '05-portal-submitted-360');
  await portalCtx.close();

  // ── HR: review + accept (F-09) ──
  await page.goto(`${candidateUrl}?tab=request`);
  await expect(page.getByRole('heading', { name: templateName })).toBeVisible();
  await expect(page.getByText('Документы загружены').first()).toBeVisible();
  await page.getByRole('button', { name: /Удостоверение личности гражданина РК/ }).click();
  await expect(page.getByRole('heading', { name: 'Заполните поля документа' }).first()).toBeVisible();
  await expect(page.locator('iframe[title^="Просмотр"]').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  await shot(page, '06-hr-review');
  await page.getByRole('button', { name: 'Принять', exact: true }).click();
  const acceptDlg = page.getByRole('dialog', { name: 'Принять документы' });
  await expect(acceptDlg).toBeVisible();
  await acceptDlg.getByRole('button', { name: 'Принять', exact: true }).click();
  await expect(acceptDlg).toBeHidden();
  await expect(page.getByText('Рекомендован', { exact: true }).first()).toBeVisible();

  // ── HR: hire (F-12) ──
  await page.getByRole('button', { name: 'Оформить', exact: true }).click();
  const hireDlg = page.getByRole('dialog', { name: 'Оформить кандидата' });
  await expect(hireDlg).toBeVisible();
  await pickOption(page, 'Подразделение', /.+/);
  await pickOption(page, 'Должность', /.+/);
  await hireDlg.getByLabel('Оклад').fill('350000');
  await hireDlg.getByRole('button', { name: 'Оформить', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Сотрудник создан' })).toBeVisible({ timeout: 60_000 });
  await shot(page, '07-hired');
  await page.getByRole('dialog', { name: 'Сотрудник создан' }).getByRole('button', { name: 'Закрыть' }).first().click();
  await expect(page.getByText('Кандидат оформлен на работу.', { exact: false })).toBeVisible();
});
