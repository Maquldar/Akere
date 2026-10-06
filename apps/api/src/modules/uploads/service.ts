import type { StoredFile } from '@prisma/client';
import { storage } from '../../adapters/storage';
import { prisma, type Tx } from '../../lib/db';
import { randomToken, sha256 } from '../../lib/crypto';
import { AppError } from '../../lib/errors';
import { DOC_KINDS, MAX_FILE_BYTES, sniff, type FileKind } from '../../lib/files';

/**
 * Temporary attachments (POST /uploads): stored under `<tenant>/uploads/…` so the purge job can tell them
 * apart from every other stored file. They become permanent once a request references them
 * (Request.attachmentFileIds); unreferenced uploads older than 24 h are deleted.
 */

const MIME: Record<FileKind, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
export const UPLOAD_PREFIX = '/uploads/';
export const UPLOAD_TTL_MS = 24 * 3_600_000;

const safeName = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(-180) || 'file';

export async function saveUpload(opts: { tenantId: string; userId: string; buffer: Buffer; filename: string }, tx: Tx = prisma): Promise<StoredFile> {
  if (opts.buffer.length > MAX_FILE_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'File is larger than 25 MB');
  if (opts.buffer.length === 0) throw new AppError(415, 'UNSUPPORTED_FILE', 'File is empty');
  const kind = await sniff(opts.buffer, opts.filename);
  if (!kind || !DOC_KINDS.includes(kind)) throw new AppError(415, 'UNSUPPORTED_FILE', `Allowed types: ${DOC_KINDS.join(', ')}`);
  const key = `${opts.tenantId}${UPLOAD_PREFIX}${new Date().toISOString().slice(0, 7)}/${randomToken(16)}.${kind}`;
  await storage.put(key, opts.buffer, MIME[kind]);
  return tx.storedFile.create({
    data: { tenantId: opts.tenantId, key, filename: safeName(opts.filename), mime: MIME[kind], size: opts.buffer.length, sha256: sha256(opts.buffer), uploadedById: opts.userId },
  });
}

/** Deletes temporary uploads older than 24 h that no request (or document version) references. */
export async function purgeUploads(now: Date = new Date()): Promise<{ deleted: number }> {
  const stale = await prisma.storedFile.findMany({
    where: { key: { contains: UPLOAD_PREFIX }, createdAt: { lt: new Date(now.getTime() - UPLOAD_TTL_MS) }, candidateDocumentId: null, versions: { none: {} } },
    select: { id: true, key: true },
    take: 2000,
  });
  if (!stale.length) return { deleted: 0 };
  const referenced = await prisma.request.findMany({ where: { attachmentFileIds: { hasSome: stale.map((f) => f.id) } }, select: { attachmentFileIds: true } });
  const keep = new Set(referenced.flatMap((r) => r.attachmentFileIds));
  let deleted = 0;
  for (const f of stale) {
    if (keep.has(f.id)) continue;
    await prisma.storedFile.delete({ where: { id: f.id } });
    await storage.delete(f.key).catch(() => undefined);
    deleted++;
  }
  return { deleted };
}
