import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import {
  DocumentTemplateInput, DocumentTypeFilter, DocumentTypeInput, DocumentTypeUpdate, RouteTemplateInput, TemplatePreviewInput, id,
  type RouteStepDef, type TemplateBlock,
} from '@akere/shared';
import { prisma } from '../../lib/db';
import { requireUser } from '../../lib/auth';
import { conflict, notFound } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { legalEntityAllowed } from '../../lib/scope';
import { TEMPLATE_VARIABLES, buildTemplateContext, renderTemplatePdf } from '../../lib/templates';

const idParam = z.object({ id });

const typeInclude = { template: { select: { id: true, name: true } }, routeTemplate: { select: { id: true, name: true } } } as const;
type TypeRow = Prisma.DocumentTypeGetPayload<{ include: typeof typeInclude }>;
const typeOut = (t: TypeRow) => ({
  id: t.id, code: t.code, name: t.name, nameKk: t.nameKk, kind: t.kind, numberPattern: t.numberPattern, templateId: t.templateId,
  routeTemplateId: t.routeTemplateId, esutdRequired: t.esutdRequired, isActive: t.isActive, template: t.template, routeTemplate: t.routeTemplate,
});

const templateOut = (t: { id: string; name: string; body: Prisma.JsonValue; updatedAt: Date }) => ({
  id: t.id, name: t.name, body: t.body as TemplateBlock[], updatedAt: t.updatedAt.toISOString(),
});

/** Configuration endpoints (document.manage): document types, templates, route templates. */
export default async function configRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  async function assertRefs(tenantId: string, templateId?: string | null, routeTemplateId?: string | null) {
    if (templateId && !(await prisma.documentTemplate.findFirst({ where: { id: templateId, tenantId } }))) throw notFound('Template');
    if (routeTemplateId && !(await prisma.routeTemplate.findFirst({ where: { id: routeTemplateId, tenantId } }))) throw notFound('Route template');
  }

  // ── Document types ── (read: anyone who works with documents, write: document.manage)
  app.get('/document-types', { schema: { querystring: DocumentTypeFilter } }, async (req) => {
    const u = requireUser(req, 'document.read');
    const rows = await prisma.documentType.findMany({
      where: { tenantId: u.tenantId, ...(req.query.kind ? { kind: req.query.kind } : {}), ...(req.query.active !== undefined ? { isActive: req.query.active } : {}) },
      include: typeInclude,
      orderBy: { name: 'asc' },
    });
    return rows.map(typeOut);
  });

  app.post('/document-types', { schema: { body: DocumentTypeInput } }, async (req, reply) => {
    const u = requireUser(req, 'document.manage');
    await assertRefs(u.tenantId, req.body.templateId, req.body.routeTemplateId);
    const t = await prisma.documentType.create({ data: { ...req.body, tenantId: u.tenantId }, include: typeInclude });
    await audit(u, 'document_type.create', 'DocumentType', t.id, { code: t.code }, { ip: req.ip });
    return reply.status(201).send(typeOut(t));
  });

  app.patch('/document-types/:id', { schema: { params: idParam, body: DocumentTypeUpdate } }, async (req) => {
    const u = requireUser(req, 'document.manage');
    const found = await prisma.documentType.findFirst({ where: { id: req.params.id, tenantId: u.tenantId } });
    if (!found) throw notFound('Document type');
    await assertRefs(u.tenantId, req.body.templateId, req.body.routeTemplateId);
    const t = await prisma.documentType.update({ where: { id: found.id }, data: req.body, include: typeInclude });
    await audit(u, 'document_type.update', 'DocumentType', t.id, req.body, { ip: req.ip });
    return typeOut(t);
  });

  // ── Templates ──
  app.get('/document-templates/variables', async (req) => {
    requireUser(req, 'document.read');
    return TEMPLATE_VARIABLES;
  });

  app.get('/document-templates', async (req) => {
    const u = requireUser(req, 'document.manage');
    return (await prisma.documentTemplate.findMany({ where: { tenantId: u.tenantId }, orderBy: { name: 'asc' } })).map(templateOut);
  });

  app.post('/document-templates', { schema: { body: DocumentTemplateInput } }, async (req, reply) => {
    const u = requireUser(req, 'document.manage');
    const t = await prisma.documentTemplate.create({ data: { tenantId: u.tenantId, name: req.body.name, body: req.body.body } });
    await audit(u, 'document_template.create', 'DocumentTemplate', t.id, { name: t.name }, { ip: req.ip });
    return reply.status(201).send(templateOut(t));
  });

  app.get('/document-templates/:id', { schema: { params: idParam } }, async (req) => {
    const u = requireUser(req, 'document.manage');
    const t = await prisma.documentTemplate.findFirst({ where: { id: req.params.id, tenantId: u.tenantId } });
    if (!t) throw notFound('Template');
    return templateOut(t);
  });

  app.patch('/document-templates/:id', { schema: { params: idParam, body: DocumentTemplateInput.partial() } }, async (req) => {
    const u = requireUser(req, 'document.manage');
    const found = await prisma.documentTemplate.findFirst({ where: { id: req.params.id, tenantId: u.tenantId } });
    if (!found) throw notFound('Template');
    const t = await prisma.documentTemplate.update({ where: { id: found.id }, data: req.body });
    await audit(u, 'document_template.update', 'DocumentTemplate', t.id, { name: t.name }, { ip: req.ip });
    return templateOut(t);
  });

  app.post('/document-templates/:id/preview', { schema: { params: idParam, body: TemplatePreviewInput } }, async (req, reply) => {
    const u = requireUser(req, 'document.manage');
    const t = await prisma.documentTemplate.findFirst({ where: { id: req.params.id, tenantId: u.tenantId } });
    if (!t) throw notFound('Template');
    const le = await prisma.legalEntity.findFirst({ where: { id: req.body.legalEntityId, tenantId: u.tenantId } });
    if (!le || !legalEntityAllowed(u, le.id)) throw notFound('Legal entity');
    if (req.body.subjectEmployeeId && !(await prisma.employee.findFirst({ where: { id: req.body.subjectEmployeeId, tenantId: u.tenantId } }))) throw notFound('Employee');
    const ctx = await buildTemplateContext({
      legalEntityId: le.id, subjectEmployeeId: req.body.subjectEmployeeId, authorUserId: u.userId,
      document: { title: t.name, createdAt: new Date() }, data: req.body.data,
    });
    const pdf = await renderTemplatePdf(t.body as TemplateBlock[], ctx, t.name);
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(`${t.name}.pdf`)}`).send(pdf);
  });

  // ── Route templates ──
  const routeOut = (r: { id: string; name: string; steps: Prisma.JsonValue; updatedAt: Date; _count: { documentTypes: number } }) => ({
    id: r.id, name: r.name, steps: r.steps as RouteStepDef[], usedBy: r._count.documentTypes, updatedAt: r.updatedAt.toISOString(),
  });
  const routeCount = { _count: { select: { documentTypes: true } } } as const;

  async function assertStepUsers(tenantId: string, steps: RouteStepDef[]) {
    const ids = [...new Set(steps.map((s) => s.userId).filter((x): x is string => !!x))];
    if (ids.length && (await prisma.user.count({ where: { tenantId, id: { in: ids } } })) !== ids.length) throw notFound('User');
  }
  const normalize = (steps: RouteStepDef[]) => steps.map((s) => ({ ...s, ...(s.rule === 'USER' ? {} : { userId: undefined }) })).sort((a, b) => a.order - b.order);

  app.get('/route-templates', async (req) => {
    const u = requireUser(req, 'document.manage');
    return (await prisma.routeTemplate.findMany({ where: { tenantId: u.tenantId }, include: routeCount, orderBy: { name: 'asc' } })).map(routeOut);
  });

  app.post('/route-templates', { schema: { body: RouteTemplateInput } }, async (req, reply) => {
    const u = requireUser(req, 'document.manage');
    await assertStepUsers(u.tenantId, req.body.steps);
    const r = await prisma.routeTemplate.create({ data: { tenantId: u.tenantId, name: req.body.name, steps: normalize(req.body.steps) }, include: routeCount });
    await audit(u, 'route_template.create', 'RouteTemplate', r.id, { name: r.name }, { ip: req.ip });
    return reply.status(201).send(routeOut(r));
  });

  app.get('/route-templates/:id', { schema: { params: idParam } }, async (req) => {
    const u = requireUser(req, 'document.manage');
    const r = await prisma.routeTemplate.findFirst({ where: { id: req.params.id, tenantId: u.tenantId }, include: routeCount });
    if (!r) throw notFound('Route template');
    return routeOut(r);
  });

  app.patch('/route-templates/:id', { schema: { params: idParam, body: RouteTemplateInput.partial() } }, async (req) => {
    const u = requireUser(req, 'document.manage');
    const found = await prisma.routeTemplate.findFirst({ where: { id: req.params.id, tenantId: u.tenantId } });
    if (!found) throw notFound('Route template');
    if (req.body.steps) await assertStepUsers(u.tenantId, req.body.steps);
    const r = await prisma.routeTemplate.update({
      where: { id: found.id },
      data: { ...(req.body.name ? { name: req.body.name } : {}), ...(req.body.steps ? { steps: normalize(req.body.steps) } : {}) },
      include: routeCount,
    });
    await audit(u, 'route_template.update', 'RouteTemplate', r.id, { name: r.name }, { ip: req.ip });
    return routeOut(r);
  });

  app.delete('/route-templates/:id', { schema: { params: idParam } }, async (req, reply) => {
    const u = requireUser(req, 'document.manage');
    const found = await prisma.routeTemplate.findFirst({ where: { id: req.params.id, tenantId: u.tenantId }, include: routeCount });
    if (!found) throw notFound('Route template');
    if (found._count.documentTypes > 0) throw conflict('Route template is used by document types', { rule: 'IN_USE' });
    await prisma.routeTemplate.delete({ where: { id: found.id } });
    await audit(u, 'route_template.delete', 'RouteTemplate', found.id, { name: found.name }, { ip: req.ip });
    return reply.status(204).send();
  });
}
