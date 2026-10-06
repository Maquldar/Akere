import type { FastifyRequest } from 'fastify';
import { badRequest } from '../../lib/errors';

export type UploadedPart = { field: string; filename: string; buffer: Buffer };

/** Collects all multipart files and fields (field order independent). */
export async function readMultipart(req: FastifyRequest): Promise<{ files: UploadedPart[]; fields: Record<string, string> }> {
  if (!req.isMultipart()) throw badRequest('Expected multipart/form-data');
  const files: UploadedPart[] = [];
  const fields: Record<string, string> = {};
  for await (const part of req.parts()) {
    if (part.type === 'file') files.push({ field: part.fieldname, filename: part.filename || 'file', buffer: await part.toBuffer() });
    else fields[part.fieldname] = String(part.value ?? '');
  }
  return { files, fields };
}
