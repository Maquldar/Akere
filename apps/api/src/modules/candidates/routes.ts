import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CandidateCommentInput, CandidateExportInput, CandidateFilter, CandidateInput, CandidateUpdate, DocValuesInput, HireInput, RequestDocumentsInput, ReviewInput, boolQuery, id,
} from '@akere/shared';
import type { CandidateStatus, Prisma } from '@prisma/client';
import { prisma } from '../../lib/db';
import { requireUser } from '../../lib/auth';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { pageArgs, toPage } from '../../lib/pagination';
import { addDays, fromDateStr, toDateStr } from '../../lib/dates';
import { toFileRef, sniff } from '../../lib/files';
import { legalEntityAllowed } from '../../lib/scope';
import { toUserRef, userRefSelect } from '../../lib/names';
import { decodeIin } from '../../adapters/personal-file';
import { visibleFields, type FormFieldDef } from '../onboarding/service';
import {
  candidateInclude, candidateScope, docView, findCandidate, latestRequest, loadDetail, loadRequest, mergeValues, refreshDocStatus, requestInclude, requestView,
  sendToCandidate, toListItem, userRefs, validateCandidate,
} from './service';
import { MAX_IMPORT_BYTES, assertImportArchiveSize, buildImportTemplate, parseImport } from './import';
import { MAX_EXPORT_ROWS, buildRecords, toXlsx, toXml } from './export';
import { hireCandidate } from './hire';
import { readFileWithFields, readSingleFile, saveDocFile } from './uploads';

const idParam = z.object({ id });
const docParam = z.object({ id, docId: id });
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const IN_FLIGHT = ['SENT', 'FILLING', 'UPLOADED', 'RETURNED'] as const;

/** Fill birth date / gender from the ИИН when the HR left them empty. */
function withIinDefaults<T extends { iin?: string | null; noIin?: boolean; birthDate?: string | null; gender?: 'MALE' | 'FEMALE' | null }>(c: T): T {
  if (!c.iin || c.noIin) return c;
  const d = decodeIin(c.iin);
  if (!d) return c;
  return { ...c, birthDate: c.birthDate ?? d.birthDate, gender: c.gender ?? d.gender };
}

function candidateData(c: Partial<CandidateInput>) {
  const data: Prisma.CandidateUncheckedUpdateInput = {};
  const keys = ['legalEntityId', 'lastName', 'firstName', 'middleName', 'iin', 'noIin', 'gender', 'channels', 'email', 'phone', 'comment', 'tags', 'responsibleUserId', 'departmentId', 'positionId'] as const;
  for (const k of keys) if (c[k] !== undefined) (data as Record<string, unknown>)[k] = c[k];
  if (c.birthDate !== undefined) data.birthDate = c.birthDate ? fromDateStr(c.birthDate) : null;
  if (c.plannedHireDate !== undefined) data.plannedHireDate = c.plannedHireDate ? fromDateStr(c.plannedHireDate) : null;
  if (c.noIin) data.iin = null;
  return data;
}

export default async function candidatesRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // ── Registry (F-01) ──
  app.get('/', { schema: { querystring: CandidateFilter } }, async (req) => {
    const u = requireUser(req, 'candidate.read');
    const q = req.query;
    const and: Prisma.CandidateWhereInput[] = [candidateScope(u)];
    if (q.q) {
      const words = q.q.split(/\s+/).filter(Boolean).slice(0, 4);
      for (const w of words) {
        and.push({
          OR: [
            { lastName: { contains: w, mode: 'insensitive' } }, { firstName: { contains: w, mode: 'insensitive' } }, { middleName: { contains: w, mode: 'insensitive' } },
            { iin: { startsWith: w } }, { email: { contains: w, mode: 'insensitive' } }, { phone: { contains: w.replace(/[\s()-]/g, '') } },
          ],
        });
      }
    }
    if (q.status) and.push({ status: { in: q.status } });
    if (q.invitationStatus) and.push({ invitationStatus: { in: q.invitationStatus } });
    if (q.docRequestStatus) and.push({ docRequestStatus: { in: q.docRequestStatus } });
    if (q.checkStatus) and.push({ checkStatus: { in: q.checkStatus } });
    if (q.responsibleUserId) and.push({ responsibleUserId: q.responsibleUserId });
    if (q.legalEntityId) and.push({ legalEntityId: q.legalEntityId });
    if (q.tag) and.push({ tags: { has: q.tag } });
    if (q.updatedFrom) and.push({ updatedAt: { gte: fromDateStr(q.updatedFrom) } });
    if (q.updatedTo) and.push({ updatedAt: { lt: addDays(fromDateStr(q.updatedTo), 1) } });
    const where = { AND: and };
    const orderBy: Prisma.CandidateOrderByWithRelationInput[] =
      q.sort === 'lastName' ? [{ lastName: q.order }, { firstName: q.order }, { id: 'asc' }] : [{ [q.sort]: q.order }, { id: 'asc' }];
    const [rows, total] = await Promise.all([
      prisma.candidate.findMany({ where, include: candidateInclude, orderBy, ...pageArgs(q) }),
      prisma.candidate.count({ where }),
    ]);
    const refs = await userRefs(rows.map((r) => r.responsibleUserId));
    return toPage(rows.map((r) => toListItem(r, refs)), total, q);
  });

  app.post('/', { schema: { body: CandidateInput } }, async (req, reply) => {
    const u = requireUser(req, 'candidate.manage');
    const body = withIinDefaults(req.body);
    const responsibleUserId = body.responsibleUserId === undefined ? (u.roles.includes('HR') || u.roles.includes('ADMIN') ? u.userId : null) : body.responsibleUserId;
    await validateCandidate(u, { ...body, responsibleUserId });
    const c = await prisma.candidate.create({
      data: { ...(candidateData({ ...body, responsibleUserId }) as Prisma.CandidateUncheckedCreateInput), tenantId: u.tenantId, tags: body.tags ?? [] },
    });
    await audit(u, 'candidate.create', 'Candidate', c.id, { legalEntityId: c.legalEntityId }, { ip: req.ip });
    return reply.status(201).send(await loadDetail(c.id));
  });

  // ── Import (F-03) ──
  app.get('/import-template', async (req, reply) => {
    requireUser(req, 'candidate.manage');
    const buf = await buildImportTemplate();
    return reply
      .header('Content-Type', XLSX_MIME)
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('Шаблон_импорта_кандидатов.xlsx')}`)
      .send(buf);
  });

  app.post('/import', { schema: { querystring: z.object({ dryRun: boolQuery.optional() }) } }, async (req) => {
    const u = requireUser(req, 'candidate.manage');
    const { file, fields } = await readFileWithFields(req, { maxFileBytes: MAX_IMPORT_BYTES });
    const legalEntityId = fields.legalEntityId;
    if (!legalEntityId) throw badRequest('legalEntityId is required', { fieldErrors: { legalEntityId: ['Required'] }, formErrors: [] });
    if (!file) throw badRequest('Multipart field "file" is required', { fieldErrors: { file: ['Required'] }, formErrors: [] });
    if ((await sniff(file.buffer, file.filename)) !== 'xlsx') throw new AppError(415, 'UNSUPPORTED_FILE', 'Upload the XLSX import template');
    assertImportArchiveSize(file.buffer);
    if (!(await prisma.legalEntity.findFirst({ where: { id: legalEntityId, tenantId: u.tenantId } }))) throw notFound('Legal entity');
    if (!legalEntityAllowed(u, legalEntityId)) throw new AppError(403, 'FORBIDDEN', 'Legal entity is outside your scope');

    const { rows, errors } = await parseImport(file.buffer, legalEntityId);
    // Rows that duplicate existing candidates in the tenant.
    const iins = rows.map((r) => r.data.iin).filter((x): x is string => !!x);
    if (iins.length) {
      const existing = await prisma.candidate.findMany({ where: { tenantId: u.tenantId, iin: { in: iins }, status: { not: 'BLOCKED' }, employeeId: null }, select: { iin: true } });
      const set = new Set(existing.map((e) => e.iin));
      for (const r of rows) if (r.data.iin && set.has(r.data.iin)) errors.push({ row: r.row, field: 'iin', message: 'Кандидат с таким ИИН уже существует' });
    }
    errors.sort((a, b) => a.row - b.row);
    if (req.query.dryRun || errors.length) return { created: 0, errors };

    const responsibleUserId = u.roles.includes('HR') || u.roles.includes('ADMIN') ? u.userId : null;
    const created = await prisma.$transaction(async (tx) => {
      let n = 0;
      for (const r of rows) {
        const d = withIinDefaults(r.data);
        await tx.candidate.create({ data: { ...(candidateData({ ...d, responsibleUserId }) as Prisma.CandidateUncheckedCreateInput), tenantId: u.tenantId, tags: d.tags ?? [] } });
        n++;
      }
      return n;
    });
    await audit(u, 'candidate.import', 'Candidate', null, { legalEntityId, created }, { ip: req.ip });
    return { created, errors: [] };
  });

  // ── Document requests (F-06) ──
  app.post('/request-documents', { schema: { body: RequestDocumentsInput } }, async (req) => {
    const u = requireUser(req, 'candidate.manage');
    const template = await prisma.requestTemplate.findFirst({
      where: { id: req.body.requestTemplateId, tenantId: u.tenantId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!template) throw notFound('Request template');
    if (!template.items.length) throw conflict('Request template has no documents');
    const ids = [...new Set(req.body.candidateIds)];
    const candidates = await prisma.candidate.findMany({ where: { AND: [candidateScope(u), { id: { in: ids } }] }, include: { legalEntity: { select: { name: true } } } });
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const skipped: { candidateId: string; reason: string }[] = [];
    let sent = 0;
    for (const candidateId of ids) {
      const c = byId.get(candidateId);
      if (!c) skipped.push({ candidateId, reason: 'NOT_FOUND' });
      else if (c.employeeId) skipped.push({ candidateId, reason: 'HIRED' });
      else if (c.status === 'BLOCKED') skipped.push({ candidateId, reason: 'BLOCKED' });
      else if (c.status === 'ACCEPTED' || c.status === 'EXPORTED') skipped.push({ candidateId, reason: 'ALREADY_ACCEPTED' });
      else if ((IN_FLIGHT as readonly string[]).includes(c.docRequestStatus)) skipped.push({ candidateId, reason: 'REQUEST_IN_PROGRESS' });
      else {
        const request = await prisma.$transaction(async (tx) => {
          const r = await tx.documentRequest.create({
            data: {
              tenantId: u.tenantId, candidateId: c.id, requestTemplateId: template.id, sentById: u.userId, status: 'SENT',
              documents: { create: template.items.map((i) => ({ personalDocTypeId: i.personalDocTypeId, required: i.required, fieldKeys: i.fieldKeys ?? [] })) },
            },
          });
          await tx.candidate.update({ where: { id: c.id }, data: { invitationStatus: 'SENT', docRequestStatus: 'SENT', status: 'IN_PROGRESS', checkStatus: 'NONE' } });
          return r;
        });
        await sendToCandidate(c, 'invite', { company: c.legalEntity.name });
        await audit(u, 'candidate.request_documents', 'Candidate', c.id, { requestId: request.id, templateId: template.id, channels: c.channels }, { ip: req.ip });
        sent++;
      }
    }
    return { sent, skipped };
  });

  app.get('/:id', { schema: { params: idParam } }, async (req) => {
    const u = requireUser(req, 'candidate.read');
    const c = await findCandidate(u, req.params.id);
    return loadDetail(c.id);
  });

  app.patch('/:id', { schema: { params: idParam, body: CandidateUpdate } }, async (req) => {
    const u = requireUser(req, 'candidate.manage');
    const c = await findCandidate(u, req.params.id);
    const { status, ...rest } = req.body;
    const merged = withIinDefaults({
      legalEntityId: rest.legalEntityId ?? c.legalEntityId,
      iin: rest.iin !== undefined ? rest.iin : c.iin,
      noIin: rest.noIin ?? c.noIin,
      channels: rest.channels ?? c.channels,
      email: rest.email !== undefined ? rest.email : c.email,
      phone: rest.phone !== undefined ? rest.phone : c.phone,
      responsibleUserId: rest.responsibleUserId !== undefined ? rest.responsibleUserId : c.responsibleUserId,
      departmentId: rest.departmentId !== undefined ? rest.departmentId : c.departmentId,
      positionId: rest.positionId !== undefined ? rest.positionId : c.positionId,
      birthDate: rest.birthDate !== undefined ? rest.birthDate : c.birthDate ? toDateStr(c.birthDate) : null,
      gender: rest.gender !== undefined ? rest.gender : c.gender,
    });
    if (rest.legalEntityId && rest.legalEntityId !== c.legalEntityId && c.employeeId) throw conflict('Hired candidate cannot change legal entity');
    await validateCandidate(u, merged, c.id);
    const data = candidateData(rest);
    if (merged.birthDate && !c.birthDate && rest.birthDate === undefined) data.birthDate = fromDateStr(merged.birthDate);
    if (merged.gender && !c.gender && rest.gender === undefined) data.gender = merged.gender;
    if (status && status !== c.status) data.status = assertStatusChange(c, status);
    const updated = await prisma.candidate.update({ where: { id: c.id }, data });
    if (data.status === 'BLOCKED') await prisma.session.deleteMany({ where: { candidateId: c.id } });
    await audit(u, 'candidate.update', 'Candidate', c.id, { fields: Object.keys(req.body), status: updated.status }, { ip: req.ip });
    return loadDetail(c.id);
  });

  function assertStatusChange(c: { status: CandidateStatus; employeeId: string | null; docRequestStatus: string }, to: CandidateStatus): CandidateStatus {
    if (c.employeeId) throw conflict('Hired candidate status cannot be changed');
    if (to === 'ACCEPTED' && c.docRequestStatus !== 'COMPLETED') throw conflict('Accept the document package via review first');
    if (to === 'EXPORTED' && c.status !== 'ACCEPTED') throw conflict('Only accepted candidates can be marked as exported');
    if (to === 'NEW' && c.docRequestStatus !== 'NONE') throw conflict('Candidate already received a document request');
    return to;
  }

  app.delete('/:id', { schema: { params: idParam } }, async (req, reply) => {
    const u = requireUser(req, 'candidate.manage');
    const c = await findCandidate(u, req.params.id);
    const requests = await prisma.documentRequest.count({ where: { candidateId: c.id } });
    if (c.status !== 'NEW' || requests > 0) throw conflict('Only new candidates without document requests can be deleted');
    await prisma.candidate.delete({ where: { id: c.id } });
    await audit(u, 'candidate.delete', 'Candidate', c.id, { name: `${c.lastName} ${c.firstName}` }, { ip: req.ip });
    return reply.status(204).send();
  });

  app.post('/:id/resend-invite', { schema: { params: idParam } }, async (req, reply) => {
    const u = requireUser(req, 'candidate.manage');
    const c = await findCandidate(u, req.params.id);
    const r = await prisma.documentRequest.findFirst({ where: { candidateId: c.id }, orderBy: { createdAt: 'desc' } });
    if (!r || !['SENT', 'FILLING', 'RETURNED'].includes(r.status) || c.status === 'BLOCKED' || c.employeeId) {
      throw conflict('There is no open document request to resend');
    }
    const le = await prisma.legalEntity.findUniqueOrThrow({ where: { id: c.legalEntityId } });
    await sendToCandidate(c, 'invite', { company: le.name });
    if (c.invitationStatus === 'NONE') await prisma.candidate.update({ where: { id: c.id }, data: { invitationStatus: 'SENT' } });
    await audit(u, 'candidate.resend_invite', 'Candidate', c.id, { requestId: r.id }, { ip: req.ip });
    return reply.status(204).send();
  });

  // ── Comments (F-11) ──
  const commentOut = (cm: { id: string; text: string; byCandidate: boolean; createdAt: Date; authorUserId: string | null }, refs: Map<string, ReturnType<typeof toUserRef>>) => ({
    id: cm.id, text: cm.text, author: cm.authorUserId ? (refs.get(cm.authorUserId) ?? null) : null, byCandidate: cm.byCandidate, createdAt: cm.createdAt.toISOString(),
  });

  app.get('/:id/comments', { schema: { params: idParam } }, async (req) => {
    const u = requireUser(req, 'candidate.read');
    const c = await findCandidate(u, req.params.id);
    const rows = await prisma.candidateComment.findMany({ where: { candidateId: c.id }, orderBy: { createdAt: 'asc' } });
    const refs = await userRefs(rows.map((r) => r.authorUserId));
    return rows.map((r) => commentOut(r, refs));
  });

  app.post('/:id/comments', { schema: { params: idParam, body: CandidateCommentInput } }, async (req, reply) => {
    const u = requireUser(req, 'candidate.manage');
    const c = await findCandidate(u, req.params.id);
    const cm = await prisma.candidateComment.create({ data: { candidateId: c.id, authorUserId: u.userId, text: req.body.text } });
    await audit(u, 'candidate.comment', 'Candidate', c.id, { commentId: cm.id }, { ip: req.ip });
    const me = await prisma.user.findUniqueOrThrow({ where: { id: u.userId }, select: userRefSelect });
    return reply.status(201).send(commentOut(cm, new Map([[u.userId, toUserRef(me)]])));
  });

  // ── HR review (F-09) ──
  app.get('/:id/request', { schema: { params: idParam } }, async (req) => {
    const u = requireUser(req, 'candidate.read');
    const c = await findCandidate(u, req.params.id);
    const r = await latestRequest(c.id);
    if (!r) throw notFound('Document request');
    return requestView(r);
  });

  async function hrDoc(candidateId: string, docId: string) {
    const r = await latestRequest(candidateId);
    const doc = r?.documents.find((d) => d.id === docId);
    if (!r || !doc) throw notFound('Document');
    return { r, doc };
  }

  app.patch('/:id/request/documents/:docId', { schema: { params: docParam, body: DocValuesInput } }, async (req) => {
    const u = requireUser(req, 'candidate.manage');
    const c = await findCandidate(u, req.params.id);
    if (c.employeeId) throw conflict('Candidate has already been hired');
    const { doc } = await hrDoc(c.id, req.params.docId);
    const fields = visibleFields((doc.docType.fields ?? []) as FormFieldDef[], (doc.fieldKeys ?? []) as string[]);
    const { values, changed } = mergeValues(fields, (doc.values ?? {}) as Record<string, unknown>, req.body.values);
    await prisma.candidateDocument.update({
      where: { id: doc.id },
      data: { values: values as Prisma.InputJsonValue, autoFilledKeys: doc.autoFilledKeys.filter((k) => !changed.includes(k)) },
    });
    await refreshDocStatus(doc.id);
    await prisma.candidate.update({ where: { id: c.id }, data: { updatedAt: new Date() } });
    await audit(u, 'candidate.document_update', 'CandidateDocument', doc.id, { candidateId: c.id, changed }, { ip: req.ip });
    const r = await loadRequest(doc.documentRequestId);
    return docView(r.documents.find((d) => d.id === doc.id)!);
  });

  app.post('/:id/request/documents/:docId/files', { schema: { params: docParam } }, async (req, reply) => {
    const u = requireUser(req, 'candidate.manage');
    const c = await findCandidate(u, req.params.id);
    if (c.employeeId) throw conflict('Candidate has already been hired');
    const { r, doc } = await hrDoc(c.id, req.params.docId);
    const { buffer, filename } = await readSingleFile(req);
    const f = await saveDocFile({ tenantId: u.tenantId, requestId: r.id, docId: doc.id, buffer, filename, uploadedById: u.userId });
    await refreshDocStatus(doc.id);
    await audit(u, 'candidate.document_file_upload', 'CandidateDocument', doc.id, { candidateId: c.id, fileId: f.id, filename: f.filename }, { ip: req.ip });
    return reply.status(201).send(toFileRef(f));
  });

  app.post('/:id/request/review', { schema: { params: idParam, body: ReviewInput } }, async (req) => {
    const u = requireUser(req, 'candidate.manage');
    const c = await findCandidate(u, req.params.id);
    if (c.employeeId) throw conflict('Candidate has already been hired');
    const r = await prisma.documentRequest.findFirst({ where: { candidateId: c.id }, orderBy: { createdAt: 'desc' }, include: requestInclude });
    if (!r) throw notFound('Document request');
    const { decision, comment, checkStatus } = req.body;
    if (decision !== 'REJECT' && r.status !== 'UPLOADED') throw conflict('The candidate has not submitted the documents for review', { status: r.status });
    if (decision === 'REJECT' && c.status === 'BLOCKED') throw conflict('Candidate is already blocked');
    const le = await prisma.legalEntity.findUniqueOrThrow({ where: { id: c.legalEntityId } });
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      if (decision === 'ACCEPT') {
        await tx.candidateDocument.updateMany({ where: { documentRequestId: r.id }, data: { status: 'ACCEPTED', returnComment: null } });
        await tx.documentRequest.update({ where: { id: r.id }, data: { status: 'COMPLETED', reviewedAt: now, reviewComment: comment ?? null } });
        await tx.candidate.update({ where: { id: c.id }, data: { status: 'ACCEPTED', docRequestStatus: 'COMPLETED', checkStatus: checkStatus ?? 'RECOMMENDED' } });
      } else if (decision === 'RETURN') {
        const ids = req.body.returnDocIds!;
        const docIds = new Set(r.documents.map((d) => d.id));
        const unknown = ids.filter((x) => !docIds.has(x));
        if (unknown.length) throw badRequest('Unknown documents', { fieldErrors: { returnDocIds: [`Not in this request: ${unknown.join(', ')}`] }, formErrors: [] });
        await tx.candidateDocument.updateMany({ where: { id: { in: ids } }, data: { status: 'RETURNED', returnComment: comment ?? null } });
        await tx.documentRequest.update({ where: { id: r.id }, data: { status: 'RETURNED', reviewedAt: now, reviewComment: comment ?? null } });
        await tx.candidate.update({ where: { id: c.id }, data: { docRequestStatus: 'RETURNED', ...(checkStatus ? { checkStatus } : {}) } });
      } else {
        await tx.documentRequest.update({ where: { id: r.id }, data: { reviewedAt: now, reviewComment: comment ?? null } });
        await tx.candidate.update({ where: { id: c.id }, data: { status: 'BLOCKED', checkStatus: checkStatus ?? 'NOT_RECOMMENDED' } });
        await tx.session.deleteMany({ where: { candidateId: c.id } });
      }
    });
    const key = decision === 'ACCEPT' ? 'accepted' : decision === 'RETURN' ? 'returned' : 'rejected';
    await sendToCandidate(c, key, { company: le.name, comment });
    await audit(u, `candidate.review_${decision.toLowerCase()}`, 'Candidate', c.id, { requestId: r.id, comment: comment ?? null, checkStatus: checkStatus ?? null, returnDocIds: req.body.returnDocIds ?? [] }, { ip: req.ip });
    return loadDetail(c.id);
  });

  // ── Hire (F-12) ──
  app.post('/:id/hire', { schema: { params: idParam, body: HireInput } }, async (req, reply) => {
    const u = requireUser(req, 'candidate.manage', 'employee.manage');
    const result = await hireCandidate(u, req.params.id, req.body, req.ip);
    return reply.status(201).send(result);
  });

  // ── Export to 1С (F-13) ──
  app.post('/export', { schema: { body: CandidateExportInput } }, async (req, reply) => {
    const u = requireUser(req, 'candidate.read');
    const { candidateIds, format, markExported } = req.body;
    if (markExported) requireUser(req, 'candidate.manage');
    const where: Prisma.CandidateWhereInput = { AND: [candidateScope(u), candidateIds ? { id: { in: candidateIds } } : { status: 'ACCEPTED' }] };
    // At most MAX_EXPORT_ROWS per export (records are built in memory); X-Export-Truncated tells the client to export again.
    const found = (await prisma.candidate.findMany({ where, select: { id: true }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }], take: MAX_EXPORT_ROWS + 1 })).map((x) => x.id);
    const truncated = found.length > MAX_EXPORT_ROWS;
    const ids = found.slice(0, MAX_EXPORT_ROWS);
    if (truncated) reply.header('X-Export-Truncated', 'true');
    const records = await buildRecords(ids);
    let marked = 0;
    if (markExported && ids.length) {
      marked = (await prisma.candidate.updateMany({ where: { id: { in: ids }, status: { in: ['ACCEPTED', 'EXPORTED'] } }, data: { status: 'EXPORTED', exportedAt: new Date() } })).count;
    }
    await audit(u, 'candidate.export', 'Candidate', null, { format, count: records.length, marked, candidateIds: ids }, { ip: req.ip });
    const stamp = new Date().toISOString().slice(0, 10);
    const name = `candidates-${stamp}.${format}`;
    reply.header('Content-Disposition', `attachment; filename="${name}"`);
    if (format === 'json') {
      return reply.header('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify({ exportedAt: new Date().toISOString(), count: records.length, candidates: records }, null, 2));
    }
    if (format === 'xml') return reply.header('Content-Type', 'application/xml; charset=utf-8').send(toXml(records));
    return reply.header('Content-Type', XLSX_MIME).send(await toXlsx(records));
  });
}

