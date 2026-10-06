import { expect, test, type Page } from '@playwright/test';

/**
 * P1 smoke test against a running web (3000) + API (4000) in DEMO_MODE.
 * Screenshots go to e2e/screenshots/ (gitignored).
 */
const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/screenshots/${name}.png`, fullPage: false });

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test('login page renders with demo accounts', async ({ page }) => {
  await page.goto('/ru/login');
  await expect(page.getByRole('heading', { name: 'Вход в Akere HR' })).toBeVisible();
  await expect(page.getByLabel('Эл. почта или телефон')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Демо-доступ' })).toBeVisible();
  await shot(page, '01-login-desktop');
});

test('wrong password shows an error', async ({ page }) => {
  await page.goto('/ru/login');
  await page.getByLabel('Эл. почта или телефон').fill('nobody@example.kz');
  await page.getByRole('textbox', { name: 'Пароль', exact: true }).fill('wrong-password-1');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByText(/Неверный логин|Слишком много попыток/)).toBeVisible();
  await shot(page, '02-login-error');
});

test('demo login as admin and browse P1 pages', async ({ page }) => {
  await page.goto('/ru/login');
  await page.getByRole('button', { name: /Войти как .*Администратор/ }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/(Доброе утро|Добрый день|Добрый вечер|Доброй ночи)/);
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
  await shot(page, '03-home-admin');

  const nav = page.getByRole('navigation', { name: 'Основная навигация' });
  await nav.getByRole('link', { name: 'Пользователи' }).click();
  await expect(page.getByRole('heading', { name: 'Пользователи', level: 1 })).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await shot(page, '04-admin-users');

  await page.getByRole('button', { name: 'Новый пользователь' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await shot(page, '05-admin-user-dialog');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  await nav.getByRole('link', { name: 'Юрлица и структура' }).click();
  await expect(page.getByRole('heading', { name: 'Юрлица и структура', level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await shot(page, '06-admin-org-entities');
  await page.getByRole('tab', { name: 'Структура' }).click();
  await page.waitForLoadState('networkidle');
  await shot(page, '07-admin-org-structure');
  await page.getByRole('tab', { name: 'Места работы' }).click();
  await page.waitForLoadState('networkidle');
  await shot(page, '08-admin-org-locations');

  await nav.getByRole('link', { name: 'Журнал аудита' }).click();
  await expect(page.getByRole('heading', { name: 'Журнал аудита', level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await shot(page, '09-admin-audit');

  await nav.getByRole('link', { name: 'Outbox' }).click();
  await expect(page.getByRole('heading', { name: 'Outbox', level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await shot(page, '10-admin-outbox');

  await page.goto('/ru/notifications');
  await expect(page.getByRole('heading', { name: 'Уведомления', level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await shot(page, '11-notifications');

  await page.goto('/ru/profile');
  await expect(page.getByRole('heading', { name: 'Мой профиль', level: 1 })).toBeVisible();
  await shot(page, '12-profile');

  await page.getByRole('button', { name: 'Уведомления' }).first().click();
  await page.waitForTimeout(500);
  await shot(page, '13-notification-popover');
});

test('employee sees no admin section; mobile layout has no horizontal scroll', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('/ru/login');
  await expect(page.getByRole('heading', { name: 'Демо-доступ' })).toBeVisible();
  await noHorizontalScroll(page);
  await shot(page, '14-login-mobile');
  await page.getByRole('button', { name: /Войти как .*\(Сотрудник\)/ }).last().click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await noHorizontalScroll(page);
  await shot(page, '15-home-mobile');
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.waitForTimeout(400); // slide-in animation
  await expect(page.getByText('Администрирование')).toHaveCount(0);
  await shot(page, '16-mobile-drawer');
  await ctx.close();
});

test('kazakh locale', async ({ page }) => {
  await page.goto('/kk/login');
  await expect(page.getByRole('heading', { name: 'Akere HR жүйесіне кіру' })).toBeVisible();
  await shot(page, '17-login-kk');
});
