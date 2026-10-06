import { prisma } from '../../lib/db';
import { on } from '../../lib/hooks';
import { registerFileAccess } from '../../lib/files';
import { registerInboxCounter } from '../me/routes';
import { inTx } from '../documents/route-engine';
import { canReadRequest, handleDocumentCompleted, handleDocumentRejected, handleDocumentReturned, pendingApprovalCount } from './service';

/** Request state machine driven by the route engine (runs inside the engine's transaction). */
on('document.completed', async ({ documentId }, tx) => (tx ? handleDocumentCompleted(tx, documentId) : inTx((t) => handleDocumentCompleted(t, documentId))));
on('document.rejected', async ({ documentId }, tx) => (tx ? handleDocumentRejected(tx, documentId) : inTx((t) => handleDocumentRejected(t, documentId))));
on('document.returned', async ({ documentId }, tx) => (tx ? handleDocumentReturned(tx, documentId) : inTx((t) => handleDocumentReturned(t, documentId))));

/** Sidebar badge "Заявки": applications waiting for my approval. */
registerInboxCounter('requests', (u) => pendingApprovalCount(u));

/** Request attachments: readable by everyone who can read the request (owner, their managers, HR in scope, route participants). */
registerFileAccess(async (ctx, file) => {
  if (ctx.kind !== 'user') return false;
  const rows = await prisma.request.findMany({
    where: { tenantId: ctx.tenantId, attachmentFileIds: { has: file.id } },
    select: { id: true, employeeId: true, status: true },
    take: 5,
  });
  for (const r of rows) if (await canReadRequest(ctx, r)) return true;
  return false;
});
