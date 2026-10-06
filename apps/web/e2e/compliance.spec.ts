import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Phase 5 compliance UI: ВНД (create → recipients by department → send → employee acknowledges with NCALayer PIN →
 * HR sees the counter and downloads the sheet), ЕСУТД bulk submit, API key shown once, reports, help, support.
 * Run: WEB_URL=http://localhost:3105 pnpm exec playwright test e2e/compliance.spec.ts
 */
const PASSWORD = 'Akere2026demo';
const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/screenshots/compliance-${name}.png`, fullPage: false });

/** Minimal valid one-page PDF (passes the API magic-byte check and renders in pdf.js). */
function tinyPdf(text: string): Buffer {
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

async function login(browser: Browser, email: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto('/ru/login');
  await page.getByLabel('Эл. почта или телефон').fill(email);
  await page.getByRole('textbox', { name: 'Пароль', exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
  return page;
}

test.describe.configure({ mode: 'serial' });

test('ВНД: HR sends to a department, employee acknowledges with ЭЦП, HR sees progress and downloads the sheet', async ({ browser }) => {
  const title = `E2E Инструкция по охране труда ${Date.now()}`;
  const hr = await login(browser, 'hr@dala.kz');

  // The department of the employee who will acknowledge.
  const options = await hr.request.get('/api/v1/employees/options?q=Серикова');
  expect(options.ok()).toBeTruthy();
  const serikova = ((await options.json()) as { fullName: string; department: string | null }[])[0];
  expect(serikova?.department).toBeTruthy();

  await hr.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'ВНД' }).click();
  await expect(hr.getByRole('heading', { name: 'ВНД', level: 1 })).toBeVisible();
  await expect(hr.getByRole('tab', { name: 'Все' })).toBeVisible();
  await hr.waitForLoadState('networkidle');
  await shot(hr, '01-vnd-registry');

  // Create
  await hr.getByRole('button', { name: 'Новый ВНД' }).first().click();
  const dialog = hr.getByRole('dialog');
  await dialog.getByLabel('Название').fill(title);
  await dialog.locator('input[type=file]').setInputFiles({ name: 'instruction.pdf', mimeType: 'application/pdf', buffer: tinyPdf('Safety instruction') });
  await dialog.getByRole('button', { name: 'Создать' }).click();
  await expect(hr.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  await expect(hr.getByText('Черновик').first()).toBeVisible();
  await expect(hr.locator('canvas').first()).toBeVisible();

  // Recipients: a whole department
  await hr.getByRole('tab', { name: /Ознакомление/ }).click();
  await hr.getByRole('button', { name: 'Добавить получателя' }).first().click();
  const add = hr.getByRole('dialog');
  await add.getByText('Подразделения', { exact: true }).click();
  await add.getByRole('combobox').click();
  await hr.getByRole('option', { name: new RegExp(serikova!.department!) }).first().click();
  await hr.keyboard.press('Escape');
  await add.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(hr.getByText(/Получатель добавлен|Добавлено \d+ получател/)).toBeVisible();
  await expect(hr.getByRole('cell', { name: serikova!.fullName })).toBeVisible();
  await shot(hr, '02-vnd-recipients');

  // Send
  await hr.getByRole('button', { name: 'Отправить на ознакомление' }).click();
  await hr.getByRole('dialog').getByRole('button', { name: 'Отправить на ознакомление' }).click();
  await expect(hr.getByText('ВНД отправлен на ознакомление')).toBeVisible();
  await expect(hr.getByText('На ознакомлении').first()).toBeVisible();
  const vndUrl = hr.url();
  const before = Number((await hr.getByTestId('vnd-progress').innerText()).split('/')[0]!.trim());

  // Employee acknowledges
  const emp = await login(browser, 'a.serikova@dala.kz');
  await emp.goto('/ru/vnd');
  await expect(emp.getByRole('heading', { name: 'ВНД', level: 1 })).toBeVisible();
  const card = emp.getByRole('link', { name: new RegExp(title) });
  await expect(card).toBeVisible();
  await expect(card.getByText('Требуется ознакомление')).toBeVisible();
  await shot(emp, '03-vnd-my');
  await card.click();
  await emp.getByRole('button', { name: 'Подтвердить ознакомление' }).click();
  const ack = emp.getByRole('dialog');
  await expect(ack.getByTestId('vnd-qr')).toBeVisible();
  await shot(emp, '04-vnd-ack-qr');
  await ack.getByRole('tab', { name: 'ЭЦП НУЦ' }).click();
  await ack.getByLabel('PIN-код ключа').fill('123456');
  await ack.getByRole('button', { name: 'Подписать', exact: true }).click();
  await expect(emp.getByText('Ознакомление подтверждено')).toBeVisible();
  await expect(emp.getByText('Вы ознакомились с этим документом.')).toBeVisible();

  // HR sees the counter grow and downloads the sheet
  await hr.goto(vndUrl);
  await expect(hr.getByTestId('vnd-progress')).toContainText(`${before + 1}`);
  await hr.getByRole('tab', { name: /Ознакомление/ }).click();
  await expect(hr.getByRole('row', { name: new RegExp(serikova!.fullName) }).getByText('Ознакомлен', { exact: true })).toBeVisible();
  const download = hr.waitForEvent('download');
  await hr.getByRole('button', { name: 'Лист ознакомления' }).first().click();
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);

  // Mobile: employee list has no horizontal scroll at 360 px
  await emp.setViewportSize({ width: 360, height: 780 });
  await emp.goto('/ru/vnd');
  await expect(emp.getByRole('heading', { name: 'ВНД', level: 1 })).toBeVisible();
  const overflow = await emp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await emp.context().close();
  await hr.context().close();
});

test('ЕСУТД: bulk submit queues documents', async ({ browser }) => {
  const hr = await login(browser, 'hr@dala.kz');
  await hr.goto('/ru/esutd');
  await expect(hr.getByRole('heading', { name: /ЕСУТД/, level: 1 })).toBeVisible();
  await hr.waitForLoadState('networkidle');
  await shot(hr, '05-esutd');
  const pending = hr.getByRole('row').filter({ has: hr.getByText(/^(Не отправлено|Ошибка)$/) });
  const count = await pending.count();
  test.skip(count === 0, 'No documents waiting for ЕСУТД in this database');
  await pending.first().getByRole('checkbox').check();
  await hr.getByRole('button', { name: /Отправить в ЕСУТД/ }).click();
  await expect(hr.getByText(/поставлен.* в очередь|не отправлен/)).toBeVisible();
  await hr.context().close();
});

test('API keys: admin creates a key, sees it once, revokes it', async ({ browser }) => {
  const admin = await login(browser, 'admin@dala.kz');
  await admin.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'API-ключи' }).click();
  await expect(admin.getByRole('heading', { name: 'API-ключи', level: 1 })).toBeVisible();
  const name = `E2E 1С ${Date.now()}`;
  await admin.getByRole('button', { name: 'Новый ключ' }).first().click();
  const dialog = admin.getByRole('dialog');
  await dialog.getByLabel('Название').fill(name);
  await dialog.getByRole('checkbox', { name: /employees:read/ }).check();
  await dialog.getByRole('button', { name: 'Создать ключ' }).click();
  const value = admin.getByTestId('api-key-value');
  await expect(value).toHaveText(/^ak_[0-9a-f]{12}_/);
  await expect(admin.getByText(/показывается только один раз/)).toBeVisible();
  await shot(admin, '06-api-key-once');
  await admin.getByRole('button', { name: 'Я сохранил ключ' }).click();
  await expect(admin.getByTestId('api-key-value')).toHaveCount(0);
  const row = admin.getByRole('row', { name: new RegExp(name) });
  await expect(row).toBeVisible();
  await shot(admin, '07-api-keys');
  await row.getByRole('button', { name: 'Отозвать' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Отозвать' }).click();
  await expect(row.getByText('Отозван')).toBeVisible();
  await admin.context().close();
});

test('Reports, archive, help and support render', async ({ browser }) => {
  const hr = await login(browser, 'hr@dala.kz');
  await hr.goto('/ru/reports');
  await expect(hr.getByRole('heading', { name: 'Отчёты и аналитика', level: 1 })).toBeVisible();
  await expect(hr.getByText('Численность', { exact: true }).first()).toBeVisible();
  await hr.waitForLoadState('networkidle');
  await shot(hr, '08-reports');
  const download = hr.waitForEvent('download');
  await hr.getByRole('button', { name: 'Экспорт в Excel' }).click();
  await hr.getByRole('menuitem', { name: 'Движение персонала' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);

  await hr.goto('/ru/archive');
  await expect(hr.getByRole('heading', { name: 'Электронный архив', level: 1 })).toBeVisible();
  await hr.locator('input[type=file]').setInputFiles({ name: 'old-order.pdf', mimeType: 'application/pdf', buffer: tinyPdf('Archive') });
  await expect(hr.getByRole('cell', { name: /old-order\.pdf/ })).toBeVisible();
  await shot(hr, '09-archive');

  await hr.goto('/ru/help');
  await expect(hr.getByRole('heading', { name: 'База знаний', level: 1 })).toBeVisible();
  const first = hr.locator('main a[href*="/help/"]').first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(hr.getByRole('article')).toBeVisible();
  await shot(hr, '10-help-article');

  await hr.goto('/ru/support');
  await hr.getByLabel('Тема').fill('E2E: проверка формы');
  await hr.getByLabel('Сообщение').fill('Автотест проверяет отправку обращения в поддержку.');
  await hr.getByRole('button', { name: 'Отправить' }).click();
  await expect(hr.getByText('Спасибо! Обращение принято')).toBeVisible();
  await hr.context().close();
});
