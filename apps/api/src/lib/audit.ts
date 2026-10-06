import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from './db';
import type { AuthCtx } from './auth';

export async function audit(
  ctx: AuthCtx | { tenantId: string; userId?: string } | null,
  action: string,
  entityType: string,
  entityId: string | null,
  meta: Prisma.InputJsonValue = {},
  opts: { ip?: string; tx?: Tx } = {},
) {
  if (!ctx) return;
  const db = opts.tx ?? prisma;
  await db.auditLog.create({
    data: {
      tenantId: ctx.tenantId,
      actorUserId: 'kind' in ctx ? (ctx.kind === 'user' ? ctx.userId : null) : (ctx.userId ?? null),
      actorCandidateId: 'kind' in ctx && ctx.kind === 'candidate' ? ctx.candidateId : null,
      action,
      entityType,
      entityId,
      meta,
      ip: opts.ip ?? null,
    },
  });
}
