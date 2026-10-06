import type { Tx } from '../../lib/db';
import { conflict } from '../../lib/errors';
import { saveFile } from '../../lib/files';
import { registerNumber } from './numbering';
import { finalizeDocument, lockDocument, startRoute } from './route-engine';

/**
 * "Signed on paper" mode (F-21): stores the scan as a new attachment, completes every remaining route step
 * with method PAPER (recorded on behalf of the assignee) and completes the document; the scan (if PDF) becomes the signed PDF.
 */
export async function completePaperSigned(
  tx: Tx,
  opts: { documentId: string; actorUserId: string; scan: { filename: string; buffer: Buffer }; registeredAt?: Date },
) {
  await lockDocument(tx, opts.documentId);
  let doc = await tx.document.findUniqueOrThrow({ where: { id: opts.documentId } });
  if (['COMPLETED', 'CANCELLED', 'REJECTED'].includes(doc.status)) throw conflict(`Document in status ${doc.status} cannot be completed on paper`, { rule: 'INVALID_STATUS' });
  const stored = await saveFile({ tenantId: doc.tenantId, buffer: opts.scan.buffer, filename: opts.scan.filename, allowed: ['pdf', 'jpg', 'png'], uploadedById: opts.actorUserId }, tx);
  const df = await tx.documentFile.create({ data: { documentId: doc.id, name: `Скан бумажного оригинала (${opts.scan.filename})` } });
  await tx.fileVersion.create({ data: { documentFileId: df.id, version: 1, storedFileId: stored.id, uploadedById: opts.actorUserId } });

  if (doc.status === 'DRAFT' || doc.status === 'REWORK') await startRoute(tx, doc.id, opts.actorUserId);
  doc = await tx.document.findUniqueOrThrow({ where: { id: opts.documentId } });
  if (opts.registeredAt) await registerNumber(tx, doc.id, { registeredAt: opts.registeredAt });

  if (doc.status === 'IN_ROUTE') {
    const remaining = await tx.routeStep.findMany({ where: { documentId: doc.id, status: { in: ['WAITING', 'PENDING'] } } });
    const now = new Date();
    for (const s of remaining) {
      await tx.routeStep.update({ where: { id: s.id }, data: { status: 'DONE', actedAt: now, actedById: opts.actorUserId, comment: 'Подписано на бумаге' } });
      await tx.signature.create({
        data: {
          tenantId: doc.tenantId, documentId: doc.id, routeStepId: s.id, signerUserId: opts.actorUserId, onBehalfOfUserId: s.assigneeUserId,
          method: 'PAPER', docHash: stored.sha256, signatureB64: '', publicKeyPem: '', certSubject: `PAPER scan: ${stored.filename}`,
        },
      });
    }
    await tx.document.update({ where: { id: doc.id }, data: { paperSigned: true, signedPdfFileId: stored.mime === 'application/pdf' ? stored.id : null } });
    await finalizeDocument(tx, doc.id);
  } else {
    // Route had no steps and completed at start: just attach the paper original.
    await tx.document.update({ where: { id: doc.id }, data: { paperSigned: true, signedPdfFileId: stored.mime === 'application/pdf' ? stored.id : doc.signedPdfFileId } });
  }
}
