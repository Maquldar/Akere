import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { MarksQuery, TIME_MARK_TYPES, WeekQuery, type MarkResult, type MyWeek, type TimeMarkType } from '@akere/shared';
import { prisma } from '../../lib/db';
import { requireUser } from '../../lib/auth';
import { tooManyFiles } from '../documents/multipart';
import { badRequest, businessRule, forbidden } from '../../lib/errors';
import { registerFileAccess, saveFile } from '../../lib/files';
import { managedEmployeeScope } from '../../lib/scope';
import { pageArgs, toPage } from '../../lib/pagination';
import { addDaysStr, datesInRange, isPublicHoliday, localDayBounds, localToUtc, startOfWeek, tenantTimeSettings, todayLocal } from '../../lib/calendar';
import { faceVerifier } from '../../adapters/face';
import { allowedNextMarks, currentSessionLast, haversineM, insideGeofence, SESSION_MAX_MIN } from './compute';
import { markInclude, markView } from './views';
import { buildMyDay, currentShift, loadDays, summarize } from './service';

// Selfies are visible to the employee, their managers and HR (anyone whose managed scope covers them).
registerFileAccess(async (ctx, file) => {
  if (ctx.kind !== 'user') return false;
  const mark = await prisma.timeMark.findFirst({ where: { selfieFileId: file.id, tenantId: ctx.tenantId }, select: { employeeId: true } });
  if (!mark) return false;
  if (ctx.employeeId === mark.employeeId) return true;
  return (await prisma.employee.count({ where: { AND: [await managedEmployeeScope(ctx), { id: mark.employeeId }] } })) > 0;
});

const MarkFields = z.object({
  type: z.enum(TIME_MARK_TYPES),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  accuracyM: z.coerce.number().min(0).max(100_000).optional(),
});

async function readMarkRequest(req: FastifyRequest) {
  let selfie: { buffer: Buffer; filename: string } | null = null;
  let raw: Record<string, unknown> = {};
  if (req.isMultipart()) {
    let files = 0;
    // One selfie at most: every file part is buffered in memory (M7).
    for await (const part of req.parts({ limits: { files: 1 } })) {
      if (part.type === 'file') {
        if (++files > 1) throw tooManyFiles(1);
        const buf = await part.toBuffer();
        if (!selfie && (part.fieldname === 'selfie' || part.fieldname === 'file') && buf.length) selfie = { buffer: buf, filename: part.filename || 'selfie.jpg' };
      } else raw[part.fieldname] = part.value === '' ? undefined : part.value;
    }
  } else raw = (req.body ?? {}) as Record<string, unknown>;
  const parsed = MarkFields.safeParse(raw);
  if (!parsed.success) throw parsed.error;
  return { ...parsed.data, selfie };
}

export default async function trackingRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/me/today', async (req) => {
    const u = requireUser(req, 'time.self');
    if (!u.employeeId) throw forbidden('No employee record');
    return buildMyDay(u, u.employeeId);
  });

  app.get('/me/week', { schema: { querystring: WeekQuery } }, async (req): Promise<MyWeek> => {
    const u = requireUser(req, 'time.self');
    if (!u.employeeId) throw forbidden('No employee record');
    const { timezone: tz } = await tenantTimeSettings(u.tenantId);
    const now = new Date();
    const today = todayLocal(tz, now);
    const from = startOfWeek(req.query.date ?? today);
    const to = addDaysStr(from, 6);
    const data = await loadDays({ tenantId: u.tenantId, employeeIds: [u.employeeId], from, to, tz, publishedOnly: true });
    let worked = 0, planned = 0;
    const days = datesInRange(from, to).map((d) => {
      const s = summarize(data, u.employeeId!, d, { today, now, tz });
      const shift = data.shiftOf(u.employeeId!, d);
      const absence = data.absenceOf(u.employeeId!, d);
      worked += s.workedMinutes;
      planned += s.plannedMinutes;
      const kind: MyWeek['days'][number]['kind'] = absence ? 'ABSENCE' : shift ? 'WORK' : isPublicHoliday(d, data.cal) ? 'HOLIDAY' : 'OFF';
      return { date: d, plannedMinutes: s.plannedMinutes, workedMinutes: s.workedMinutes, kind, absenceKind: absence?.kind ?? null };
    });
    return { from, to, workedMinutes: worked, plannedMinutes: planned, days };
  });

  app.post('/marks', async (req, reply): Promise<MarkResult> => {
    const u = requireUser(req, 'time.self');
    if (!u.employeeId) throw forbidden('No employee record');
    const employeeId = u.employeeId;
    const input = await readMarkRequest(req);
    const settings = await tenantTimeSettings(u.tenantId);
    const tz = settings.timezone;
    const now = new Date();
    const type: TimeMarkType = input.type;

    // Geofence: the shift's location wins over the employee's default location.
    const today = todayLocal(tz, now);
    const data = await loadDays({ tenantId: u.tenantId, employeeIds: [employeeId], from: addDaysStr(today, -1), to: today, tz, publishedOnly: true });
    const { shift } = currentShift(data, employeeId, today, now);
    const emp = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { locationId: true } });
    const locId = shift?.locationId ?? emp.locationId;
    const location = locId ? await prisma.workLocation.findUnique({ where: { id: locId } }) : null;
    const hasCoords = input.lat !== undefined && input.lng !== undefined;
    const distanceM = location && hasCoords ? haversineM(input.lat!, input.lng!, location.lat, location.lng) : null;
    if (settings.requireGeofence && location) {
      if (!hasCoords) throw businessRule('GEOLOCATION_REQUIRED', 'Allow access to your location to mark time');
      if (!insideGeofence(distanceM!, location.radiusM, input.accuracyM)) {
        throw businessRule('OUTSIDE_GEOFENCE', 'You are outside the work location', { distanceM: Math.round(distanceM!), radiusM: location.radiusM, location: location.name });
      }
    }

    const needsSelfie = settings.requireSelfie && (type === 'IN' || type === 'OUT');
    if (needsSelfie && !input.selfie) throw businessRule('SELFIE_REQUIRED', 'A selfie is required to mark arrival and departure');

    const mark = await prisma.$transaction(async (tx) => {
      // Serialize marks per employee so a double tap can't produce two INs.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${employeeId}))`;
      const recent = await tx.timeMark.findMany({
        where: { employeeId, at: { gte: new Date(now.getTime() - (SESSION_MAX_MIN + 60) * 60_000) } },
        select: { type: true, at: true },
        orderBy: { at: 'asc' },
      });
      const allowed = allowedNextMarks(currentSessionLast(recent, now));
      if (!allowed.includes(type)) throw businessRule('INVALID_SEQUENCE', `Mark ${type} is not allowed now`, { allowed });
      let selfieFileId: string | null = null;
      let verification: 'PASSED' | 'FAILED' | 'SKIPPED' = 'SKIPPED';
      let verificationNote: string | null = null;
      if (input.selfie) {
        const f = await saveFile({ tenantId: u.tenantId, buffer: input.selfie.buffer, filename: input.selfie.filename, allowed: ['jpg', 'png'], uploadedById: u.userId }, tx);
        selfieFileId = f.id;
        const r = await faceVerifier().verify(input.selfie.buffer, { employeeId });
        verification = r.status;
        verificationNote = r.note;
      }
      return tx.timeMark.create({
        data: {
          tenantId: u.tenantId, employeeId, type, at: now, lat: input.lat ?? null, lng: input.lng ?? null, accuracyM: input.accuracyM ?? null,
          distanceM, selfieFileId, verification, verificationNote, source: 'SELF',
        },
        include: markInclude,
      });
    });
    reply.status(201);
    return { mark: markView(mark), day: await buildMyDay(u, employeeId, settings) };
  });

  app.get('/marks', { schema: { querystring: MarksQuery } }, async (req) => {
    const u = requireUser(req, 'time.self');
    const q = req.query;
    const { timezone: tz } = await tenantTimeSettings(u.tenantId);
    let empWhere: Prisma.EmployeeWhereInput;
    if (q.employeeId) {
      if (q.employeeId !== u.employeeId) {
        if (!u.permissions.includes('time.manage')) throw forbidden();
        if (!(await prisma.employee.count({ where: { AND: [await managedEmployeeScope(u), { id: q.employeeId }] } }))) throw forbidden();
      }
      empWhere = { id: q.employeeId, tenantId: u.tenantId };
    } else if (u.permissions.includes('time.manage')) {
      empWhere = { OR: [await managedEmployeeScope(u), { id: u.employeeId ?? '__none__' }] };
    } else empWhere = { id: u.employeeId ?? '__none__', tenantId: u.tenantId };
    let at: Prisma.DateTimeFilter | undefined;
    if (q.date) {
      const b = localDayBounds(q.date, tz);
      at = { gte: b.start, lt: b.end };
    } else if (q.from || q.to) {
      if (q.from && q.to && q.to < q.from) throw badRequest('`to` must not be before `from`');
      at = { ...(q.from ? { gte: localToUtc(q.from, '00:00', tz) } : {}), ...(q.to ? { lt: localToUtc(addDaysStr(q.to, 1), '00:00', tz) } : {}) };
    }
    const where: Prisma.TimeMarkWhereInput = { tenantId: u.tenantId, employee: empWhere, ...(at ? { at } : {}) };
    const [rows, total] = await Promise.all([
      prisma.timeMark.findMany({ where, include: markInclude, orderBy: { at: 'desc' }, ...pageArgs(q) }),
      prisma.timeMark.count({ where }),
    ]);
    return toPage(rows.map(markView), total, q);
  });
}
