import type { FastifyRequest } from 'fastify';
import { AppError, badRequest } from '../../lib/errors';

export type UploadedPart = { field: string; filename: string; buffer: Buffer };

export const tooManyFiles = (max: number) => new AppError(413, 'FILE_TOO_LARGE', `At most ${max} file(s) per request`, { rule: 'TOO_MANY_FILES', maxFiles: max });

/**
 * Collects multipart files and fields (field order independent). Every file is buffered in memory, so the number of
 * file parts is capped per route (`maxFiles`, default 1; busboy stops reading beyond it) — extra files → 413 FILE_TOO_LARGE (details.rule TOO_MANY_FILES).
 */
export async function readMultipart(
  req: FastifyRequest,
  opts: { maxFiles?: number; maxFileBytes?: number } = {},
): Promise<{ files: UploadedPart[]; fields: Record<string, string> }> {
  if (!req.isMultipart()) throw badRequest('Expected multipart/form-data');
  const maxFiles = opts.maxFiles ?? 1;
  const files: UploadedPart[] = [];
  const fields: Record<string, string> = {};
  const parts = req.parts({ limits: { files: maxFiles, ...(opts.maxFileBytes ? { fileSize: opts.maxFileBytes } : {}) } });
  for await (const part of parts) {
    if (part.type === 'file') {
      if (files.length >= maxFiles) throw tooManyFiles(maxFiles);
      files.push({ field: part.fieldname, filename: part.filename || 'file', buffer: await part.toBuffer() });
    } else fields[part.fieldname] = String(part.value ?? '');
  }
  return { files, fields };
}
