import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { QuestionnaireInput, RequestTemplateInput, id } from '@akere/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/db';
import { requireUser } from '../../lib/auth';
import { AppError, conflict, notFound } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { docTypeView, listDocTypes, questionnaireView, templateInclude, templateView, type FormFieldDef } from './service';

const idParam = z.object({ id });

export default async function onboardingRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/personal-doc-types', async (req) => {
    const u = requireUser(req, 'candidate.read');
    return (await listDocTypes(u.tenantId)).map(docTypeView);
  });

  // ── Request templates (F-04) ──
  async function validateTemplate(tenantId: string, body: Partial<z.infer<typeof RequestTemplateInput>>) {
    if (body.questionnaireTemplateId && !(await prisma.questionnaireTemplate.findFirst({ where: { id: body.questionnaireTemplateId, tenantId } }))) {
      throw notFound('Questionnaire');
    }
    if (body.items) {
      const ids = body.items.map((i) => i.personalDocTypeId);
      const types = await prisma.personalDocType.findMany({ where: { id: { in: ids }, OR: [{ tenantId: null }, { tenantId }] } });
      if (types.length !== ids.length) throw notFound('Personal document type');
      const fieldErrors: Record<string, string[]> = {};
      body.items.forEach((item, idx) => {
        const keys = new Set(((types.find((t) => t.id === item.personalDocTypeId)!.fields ?? []) as FormFieldDef[]).map((f) => f.key));
        const bad = item.fieldKeys.filter((k) => !keys.has(k));
        if (bad.length) fieldErrors[`items.${idx}.fieldKeys`] = [`Unknown fields: ${bad.join(', ')}`];
      });
      if (Object.keys(fieldErrors).length) throw new AppError(400, 'VALIDATION_ERROR', 'Validation failed', { fieldErrors, formErrors: [] });
    }
  }
  const itemsCreate = (items: z.infer<typeof RequestTemplateInput>['items']) =>
    items.map((i, idx) => ({ personalDocTypeId: i.personalDocTypeId, required: i.required, fieldKeys: [...new Set(i.fieldKeys)], sortOrder: idx }));

  app.get('/request-templates', async (req) => {
    const u = requireUser(req, 'candidate.read');
    const rows = await prisma.requestTemplate.findMany({ where: { tenantId: u.tenantId }, include: templateInclude, orderBy: { name: 'asc' } });
    return rows.map(templateView);
  });

  app.get('/request-templates/:id', { schema: { params: idParam } }, async (req) => {
    const u = requireUser(req, 'candidate.read');
    const t = await prisma.requestTemplate.findFirst({ where: { id: req.params.id, tenantId: u.tenantId }, include: templateInclude });
    if (!t) throw notFound('Request template');
    return templateView(t);
  });

  app.post('/request-templates', { schema: { body: RequestTemplateInput } }, async (req, reply) => {
    const u = requireUser(req, 'candidate.manage');
    await validateTemplate(u.tenantId, req.body);
    const t = await prisma.requestTemplate.create({
      data: { tenantId: u.tenantId, name: req.body.name, questionnaireTemplateId: req.body.questionnaireTemplateId ?? null, items: { create: itemsCreate(req.body.items) } },
      include: templateInclude,
    });
    await audit(u, 'onboarding.template_create', 'RequestTemplate', t.id, { name: t.name, items: t.items.length }, { ip: req.ip });
    return reply.status(201).send(templateView(t));
  });

  app.patch('/request-templates/:id', { schema: { params: idParam, body: RequestTemplateInput.partial() } }, async (req) => {
    const u = requireUser(req, 'candidate.manage');
    const found = await prisma.requestTemplate.findFirst({ where: { id: req.params.id, tenantId: u.tenantId } });
    if (!found) throw notFound('Request template');
    await validateTemplate(u.tenantId, req.body);
    const { items, ...rest } = req.body;
    const t = await prisma.$transaction(async (tx) => {
      if (items) {
        await tx.requestTemplateItem.deleteMany({ where: { requestTemplateId: found.id } });
        await tx.requestTemplateItem.createMany({ data: itemsCreate(items).map((i) => ({ ...i, requestTemplateId: found.id })) });
      }
      return tx.requestTemplate.update({ where: { id: found.id }, data: { ...rest, updatedAt: new Date() }, include: templateInclude });
    });
    await audit(u, 'onboarding.template_update', 'RequestTemplate', t.id, { name: t.name, items: t.items.length }, { ip: req.ip });
    return templateView(t);
  });

  app.delete('/request-templates/:id', { schema: { params: idParam } }, async (req, reply) => {
    const u = requireUser(req, 'candidate.manage');
    const found = await prisma.requestTemplate.findFirst({ where: { id: req.params.id, tenantId: u.tenantId }, include: { _count: { select: { requests: true } } } });
    if (!found) throw notFound('Request template');
    if (found._count.requests) throw conflict('Template was already used for document requests');
    await prisma.requestTemplate.delete({ where: { id: found.id } });
    await audit(u, 'onboarding.template_delete', 'RequestTemplate', found.id, { name: found.name }, { ip: req.ip });
    return reply.status(204).send();
  });

  // ── Questionnaires (F-05) ──
  app.get('/questionnaires', async (req) => {
    const u = requireUser(req, 'candidate.read');
    return (await prisma.questionnaireTemplate.findMany({ where: { tenantId: u.tenantId }, orderBy: { name: 'asc' } })).map(questionnaireView);
  });

  app.get('/questionnaires/:id', { schema: { params: idParam } }, async (req) => {
    const u = requireUser(req, 'candidate.read');
    const q = await prisma.questionnaireTemplate.findFirst({ where: { id: req.params.id, tenantId: u.tenantId } });
    if (!q) throw notFound('Questionnaire');
    return questionnaireView(q);
  });

  app.post('/questionnaires', { schema: { body: QuestionnaireInput } }, async (req, reply) => {
    const u = requireUser(req, 'candidate.manage');
    const q = await prisma.questionnaireTemplate.create({
      data: { tenantId: u.tenantId, name: req.body.name, fields: req.body.fields as unknown as Prisma.InputJsonValue },
    });
    await audit(u, 'onboarding.questionnaire_create', 'QuestionnaireTemplate', q.id, { name: q.name }, { ip: req.ip });
    return reply.status(201).send(questionnaireView(q));
  });

  app.patch('/questionnaires/:id', { schema: { params: idParam, body: QuestionnaireInput.partial() } }, async (req) => {
    const u = requireUser(req, 'candidate.manage');
    const found = await prisma.questionnaireTemplate.findFirst({ where: { id: req.params.id, tenantId: u.tenantId } });
    if (!found) throw notFound('Questionnaire');
    const q = await prisma.questionnaireTemplate.update({
      where: { id: found.id },
      data: { ...(req.body.name ? { name: req.body.name } : {}), ...(req.body.fields ? { fields: req.body.fields as unknown as Prisma.InputJsonValue } : {}) },
    });
    await audit(u, 'onboarding.questionnaire_update', 'QuestionnaireTemplate', q.id, { name: q.name }, { ip: req.ip });
    return questionnaireView(q);
  });

  app.delete('/questionnaires/:id', { schema: { params: idParam } }, async (req, reply) => {
    const u = requireUser(req, 'candidate.manage');
    const found = await prisma.questionnaireTemplate.findFirst({ where: { id: req.params.id, tenantId: u.tenantId } });
    if (!found) throw notFound('Questionnaire');
    await prisma.questionnaireTemplate.delete({ where: { id: found.id } }); // request templates keep working without it (SetNull)
    await audit(u, 'onboarding.questionnaire_delete', 'QuestionnaireTemplate', found.id, { name: found.name }, { ip: req.ip });
    return reply.status(204).send();
  });
}
