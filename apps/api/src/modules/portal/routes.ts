import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AutofillReplyInput, DocValuesInput, PortalRequestCodeInput, PortalVerifyInput, QuestionnaireAnswersInput, id } from '@akere/shared';
import type { ContactChannel, Prisma } from '@prisma/client';
import { prisma } from '../../lib/db';
import { createSession, destroySession, requireCandidate, type CandidateCtx } from '../../lib/auth';
import { badRequest, businessRule, conflict, notFound } from '../../lib/errors';
import { issueOtp, verifyOtp } from '../../lib/otp';
import { fullName, maskTarget } from '../../lib/names';
import { audit } from '../../lib/audit';
import { notify } from '../../lib/notify';
import { toFileRef } from '../../lib/files';
import { tx as tr } from '../../lib/i18n';
import { storage } from '../../adapters/storage';
import { messaging } from '../../adapters/messaging';
import { personalFile } from '../../adapters/personal-file';
import { visibleFields, type FormFieldDef } from '../onboarding/service';
import { docCompleteness, docView, latestRequest, loadRequest, mergeValues, refreshDocStatus, requestView, setRequestStatus, type RequestRow } from '../candidates/service';
import { applyAutofill } from '../candidates/autofill';
import { readSingleFile, saveDocFile } from '../candidates/uploads';

const EDITABLE = ['SENT', 'FILLING', 'RETURNED'];

/** Per IP + login: stops code flooding and guessing; issueOtp adds a per-target limit on top. */
const loginLimit = (max: number) => ({
  rateLimit: {
    max,
    timeWindow: '15 minutes',
    hook: 'preHandler' as const,
    keyGenerator: (req: FastifyRequest) => `portal:${req.ip}:${String((req.body as { login?: string } | undefined)?.login ?? '').toLowerCase()}`,
  },
});

function normalizeLogin(login: string): { email: string } | { phone: string } {
  const l = login.trim().toLowerCase();
  if (l.includes('@')) return { email: l };
  return { phone: l.replace(/[\s()-]/g, '').replace(/^8(\d{10})$/, '+7$1').replace(/^7(\d{10})$/, '+7$1') };
}

/** Candidates can sign in while they have a document request and are neither blocked nor hired. */
function findPortalCandidate(login: string) {
  const n = normalizeLogin(login);
  return prisma.candidate.findFirst({
    where: { ...('email' in n ? { email: n.email } : { phone: n.phone }), status: { not: 'BLOCKED' }, employeeId: null, requests: { some: {} } },
    orderBy: { updatedAt: 'desc' },
  });
}

const pickLocale = (req: FastifyRequest) => {
  const h = String(req.headers['accept-language'] ?? '').slice(0, 2).toLowerCase();
  return (['ru', 'kk', 'en'].includes(h) ? h : 'ru') as 'ru' | 'kk' | 'en';
};

async function portalMe(candidateId: string, locale: 'ru' | 'kk' | 'en') {
  const c = await prisma.candidate.findUniqueOrThrow({ where: { id: candidateId }, include: { legalEntity: { select: { name: true, nameKk: true } } } });
  return { candidateId: c.id, fullName: fullName(c), legalEntity: locale === 'kk' && c.legalEntity.nameKk ? c.legalEntity.nameKk : c.legalEntity.name, locale };
}

async function myRequest(ctx: CandidateCtx): Promise<RequestRow> {
  const r = await latestRequest(ctx.candidateId);
  if (!r) throw notFound('Document request');
  return r;
}

function assertEditable(r: { status: string }, doc?: { status: string }) {
  if (!EDITABLE.includes(r.status)) throw conflict('Документы уже отправлены на проверку', { status: r.status });
  if (doc?.status === 'ACCEPTED') throw conflict('Документ уже принят');
  if (doc && r.status === 'RETURNED' && doc.status !== 'RETURNED') throw conflict('Этот документ не требует доработки');
}

/** First portal edit moves the request from SENT to FILLING (API.md §5 state rules). */
async function markFilling(r: { id: string; status: string; candidateId: string }) {
  if (r.status === 'SENT') await setRequestStatus(r.id, r.candidateId, 'FILLING');
  else await prisma.candidate.update({ where: { id: r.candidateId }, data: { updatedAt: new Date() } });
}

export default async function portalRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // ── Auth (OTP only, AS-10) ──
  app.post('/auth/request-code', { schema: { body: PortalRequestCodeInput }, config: loginLimit(10) }, async (req) => {
    const n = normalizeLogin(req.body.login);
    const target = 'email' in n ? n.email : n.phone;
    const c = await findPortalCandidate(req.body.login);
    let channel: ContactChannel = 'email' in n ? 'EMAIL' : 'SMS';
    if (c && 'phone' in n) channel = c.channels.find((ch) => ch !== 'EMAIL') ?? 'SMS';
    if (c) {
      await issueOtp({ purpose: 'CANDIDATE_LOGIN', target, channel, tenantId: c.tenantId, candidateId: c.id, lang: pickLocale(req) });
      await audit({ tenantId: c.tenantId }, 'portal.code_requested', 'Candidate', c.id, { channel }, { ip: req.ip });
    }
    return { channel, maskedTarget: maskTarget(target) }; // same answer whether or not the login exists
  });

  app.post('/auth/verify', { schema: { body: PortalVerifyInput }, config: loginLimit(10) }, async (req, reply) => {
    const n = normalizeLogin(req.body.login);
    const target = 'email' in n ? n.email : n.phone;
    const c = await findPortalCandidate(req.body.login);
    const ok = c && (await verifyOtp({ purpose: 'CANDIDATE_LOGIN', target, code: req.body.code, candidateId: c.id }));
    if (!ok || !c) throw badRequest('Неверный или просроченный код', { fieldErrors: { code: ['Invalid code'] }, formErrors: [] });
    await createSession(reply, req, { candidateId: c.id });
    if (c.invitationStatus !== 'ACCEPTED') await prisma.candidate.update({ where: { id: c.id }, data: { invitationStatus: 'ACCEPTED' } });
    await audit({ tenantId: c.tenantId }, 'portal.login', 'Candidate', c.id, {}, { ip: req.ip });
    return portalMe(c.id, pickLocale(req));
  });

  app.post('/auth/logout', async (req, reply) => {
    await destroySession(req, reply);
    return reply.status(204).send();
  });

  app.get('/me', async (req) => {
    const ctx = requireCandidate(req);
    return portalMe(ctx.candidateId, pickLocale(req));
  });

  // ── Request ──
  app.get('/request', async (req) => {
    const ctx = requireCandidate(req);
    return requestView(await myRequest(ctx), true);
  });

  app.patch('/request/documents/:docId', { schema: { params: z.object({ docId: id }), body: DocValuesInput } }, async (req) => {
    const ctx = requireCandidate(req);
    const r = await myRequest(ctx);
    const doc = r.documents.find((d) => d.id === req.params.docId);
    if (!doc) throw notFound('Document');
    assertEditable(r, doc);
    const fields = visibleFields((doc.docType.fields ?? []) as FormFieldDef[], (doc.fieldKeys ?? []) as string[]);
    const { values, changed } = mergeValues(fields, (doc.values ?? {}) as Record<string, unknown>, req.body.values);
    await prisma.candidateDocument.update({
      where: { id: doc.id },
      data: { values: values as Prisma.InputJsonValue, autoFilledKeys: doc.autoFilledKeys.filter((k) => !changed.includes(k)) },
    });
    await refreshDocStatus(doc.id);
    await markFilling(r);
    await audit(ctx, 'portal.document_update', 'CandidateDocument', doc.id, { changed }, { ip: req.ip });
    const fresh = await loadRequest(r.id);
    return docView(fresh.documents.find((d) => d.id === doc.id)!, true);
  });

  app.post('/request/documents/:docId/files', { schema: { params: z.object({ docId: id }) } }, async (req, reply) => {
    const ctx = requireCandidate(req);
    const r = await myRequest(ctx);
    const doc = r.documents.find((d) => d.id === req.params.docId);
    if (!doc) throw notFound('Document');
    assertEditable(r, doc);
    const { buffer, filename } = await readSingleFile(req);
    const f = await saveDocFile({ tenantId: ctx.tenantId, requestId: r.id, docId: doc.id, buffer, filename, uploadedById: null });
    await refreshDocStatus(doc.id);
    await markFilling(r);
    await audit(ctx, 'portal.file_upload', 'CandidateDocument', doc.id, { fileId: f.id, filename: f.filename, size: f.size }, { ip: req.ip });
    return reply.status(201).send(toFileRef(f, true));
  });

  app.delete('/request/documents/:docId/files/:fileId', { schema: { params: z.object({ docId: id, fileId: id }) } }, async (req, reply) => {
    const ctx = requireCandidate(req);
    const r = await myRequest(ctx);
    const doc = r.documents.find((d) => d.id === req.params.docId);
    const file = doc?.files.find((f) => f.id === req.params.fileId);
    if (!doc || !file) throw notFound('File');
    assertEditable(r, doc);
    await prisma.storedFile.delete({ where: { id: file.id } });
    await storage.delete(file.key).catch(() => undefined);
    await refreshDocStatus(doc.id);
    await audit(ctx, 'portal.file_delete', 'CandidateDocument', doc.id, { fileId: file.id, filename: file.filename }, { ip: req.ip });
    return reply.status(204).send();
  });

  app.patch('/request/questionnaire', { schema: { body: QuestionnaireAnswersInput } }, async (req) => {
    const ctx = requireCandidate(req);
    const r = await myRequest(ctx);
    assertEditable(r);
    const q = r.template.questionnaire;
    if (!q) throw conflict('Анкета не прикреплена к запросу');
    const { values } = mergeValues((q.fields ?? []) as FormFieldDef[], (r.questionnaireAnswers ?? {}) as Record<string, unknown>, req.body.answers, 'answers');
    await prisma.documentRequest.update({ where: { id: r.id }, data: { questionnaireAnswers: values as Prisma.InputJsonValue } });
    await markFilling(r);
    await audit(ctx, 'portal.questionnaire_update', 'DocumentRequest', r.id, { keys: Object.keys(req.body.answers) }, { ip: req.ip });
    return requestView(await loadRequest(r.id), true);
  });

  // ── Digital personal file autofill (F-08) ──
  app.post('/request/autofill/consent', async (req) => {
    const ctx = requireCandidate(req);
    const r = await myRequest(ctx);
    assertEditable(r);
    const c = await prisma.candidate.findUniqueOrThrow({ where: { id: ctx.candidateId } });
    if (!c.iin || c.noIin) throw businessRule('NO_IIN', 'Автозаполнение доступно только при наличии ИИН');
    if (!r.documents.some((d) => d.docType.autoFillable && d.status !== 'ACCEPTED')) throw businessRule('NOTHING_TO_AUTOFILL', 'В запросе нет документов для автозаполнения');
    const { smsPreview } = await personalFile.requestConsent(c.iin);
    await prisma.documentRequest.update({ where: { id: r.id }, data: { consentStatus: 'REQUESTED' } });
    if (c.phone) await messaging('SMS').send({ tenantId: c.tenantId, to: c.phone, text: smsPreview }).catch(() => undefined);
    await audit(ctx, 'portal.autofill_consent_requested', 'DocumentRequest', r.id, {}, { ip: req.ip });
    return { status: 'REQUESTED' as const, smsPreview };
  });

  app.post('/request/autofill/reply', { schema: { body: AutofillReplyInput } }, async (req) => {
    const ctx = requireCandidate(req);
    const r = await myRequest(ctx);
    assertEditable(r);
    if (r.consentStatus !== 'REQUESTED') throw conflict('Сначала запросите согласие на получение данных');
    if (req.body.reply === '512') {
      await prisma.documentRequest.update({ where: { id: r.id }, data: { consentStatus: 'DENIED', consentAt: new Date() } });
      await audit(ctx, 'portal.autofill_denied', 'DocumentRequest', r.id, {}, { ip: req.ip });
    } else {
      const filled = await applyAutofill(r.id, { onlyReturned: r.status === 'RETURNED' });
      await prisma.documentRequest.update({ where: { id: r.id }, data: { consentStatus: 'GRANTED', consentAt: new Date() } });
      await markFilling(r);
      await audit(ctx, 'portal.autofill_granted', 'DocumentRequest', r.id, { filledDocumentIds: filled }, { ip: req.ip });
    }
    return requestView(await loadRequest(r.id), true);
  });

  // ── Confirm readiness ──
  app.post('/request/submit', async (req) => {
    const ctx = requireCandidate(req);
    const r = await myRequest(ctx);
    assertEditable(r);
    const missing: { type: 'document' | 'questionnaire'; id: string; code: string; name: string; fields: string[] }[] = [];
    for (const d of r.documents) {
      if (!d.required || d.status === 'ACCEPTED') continue;
      const comp = docCompleteness(d);
      if (!comp.complete) missing.push({ type: 'document', id: d.id, code: d.docType.code, name: d.docType.name, fields: comp.missing });
    }
    const q = r.template.questionnaire;
    const answers = (r.questionnaireAnswers ?? {}) as Record<string, unknown>;
    for (const f of (q?.fields ?? []) as FormFieldDef[]) {
      const v = answers[f.key];
      if (f.required && (v === undefined || v === null || v === '' || (f.type === 'checkbox' && v !== true))) {
        missing.push({ type: 'questionnaire', id: q!.id, code: f.key, name: f.label, fields: [f.key] });
      }
    }
    if (missing.length) throw businessRule('REQUIRED_MISSING', 'Заполните обязательные документы и поля', { missing });

    const c = await prisma.candidate.findUniqueOrThrow({ where: { id: ctx.candidateId } });
    await prisma.$transaction(async (tx) => {
      for (const d of r.documents) {
        if (d.status === 'ACCEPTED') continue;
        const status = docCompleteness(d).complete ? 'FILLED' : 'PENDING';
        if (status !== d.status) await tx.candidateDocument.update({ where: { id: d.id }, data: { status } });
      }
      await tx.documentRequest.update({ where: { id: r.id }, data: { status: 'UPLOADED', readyAt: new Date() } });
      await tx.candidate.update({ where: { id: c.id }, data: { docRequestStatus: 'UPLOADED', checkStatus: 'ON_REVIEW' } });
    });
    const hrUserId = c.responsibleUserId ?? r.sentById;
    const hr = await prisma.user.findFirst({ where: { id: hrUserId, tenantId: c.tenantId, isActive: true }, select: { id: true, locale: true } });
    if (hr) {
      await notify({
        tenantId: c.tenantId, userId: hr.id, type: 'candidate.submitted',
        title: tr('candidate.submitted.title', hr.locale, { name: fullName(c) }), body: tr('candidate.submitted.body', hr.locale),
        link: `/${hr.locale}/candidates/${c.id}`,
      });
    }
    await audit(ctx, 'portal.submit', 'DocumentRequest', r.id, { resubmit: r.status === 'RETURNED' }, { ip: req.ip });
    return requestView(await loadRequest(r.id), true);
  });

  // ── Files (candidate may only read files of their own request) ──
  app.get('/files/:id', { schema: { params: z.object({ id }), querystring: z.object({ download: z.string().optional() }) } }, async (req, reply) => {
    const ctx = requireCandidate(req);
    const file = await prisma.storedFile.findFirst({
      where: { id: req.params.id, tenantId: ctx.tenantId, candidateDocument: { request: { candidateId: ctx.candidateId } } },
    });
    if (!file) throw notFound('File');
    const body = await storage.get(file.key);
    const inline = !req.query.download && /^(application\/pdf|image\/(jpeg|png))$/.test(file.mime);
    return reply
      .header('Content-Type', file.mime)
      .header('Content-Length', String(body.length))
      .header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.filename)}`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, max-age=300')
      .send(body);
  });
}
