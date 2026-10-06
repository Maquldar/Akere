import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  DepartmentInput, LegalEntityInput, PositionInput, ROLES, UserInput, UserUpdate, WorkLocationInput, boolQuery, id, pageQuery,
} from '@akere/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/db';
import { requireUser } from '../../lib/auth';
import { conflict, notFound } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { pageArgs, toPage } from '../../lib/pagination';
import { fullName, toUserRef, userRefSelect } from '../../lib/names';
import { messaging } from '../../adapters/messaging';
import { t } from '../../lib/i18n';
import { config } from '../../config';

const idParam = z.object({ id });

export default async function orgRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // ── Legal entities ──
  app.get('/legal-entities', async (req) => {
    const u = requireUser(req, 'org.read');
    const rows = await prisma.legalEntity.findMany({
      where: { tenantId: u.tenantId },
      include: { _count: { select: { employees: { where: { status: 'ACTIVE' } } } } },
      orderBy: { name: 'asc' },
    });
    return rows.map(({ _count, tenantId: _t, createdAt: _c, ...le }) => ({ ...le, employeeCount: _count.employees }));
  });

  app.post('/legal-entities', { schema: { body: LegalEntityInput } }, async (req, reply) => {
    const u = requireUser(req, 'org.manage');
    const le = await prisma.legalEntity.create({ data: { ...req.body, tenantId: u.tenantId } });
    await audit(u, 'org.legal_entity_create', 'LegalEntity', le.id, { name: le.name }, { ip: req.ip });
    return reply.status(201).send({ id: le.id, name: le.name, nameKk: le.nameKk, bin: le.bin, address: le.address, directorName: le.directorName, employeeCount: 0 });
  });

  app.patch('/legal-entities/:id', { schema: { params: idParam, body: LegalEntityInput.partial() } }, async (req) => {
    const u = requireUser(req, 'org.manage');
    const found = await prisma.legalEntity.findFirst({ where: { id: req.params.id, tenantId: u.tenantId } });
    if (!found) throw notFound('Legal entity');
    const le = await prisma.legalEntity.update({
      where: { id: found.id },
      data: req.body,
      include: { _count: { select: { employees: { where: { status: 'ACTIVE' } } } } },
    });
    await audit(u, 'org.legal_entity_update', 'LegalEntity', le.id, req.body, { ip: req.ip });
    return { id: le.id, name: le.name, nameKk: le.nameKk, bin: le.bin, address: le.address, directorName: le.directorName, employeeCount: le._count.employees };
  });

  // ── Departments ──
  const deptOut = (d: { id: string; legalEntityId: string; parentId: string | null; name: string; nameKk: string | null; _count: { employees: number } }) => ({
    id: d.id, legalEntityId: d.legalEntityId, parentId: d.parentId, name: d.name, nameKk: d.nameKk, employeeCount: d._count.employees,
  });
  const deptCount = { _count: { select: { employees: { where: { status: 'ACTIVE' as const } } } } };

  app.get('/departments', { schema: { querystring: z.object({ legalEntityId: id.optional() }) } }, async (req) => {
    const u = requireUser(req, 'org.read');
    const rows = await prisma.department.findMany({
      where: { tenantId: u.tenantId, ...(req.query.legalEntityId ? { legalEntityId: req.query.legalEntityId } : {}) },
      include: deptCount,
      orderBy: { name: 'asc' },
    });
    return rows.map(deptOut);
  });

  async function assertDeptRefs(tenantId: string, legalEntityId: string, parentId?: string | null, selfId?: string) {
    if (!(await prisma.legalEntity.findFirst({ where: { id: legalEntityId, tenantId } }))) throw notFound('Legal entity');
    if (parentId) {
      if (parentId === selfId) throw conflict('A department cannot be its own parent');
      const parent = await prisma.department.findFirst({ where: { id: parentId, tenantId, legalEntityId } });
      if (!parent) throw notFound('Parent department');
      // Reject cycles: walk up from the new parent.
      let cur: string | null = parent.parentId;
      while (cur) {
        if (cur === selfId) throw conflict('Department hierarchy cannot contain cycles');
        cur = (await prisma.department.findUnique({ where: { id: cur }, select: { parentId: true } }))?.parentId ?? null;
      }
    }
  }

  app.post('/departments', { schema: { body: DepartmentInput } }, async (req, reply) => {
    const u = requireUser(req, 'org.manage');
    await assertDeptRefs(u.tenantId, req.body.legalEntityId, req.body.parentId);
    const d = await prisma.department.create({ data: { ...req.body, tenantId: u.tenantId }, include: deptCount });
    await audit(u, 'org.department_create', 'Department', d.id, { name: d.name }, { ip: req.ip });
    return reply.status(201).send(deptOut(d));
  });

  app.patch('/departments/:id', { schema: { params: idParam, body: DepartmentInput.partial() } }, async (req) => {
    const u = requireUser(req, 'org.manage');
    const found = await prisma.department.findFirst({ where: { id: req.params.id, tenantId: u.tenantId } });
    if (!found) throw notFound('Department');
    await assertDeptRefs(u.tenantId, req.body.legalEntityId ?? found.legalEntityId, req.body.parentId, found.id);
    const d = await prisma.department.update({ where: { id: found.id }, data: req.body, include: deptCount });
    await audit(u, 'org.department_update', 'Department', d.id, req.body, { ip: req.ip });
    return deptOut(d);
  });

  app.delete('/departments/:id', { schema: { params: idParam } }, async (req, reply) => {
    const u = requireUser(req, 'org.manage');
    const found = await prisma.department.findFirst({
      where: { id: req.params.id, tenantId: u.tenantId },
      include: { _count: { select: { employees: true, children: true, candidates: true } } },
    });
    if (!found) throw notFound('Department');
    if (found._count.employees || found._count.children || found._count.candidates) {
      throw conflict('Department has employees, candidates or sub-departments');
    }
    await prisma.department.delete({ where: { id: found.id } });
    await audit(u, 'org.department_delete', 'Department', found.id, { name: found.name }, { ip: req.ip });
    return reply.status(204).send();
  });

  // ── Positions ──
  app.get('/positions', async (req) => {
    const u = requireUser(req, 'org.read');
    return prisma.position.findMany({ where: { tenantId: u.tenantId }, select: { id: true, name: true, nameKk: true }, orderBy: { name: 'asc' } });
  });
  app.post('/positions', { schema: { body: PositionInput } }, async (req, reply) => {
    const u = requireUser(req, 'org.manage');
    const p = await prisma.position.create({ data: { ...req.body, tenantId: u.tenantId }, select: { id: true, name: true, nameKk: true } });
    await audit(u, 'org.position_create', 'Position', p.id, { name: p.name }, { ip: req.ip });
    return reply.status(201).send(p);
  });
  app.patch('/positions/:id', { schema: { params: idParam, body: PositionInput.partial() } }, async (req) => {
    const u = requireUser(req, 'org.manage');
    if (!(await prisma.position.findFirst({ where: { id: req.params.id, tenantId: u.tenantId } }))) throw notFound('Position');
    return prisma.position.update({ where: { id: req.params.id }, data: req.body, select: { id: true, name: true, nameKk: true } });
  });

  // ── Work locations ──
  const locSelect = { id: true, name: true, address: true, lat: true, lng: true, radiusM: true } as const;
  app.get('/locations', async (req) => {
    const u = requireUser(req, 'org.read');
    return prisma.workLocation.findMany({ where: { tenantId: u.tenantId }, select: locSelect, orderBy: { name: 'asc' } });
  });
  app.post('/locations', { schema: { body: WorkLocationInput } }, async (req, reply) => {
    const u = requireUser(req, 'org.manage');
    const l = await prisma.workLocation.create({ data: { ...req.body, tenantId: u.tenantId }, select: locSelect });
    await audit(u, 'org.location_create', 'WorkLocation', l.id, { name: l.name }, { ip: req.ip });
    return reply.status(201).send(l);
  });
  app.patch('/locations/:id', { schema: { params: idParam, body: WorkLocationInput.partial() } }, async (req) => {
    const u = requireUser(req, 'org.manage');
    if (!(await prisma.workLocation.findFirst({ where: { id: req.params.id, tenantId: u.tenantId } }))) throw notFound('Location');
    return prisma.workLocation.update({ where: { id: req.params.id }, data: req.body, select: locSelect });
  });

  // ── Users ──
  const userInclude = { roles: true, employee: { select: { id: true } } } as const;
  type UserRow = Prisma.UserGetPayload<{ include: typeof userInclude }>;
  const userOut = (x: UserRow) => ({
    id: x.id, email: x.email, phone: x.phone, fullName: fullName(x), firstName: x.firstName, lastName: x.lastName, middleName: x.middleName,
    isActive: x.isActive, roles: x.roles.map((r) => ({ role: r.role, legalEntityId: r.legalEntityId, canSign: r.canSign })),
    lastLoginAt: x.lastLoginAt?.toISOString() ?? null, employeeId: x.employee?.id ?? null,
  });

  async function assertRoleScopes(tenantId: string, roles: { legalEntityId: string | null }[]) {
    const ids = [...new Set(roles.map((r) => r.legalEntityId).filter((x): x is string => !!x))];
    if (ids.length && (await prisma.legalEntity.count({ where: { tenantId, id: { in: ids } } })) !== ids.length) throw notFound('Legal entity');
  }

  app.get('/users', {
    schema: { querystring: pageQuery.extend({ q: z.string().max(100).optional(), role: z.enum(ROLES).optional(), active: boolQuery.optional() }) },
  }, async (req) => {
    const u = requireUser(req, 'users.manage');
    const { q, role, active } = req.query;
    const where: Prisma.UserWhereInput = {
      tenantId: u.tenantId,
      ...(role ? { roles: { some: { role } } } : {}),
      ...(active !== undefined ? { isActive: active } : {}),
      ...(q ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } }, { firstName: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.user.findMany({ where, include: userInclude, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], ...pageArgs(req.query) }),
      prisma.user.count({ where }),
    ]);
    return toPage(rows.map(userOut), total, req.query);
  });

  app.post('/users', { schema: { body: UserInput } }, async (req, reply) => {
    const u = requireUser(req, 'users.manage');
    const { roles, sendInvite, ...data } = req.body;
    await assertRoleScopes(u.tenantId, roles);
    const created = await prisma.user.create({
      data: { ...data, tenantId: u.tenantId, roles: { create: roles } },
      include: userInclude,
    });
    await audit(u, 'users.create', 'User', created.id, { email: created.email, roles }, { ip: req.ip });
    if (sendInvite) {
      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: u.tenantId } });
      await messaging('EMAIL').send({
        tenantId: u.tenantId,
        to: created.email,
        subject: t('invite.subject', created.locale),
        text: t('invite.user', created.locale, { name: created.firstName, company: tenant.name, url: `${config.APP_URL}/${created.locale}/reset` }),
      });
    }
    return reply.status(201).send(userOut(created));
  });

  app.patch('/users/:id', { schema: { params: idParam, body: UserUpdate } }, async (req) => {
    const u = requireUser(req, 'users.manage');
    const found = await prisma.user.findFirst({ where: { id: req.params.id, tenantId: u.tenantId } });
    if (!found) throw notFound('User');
    const { roles, sendInvite: _s, ...data } = req.body;
    if (found.id === u.userId && (data.isActive === false || (roles && !roles.some((r) => r.role === 'ADMIN')))) {
      throw conflict('You cannot deactivate yourself or remove your own admin role');
    }
    if (roles) await assertRoleScopes(u.tenantId, roles);
    const updated = await prisma.$transaction(async (tx) => {
      if (roles) {
        await tx.roleAssignment.deleteMany({ where: { userId: found.id } });
        await tx.roleAssignment.createMany({ data: roles.map((r) => ({ ...r, userId: found.id })) });
      }
      if (data.isActive === false) await tx.session.deleteMany({ where: { userId: found.id } });
      return tx.user.update({ where: { id: found.id }, data, include: userInclude });
    });
    await audit(u, 'users.update', 'User', found.id, req.body, { ip: req.ip });
    return userOut(updated);
  });

  app.get('/seats', async (req) => {
    const u = requireUser(req, 'org.manage');
    const [activeEmployees, hrUsers, legalEntities] = await Promise.all([
      prisma.employee.count({ where: { tenantId: u.tenantId, status: 'ACTIVE' } }),
      prisma.user.count({ where: { tenantId: u.tenantId, isActive: true, roles: { some: { role: 'HR' } } } }),
      prisma.legalEntity.count({ where: { tenantId: u.tenantId } }),
    ]);
    return { activeEmployees, hrUsers, legalEntities };
  });

  // ── Audit log & outbox ──
  app.get('/audit', {
    schema: {
      querystring: pageQuery.extend({
        entityType: z.string().max(50).optional(), entityId: id.optional(), actorId: id.optional(),
        from: z.iso.datetime().optional(), to: z.iso.datetime().optional(), action: z.string().max(80).optional(),
      }),
    },
  }, async (req) => {
    const u = requireUser(req, 'audit.read');
    const q = req.query;
    const where: Prisma.AuditLogWhereInput = {
      tenantId: u.tenantId,
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.actorId ? { actorUserId: q.actorId } : {}),
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }),
      prisma.auditLog.count({ where }),
    ]);
    const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter((x): x is string => !!x))];
    const actors = new Map(
      (await prisma.user.findMany({ where: { id: { in: actorIds } }, select: userRefSelect })).map((a) => [a.id, toUserRef(a)]),
    );
    return toPage(
      rows.map((r) => ({
        id: r.id, action: r.action, entityType: r.entityType, entityId: r.entityId,
        actor: r.actorUserId ? (actors.get(r.actorUserId) ?? null) : null, meta: r.meta, ip: r.ip, createdAt: r.createdAt.toISOString(),
      })),
      total,
      q,
    );
  });

  app.get('/outbox', { schema: { querystring: pageQuery.extend({ channel: z.enum(['EMAIL', 'SMS', 'WHATSAPP']).optional(), to: z.string().max(200).optional() }) } }, async (req) => {
    const u = requireUser(req, 'org.manage');
    const where: Prisma.OutboxWhereInput = {
      tenantId: u.tenantId,
      ...(req.query.channel ? { channel: req.query.channel } : {}),
      ...(req.query.to ? { to: { contains: req.query.to } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.outbox.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(req.query) }),
      prisma.outbox.count({ where }),
    ]);
    return toPage(rows.map((r) => ({ ...r, tenantId: undefined, createdAt: r.createdAt.toISOString() })), total, req.query);
  });
}
