import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Prisma, SickLeave, StoredFile } from '@prisma/client';
import { SickLeaveInput, SickLeaveUpdate, SickLeavesQuery, id, type SickLeaveView } from '@akere/shared';
import { prisma, type Tx } from '../../lib/db';
import { requireUser, type UserCtx } from '../../lib/auth';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { notify } from '../../lib/notify';
import { employeeScope, managedEmployeeScope } from '../../lib/scope';
import { fromDateStr, toDateStr, daysBetweenInclusive } from '../../lib/dates';
import { pageArgs, toPage } from '../../lib/pagination';
import { registerFileAccess, toFileRef } from '../../lib/files';
import { tenantTimezone, todayLocal } from '../../lib/calendar';
import { sickLeaveRegistry } from '../../adapters/sick-leave';
import { empRef, empRefInclude } from '../time/views';

// Scanned sick-leave sheets: visible to whoever can read the sick leave (HR, managers, the employee).
registerFileAccess(async (ctx, file) => {
  if (ctx.kind !== 'user') return false;
  const sl = await prisma.sickLeave.findFirst({ where: { fileId: file.id, tenantId: ctx.tenantId }, select: { employeeId: true } });
  if (!sl) return false;
  return (await prisma.employee.count({ where: { AND: [await employeeScope(ctx), { id: sl.employeeId }] } })) > 0;
});

const idParam = z.object({ id });
type Row = SickLeave & { employee: Prisma.EmployeeGetPayload<{ include: typeof empRefInclude }> };

function view(s: Row, files: Map<string, StoredFile>): SickLeaveView {
  const { employeeId: _e, ...ref } = empRef(s.employee);
  const f = s.fileId ? files.get(s.fileId) : undefined;
  return {
    id: s.id, employee: ref, number: s.number, startDate: toDateStr(s.startDate), endDate: toDateStr(s.endDate),
    days: daysBetweenInclusive(s.startDate, s.endDate), source: s.source, file: f ? toFileRef(f) : null, note: s.note, createdAt: s.createdAt.toISOString(),
  };
}

async function filesFor(rows: { fileId: string | null }[]) {
  const ids = rows.map((r) => r.fileId).filter((x): x is string => !!x);
  if (!ids.length) return new Map<string, StoredFile>();
  return new Map((await prisma.storedFile.findMany({ where: { id: { in: ids } } })).map((f) => [f.id, f]));
}

async function assertManagedEmployee(u: UserCtx, employeeId: string) {
  const e = await prisma.employee.findFirst({ where: { id: employeeId, tenantId: u.tenantId } });
  if (!e) throw notFound('Employee');
  if (!(await prisma.employee.count({ where: { AND: [await managedEmployeeScope(u), { id: employeeId }] } }))) throw forbidden('Employee is outside your scope');
  return e;
}

async function assertFile(tenantId: string, fileId: string | null | undefined) {
  if (fileId && !(await prisma.storedFile.findFirst({ where: { id: fileId, tenantId } }))) throw notFound('File');
}

const absenceNote = (number: string) => `Больничный лист № ${number}`;

/** Keeps the matching Absence (kind SICK, source SICK_LEAVE) in sync with a sick leave. */
async function syncAbsence(tx: Tx, s: SickLeave) {
  const existing = await tx.absence.findFirst({ where: { source: 'SICK_LEAVE', sourceId: s.id } });
  const data = { tenantId: s.tenantId, employeeId: s.employeeId, kind: 'SICK' as const, startDate: s.startDate, endDate: s.endDate, source: 'SICK_LEAVE' as const, sourceId: s.id, note: absenceNote(s.number) };
  if (existing) await tx.absence.update({ where: { id: existing.id }, data });
  else await tx.absence.create({ data });
}

async function assertNoOverlap(tx: Tx, employeeId: string, start: Date, end: Date, exceptId?: string) {
  const clash = await tx.sickLeave.findFirst({ where: { employeeId, startDate: { lte: end }, endDate: { gte: start }, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (clash) throw conflict('Sick leave overlaps an existing one', { sickLeaveId: clash.id, number: clash.number });
}

/** Sick leaves (API.md §12, F-36). */
export default async function sickLeaveRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/', { schema: { querystring: SickLeavesQuery } }, async (req) => {
    const u = requireUser(req, 'sickleave.read');
    const q = req.query;
    const where: Prisma.SickLeaveWhereInput = {
      tenantId: u.tenantId,
      employee: { AND: [await employeeScope(u), ...(q.employeeId ? [{ id: q.employeeId }] : [])] },
      ...(q.to ? { startDate: { lte: fromDateStr(q.to) } } : {}),
      ...(q.from ? { endDate: { gte: fromDateStr(q.from) } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.sickLeave.findMany({ where, include: { employee: { include: empRefInclude } }, orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }], ...pageArgs(q) }),
      prisma.sickLeave.count({ where }),
    ]);
    const files = await filesFor(rows);
    return toPage(rows.map((r) => view(r, files)), total, q);
  });

  app.post('/', { schema: { body: SickLeaveInput } }, async (req, reply) => {
    const u = requireUser(req, 'sickleave.manage');
    const b = req.body;
    if (b.endDate < b.startDate) throw badRequest('End date is before start date', { fieldErrors: { endDate: ['Must not be before startDate'] }, formErrors: [] });
    const emp = await assertManagedEmployee(u, b.employeeId);
    await assertFile(u.tenantId, b.fileId);
    if (await prisma.sickLeave.findFirst({ where: { tenantId: u.tenantId, number: b.number } })) throw conflict('Sick leave with this number already exists', { fields: ['number'] });
    const created = await prisma.$transaction(async (tx) => {
      await assertNoOverlap(tx, b.employeeId, fromDateStr(b.startDate), fromDateStr(b.endDate));
      const s = await tx.sickLeave.create({
        data: {
          tenantId: u.tenantId, employeeId: b.employeeId, number: b.number, startDate: fromDateStr(b.startDate), endDate: fromDateStr(b.endDate),
          source: b.source, fileId: b.fileId ?? null, note: b.note ?? null, createdById: u.userId,
        },
      });
      await syncAbsence(tx, s);
      return tx.sickLeave.findUniqueOrThrow({ where: { id: s.id }, include: { employee: { include: empRefInclude } } });
    });
    if (emp.managerId) {
      const mgr = await prisma.employee.findUnique({ where: { id: emp.managerId }, select: { userId: true } });
      if (mgr) await notify({ tenantId: u.tenantId, userId: mgr.userId, type: 'sickleave.created', title: `Больничный: ${empRef(created.employee).shortName}`, body: `${b.startDate} — ${b.endDate}`, link: '/absences', email: false });
    }
    await audit(u, 'sickleave.create', 'SickLeave', created.id, { number: b.number, employeeId: b.employeeId }, { ip: req.ip });
    return reply.status(201).send(view(created, await filesFor([created])));
  });

  app.patch('/:id', { schema: { params: idParam, body: SickLeaveUpdate } }, async (req) => {
    const u = requireUser(req, 'sickleave.manage');
    const cur = await prisma.sickLeave.findFirst({ where: { id: req.params.id, tenantId: u.tenantId } });
    if (!cur) throw notFound('Sick leave');
    await assertManagedEmployee(u, cur.employeeId);
    const b = req.body;
    const employeeId = b.employeeId ?? cur.employeeId;
    if (b.employeeId && b.employeeId !== cur.employeeId) await assertManagedEmployee(u, b.employeeId);
    const start = b.startDate ?? toDateStr(cur.startDate);
    const end = b.endDate ?? toDateStr(cur.endDate);
    if (end < start) throw badRequest('End date is before start date', { fieldErrors: { endDate: ['Must not be before startDate'] }, formErrors: [] });
    await assertFile(u.tenantId, b.fileId);
    if (b.number && b.number !== cur.number && (await prisma.sickLeave.findFirst({ where: { tenantId: u.tenantId, number: b.number } }))) {
      throw conflict('Sick leave with this number already exists', { fields: ['number'] });
    }
    const updated = await prisma.$transaction(async (tx) => {
      await assertNoOverlap(tx, employeeId, fromDateStr(start), fromDateStr(end), cur.id);
      const s = await tx.sickLeave.update({
        where: { id: cur.id },
        data: {
          employeeId, number: b.number ?? cur.number, startDate: fromDateStr(start), endDate: fromDateStr(end), source: b.source ?? cur.source,
          fileId: b.fileId !== undefined ? b.fileId : cur.fileId, note: b.note !== undefined ? b.note : cur.note,
        },
      });
      await syncAbsence(tx, s);
      return tx.sickLeave.findUniqueOrThrow({ where: { id: s.id }, include: { employee: { include: empRefInclude } } });
    });
    await audit(u, 'sickleave.update', 'SickLeave', cur.id, b, { ip: req.ip });
    return view(updated, await filesFor([updated]));
  });

  app.delete('/:id', { schema: { params: idParam } }, async (req, reply) => {
    const u = requireUser(req, 'sickleave.manage');
    const cur = await prisma.sickLeave.findFirst({ where: { id: req.params.id, tenantId: u.tenantId } });
    if (!cur) throw notFound('Sick leave');
    await assertManagedEmployee(u, cur.employeeId);
    await prisma.$transaction([
      prisma.absence.deleteMany({ where: { source: 'SICK_LEAVE', sourceId: cur.id } }),
      prisma.sickLeave.delete({ where: { id: cur.id } }),
    ]);
    await audit(u, 'sickleave.delete', 'SickLeave', cur.id, { number: cur.number }, { ip: req.ip });
    return reply.status(204).send();
  });

  app.post('/sync', async (req) => {
    const u = requireUser(req, 'sickleave.manage');
    const tz = await tenantTimezone(u.tenantId);
    const employees = await prisma.employee.findMany({ where: { AND: [await managedEmployeeScope(u), { status: 'ACTIVE' }] }, select: { id: true, iin: true } });
    const records = await sickLeaveRegistry().fetchRecent({ tenantId: u.tenantId, today: todayLocal(tz), employees });
    const allowed = new Set(employees.map((e) => e.id));
    let imported = 0;
    for (const r of records) {
      if (!allowed.has(r.employeeId)) continue;
      if (await prisma.sickLeave.findFirst({ where: { tenantId: u.tenantId, number: r.number } })) continue;
      const start = fromDateStr(r.startDate);
      const end = fromDateStr(r.endDate);
      if (await prisma.sickLeave.findFirst({ where: { employeeId: r.employeeId, startDate: { lte: end }, endDate: { gte: start } } })) continue;
      await prisma.$transaction(async (tx) => {
        const s = await tx.sickLeave.create({
          data: { tenantId: u.tenantId, employeeId: r.employeeId, number: r.number, startDate: start, endDate: end, source: 'ELECTRONIC', note: 'Импорт из реестра электронных больничных (песочница)', createdById: u.userId },
        });
        await syncAbsence(tx, s);
      });
      imported++;
    }
    await audit(u, 'sickleave.sync', 'SickLeave', null, { fetched: records.length, imported }, { ip: req.ip });
    return { imported };
  });
}
