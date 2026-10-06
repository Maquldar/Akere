import { expect, test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';

/**
 * P6 E2E (time tracking): manager plans + publishes a shift via the "+" popover → the employee sees it
 * in "Мой график" → the employee clocks in/out with a (fake) camera selfie and geolocation → HR opens
 * Form T-13 and downloads the Excel file. Runs against a web dev server (WEB_URL) proxying to the API.
 */

const PASSWORD = 'Akere2026demo';
const EMPLOYEE = 'a.serikova@dala.kz';
const EMPLOYEE_SHORT = 'Серикова Ә.Б.';
const MANAGER = 'r.alimov@dala.kz';
const HR = 'hr@dala.kz';
const OFFICE = { latitude: 51.0906, longitude: 71.4183 };

test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
});

const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/screenshots/time-${name}.png`, fullPage: false });

async function login(browser: Browser, email: string, extra: BrowserContextOptions = {}) {
  const context = await browser.newContext(extra);
  const page = await context.newPage();
  await page.goto('/ru/login');
  await page.getByLabel('Эл. почта или телефон').fill(email);
  await page.getByRole('textbox', { name: 'Пароль', exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
  return { context, page };
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Saturday of next week in Asia/Almaty (no regular 5/2 shift there). */
function nextWeekSaturday(): { weekStart: string; saturday: string } {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date());
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const base = new Date(Date.UTC(y, m - 1, d, 12));
  const monday = new Date(base.getTime() - ((base.getUTCDay() + 6) % 7) * 86_400_000 + 7 * 86_400_000);
  return { weekStart: ymd(monday), saturday: ymd(new Date(monday.getTime() + 5 * 86_400_000)) };
}

test('manager plans and publishes a shift; employee sees it, clocks in/out; HR exports T-13', async ({ browser }) => {
  test.setTimeout(300_000);
  const { weekStart, saturday } = nextWeekSaturday();
  const weekEnd = ymd(new Date(Date.parse(`${weekStart}T12:00:00Z`) + 6 * 86_400_000));

  // ── Manager: clean the target cell, assign "День офис" via the + popover, publish ──
  const mgr = await login(browser, MANAGER);
  const sched = await mgr.page.request.get(`/api/v1/time/schedule?from=${weekStart}&to=${weekEnd}&scope=managed`);
  expect(sched.ok()).toBeTruthy();
  const body = (await sched.json()) as { rows: { employee: { shortName: string }; shifts: { id: string; date: string }[] }[] };
  const row = body.rows.find((r) => r.employee.shortName === EMPLOYEE_SHORT);
  expect(row, 'employee is managed by the manager').toBeTruthy();
  for (const s of row!.shifts.filter((x) => x.date === saturday)) {
    const del = await mgr.page.request.delete(`/api/v1/time/shifts/${s.id}`, { headers: { 'X-Requested-With': 'akere' } });
    expect(del.status()).toBe(204);
  }

  await mgr.page.goto('/ru/time/planning');
  await expect(mgr.page.getByRole('table', { name: 'Планирование смен на неделю' })).toBeVisible();
  await mgr.page.getByRole('button', { name: 'Вперёд' }).click();
  const plus = mgr.page.getByRole('button', { name: `Назначить смену: ${EMPLOYEE_SHORT}, ${saturday}` });
  await expect(plus).toBeVisible();
  await plus.click();
  await expect(mgr.page.getByText('Назначить смену', { exact: true })).toBeVisible();
  await shot(mgr.page, '01-planning-popover');
  await mgr.page.getByRole('menuitem', { name: /День офис/ }).click();
  await expect(mgr.page.getByText(/Смена «День офис» назначена/)).toBeVisible();
  const publish = mgr.page.getByRole('button', { name: 'Опубликовать' });
  await expect(publish).toBeEnabled();
  await publish.click();
  await expect(mgr.page.getByText(/Опубликован/).first()).toBeVisible();
  await mgr.page.waitForLoadState('networkidle');
  await shot(mgr.page, '02-planning');
  await mgr.context.close();

  // ── Employee: sees the published shift in "Мой график", then clocks in and out ──
  const emp = await login(browser, EMPLOYEE, { permissions: ['camera', 'geolocation'], geolocation: OFFICE });
  await emp.page.goto('/ru/time/schedule?tab=team');
  await expect(emp.page.getByRole('table', { name: 'График команды на неделю' })).toBeVisible();
  await emp.page.getByRole('button', { name: 'Вперёд' }).click();
  const myRow = emp.page.getByRole('row').filter({ has: emp.page.getByRole('rowheader', { name: new RegExp(EMPLOYEE_SHORT) }) });
  await expect(myRow.getByText('День офис').first()).toBeVisible();
  await shot(emp.page, '03-my-schedule');

  await emp.page.goto('/ru/time');
  await expect(emp.page.getByRole('heading', { name: 'Моя смена' })).toBeVisible();
  // A leftover open session from an interrupted run is closed first.
  const clockOut = emp.page.getByRole('button', { name: 'Отметить уход', exact: true });
  const clockIn = emp.page.getByRole('button', { name: /^Отметить приход/ }).first();
  await expect(clockOut.or(clockIn).first()).toBeVisible();
  if (await clockOut.isVisible()) {
    await clockOut.click();
    await emp.page.getByRole('dialog').getByRole('button', { name: 'Сделать снимок' }).click();
    await expect(emp.page.getByText('Смена завершена')).toBeVisible();
    await expect(emp.page.getByRole('dialog')).toBeHidden();
  }
  await shot(emp.page, '04-my-time');

  await emp.page.getByRole('button', { name: /^Отметить приход/ }).first().click();
  const dialog = emp.page.getByRole('dialog');
  await expect(dialog.getByText('Посмотрите прямо в камеру')).toBeVisible();
  const snap = dialog.getByRole('button', { name: 'Сделать снимок' });
  await expect(snap).toBeVisible();
  await emp.page.waitForTimeout(600); // let the fake stream deliver frames
  await shot(emp.page, '05-identity');
  await snap.click();
  await expect(dialog.getByText(/Верификация пройдена|Отметка сохранена/)).toBeVisible();
  await expect(emp.page.getByText(/Вы отметились в \d\d:\d\d/)).toBeVisible();
  await expect(dialog).toBeHidden();
  // Live timer card.
  await expect(emp.page.getByRole('button', { name: 'Перерыв' })).toBeVisible();
  await expect(clockOut).toBeVisible();
  await shot(emp.page, '06-timer');

  await clockOut.click();
  await expect(dialog.getByRole('button', { name: 'Сделать снимок' })).toBeVisible();
  await emp.page.waitForTimeout(400);
  await dialog.getByRole('button', { name: 'Сделать снимок' }).click();
  await expect(emp.page.getByText('Смена завершена')).toBeVisible();
  await expect(emp.page.getByRole('button', { name: 'Запросить корректировку' })).toBeVisible();
  await shot(emp.page, '07-finished');
  await emp.context.close();

  // ── HR: Form T-13 → download Excel ──
  const hr = await login(browser, HR);
  await hr.page.goto('/ru/time/timesheet');
  await expect(hr.page.getByRole('heading', { name: /\S/ }).first()).toBeVisible();
  await hr.page.waitForLoadState('networkidle');
  await shot(hr.page, '08-today');
  await hr.page.getByRole('tab', { name: 'Форма Т-13' }).click();
  await expect(hr.page.getByRole('table', { name: 'Табель учёта рабочего времени Т-13' })).toBeVisible();
  await hr.page.waitForLoadState('networkidle');
  await shot(hr.page, '09-t13');
  const [download] = await Promise.all([hr.page.waitForEvent('download'), hr.page.getByRole('button', { name: 'Выгрузить Т-13' }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  await expect(hr.page.getByText(/скачан/)).toBeVisible();
  await hr.context.close();
});
