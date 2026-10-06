import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import {
  DocumentApproveInput, DocumentBulkCreate, DocumentBulkIds, DocumentCancelInput, DocumentCommentInput, DocumentCreate, DocumentFilter,
  DocumentLinkInput, DocumentRegisterInput, DocumentReturnInput, DocumentUpdate, boolQuery, dateStr, id,
} from '@akere/shared';
import { prisma } from '../../lib/db';
import { requireUser, type UserCtx } from '../../lib/auth';
import { AppError, businessRule, conflict, forbidden, notFound } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { pageArgs, toPage } from '../../lib/pagination';
import { fromDateStr, todayUtc } from '../../lib/dates';
import { DOC_KINDS, saveFile } from '../../lib/files';
import { toUserRef, userRefSelect } from '../../lib/names';
import { managedEmployeeScope } from '../../lib/scope';
import { storage } from '../../adapters/storage';
import { verifyBytes } from '../../adapters/signing';
import {
  canManageDoc, createDocument, documentScope, getDocumentDetail, getReadableDocument, isDocHr, listInclude, markViewed, toFileViews,
  toListItems, updateDocument, viewerCtx,
} from './service';
import { completePaperSigned } from './paper';
import { findActionableStep, inTx, rejectDocument, returnDocument, signAndComplete, startRoute } from './route-engine';
import { registerNumber } from './numbering';
import { generateDocumentPdf } from './render';
import { readMultipart } from './multipart';
import { activePrincipalIds } from '../deputies/service';
import configRoutes from './config-routes';
import './hooks';

const idParam = z.object({ id });

/** Non-HR creators may only create documents about employees they manage (or themselves). */
async function assertCanCreate(u: UserCtx, legalEntityId: string, subjectEmployeeIds: string[]) {
  if (isDocHr(u, legalEntityId)) return;
  if (!subjectEmployeeIds.length) {
    const own = u.employeeId ? await prisma.employee.findUnique({ where: { id: u.employeeId }, select: { legalEntityId: true } }) : null;
    if (own?.legalEntityId !== legalEntityId) throw forbidden();
    return;
  }
  const scope = await managedEmployeeScope(u);
  const allowed = await prisma.employee.count({ where: { AND: [scope, { id: { in: subjectEmployeeIds } }] } });
  const selfIncluded = u.employeeId && subjectEmployeeIds.includes(u.employeeId) ? 1 : 0;
  if (allowed + selfIncluded < new Set(subjectEmployeeIds).size) throw forbidden();
}

const failureReason = (e: unknown) => {
  if (e instanceof AppError) return (e.details as { rule?: string } | undefined)?.rule ?? e.code;
  return 'INTERNAL';
};

export default async function documentsRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  await app.register(configRoutes);

  // ── Registry ──
  app.get('/documents', { schema: { querystring: DocumentFilter } }, async (req) => {
    const u = requireUser(req, 'document.read');
    const q = req.query;
    const principals = await activePrincipalIds(u.userId);
    const and: Prisma.DocumentWhereInput[] = [await documentScope(u)];
    switch (q.box) {
      case 'inbox':
        and.push({ status: 'IN_ROUTE', steps: { some: { status: 'PENDING', assigneeUserId: { in: [u.userId, ...principals] } } } });
        break;
      case 'outbox':
        and.push({ authorId: u.userId, status: { not: 'DRAFT' } });
        break;
      case 'drafts':
        and.push({ authorId: u.userId, status: 'DRAFT' });
        break;
      case 'archive':
        and.push({ kind: 'ARCHIVE' });
        break;
      default:
        break;
    }
    if (q.kind) and.push({ kind: q.kind });
    if (q.documentTypeId) and.push({ documentTypeId: q.documentTypeId });
    if (q.status) and.push({ status: q.status });
    if (q.legalEntityId) and.push({ legalEntityId: q.legalEntityId });
    if (q.subjectEmployeeId) and.push({ subjectEmployeeId: q.subjectEmployeeId });
    if (q.authorId) and.push({ authorId: q.authorId });
    if (q.dateFrom) and.push({ createdAt: { gte: fromDateStr(q.dateFrom) } });
    if (q.dateTo) and.push({ createdAt: { lt: new Date(fromDateStr(q.dateTo).getTime() + 86_400_000) } });
    if (q.q) and.push({ searchText: { contains: q.q.toLowerCase(), mode: 'insensitive' } });
    if (q.overdue !== undefined) {
      const now = new Date();
      const overdue: Prisma.DocumentWhereInput = { status: 'IN_ROUTE', OR: [{ dueAt: { lt: now } }, { steps: { some: { status: 'PENDING', dueAt: { lt: now } } } }] };
      and.push(q.overdue ? overdue : { NOT: overdue });
    }
    const where: Prisma.DocumentWhereInput = { AND: and };
    const orderBy: Prisma.DocumentOrderByWithRelationInput[] =
      q.sort === 'number' ? [{ number: { sort: q.order, nulls: 'last' } }, { createdAt: 'desc' }]
        : q.sort === 'dueAt' ? [{ dueAt: { sort: q.order, nulls: 'last' } }, { createdAt: 'desc' }]
          : [{ createdAt: q.order }, { id: q.order }];
    const [rows, total] = await Promise.all([
      prisma.document.findMany({ where, include: listInclude, orderBy, ...pageArgs(q) }),
      prisma.document.count({ where }),
    ]);
    return toPage(await toListItems(rows, await viewerCtx(u)), total, q);
  });

  app.post('/documents', { schema: { body: DocumentCreate } }, async (req, reply) => {
    const u = requireUser(req, 'document.create');
    const b = req.body;
    await assertCanCreate(u, b.legalEntityId, b.subjectEmployeeId ? [b.subjectEmployeeId] : []);
    const docId = await inTx((tx) => createDocument(tx, {
      tenantId: u.tenantId, authorUserId: u.userId, documentTypeId: b.documentTypeId, legalEntityId: b.legalEntityId, title: b.title,
      subjectEmployeeId: b.subjectEmployeeId, data: b.data, dueAt: b.dueAt ? new Date(b.dueAt) : null, startRoute: b.startRoute,
    }));
    return reply.status(201).send(await getDocumentDetail(u, docId));
  });

  app.post('/documents/bulk', { schema: { body: DocumentBulkCreate } }, async (req, reply) => {
    const u = requireUser(req, 'document.create');
    const b = req.body;
    const subjects = [...new Set(b.subjectEmployeeIds)];
    await assertCanCreate(u, b.legalEntityId, subjects);
    const documentIds = await inTx(async (tx) => {
      const ids: string[] = [];
      for (const subjectEmployeeId of subjects) {
        ids.push(await createDocument(tx, {
          tenantId: u.tenantId, authorUserId: u.userId, documentTypeId: b.documentTypeId, legalEntityId: b.legalEntityId,
          subjectEmployeeId, data: b.data, dueAt: b.dueAt ? new Date(b.dueAt) : null, startRoute: b.startRoute,
        }));
      }
      return ids;
    });
    return reply.status(201).send({ documentIds });
  });

  app.post('/documents/bulk-approve', { schema: { body: DocumentBulkIds } }, async (req) => {
    const u = requireUser(req, 'document.read');
    const succeeded: string[] = [];
    const failed: { id: string; reason: string }[] = [];
    const principalIds = await activePrincipalIds(u.userId);
    for (const docId of [...new Set(req.body.documentIds)]) {
      try {
        await getReadableDocument(u, docId);
        await inTx(async (tx) => {
          const act = await findActionableStep(tx, { userId: u.userId, principalIds }, docId, ['APPROVE', 'ACKNOWLEDGE']);
          if (!act) throw businessRule('NOTHING_TO_APPROVE', 'No pending approval step');
          await signAndComplete(tx, { documentId: docId, actorUserId: u.userId, method: 'CLICK', actions: ['APPROVE', 'ACKNOWLEDGE'], principalIds });
        });
        succeeded.push(docId);
      } catch (e) {
        failed.push({ id: docId, reason: failureReason(e) });
      }
    }
    return { succeeded, failed };
  });

  // ── Card ──
  app.get('/documents/:id', { schema: { params: idParam } }, async (req) => {
    const u = requireUser(req, 'document.read');
    await getReadableDocument(u, req.params.id);
    await markViewed(u, req.params.id);
    return getDocumentDetail(u, req.params.id);
  });

  app.patch('/documents/:id', { schema: { params: idParam, body: DocumentUpdate } }, async (req) => {
    const u = requireUser(req, 'document.read');
    const doc = await getReadableDocument(u, req.params.id);
    if (!canManageDoc(u, doc)) throw forbidden();
    const b = req.body;
    await inTx((tx) => updateDocument(tx, doc.id, u.userId, { title: b.title, data: b.data, dueAt: b.dueAt === undefined ? undefined : b.dueAt ? new Date(b.dueAt) : null }));
    return getDocumentDetail(u, doc.id);
  });

  app.delete('/documents/:id', { schema: { params: idParam } }, async (req, reply) => {
    const u = requireUser(req, 'document.read');
    const doc = await getReadableDocument(u, req.params.id);
    if (!canManageDoc(u, doc)) throw forbidden();
    if (doc.status !== 'DRAFT') throw conflict('Only drafts can be deleted', { rule: 'NOT_DRAFT' });
    await prisma.document.delete({ where: { id: doc.id } });
    await audit(u, 'document.delete', 'Document', doc.id, { title: doc.title }, { ip: req.ip });
    return reply.status(204).send();
  });

  app.post('/documents/:id/start', { schema: { params: idParam } }, async (req) => {
    const u = requireUser(req, 'document.read');
    const doc = await getReadableDocument(u, req.params.id);
    if (!canManageDoc(u, doc)) throw forbidden();
    await inTx((tx) => startRoute(tx, doc.id, u.userId));
    return getDocumentDetail(u, doc.id);
  });

  app.post('/documents/:id/cancel', { schema: { params: idParam, body: DocumentCancelInput } }, async (req) => {
    const u = requireUser(req, 'document.read');
    const doc = await getReadableDocument(u, req.params.id);
    if (!canManageDoc(u, doc)) throw forbidden();
    if (['COMPLETED', 'CANCELLED', 'REJECTED'].includes(doc.status)) throw conflict(`Document in status ${doc.status} cannot be cancelled`, { rule: 'INVALID_STATUS' });
    await inTx(async (tx) => {
      await tx.routeStep.updateMany({ where: { documentId: doc.id, status: { in: ['WAITING', 'PENDING'] } }, data: { status: 'SKIPPED' } });
      await tx.document.update({ where: { id: doc.id }, data: { status: 'CANCELLED', currentStepOrder: null } });
      await tx.documentComment.create({ data: { documentId: doc.id, authorId: u.userId, text: `Документ отменён: ${req.body.reason}` } });
      await audit(u, 'document.cancel', 'Document', doc.id, { reason: req.body.reason }, { ip: req.ip, tx });
    });
    return getDocumentDetail(u, doc.id);
  });

  app.post('/documents/:id/register', { schema: { params: idParam, body: DocumentRegisterInput } }, async (req) => {
    const u = requireUser(req, 'document.manage');
    const doc = await getReadableDocument(u, req.params.id);
    if (!isDocHr(u, doc.legalEntityId)) throw forbidden();
    if (doc.status === 'CANCELLED' || doc.status === 'REJECTED') throw conflict(`Document in status ${doc.status} cannot be registered`, { rule: 'INVALID_STATUS' });
    const registeredAt = req.body.registeredAt ? fromDateStr(req.body.registeredAt) : undefined;
    if (registeredAt && registeredAt > todayUtc()) throw businessRule('FUTURE_REGISTRATION_DATE', 'Registration date cannot be in the future');
    await inTx(async (tx) => {
      await registerNumber(tx, doc.id, { number: req.body.number, registeredAt });
      // The number is printed in the PDF; regenerate only while nobody has signed it yet.
      if ((await tx.signature.count({ where: { documentId: doc.id } })) === 0) await generateDocumentPdf(doc.id, tx);
      await audit(u, 'document.register', 'Document', doc.id, req.body, { ip: req.ip, tx });
    });
    return getDocumentDetail(u, doc.id);
  });

  // ── Route actions ──
  app.post('/documents/:id/approve', { schema: { params: idParam, body: DocumentApproveInput } }, async (req) => {
    const u = requireUser(req, 'document.read');
    const doc = await getReadableDocument(u, req.params.id);
    await inTx(async (tx) => {
      const act = await findActionableStep(tx, { userId: u.userId }, doc.id, ['APPROVE', 'ACKNOWLEDGE']);
      if (!act) throw businessRule('NOTHING_TO_APPROVE', 'You have no pending approval or acknowledgment step on this document');
      await signAndComplete(tx, { documentId: doc.id, actorUserId: u.userId, method: 'CLICK', actions: ['APPROVE', 'ACKNOWLEDGE'], comment: req.body.comment });
    });
    return getDocumentDetail(u, doc.id);
  });

  for (const action of ['return', 'reject'] as const) {
    app.post(`/documents/:id/${action}`, { schema: { params: idParam, body: DocumentReturnInput } }, async (req) => {
      const u = requireUser(req, 'document.read');
      const doc = await getReadableDocument(u, req.params.id);
      await inTx(async (tx) => {
        const act = await findActionableStep(tx, { userId: u.userId }, doc.id);
        if (!act) throw businessRule('NO_PENDING_STEP', 'You have no pending step on this document');
        const fn = action === 'return' ? returnDocument : rejectDocument;
        await fn(tx, { stepId: act.step.id, actorUserId: u.userId, comment: req.body.comment });
      });
      return getDocumentDetail(u, doc.id);
    });
  }

  app.post('/documents/:id/paper-signed', { schema: { params: idParam } }, async (req) => {
    const u = requireUser(req, 'document.manage');
    const doc = await getReadableDocument(u, req.params.id);
    if (!isDocHr(u, doc.legalEntityId)) throw forbidden();
    const { files, fields } = await readMultipart(req);
    const scan = files[0];
    if (!scan) throw businessRule('FILE_REQUIRED', 'Upload the scan of the signed paper document');
    const registeredAt = fields.registeredAt ? dateStr.parse(fields.registeredAt) : undefined;
    await inTx((tx) => completePaperSigned(tx, {
      documentId: doc.id, actorUserId: u.userId, scan, registeredAt: registeredAt ? fromDateStr(registeredAt) : undefined,
    }));
    await audit(u, 'document.paper_signed', 'Document', doc.id, { registeredAt: registeredAt ?? null }, { ip: req.ip });
    return getDocumentDetail(u, doc.id);
  });

  app.get('/documents/:id/pdf', { schema: { params: idParam, querystring: z.object({ signed: boolQuery.optional(), download: boolQuery.optional() }) } }, async (req, reply) => {
    const u = requireUser(req, 'document.read');
    const doc = await getReadableDocument(u, req.params.id);
    const fileId = req.query.signed ? doc.signedPdfFileId : doc.pdfFileId;
    if (!fileId) throw notFound(req.query.signed ? 'Signed PDF' : 'PDF');
    const file = await prisma.storedFile.findUniqueOrThrow({ where: { id: fileId } });
    const body = await storage.get(file.key);
    return reply
      .header('Content-Type', file.mime)
      .header('Content-Length', String(body.length))
      .header('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.filename)}`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-cache')
      .send(body);
  });

  // ── Attachments ──
  const fileInclude = { versions: { orderBy: { version: 'desc' as const }, include: { storedFile: true } } };

  app.get('/documents/:id/files', { schema: { params: idParam } }, async (req) => {
    const u = requireUser(req, 'document.read');
    const doc = await getReadableDocument(u, req.params.id);
    const files = await prisma.documentFile.findMany({ where: { documentId: doc.id }, include: fileInclude, orderBy: { createdAt: 'asc' } });
    return toFileViews(files);
  });

  app.post('/documents/:id/files', { schema: { params: idParam } }, async (req, reply) => {
    const u = requireUser(req, 'document.read');
    const doc = await getReadableDocument(u, req.params.id);
    const participant = await prisma.routeStep.count({ where: { documentId: doc.id, assigneeUserId: u.userId } });
    if (!canManageDoc(u, doc) && !participant) throw forbidden();
    if (doc.status === 'CANCELLED') throw conflict('Document is cancelled', { rule: 'INVALID_STATUS' });
    const { files, fields } = await readMultipart(req);
    const upload = files[0];
    if (!upload) throw businessRule('FILE_REQUIRED', 'No file uploaded');
    const result = await inTx(async (tx) => {
      const stored = await saveFile({ tenantId: u.tenantId, buffer: upload.buffer, filename: upload.filename, allowed: [...DOC_KINDS, 'xlsx'], uploadedById: u.userId }, tx);
      let df;
      if (fields.documentFileId) {
        const existing = await tx.documentFile.findFirst({ where: { id: fields.documentFileId, documentId: doc.id } });
        if (!existing) throw notFound('Document file');
        const version = existing.currentVersion + 1;
        await tx.fileVersion.create({ data: { documentFileId: existing.id, version, storedFileId: stored.id, uploadedById: u.userId } });
        df = await tx.documentFile.update({ where: { id: existing.id }, data: { currentVersion: version } });
      } else {
        df = await tx.documentFile.create({ data: { documentId: doc.id, name: fields.name?.trim() || upload.filename } });
        await tx.fileVersion.create({ data: { documentFileId: df.id, version: 1, storedFileId: stored.id, uploadedById: u.userId } });
      }
      await audit(u, 'document.file_upload', 'Document', doc.id, { documentFileId: df.id, version: df.currentVersion }, { ip: req.ip, tx });
      return tx.documentFile.findUniqueOrThrow({ where: { id: df.id }, include: fileInclude });
    });
    return reply.status(201).send((await toFileViews([result]))[0]);
  });

  // ── Comments ──
  app.get('/documents/:id/comments', { schema: { params: idParam } }, async (req) => {
    const u = requireUser(req, 'document.read');
    const doc = await getReadableDocument(u, req.params.id);
    const rows = await prisma.documentComment.findMany({ where: { documentId: doc.id }, orderBy: { createdAt: 'asc' } });
    const users = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.authorId))] } }, select: userRefSelect })).map((x) => [x.id, toUserRef(x)]));
    return rows.map((c) => ({ id: c.id, text: c.text, author: users.get(c.authorId) ?? null, createdAt: c.createdAt.toISOString() }));
  });

  app.post('/documents/:id/comments', { schema: { params: idParam, body: DocumentCommentInput } }, async (req, reply) => {
    const u = requireUser(req, 'document.read');
    const doc = await getReadableDocument(u, req.params.id);
    const c = await prisma.documentComment.create({ data: { documentId: doc.id, authorId: u.userId, text: req.body.text } });
    const author = await prisma.user.findUniqueOrThrow({ where: { id: u.userId }, select: userRefSelect });
    return reply.status(201).send({ id: c.id, text: c.text, author: toUserRef(author), createdAt: c.createdAt.toISOString() });
  });

  // ── Links ──
  app.post('/documents/:id/links', { schema: { params: idParam, body: DocumentLinkInput } }, async (req, reply) => {
    const u = requireUser(req, 'document.read');
    const doc = await getReadableDocument(u, req.params.id);
    if (!canManageDoc(u, doc)) throw forbidden();
    if (req.body.toId === doc.id) throw businessRule('SELF_LINK', 'A document cannot be linked to itself');
    const target = await getReadableDocument(u, req.body.toId);
    const link = await prisma.documentLink.create({ data: { fromId: doc.id, toId: target.id, relation: req.body.relation } });
    return reply.status(201).send({
      id: link.id, relation: link.relation, direction: 'from',
      document: { id: target.id, title: target.title, number: target.number, status: target.status },
    });
  });

  app.delete('/documents/:id/links/:linkId', { schema: { params: z.object({ id, linkId: id }) } }, async (req, reply) => {
    const u = requireUser(req, 'document.read');
    const doc = await getReadableDocument(u, req.params.id);
    if (!canManageDoc(u, doc)) throw forbidden();
    const link = await prisma.documentLink.findFirst({ where: { id: req.params.linkId, OR: [{ fromId: doc.id }, { toId: doc.id }] } });
    if (!link) throw notFound('Link');
    await prisma.documentLink.delete({ where: { id: link.id } });
    return reply.status(204).send();
  });

  // ── Signature verification ──
  app.get('/documents/:id/signatures/verify', { schema: { params: idParam } }, async (req) => {
    const u = requireUser(req, 'document.read');
    const doc = await getReadableDocument(u, req.params.id);
    return verifyDocumentSignatures(doc.id);
  });
}

/** Recomputes the hash of the signed PDF and verifies every stored signature with its public key. */
export async function verifyDocumentSignatures(documentId: string) {
  const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
  const sigs = await prisma.signature.findMany({ where: { documentId }, orderBy: { signedAt: 'asc' } });
  let pdf: Buffer | null = null;
  if (doc.pdfFileId) {
    const f = await prisma.storedFile.findUnique({ where: { id: doc.pdfFileId } });
    pdf = f ? await storage.get(f.key).catch(() => null) : null;
  }
  const scanHashes = new Set(
    (await prisma.fileVersion.findMany({ where: { documentFile: { documentId } }, include: { storedFile: { select: { sha256: true } } } })).map((v) => v.storedFile.sha256),
  );
  const users = new Map((await prisma.user.findMany({ where: { id: { in: sigs.map((s) => s.signerUserId) } }, select: userRefSelect })).map((x) => [x.id, toUserRef(x)]));
  const signatures = sigs.map((s) => ({
    signer: users.get(s.signerUserId)!,
    method: s.method,
    signedAt: s.signedAt.toISOString(),
    valid: s.method === 'PAPER' ? scanHashes.has(s.docHash) : !!pdf && verifyBytes(pdf, s),
  }));
  return { valid: signatures.length > 0 && signatures.every((s) => s.valid), signatures };
}
