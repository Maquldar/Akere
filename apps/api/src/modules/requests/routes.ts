import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { RequestInput, RequestsQuery, id } from '@akere/shared';
import { prisma } from '../../lib/db';
import { requireUser } from '../../lib/auth';
import { pageArgs, toPage } from '../../lib/pagination';
import { inTx } from '../documents/route-engine';
import { ensureRequestTypes, sortTypes, toRequestTypeView } from './types';
import {
  cancelRequest, createRequest, getRequestDetail, listScope, previewRequest, requestInclude, submitRequest, toListItem, updateRequest,
} from './service';
import './hooks';

const idParam = z.object({ id });

/** Employee requests (API.md §8, F-26/F-27). */
export default async function requestsRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/request-types', async (req) => {
    const u = requireUser(req, 'request.create');
    const types = await ensureRequestTypes(u.tenantId);
    return sortTypes(types.filter((t) => t.isActive)).map(toRequestTypeView);
  });

  app.get('/requests', { schema: { querystring: RequestsQuery } }, async (req) => {
    const u = requireUser(req, 'request.read');
    const q = req.query;
    const where = {
      AND: [
        await listScope(u, q.scope),
        ...(q.status ? [{ status: q.status }] : []),
        ...(q.requestTypeId ? [{ requestTypeId: q.requestTypeId }] : []),
        ...(q.employeeId ? [{ employeeId: q.employeeId }] : []),
      ],
    };
    const [rows, total] = await Promise.all([
      prisma.request.findMany({ where, include: requestInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pageArgs(q) }),
      prisma.request.count({ where }),
    ]);
    return toPage(rows.map(toListItem), total, q);
  });

  app.post('/requests', { schema: { body: RequestInput } }, async (req, reply) => {
    const u = requireUser(req, 'request.create');
    const reqId = await inTx((tx) => createRequest(tx, u, req.body));
    return reply.status(201).send(await getRequestDetail(u, reqId));
  });

  app.post('/requests/preview', { schema: { body: RequestInput, querystring: z.object({ requestId: id.optional() }) } }, async (req) => {
    const u = requireUser(req, 'request.create');
    return previewRequest(u, req.body, req.query.requestId ?? null);
  });

  app.get('/requests/:id', { schema: { params: idParam } }, async (req) => {
    const u = requireUser(req, 'request.read');
    return getRequestDetail(u, req.params.id);
  });

  app.patch('/requests/:id', { schema: { params: idParam, body: RequestInput } }, async (req) => {
    const u = requireUser(req, 'request.create');
    await inTx((tx) => updateRequest(tx, u, req.params.id, req.body));
    return getRequestDetail(u, req.params.id);
  });

  app.post('/requests/:id/submit', { schema: { params: idParam } }, async (req) => {
    const u = requireUser(req, 'request.create');
    await inTx((tx) => submitRequest(tx, u, req.params.id));
    return getRequestDetail(u, req.params.id);
  });

  app.post('/requests/:id/cancel', { schema: { params: idParam } }, async (req) => {
    const u = requireUser(req, 'request.create');
    await inTx((tx) => cancelRequest(tx, u, req.params.id));
    return getRequestDetail(u, req.params.id);
  });
}
