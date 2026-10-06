import { crc32, deflateSync } from 'node:zlib';
import type { ShiftStatus, TimeMarkType } from '@prisma/client';
import { prisma } from '../src/lib/db';
import { addDaysStr, localToUtc, shiftInstants, todayLocal } from '../src/lib/calendar';
import { Client, makeTenant, type TestApp } from './helpers';

export const TZ = 'Asia/Almaty';
export const today = () => todayLocal(TZ);
export const at = (date: string, hhmm: string) => localToUtc(date, hhmm, TZ);
export const LOC = { lat: 51.0906, lng: 71.4183, radiusM: 200 };

/** A tenant with HR, two managers (each with a team) and logged-in clients. */
export async function timeSetup(app: TestApp, settings: { requireSelfie?: boolean; requireGeofence?: boolean } = {}) {
  const t = await makeTenant();
  await prisma.tenant.update({ where: { id: t.tenantId }, data: { settings: { requireSelfie: !!settings.requireSelfie, requireGeofence: !!settings.requireGeofence, timezone: TZ } } });
  const location = await prisma.workLocation.create({ data: { tenantId: t.tenantId, name: 'Офис', ...LOC } });
  const hr = await t.person({ email: 'hr@t.kz', roles: [{ role: 'HR' }], lastName: 'Кадрова' });
  const mgr = await t.person({ email: 'mgr@t.kz', roles: [{ role: 'MANAGER' }], lastName: 'Руководов' });
  const emp1 = await t.person({ email: 'e1@t.kz', managerEmployeeId: mgr.employeeId, lastName: 'Аманов', firstName: 'Ерлан' });
  const emp2 = await t.person({ email: 'e2@t.kz', managerEmployeeId: mgr.employeeId, lastName: 'Бекова', firstName: 'Дана' });
  const otherMgr = await t.person({ email: 'om@t.kz', roles: [{ role: 'MANAGER' }], lastName: 'Другов' });
  const other = await t.person({ email: 'o@t.kz', managerEmployeeId: otherMgr.employeeId, lastName: 'Чужой' });
  await prisma.employee.updateMany({ where: { tenantId: t.tenantId }, data: { locationId: location.id } });
  const login = async (email: string) => {
    const c = new Client(app);
    await c.login(email);
    return c;
  };
  return {
    t, location, hr, mgr, emp1, emp2, otherMgr, other,
    c: { hr: await login('hr@t.kz'), mgr: await login('mgr@t.kz'), e1: await login('e1@t.kz'), e2: await login('e2@t.kz'), om: await login('om@t.kz') },
  };
}

export async function makeShift(tenantId: string, employeeId: string | null, date: string, start = '09:00', end = '18:00', opts: { breakMinutes?: number; status?: ShiftStatus; title?: string; createdById?: string } = {}) {
  const { startAt, endAt } = shiftInstants(date, start, end, TZ);
  return prisma.shift.create({
    data: {
      tenantId, employeeId, date: new Date(`${date}T00:00:00Z`), startAt, endAt, breakMinutes: opts.breakMinutes ?? 60, title: opts.title ?? 'День офис',
      status: opts.status ?? 'PUBLISHED', createdById: opts.createdById ?? 'seed',
    },
  });
}

export async function makeMarks(tenantId: string, employeeId: string, date: string, ...xs: [TimeMarkType, string][]) {
  for (const [type, t] of xs) {
    const d = t.startsWith('+') ? addDaysStr(date, 1) : date;
    await prisma.timeMark.create({ data: { tenantId, employeeId, type, at: at(d, t.replace('+', '')) } });
  }
}

/** A valid w×h RGB PNG (real IHDR/IDAT/IEND with CRCs). */
export function makePng(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h, 0x80);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
