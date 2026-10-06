import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ArchiveItem, type ArchiveItem as ArchiveItemT } from '@akere/shared';
import { prisma } from '../../lib/db';
import { requireUser, type UserCtx } from '../../lib/auth';
import { AppError, badRequest } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { DOC_KINDS, saveFile } from '../../lib/files';
import { fromDateStr, todayUtc } from '../../lib/dates';
import { legalEntityAllowed } from '../../lib/scope';
import { readMultipart, type UploadedPart } from '../documents/multipart';
import { registerNumber } from '../documents/numbering';

/**
 * Electronic archive (F-25): bulk registration of pre-existing paper-signed documents.
 * Registered with prefix `/documents` → POST /documents/archive (a static route; the documents plugin has no POST /documents/:id).
 * Each item is created in its own transaction so one bad row does not reject the batch.
 */

const message = (e: unknown) => {
  if (e instanceof AppError) return e.message;
  return 'Unexpected error while saving the document';
};

export async function createArchiveDocument(u: UserCtx, item: ArchiveItemT, file: UploadedPart): Promise<string> {
  const registeredAt = fromDateStr(item.registeredAt);
  if (registeredAt > todayUtc()) throw badRequest('Registration date cannot be in the future');
  const type = await prisma.documentType.findFirst({ where: { id: item.documentTypeId, tenantId: u.tenantId } });
  if (!type) throw new AppError(404, 'NOT_FOUND', 'Document type not found');
  const le = await prisma.legalEntity.findFirst({ where: { id: item.legalEntityId, tenantId: u.tenantId } });
  if (!le || !legalEntityAllowed(u, le.id)) throw new AppError(404, 'NOT_FOUND', 'Legal entity not found');
  if (item.subjectEmployeeId) {
    const emp = await prisma.employee.findFirst({ where: { id: item.subjectEmployeeId, tenantId: u.tenantId } });
    if (!emp) throw new AppError(404, 'NOT_FOUND', 'Employee not found');
    if (emp.legalEntityId !== le.id) throw new AppError(422, 'BUSINESS_RULE', 'The employee belongs to another legal entity', { rule: 'SUBJECT_LEGAL_ENTITY_MISMATCH' });
  }
  return prisma.$transaction(async (tx) => {
    const stored = await saveFile({ tenantId: u.tenantId, buffer: file.buffer, filename: file.filename, allowed: DOC_KINDS, uploadedById: u.userId }, tx);
    const isPdf = stored.mime === 'application/pdf';
    const doc = await tx.document.create({
      data: {
        tenantId: u.tenantId, legalEntityId: le.id, documentTypeId: type.id, kind: 'ARCHIVE', title: item.title, status: 'COMPLETED',
        paperSigned: true, authorId: u.userId, subjectEmployeeId: item.subjectEmployeeId ?? null,
        pdfFileId: isPdf ? stored.id : null, signedPdfFileId: isPdf ? stored.id : null,
        completedAt: new Date(`${item.registeredAt}T12:00:00.000Z`),
        data: { archive: true, originalType: type.code, uploadedFile: stored.filename },
      },
    });
    const df = await tx.documentFile.create({ data: { documentId: doc.id, name: `Скан оригинала (${stored.filename})` } });
    await tx.fileVersion.create({ data: { documentFileId: df.id, version: 1, storedFileId: stored.id, uploadedById: u.userId } });
    // Manual number (unique per legal entity + type → 409) or the next number of the type's sequence for that year.
    await registerNumber(tx, doc.id, { number: item.number || undefined, registeredAt });
    // A paper original registered on its real date is not a backdated registration.
    await tx.document.update({ where: { id: doc.id }, data: { backdated: false } });
    await audit(u, 'document.archive', 'Document', doc.id, { title: item.title, number: item.number ?? null, file: stored.filename }, { tx });
    return doc.id;
  }, { timeout: 60_000 });
}

/** Every scan is buffered in memory: one upload carries at most 20 files (M7). */
const MAX_ARCHIVE_FILES = 20;

export default async function archiveRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post('/archive', async (req, reply) => {
    const u = requireUser(req, 'document.manage');
    const { files, fields } = await readMultipart(req, { maxFiles: MAX_ARCHIVE_FILES });
    let raw: unknown;
    try {
      raw = JSON.parse(fields.meta ?? '');
    } catch {
      throw badRequest('Field "meta" must be a JSON array', { fieldErrors: { meta: ['Invalid JSON'] }, formErrors: [] });
    }
    if (!Array.isArray(raw) || raw.length === 0) throw badRequest('Field "meta" must be a non-empty JSON array', { fieldErrors: { meta: ['Expected an array'] }, formErrors: [] });
    if (raw.length > MAX_ARCHIVE_FILES) throw badRequest(`At most ${MAX_ARCHIVE_FILES} documents per upload`, { fieldErrors: { meta: ['Too many items'] }, formErrors: [] });
    const uploads = files.filter((f) => f.field === 'files' || f.field === 'files[]' || f.field === 'file');

    const documentIds: string[] = [];
    const errors: { index: number; message: string }[] = [];
    for (let index = 0; index < raw.length; index++) {
      const parsed = ArchiveItem.safeParse(raw[index]);
      if (!parsed.success) {
        errors.push({ index, message: parsed.error.issues.map((i) => `${i.path.join('.') || 'item'}: ${i.message}`).join('; ') });
        continue;
      }
      const file = uploads[index];
      if (!file) {
        errors.push({ index, message: 'File is missing for this item' });
        continue;
      }
      try {
        documentIds.push(await createArchiveDocument(u, parsed.data, file));
      } catch (e) {
        if (!(e instanceof AppError)) req.log.error(e);
        errors.push({ index, message: message(e) });
      }
    }
    for (let index = raw.length; index < uploads.length; index++) errors.push({ index, message: 'File has no matching meta item' });
    return reply.status(201).send({ documentIds, errors });
  });
}
