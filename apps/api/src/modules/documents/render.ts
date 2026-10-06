import type { TemplateBlock } from '@akere/shared';
import { storage } from '../../adapters/storage';
import { keyFingerprint } from '../../adapters/signing';
import { prisma, type Tx } from '../../lib/db';
import { saveGenerated } from '../../lib/files';
import { fullName } from '../../lib/names';
import { appendSignatureSheet } from '../../lib/pdf';
import { buildTemplateContext, renderPlainPdf, renderTemplatePdf } from '../../lib/templates';
import { sha256 } from '../../lib/crypto';

const METHOD_LABEL: Record<string, string> = {
  EGOV_MOBILE: 'eGov mobile', EGOV_BUSINESS: 'eGov mobile Business', NCALAYER: 'ЭЦП НУЦ РК (NCALayer)', PAPER: 'На бумаге', CLICK: 'Простая электронная подпись',
};
export const signMethodLabel = (m: string) => METHOD_LABEL[m] ?? m;

const pdfName = (title: string, number: string | null) => `${(number ? `${title} №${number}` : title).replace(/[\\/:*?"<>|]/g, '_').slice(0, 150)}.pdf`;

/** (Re)generates the document PDF from its type's template (or a plain layout) and stores it as pdfFileId. */
export async function generateDocumentPdf(documentId: string, tx: Tx = prisma): Promise<string> {
  const doc = await tx.document.findUniqueOrThrow({ where: { id: documentId }, include: { documentType: { include: { template: true } } } });
  const ctx = await buildTemplateContext({
    legalEntityId: doc.legalEntityId,
    subjectEmployeeId: doc.subjectEmployeeId,
    authorUserId: doc.authorId,
    documentTypeId: doc.documentTypeId,
    document: { number: doc.number, registeredAt: doc.registeredAt, createdAt: doc.createdAt, title: doc.title },
    data: (doc.data ?? {}) as Record<string, unknown>,
  }, tx);
  const tpl = doc.documentType.template;
  const bytes = tpl ? await renderTemplatePdf(tpl.body as TemplateBlock[], ctx, doc.title) : await renderPlainPdf(ctx);
  const file = await saveGenerated(doc.tenantId, bytes, pdfName(doc.title, doc.number), 'application/pdf', tx);
  await tx.document.update({ where: { id: doc.id }, data: { pdfFileId: file.id } });
  return file.id;
}

/** Bytes of the document's current (unsigned) PDF; generates one if the document has none yet. */
export async function documentPdfBytes(documentId: string, tx: Tx = prisma): Promise<{ bytes: Buffer; fileId: string }> {
  const doc = await tx.document.findUniqueOrThrow({ where: { id: documentId }, select: { pdfFileId: true } });
  const fileId = doc.pdfFileId ?? (await generateDocumentPdf(documentId, tx));
  const file = await tx.storedFile.findUniqueOrThrow({ where: { id: fileId } });
  return { bytes: await storage.get(file.key), fileId };
}

/** Builds the signed PDF (original + signature sheet) and stores it as signedPdfFileId. */
export async function generateSignedPdf(documentId: string, tx: Tx = prisma): Promise<string | null> {
  const doc = await tx.document.findUniqueOrThrow({ where: { id: documentId } });
  const sigs = await tx.signature.findMany({ where: { documentId }, orderBy: { signedAt: 'asc' } });
  const crypto = sigs.filter((s) => s.method !== 'PAPER');
  if (!crypto.length) return null;
  const { bytes } = await documentPdfBytes(documentId, tx);
  const userIds = [...new Set(sigs.flatMap((s) => [s.signerUserId, s.onBehalfOfUserId].filter((x): x is string => !!x)))];
  const users = new Map((await tx.user.findMany({ where: { id: { in: userIds } } })).map((u) => [u.id, fullName(u)]));
  const signed = await appendSignatureSheet(bytes, {
    title: doc.number ? `${doc.title} № ${doc.number}` : doc.title,
    docHash: sha256(bytes),
    signatures: crypto.map((s) => ({
      signer: users.get(s.signerUserId) ?? s.certSubject,
      method: signMethodLabel(s.method),
      signedAt: s.signedAt.toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
      onBehalfOf: s.onBehalfOfUserId ? (users.get(s.onBehalfOfUserId) ?? null) : null,
      fingerprint: keyFingerprint(s.publicKeyPem),
    })),
  });
  const file = await saveGenerated(doc.tenantId, signed, pdfName(`${doc.title} (подписан)`, doc.number), 'application/pdf', tx);
  await tx.document.update({ where: { id: doc.id }, data: { signedPdfFileId: file.id } });
  return file.id;
}
