import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import {
  PublicCandidatesQuery, PublicDocumentsQuery, PublicEmployeesQuery, PublicMarkExportedInput, PublicTimesheetQuery, permissionsForRoles,
  type ApiKeyScope,
} from '@akere/shared';
import { prisma } from '../../lib/db';
import type { UserCtx } from '../../lib/auth';
import { AppError, forbidden, unauthenticated } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { pageArgs, toPage } from '../../lib/pagination';
import { fromDateStr } from '../../lib/dates';
import { exportRecord } from '../candidates/export';
import { employeeListInclude, toEmployeeListItem } from '../employees/service';
import { listInclude, toListItems } from '../documents/service';
import { buildT13 } from '../time/service';
import { keyPrefix, verifyApiKey } from '../api-keys/service';

/**
 * Public REST API (F-50) for 1С / ERP integrations. app.ts skips cookie auth and CSRF for /api/v1/public/*;
 * this plugin authenticates `Authorization: Bearer ak_<prefix>_<secret>` itself, checks the route's scope,
 * records lastUsedAt and rate-limits each key to 60 requests per minute.
 */
type ApiCtx = { tenantId: string; keyId: string; createdById: string; scopes: string[] };
const ctxOf = new WeakMap<FastifyRequest, ApiCtx>();
const apiCtx = (req: FastifyRequest) => ctxOf.get(req)!;

const RATE_LIMIT = {
  max: 60,
  timeWindow: '1 minute',
  keyGenerator: (req: FastifyRequest) => {
    const raw = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? '').trim())?.[1];
    const prefix = keyPrefix(raw);
    return prefix ? `apikey:${prefix}` : `apikey-anon:${req.ip}`;
  },
};

const REASONS: Record<string, string> = {
  MISSING: 'API key required: send Authorization: Bearer <key>',
  MALFORMED: 'Malformed Authorization header, expected: Bearer <key>',
  INVALID: 'Invalid API key',
  REVOKED: 'API key has been revoked',
};

function guard(scope: ApiKeyScope) {
  return {
    config: { rateLimit: RATE_LIMIT },
    onRequest: async (req: FastifyRequest) => {
      const res = await verifyApiKey(req.headers.authorization);
      if (!res.ok) throw unauthenticated(REASONS[res.reason]);
      if (!res.key.scopes.includes(scope)) throw forbidden(`API key lacks scope ${scope}`);
      ctxOf.set(req, { tenantId: res.key.tenantId, keyId: res.key.id, createdById: res.key.createdById, scopes: res.key.scopes });
      if (!res.key.lastUsedAt || Date.now() - res.key.lastUsedAt.getTime() > 60_000) {
        await prisma.apiKey.update({ where: { id: res.key.id }, data: { lastUsedAt: new Date() } });
      }
    },
  };
}

/** Tenant-wide read context for reusing staff services (T-13 builder) on behalf of an API key. */
function integrationUser(c: ApiCtx): UserCtx {
  return {
    kind: 'user', sessionId: `apikey:${c.keyId}`, userId: c.createdById, tenantId: c.tenantId, roles: ['ADMIN'],
    grants: [{ role: 'ADMIN', legalEntityId: null, canSign: false }], permissions: permissionsForRoles(['ADMIN']), employeeId: null, locale: 'ru', pending2fa: false,
  };
}

const since = (v: string | undefined) => (v ? (v.length === 10 ? fromDateStr(v) : new Date(v)) : undefined);

export default async function publicRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/candidates', { ...guard('candidates:read'), schema: { querystring: PublicCandidatesQuery } }, async (req) => {
    const c = apiCtx(req);
    const q = req.query;
    const where: Prisma.CandidateWhereInput = {
      tenantId: c.tenantId, status: q.status,
      ...(q.updatedFrom ? { updatedAt: { gte: since(q.updatedFrom) } } : {}),
      ...(q.tag ? { tags: { has: q.tag } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.candidate.findMany({ where, include: { legalEntity: { select: { name: true, bin: true } } }, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], ...pageArgs(q) }),
      prisma.candidate.count({ where }),
    ]);
    const items = [];
    for (const r of rows) items.push(await exportRecord(r));
    return toPage(items, total, q);
  });

  app.post('/candidates/mark-exported', { ...guard('candidates:write'), schema: { body: PublicMarkExportedInput } }, async (req) => {
    const c = apiCtx(req);
    const ids = [...new Set(req.body.candidateIds)];
    const res = await prisma.candidate.updateMany({
      where: { tenantId: c.tenantId, id: { in: ids }, status: { in: ['ACCEPTED', 'EXPORTED'] } },
      data: { status: 'EXPORTED', exportedAt: new Date() },
    });
    await audit({ tenantId: c.tenantId }, 'candidate.export_api', 'Candidate', null, { apiKeyId: c.keyId, candidateIds: ids, updated: res.count }, { ip: req.ip });
    return { updated: res.count };
  });

  app.get('/employees', { ...guard('employees:read'), schema: { querystring: PublicEmployeesQuery } }, async (req) => {
    const c = apiCtx(req);
    const q = req.query;
    const where: Prisma.EmployeeWhereInput = {
      tenantId: c.tenantId,
      ...(q.legalEntityId ? { legalEntityId: q.legalEntityId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.updatedFrom ? { updatedAt: { gte: since(q.updatedFrom) } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.employee.findMany({ where, include: employeeListInclude, orderBy: [{ tabNumber: 'asc' }], ...pageArgs(q) }),
      prisma.employee.count({ where }),
    ]);
    return toPage(rows.map((e) => ({ ...toEmployeeListItem(e), iin: e.iin, terminationDate: e.terminationDate?.toISOString().slice(0, 10) ?? null, updatedAt: e.updatedAt.toISOString() })), total, q);
  });

  app.get('/timesheet', { ...guard('timesheet:read'), schema: { querystring: PublicTimesheetQuery } }, async (req) => {
    const c = apiCtx(req);
    if (req.query.legalEntityId && !(await prisma.legalEntity.count({ where: { id: req.query.legalEntityId, tenantId: c.tenantId } }))) {
      throw new AppError(404, 'NOT_FOUND', 'Legal entity not found');
    }
    const { rowsMeta, meta, ...sheet } = await buildT13(integrationUser(c), { year: req.query.year, month: req.query.month, legalEntityId: req.query.legalEntityId });
    return {
      ...sheet,
      // 1С matches rows by табельный номер.
      rows: sheet.rows.map((r, i) => ({ ...r, tabNumber: rowsMeta[i]?.tabNumber ?? null, position: rowsMeta[i]?.position ?? null })),
      legalEntity: meta.legalEntityName,
    };
  });

  app.get('/documents', { ...guard('documents:read'), schema: { querystring: PublicDocumentsQuery } }, async (req) => {
    const c = apiCtx(req);
    const q = req.query;
    const where: Prisma.DocumentWhereInput = {
      tenantId: c.tenantId, status: q.status,
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.updatedFrom ? { updatedAt: { gte: since(q.updatedFrom) } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.document.findMany({ where, include: listInclude, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], ...pageArgs(q) }),
      prisma.document.count({ where }),
    ]);
    const items = await toListItems(rows, { userId: '', principalIds: [], hrLegalEntities: 'none' });
    const extra = new Map(rows.map((d) => [d.id, d]));
    return toPage(items.map((i) => {
      const d = extra.get(i.id)!;
      return { ...i, registeredAt: d.registeredAt?.toISOString().slice(0, 10) ?? null, completedAt: d.completedAt?.toISOString() ?? null };
    }), total, q);
  });
}
