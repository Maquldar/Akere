import { test } from '@playwright/test';
test('csp', async ({ page }) => {
  const msgs: string[] = [];
  page.on('console', (m) => msgs.push(m.type() + ': ' + m.text()));
  await page.goto('http://localhost:3103/ru/login');
  await page.getByRole('button', { name: /Войти как Сулейменова/ }).click();
  await page.waitForURL((u) => !u.pathname.includes('/login'));
  await page.goto('http://localhost:3103/ru/admin/document-templates');
  await page.getByRole('link', { name: /Приказ о переводе/ }).first().click();
  await page.waitForTimeout(8000);
  const src = await page.locator('iframe').first().getAttribute('src');
  console.log('IFRAME', src);
  console.log(msgs.filter((m) => /frame|Content Security|Refused/i.test(m)).join('\n'));
});
