import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { NcaLayerInput, SigningConfirmInput, SigningSessionCreate, id } from '@akere/shared';
import { prisma } from '../../lib/db';
import { requireUser } from '../../lib/auth';
import { businessRule } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { verifySigningPin } from '../../adapters/signing';
import { createSigningSession, declineSession, getOwnSession, getSessionByToken, sessionView, signSession } from './service';

const idParam = z.object({ id });
const tokenParam = z.object({ token: z.string().min(16).max(128) });

export default async function signingRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post('/sessions', { schema: { body: SigningSessionCreate } }, async (req, reply) => {
    const u = requireUser(req, 'document.read');
    return reply.status(201).send(await createSigningSession(u, req.body.documentIds, req.body.method));
  });

  app.get('/sessions/:id', { schema: { params: idParam } }, async (req) => {
    const u = requireUser(req, 'document.read');
    return sessionView(await getOwnSession(u, req.params.id));
  });

  app.post('/sessions/:id/ncalayer', { schema: { params: idParam, body: NcaLayerInput } }, async (req) => {
    const u = requireUser(req, 'document.read');
    const s = await getOwnSession(u, req.params.id);
    if (s.method !== 'NCALAYER') throw businessRule('WRONG_METHOD', 'This session is not an NCALayer session');
    if (!(await verifySigningPin(u.userId, req.body.pin))) {
      await audit(u, 'signing.pin_failed', 'SigningSession', s.id, {}, { ip: req.ip });
      throw businessRule('INVALID_PIN', 'Wrong signing PIN');
    }
    return signSession(u, s);
  });

  app.post('/sessions/:id/cancel', { schema: { params: idParam } }, async (req, reply) => {
    const u = requireUser(req, 'document.read');
    const s = await getOwnSession(u, req.params.id);
    await prisma.signingSession.updateMany({ where: { id: s.id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    return reply.status(204).send();
  });

  // eGov mobile sandbox page (opened from the QR on the phone; requires the same user's session).
  app.get('/qr/:token', { schema: { params: tokenParam } }, async (req) => {
    const u = requireUser(req, 'document.read');
    const s = await getSessionByToken(u, req.params.token);
    const docs = await prisma.document.findMany({ where: { id: { in: s.documentIds } }, select: { id: true, title: true, number: true } });
    const order = new Map(s.documentIds.map((x, i) => [x, i]));
    docs.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    return { session: await sessionView(s), documents: docs };
  });

  app.post('/qr/:token/confirm', { schema: { params: tokenParam, body: SigningConfirmInput } }, async (req) => {
    const u = requireUser(req, 'document.read');
    const s = await getSessionByToken(u, req.params.token);
    if (s.method === 'NCALAYER') throw businessRule('WRONG_METHOD', 'NCALayer sessions are confirmed with a PIN');
    return req.body.decision === 'SIGN' ? signSession(u, s) : declineSession(u, s);
  });
}
