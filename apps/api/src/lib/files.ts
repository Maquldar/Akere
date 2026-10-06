import { fileTypeFromBuffer } from 'file-type';
import type { StoredFile } from '@prisma/client';
import { storage } from '../adapters/storage';
import { prisma, type Tx } from './db';
import { randomToken, sha256 } from './crypto';
import { AppError } from './errors';
import type { AuthCtx } from './auth';

export type FileKind = 'pdf' | 'doc' | 'docx' | 'jpg' | 'png' | 'heic' | 'xlsx';
export const DOC_KINDS: FileKind[] = ['pdf', 'doc', 'docx', 'jpg', 'png', 'heic'];
export const IMAGE_KINDS: FileKind[] = ['jpg', 'png', 'heic'];
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

const MIME: Record<FileKind, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** Detect the real type from magic bytes; the client-provided name/mime are never trusted. */
export async function sniff(buf: Buffer, filename: string): Promise<FileKind | null> {
  const ft = await fileTypeFromBuffer(buf);
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (!ft) return null;
  if (ft.ext === 'pdf') return 'pdf';
  if (ft.ext === 'jpg') return 'jpg';
  if (ft.ext === 'png') return 'png';
  if (ft.ext === 'heic' || ft.mime === 'image/heic' || ft.mime === 'image/heif') return 'heic';
  if (ft.ext === 'docx') return 'docx';
  if (ft.ext === 'xlsx') return 'xlsx';
  if (ft.ext === 'cfb' && ext === 'doc') return 'doc';
  // Some docx/xlsx producers are detected as plain zip.
  if (ft.ext === 'zip' && (ext === 'docx' || ext === 'xlsx')) return ext;
  return null;
}

const safeName = (name: string) =>
  name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(-180) || 'file';

export async function saveFile(
  opts: { tenantId: string; buffer: Buffer; filename: string; allowed: FileKind[]; uploadedById?: string | null; candidateDocumentId?: string },
  tx: Tx = prisma,
): Promise<StoredFile> {
  if (opts.buffer.length > MAX_FILE_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'File is larger than 25 MB');
  if (opts.buffer.length === 0) throw new AppError(415, 'UNSUPPORTED_FILE', 'File is empty');
  const kind = await sniff(opts.buffer, opts.filename);
  if (!kind || !opts.allowed.includes(kind)) {
    throw new AppError(415, 'UNSUPPORTED_FILE', `Allowed types: ${opts.allowed.join(', ')}`);
  }
  const key = `${opts.tenantId}/${new Date().toISOString().slice(0, 7)}/${randomToken(16)}.${kind}`;
  await storage.put(key, opts.buffer, MIME[kind]);
  return tx.storedFile.create({
    data: {
      tenantId: opts.tenantId,
      key,
      filename: safeName(opts.filename),
      mime: MIME[kind],
      size: opts.buffer.length,
      sha256: sha256(opts.buffer),
      uploadedById: opts.uploadedById ?? null,
      candidateDocumentId: opts.candidateDocumentId,
    },
  });
}

/** For server-generated files (PDF, xlsx) — no sniffing needed. */
export async function saveGenerated(tenantId: string, buffer: Buffer, filename: string, mime: string, tx: Tx = prisma) {
  const ext = filename.split('.').pop() ?? 'bin';
  const key = `${tenantId}/${new Date().toISOString().slice(0, 7)}/${randomToken(16)}.${ext}`;
  await storage.put(key, buffer, mime);
  return tx.storedFile.create({ data: { tenantId, key, filename: safeName(filename), mime, size: buffer.length, sha256: sha256(buffer) } });
}

export const fileUrl = (id: string) => `/api/v1/files/${id}`;

export type FileRef = { id: string; filename: string; mime: string; size: number; url: string; createdAt: string };
export const toFileRef = (f: StoredFile, portal = false): FileRef => ({
  id: f.id,
  filename: f.filename,
  mime: f.mime,
  size: f.size,
  url: portal ? `/api/v1/portal/files/${f.id}` : fileUrl(f.id),
  createdAt: f.createdAt.toISOString(),
});

/**
 * File access is decided by the module that owns the file. Modules register checkers;
 * the first one that returns true grants access. Unknown files are denied.
 */
type FileAccessChecker = (ctx: AuthCtx, file: StoredFile) => Promise<boolean>;
const checkers: FileAccessChecker[] = [];
export const registerFileAccess = (fn: FileAccessChecker) => checkers.push(fn);

export async function canAccessFile(ctx: AuthCtx, file: StoredFile): Promise<boolean> {
  if (file.tenantId !== ctx.tenantId) return false;
  if (ctx.kind === 'user' && file.uploadedById === ctx.userId) return true;
  for (const check of checkers) if (await check(ctx, file)) return true;
  return false;
}
