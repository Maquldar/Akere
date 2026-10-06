import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { DismissalInput, EmployeeFilter, EmployeeOptionsQuery, EmployeeUpdate, TransferInput, VacationAdjustmentInput, id, pageQuery } from '@akere/shared';
import { prisma, type Tx } from '../../lib/db';
import { requireUser, type UserCtx } from '../../lib/auth';
import { businessRule, conflict, forbidden, notFound } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { pageArgs, toPage } from '../../lib/pagination';
import { canReadEmployee, employeeScope, legalEntityAllowed, isHrOrAdmin } from '../../lib/scope';
import { registerFileAccess, toFileRef } from '../../lib/files';
import { fullName, toUserRef, userRefSelect } from '../../lib/names';
import { fromDateStr, optDateStr, toDateStr, todayUtc } from '../../lib/dates';
import { deputyInclude, toDeputyItem } from '../deputies/service';
import { createDocument, documentScope, getDocumentDetail, listInclude, toListItems, viewerCtx } from '../documents/service';
import { ensureDocumentType } from '../documents/defaults';
import { inTx } from '../documents/route-engine';
import { employeeListInclude, getVacationBalance, photoUrl, toEmployeeListItem } from './service';

const idParam = z.object({ id });

// Personal documents from onboarding are readable by whoever may read the employee.
registerFileAccess(async (ctx, file) => {
  if (ctx.kind !== 'user' || !file.candidateDocumentId) return false;
  const cd = await prisma.candidateDocument.findUnique({ where: { id: file.candidateDocumentId }, select: { request: { select: { candidate: { select: { employeeId: true } } } } } });
  const employeeId = cd?.request.candidate.employeeId;
  return !!employeeId && canReadEmployee(ctx, employeeId);
});

async function findReadable(u: UserCtx, employeeId: string) {
  const e = await prisma.employee.findFirst({ where: { AND: [await employeeScope(u), { id: employeeId }] } });
  if (!e) throw notFound('Employee');
  return e;
}

async function findManageable(u: UserCtx, employeeId: string) {
  const e = await prisma.employee.findFirst({ where: { id: employeeId, tenantId: u.tenantId } });
  if (!e || !legalEntityAllowed(u, e.legalEntityId)) throw notFound('Employee');
  return e;
}

async function assertOrgRefs(tx: Tx, tenantId: string, legalEntityId: string, employeeId: string, refs: { departmentId?: string | null; positionId?: string | null; managerId?: string | null; locationId?: string | null }) {
  if (refs.departmentId && !(await tx.department.findFirst({ where: { id: refs.departmentId, tenantId, legalEntityId } }))) throw notFound('Department');
  if (refs.positionId && !(await tx.position.findFirst({ where: { id: refs.positionId, tenantId } }))) throw notFound('Position');
  if (refs.locationId && !(await tx.workLocation.findFirst({ where: { id: refs.locationId, tenantId } }))) throw notFound('Location');
  if (refs.managerId) {
    if (refs.managerId === employeeId) throw businessRule('SELF_MANAGER', 'An employee cannot be their own manager');
    const mgr = await tx.employee.findFirst({ where: { id: refs.managerId, tenantId, status: 'ACTIVE' } });
    if (!mgr) throw notFound('Manager');
    let cur = mgr.managerId;
    for (let i = 0; cur && i < 100; i++) {
      if (cur === employeeId) throw businessRule('MANAGER_CYCLE', 'The manager hierarchy cannot contain cycles');
      cur = (await tx.employee.findUnique({ where: { id: cur }, select: { managerId: true } }))?.managerId ?? null;
    }
  }
}

async function profile(u: UserCtx, employeeId: string) {
  const e = await prisma.employee.findUniqueOrThrow({
    where: { id: employeeId },
    include: { ...employeeListInclude, location: { select: { id: true, name: true } }, candidate: { select: { id: true } }, user: { select: { id: true, firstName: true, lastName: true, middleName: true, email: true, phone: true, roles: true } } },
  });
  const deputies = await prisma.deputy.findMany({
    where: { principalUserId: e.userId, endDate: { gte: todayUtc() } }, include: deputyInclude, orderBy: { startDate: 'asc' },
  });
  const balance = await getVacationBalance(e.id);
  return {
    ...toEmployeeListItem(e),
    iin: e.iin, birthDate: optDateStr(e.birthDate), gender: e.gender, terminationDate: optDateStr(e.terminationDate),
    location: e.location, roles: [...new Set(e.user.roles.map((r) => r.role))], vacationDaysPerYear: e.vacationDaysPerYear,
    vacationBalance: balance.available, personal: e.personal as Record<string, unknown>, photoUrl: photoUrl(e.photoFileId),
    deputies: deputies.map(toDeputyItem), candidateId: e.candidate?.id ?? null,
    canManage: isHrOrAdmin(u) && legalEntityAllowed(u, e.legalEntityId),
  };
}

export default async function employeesRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/', { schema: { querystring: EmployeeFilter } }, async (req) => {
    const u = requireUser(req, 'employee.read');
    const q = req.query;
    const words = q.q?.split(/\s+/).filter(Boolean) ?? [];
    const where: Prisma.EmployeeWhereInput = {
      AND: [
        await employeeScope(u),
        ...(q.legalEntityId ? [{ legalEntityId: q.legalEntityId }] : []),
        ...(q.departmentId ? [{ departmentId: q.departmentId }] : []),
        ...(q.positionId ? [{ positionId: q.positionId }] : []),
        ...(q.managerId ? [{ managerId: q.managerId }] : []),
        ...(q.status ? [{ status: q.status }] : []),
        ...words.map((w): Prisma.EmployeeWhereInput => ({
          OR: [
            { user: { lastName: { contains: w, mode: 'insensitive' } } }, { user: { firstName: { contains: w, mode: 'insensitive' } } },
            { user: { middleName: { contains: w, mode: 'insensitive' } } }, { user: { email: { contains: w, mode: 'insensitive' } } },
            { tabNumber: { contains: w } }, { iin: { startsWith: w } },
          ],
        })),
      ],
    };
    const orderBy: Prisma.EmployeeOrderByWithRelationInput[] =
      q.sort === 'hireDate' ? [{ hireDate: q.order }] : q.sort === 'tabNumber' ? [{ tabNumber: q.order }] : [{ user: { lastName: q.order } }, { user: { firstName: q.order } }];
    const [rows, total] = await Promise.all([
      prisma.employee.findMany({ where, include: employeeListInclude, orderBy, ...pageArgs(q) }),
      prisma.employee.count({ where }),
    ]);
    return toPage(rows.map(toEmployeeListItem), total, q);
  });

  app.get('/options', { schema: { querystring: EmployeeOptionsQuery } }, async (req) => {
    const u = requireUser(req, 'employee.read');
    const words = req.query.q?.split(/\s+/).filter(Boolean) ?? [];
    const rows = await prisma.employee.findMany({
      where: {
        AND: [
          { tenantId: u.tenantId, status: 'ACTIVE' },
          ...(req.query.legalEntityId ? [{ legalEntityId: req.query.legalEntityId }] : []),
          ...words.map((w): Prisma.EmployeeWhereInput => ({
            OR: [{ user: { lastName: { contains: w, mode: 'insensitive' } } }, { user: { firstName: { contains: w, mode: 'insensitive' } } }, { tabNumber: { contains: w } }],
          })),
        ],
      },
      include: { user: { select: userRefSelect } },
      orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
      take: 50,
    });
    return rows.map((e) => ({ ...toUserRef(e.user), id: e.id, userId: e.userId }));
  });

  app.get('/:id', { schema: { params: idParam } }, async (req) => {
    const u = requireUser(req, 'employee.read');
    const e = await findReadable(u, req.params.id);
    return profile(u, e.id);
  });

  app.patch('/:id', { schema: { params: idParam, body: EmployeeUpdate } }, async (req) => {
    const u = requireUser(req, 'employee.manage');
    const e = await findManageable(u, req.params.id);
    const b = req.body;
    await assertOrgRefs(prisma, u.tenantId, e.legalEntityId, e.id, b);
    const data: Prisma.EmployeeUncheckedUpdateInput = {
      ...(b.departmentId !== undefined ? { departmentId: b.departmentId } : {}),
      ...(b.positionId !== undefined ? { positionId: b.positionId } : {}),
      ...(b.managerId !== undefined ? { managerId: b.managerId } : {}),
      ...(b.locationId !== undefined ? { locationId: b.locationId } : {}),
      ...(b.tabNumber !== undefined ? { tabNumber: b.tabNumber } : {}),
      ...(b.vacationDaysPerYear !== undefined ? { vacationDaysPerYear: b.vacationDaysPerYear } : {}),
      ...(b.personal !== undefined ? { personal: { ...(e.personal as Record<string, unknown>), ...b.personal } as Prisma.InputJsonValue } : {}),
    };
    await prisma.employee.update({ where: { id: e.id }, data });
    await audit(u, 'employee.update', 'Employee', e.id, b as Prisma.InputJsonValue, { ip: req.ip });
    return profile(u, e.id);
  });

  app.get('/:id/documents', { schema: { params: idParam, querystring: pageQuery } }, async (req) => {
    const u = requireUser(req, 'employee.read');
    const e = await findReadable(u, req.params.id);
    const where: Prisma.DocumentWhereInput = { AND: [await documentScope(u), { subjectEmployeeId: e.id }] };
    const [rows, total] = await Promise.all([
      prisma.document.findMany({ where, include: listInclude, orderBy: { createdAt: 'desc' }, ...pageArgs(req.query) }),
      prisma.document.count({ where }),
    ]);
    return toPage(await toListItems(rows, await viewerCtx(u)), total, req.query);
  });

  app.get('/:id/personal-documents', { schema: { params: idParam } }, async (req) => {
    const u = requireUser(req, 'employee.read');
    const e = await findReadable(u, req.params.id);
    const candidate = await prisma.candidate.findUnique({ where: { employeeId: e.id }, select: { id: true } });
    if (!candidate) return [];
    const request = await prisma.documentRequest.findFirst({
      where: { candidateId: candidate.id },
      orderBy: { createdAt: 'desc' },
      include: { documents: { include: { docType: true, files: { orderBy: { createdAt: 'asc' } } }, orderBy: { docType: { sortOrder: 'asc' } } } },
    });
    if (!request) return [];
    return request.documents.map((d) => ({
      id: d.id,
      docType: { id: d.docType.id, code: d.docType.code, name: d.docType.name, nameKk: d.docType.nameKk, fields: d.docType.fields, autoFillable: d.docType.autoFillable },
      required: d.required, fieldKeys: d.fieldKeys as string[], status: d.status, values: d.values as Record<string, unknown>,
      autoFilledKeys: d.autoFilledKeys, files: d.files.map((f) => toFileRef(f)), returnComment: d.returnComment,
    }));
  });

  app.get('/:id/vacation-balance', { schema: { params: idParam } }, async (req) => {
    const u = requireUser(req, 'employee.read');
    const e = await findReadable(u, req.params.id);
    return getVacationBalance(e.id);
  });

  app.post('/:id/vacation-adjustments', { schema: { params: idParam, body: VacationAdjustmentInput } }, async (req, reply) => {
    const u = requireUser(req, 'employee.manage');
    const e = await findManageable(u, req.params.id);
    const entry = await prisma.vacationLedger.create({
      data: { tenantId: u.tenantId, employeeId: e.id, type: 'ADJUSTMENT', days: req.body.days, date: fromDateStr(req.body.date), note: req.body.note },
    });
    await audit(u, 'employee.vacation_adjust', 'Employee', e.id, { entryId: entry.id, days: req.body.days, note: req.body.note }, { ip: req.ip });
    return reply.status(201).send(await getVacationBalance(e.id));
  });

  // ── HR events (F-30): documents generated and routed; changes applied when the order completes ──
  app.post('/:id/events/transfer', { schema: { params: idParam, body: TransferInput } }, async (req, reply) => {
    const u = requireUser(req, 'employee.manage');
    const e = await findManageable(u, req.params.id);
    if (e.status !== 'ACTIVE') throw conflict('Employee is terminated', { rule: 'EMPLOYEE_TERMINATED' });
    const b = req.body;
    const docId = await inTx(async (tx) => {
      await assertOrgRefs(tx, u.tenantId, e.legalEntityId, e.id, b);
      const cur = await tx.employee.findUniqueOrThrow({ where: { id: e.id }, include: { department: true, position: true, manager: { include: { user: true } } } });
      const [dept, pos, mgr] = await Promise.all([
        b.departmentId ? tx.department.findUnique({ where: { id: b.departmentId } }) : null,
        b.positionId ? tx.position.findUnique({ where: { id: b.positionId } }) : null,
        b.managerId ? tx.employee.findUnique({ where: { id: b.managerId }, include: { user: true } }) : null,
      ]);
      const type = await ensureDocumentType(u.tenantId, 'TRANSFER_ORDER', tx);
      return createDocument(tx, {
        tenantId: u.tenantId, authorUserId: u.userId, documentTypeId: type.id, legalEntityId: e.legalEntityId, subjectEmployeeId: e.id, startRoute: true,
        data: {
          effectiveDate: b.effectiveDate, reason: b.reason ?? 'Служебная необходимость, согласие работника',
          departmentId: b.departmentId ?? null, positionId: b.positionId ?? null, managerId: b.managerId ?? null, salary: b.salary ?? null,
          fromDepartment: cur.department?.name ?? null, fromPosition: cur.position?.name ?? null,
          toDepartment: dept?.name ?? cur.department?.name ?? null, toPosition: pos?.name ?? cur.position?.name ?? null,
          toManager: mgr ? fullName(mgr.user) : cur.manager ? fullName(cur.manager.user) : null,
        },
      });
    });
    await audit(u, 'employee.transfer_started', 'Employee', e.id, { documentId: docId }, { ip: req.ip });
    return reply.status(201).send(await getDocumentDetail(u, docId));
  });

  app.post('/:id/events/dismissal', { schema: { params: idParam, body: DismissalInput } }, async (req, reply) => {
    const u = requireUser(req, 'employee.manage');
    const e = await findManageable(u, req.params.id);
    if (e.status !== 'ACTIVE') throw conflict('Employee is already terminated', { rule: 'EMPLOYEE_TERMINATED' });
    if (e.userId === u.userId) throw forbidden('You cannot start your own dismissal');
    if (fromDateStr(req.body.effectiveDate) < e.hireDate) throw businessRule('BEFORE_HIRE_DATE', 'Dismissal date is before the hire date');
    const balance = await getVacationBalance(e.id);
    const docId = await inTx(async (tx) => {
      const type = await ensureDocumentType(u.tenantId, 'DISMISSAL_ORDER', tx);
      return createDocument(tx, {
        tenantId: u.tenantId, authorUserId: u.userId, documentTypeId: type.id, legalEntityId: e.legalEntityId, subjectEmployeeId: e.id, startRoute: true,
        data: { effectiveDate: req.body.effectiveDate, reason: req.body.reason, article: req.body.article, compensationDays: Math.max(0, balance.available), hireDate: toDateStr(e.hireDate) },
      });
    });
    await audit(u, 'employee.dismissal_started', 'Employee', e.id, { documentId: docId }, { ip: req.ip });
    return reply.status(201).send(await getDocumentDetail(u, docId));
  });
}
