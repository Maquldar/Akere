import { test } from '@playwright/test';
test('probe', async ({ page }) => {
  page.on('console', (m) => console.log('CONSOLE', m.type(), m.text().slice(0, 300)));
  page.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 300)));
  await page.goto('/ru/login');
  await page.getByLabel('Эл. почта или телефон').fill('hr@dala.kz');
  await page.getByRole('textbox', { name: 'Пароль', exact: true }).fill('Akere2026demo');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL(/\/ru$/);
  const r = await page.request.get('/api/v1/vnd?page=1&pageSize=5');
  const j = await r.json(); console.log('VND', JSON.stringify(j.items.map((x: {id:string;title:string}) => [x.id, x.title])));
  await page.goto('/ru/vnd/' + j.items[0].id);
  await page.waitForTimeout(12000);
  await page.screenshot({ path: 'e2e/screenshots/compliance-probe.png' });
});
