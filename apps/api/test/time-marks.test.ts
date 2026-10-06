import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db';
import { createApp, resetDb, SAMPLE_PDF, SAMPLE_PNG, type TestApp } from './helpers';
import { LOC, makeMarks, makePng, makeShift, timeSetup, today } from './time-fixtures';
import { addDaysStr, localTimeStr } from '../src/lib/calendar';

let app: TestApp;
beforeAll(async () => {
  app = await createApp();
});
afterAll(() => app.close());
beforeEach(resetDb);

const mark = (c: { upload: (u: string, f: { field?: string; filename: string; content: Buffer }[], fields?: Record<string, string>) => Promise<{ statusCode: number; json: () => any }> }, type: string, extra: Record<string, string> = {}, selfie?: Buffer) =>
  c.upload('/time/marks', selfie ? [{ field: 'selfie', filename: 'selfie.png', content: selfie }] : [], { type, ...extra });

describe('time marks', () => {
  it('validates the IN → BREAK → OUT sequence', async () => {
    const { c } = await timeSetup(app);
    const out = await mark(c.e1, 'OUT');
    expect(out.statusCode).toBe(422);
    expect(out.json().error.details.rule).toBe('INVALID_SEQUENCE');
    expect(out.json().error.details.allowed).toEqual(['IN']);
    const inRes = await mark(c.e1, 'IN');
    expect(inRes.statusCode).toBe(201);
    expect(inRes.json().mark.type).toBe('IN');
    expect(inRes.json().mark.verification).toBe('SKIPPED');
    expect(inRes.json().day.status).toBe('ON_SHIFT');
    expect((await mark(c.e1, 'IN')).statusCode).toBe(422);
    expect((await mark(c.e1, 'BREAK_START')).json().day.status).toBe('ON_BREAK');
    expect((await mark(c.e1, 'OUT')).json().error.details.rule).toBe('INVALID_SEQUENCE');
    expect((await mark(c.e1, 'BREAK_END')).statusCode).toBe(201);
    const fin = await mark(c.e1, 'OUT');
    expect(fin.statusCode).toBe(201);
    expect(fin.json().day.status).toBe('FINISHED');
    expect(fin.json().day.marks).toHaveLength(4);
    // After OUT a new session may start.
    expect((await mark(c.e1, 'IN')).statusCode).toBe(201);
    // Also accepts JSON bodies.
    const bad = await c.e1.post('/time/marks', { type: 'NAP' });
    expect(bad.statusCode).toBe(400);
  });

  it('rejects marks outside the geofence and stores the distance', async () => {
    const { c } = await timeSetup(app, { requireGeofence: true });
    const noGeo = await mark(c.e1, 'IN');
    expect(noGeo.json().error.details.rule).toBe('GEOLOCATION_REQUIRED');
    const far = await mark(c.e1, 'IN', { lat: String(LOC.lat + 0.01), lng: String(LOC.lng), accuracyM: '20' });
    expect(far.statusCode).toBe(422);
    expect(far.json().error.details.rule).toBe('OUTSIDE_GEOFENCE');
    expect(far.json().error.details.distanceM).toBeGreaterThan(1000);
    // A huge reported accuracy does not open the fence.
    expect((await mark(c.e1, 'IN', { lat: String(LOC.lat + 0.01), lng: String(LOC.lng), accuracyM: '50000' })).statusCode).toBe(422);
    const near = await mark(c.e1, 'IN', { lat: String(LOC.lat + 0.001), lng: String(LOC.lng), accuracyM: '15' });
    expect(near.statusCode).toBe(201);
    expect(near.json().mark.distanceM).toBeGreaterThan(100);
    expect(near.json().mark.distanceM).toBeLessThan(120);
    expect(near.json().day.settings.requireGeofence).toBe(true);
    expect(near.json().day.settings.location.radiusM).toBe(200);
  });

  it('requires a selfie for IN/OUT, records verification and protects the file', async () => {
    const { c } = await timeSetup(app, { requireSelfie: true });
    const none = await mark(c.e1, 'IN');
    expect(none.statusCode).toBe(422);
    expect(none.json().error.details.rule).toBe('SELFIE_REQUIRED');
    expect((await mark(c.e1, 'IN', {}, SAMPLE_PDF)).statusCode).toBe(415);
    const tiny = await mark(c.e1, 'IN', {}, SAMPLE_PNG); // 1×1 px: stored but flagged
    expect(tiny.statusCode).toBe(201);
    expect(tiny.json().mark.verification).toBe('FAILED');
    expect(tiny.json().mark.verificationNote).toMatch(/маленький/);
    expect((await mark(c.e1, 'BREAK_START')).statusCode).toBe(201); // breaks need no selfie
    await mark(c.e1, 'BREAK_END');
    const ok = await mark(c.e1, 'OUT', {}, makePng(160, 160));
    expect(ok.json().mark.verification).toBe('PASSED');
    const url = ok.json().mark.selfieUrl as string;
    expect((await c.e1.get(url)).statusCode).toBe(200);
    expect((await c.mgr.get(url)).statusCode).toBe(200);
    expect((await c.hr.get(url)).statusCode).toBe(200);
    expect((await c.e2.get(url)).statusCode).toBe(404);
    expect((await c.om.get(url)).statusCode).toBe(404);
  });

  it('builds my day with the shift, lateness and upcoming week', async () => {
    const { t, emp1, c } = await timeSetup(app);
    const d = today();
    const now = new Date();
    // A shift that started 3 hours ago and ends in 5 hours.
    const start = localTimeStr(new Date(now.getTime() - 3 * 3_600_000), 'Asia/Almaty');
    const end = localTimeStr(new Date(now.getTime() + 5 * 3_600_000), 'Asia/Almaty');
    if (start < end) {
      await makeShift(t.tenantId, emp1.employeeId, d, start, end);
      const before = (await c.e1.get('/time/me/today')).json();
      expect(before.status).toBe('NO_MARKS');
      expect(before.lateMinutes).toBeGreaterThanOrEqual(179);
      expect(before.remainingMinutes).toBeNull();
      const after = (await mark(c.e1, 'IN')).json().day;
      expect(after.status).toBe('ON_SHIFT');
      expect(after.lateMinutes).toBeGreaterThanOrEqual(179);
      expect(after.remainingMinutes).toBeGreaterThan(290);
      expect(after.shift.title).toBe('День офис');
    }
    await makeShift(t.tenantId, emp1.employeeId, addDaysStr(d, 2), '10:00', '19:00');
    await makeShift(t.tenantId, emp1.employeeId, addDaysStr(d, 3), '10:00', '19:00', { status: 'DRAFT' });
    await makeShift(t.tenantId, null, addDaysStr(d, 4), '09:00', '21:00', { title: 'Дежурство поддержки' });
    const my = (await c.e1.get('/time/me/today')).json();
    expect(my.upcoming).toHaveLength(7);
    expect(my.upcoming[1].shift.title).toBe('День офис');
    expect(my.upcoming[2].shift).toBeNull(); // drafts are invisible to employees
    expect(my.openShifts.map((s: { title: string }) => s.title)).toEqual(['Дежурство поддержки']);
    const week = (await c.e1.get(`/time/me/week?date=${d}`)).json();
    expect(week.days).toHaveLength(7);
    expect(week.from <= d && week.to >= d).toBe(true);
  });

  it('lists marks with scope rules', async () => {
    const { t, emp1, c } = await timeSetup(app);
    const y = addDaysStr(today(), -1);
    await makeMarks(t.tenantId, emp1.employeeId, y, ['IN', '09:00'], ['OUT', '18:00']);
    const mine = (await c.e1.get('/time/marks')).json();
    expect(mine.total).toBe(2);
    expect((await c.mgr.get(`/time/marks?employeeId=${emp1.employeeId}&date=${y}`)).json().total).toBe(2);
    expect((await c.mgr.get(`/time/marks?employeeId=${emp1.employeeId}&date=${today()}`)).json().total).toBe(0);
    expect((await c.om.get(`/time/marks?employeeId=${emp1.employeeId}`)).statusCode).toBe(403);
    expect((await c.e2.get(`/time/marks?employeeId=${emp1.employeeId}`)).statusCode).toBe(403);
    expect((await c.hr.get('/time/marks')).json().total).toBe(2);
    expect((await c.om.get('/time/marks')).json().total).toBe(0);
    expect(await prisma.timeMark.count()).toBe(2);
  });
});
