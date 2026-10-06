import { test } from '@playwright/test';
test('probe', async ({ page }) => {
  test.setTimeout(120000);
  page.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 300)));
  page.on('response', async (r) => { if (r.url().includes('/api/v1/') && r.request().method() !== 'GET') console.log('RESP', r.status(), r.request().method(), r.url(), (await r.text().catch(() => '')).slice(0, 200)); });
  await page.goto('/ru/login');
  await page.getByLabel('Эл. почта или телефон').fill('a.serikova@dala.kz');
  await page.getByRole('textbox', { name: 'Пароль', exact: true }).fill('Akere2026demo');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL(/\/ru$/);
  await page.goto('/ru/vnd/cmux0tdwr05g17d8s6fr84bop');
  await page.getByRole('button', { name: 'Подтвердить ознакомление' }).click();
  await page.waitForTimeout(4000);
  await page.getByRole('dialog').getByRole('tab', { name: 'ЭЦП НУЦ' }).click();
  await page.getByRole('dialog').getByLabel('PIN-код ключа').fill('123456');
  await page.getByRole('dialog').getByRole('button', { name: 'Подписать', exact: true }).click();
  await page.waitForTimeout(6000);
  await page.screenshot({ path: 'e2e/screenshots/compliance-probe.png' });
});
