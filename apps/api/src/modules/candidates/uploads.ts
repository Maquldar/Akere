import type { FastifyRequest } from 'fastify';
import { prisma } from '../../lib/db';
import { tooManyFiles } from '../documents/multipart';
import { AppError, badRequest } from '../../lib/errors';
import { DOC_KINDS, saveFile } from '../../lib/files';

export const MAX_REQUEST_BYTES = 100 * 1024 * 1024;

/** Reads a single multipart `file` field. */
export async function readSingleFile(req: FastifyRequest) {
  const part = await req.file();
  if (!part || part.fieldname !== 'file') throw badRequest('Multipart field "file" is required', { fieldErrors: { file: ['Required'] }, formErrors: [] });
  const buffer = await part.toBuffer();
  return { buffer, filename: part.filename || 'file' };
}

/** Reads the single multipart `file` plus text fields (field order does not matter). More than one file → 413. */
export async function readFileWithFields(req: FastifyRequest, opts: { maxFileBytes?: number } = {}) {
  let file: { buffer: Buffer; filename: string } | null = null;
  const fields: Record<string, string> = {};
  let n = 0;
  for await (const part of req.parts({ limits: { files: 1, ...(opts.maxFileBytes ? { fileSize: opts.maxFileBytes } : {}) } })) {
    if (part.type === 'file') {
      if (++n > 1) throw tooManyFiles(1);
      const buf = await part.toBuffer();
      if (part.fieldname === 'file') file = { buffer: buf, filename: part.filename || 'file' };
    } else fields[part.fieldname] = String(part.value ?? '');
  }
  return { file, fields };
}

/** Saves an uploaded file onto a candidate document, enforcing the 100 MB per-request total (API.md §0). */
export async function saveDocFile(opts: { tenantId: string; requestId: string; docId: string; buffer: Buffer; filename: string; uploadedById: string | null }) {
  const agg = await prisma.storedFile.aggregate({ where: { candidateDocument: { documentRequestId: opts.requestId } }, _sum: { size: true } });
  if ((agg._sum.size ?? 0) + opts.buffer.length > MAX_REQUEST_BYTES) {
    throw new AppError(413, 'FILE_TOO_LARGE', 'Total size of the request files exceeds 100 MB');
  }
  return saveFile({ tenantId: opts.tenantId, buffer: opts.buffer, filename: opts.filename, allowed: DOC_KINDS, uploadedById: opts.uploadedById, candidateDocumentId: opts.docId });
}
