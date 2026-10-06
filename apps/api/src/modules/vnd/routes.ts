import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import {
  VndAcknowledgeInput, VndCreateFields, VndListQuery, VndMyQuery, VndRecipientsInput, VndRecipientsQuery, id, type VndRecipientView,
} from '@akere/shared';
import { prisma } from '../../lib/db';
import { requireUser, type UserCtx } from '../../lib/auth';
import { badRequest } from '../../lib/errors';
import { on } from '../../lib/hooks';
import { pageArgs, toPage } from '../../lib/pagination';
import { fromDateStr } from '../../lib/dates';
import { fullName, toUserRef, userRefSelect } from '../../lib/names';
import { managedEmployeeScope } from '../../lib/scope';
import { tenantTimezone } from '../../lib/calendar';
import { registerInboxCounter } from '../me/routes';
import { readMultipart } from '../documents/multipart';
import { buildXlsx, fmtDate, fmtDateTime, sendXlsx } from '../reports/xlsx';
import {
  acknowledgeVnd, addRecipients, canManageVnd, createVnd, getReadableVnd, listVnd, myVnd, removeRecipient, sendVnd, syncAcknowledgments, vndDetail,
} from './service';

const idParam = z.object({ id });

// Sidebar badge: my pending acknowledgments.
registerInboxCounter('vnd', async (u) => {
  if (!u.employeeId) return 0;
  return prisma.vndRecipient.count({ where: { employeeId: u.employeeId, status: 'PENDING', document: { status: 'IN_ROUTE', kind: 'VND' } } });
});

// Completion of the last acknowledgment step: mirror it into the recipient rows inside the same transaction.
on('document.completed', async (p, tx) => {
  const db = tx ?? prisma;
  const doc = await db.document.findUnique({ where: { id: p.documentId }, select: { kind: true } });
  if (doc?.kind === 'VND') await syncAcknowledgments(db, { documentId: p.documentId });
});

/** Recipient rows visible to the user: all for ВНД managers; otherwise own row and the managed subtree. */
async function recipientScope(u: UserCtx, doc: { legalEntityId: string; authorId: string }): Promise<Prisma.VndRecipientWhereInput> {
  if (canManageVnd(u, doc)) return {};
  const managed = await managedEmployeeScope(u);
  return { OR: [{ employeeId: u.employeeId ?? '__none__' }, { employee: managed }] };
}

const recipientInclude = {
  employee: { select: { id: true, user: { select: userRefSelect }, department: { select: { name: true } }, position: { select: { name: true } } } },
} satisfies Prisma.VndRecipientInclude;

export default async function vndRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/', { schema: { querystring: VndListQuery } }, async (req) => {
    const u = requireUser(req, 'vnd.read');
    const q = req.query;
    const and: Prisma.DocumentWhereInput[] = [];
    if (q.tab === 'in_progress') and.push({ status: 'IN_ROUTE' });
    if (q.tab === 'completed') and.push({ status: 'COMPLETED' });
    if (q.legalEntityId) and.push({ legalEntityId: q.legalEntityId });
    if (q.q) and.push({ searchText: { contains: q.q.toLowerCase(), mode: 'insensitive' } });
    if (q.dateFrom) and.push({ registeredAt: { gte: fromDateStr(q.dateFrom) } });
    if (q.dateTo) and.push({ registeredAt: { lte: fromDateStr(q.dateTo) } });
    const { items, total } = await listVnd(u, { AND: and }, pageArgs(q));
    return toPage(items, total, q);
  });

  app.get('/my', { schema: { querystring: VndMyQuery } }, async (req) => {
    const u = requireUser(req, 'vnd.read');
    return myVnd(u, req.query.status);
  });

  app.post('/', async (req, reply) => {
    const u = requireUser(req, 'vnd.manage');
    const { files, fields } = await readMultipart(req);
    const file = files.find((f) => f.field === 'file') ?? files[0];
    if (!file) throw badRequest('File is required', { fieldErrors: { file: ['Required'] }, formErrors: [] });
    const f = VndCreateFields.parse(fields);
    const dueAt = f.dueAt ? new Date(f.dueAt.length === 10 ? `${f.dueAt}T23:59:59+05:00` : f.dueAt) : null;
    const docId = await createVnd(u, {
      title: f.title, legalEntityId: f.legalEntityId, documentTypeId: f.documentTypeId, dueAt, requireSignature: f.requireSignature === 'true',
      file: { filename: file.filename, buffer: file.buffer },
    });
    return reply.status(201).send(await vndDetail(u, docId));
  });

  app.get('/:id', { schema: { params: idParam } }, async (req) => {
    const u = requireUser(req, 'vnd.read');
    return vndDetail(u, req.params.id);
  });

  app.get('/:id/recipients', { schema: { params: idParam, querystring: VndRecipientsQuery } }, async (req) => {
    const u = requireUser(req, 'vnd.read');
    const doc = await getReadableVnd(u, req.params.id);
    await syncAcknowledgments(prisma, { documentId: doc.id });
    const q = req.query;
    const words = q.q?.split(/\s+/).filter(Boolean).slice(0, 3) ?? [];
    const where: Prisma.VndRecipientWhereInput = {
      AND: [
        { documentId: doc.id },
        await recipientScope(u, doc),
        ...(q.status ? [{ status: q.status }] : []),
        ...(q.departmentId ? [{ employee: { departmentId: q.departmentId } }] : []),
        ...words.map((w): Prisma.VndRecipientWhereInput => ({
          employee: { OR: [{ user: { lastName: { contains: w, mode: 'insensitive' } } }, { user: { firstName: { contains: w, mode: 'insensitive' } } }, { tabNumber: { contains: w } }] },
        })),
      ],
    };
    const [rows, total] = await Promise.all([
      prisma.vndRecipient.findMany({
        where, include: recipientInclude, orderBy: [{ employee: { user: { lastName: 'asc' } } }, { employee: { user: { firstName: 'asc' } } }], ...pageArgs(q),
      }),
      prisma.vndRecipient.count({ where }),
    ]);
    const items: VndRecipientView[] = rows.map((r) => ({
      id: r.id,
      employee: { ...toUserRef(r.employee.user), employeeId: r.employee.id },
      status: r.status,
      sentAt: r.sentAt.toISOString(),
      acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
    }));
    return toPage(items, total, q);
  });

  app.post('/:id/recipients', { schema: { params: idParam, body: VndRecipientsInput } }, async (req) => {
    const u = requireUser(req, 'vnd.manage');
    return addRecipients(u, req.params.id, req.body);
  });

  app.delete('/:id/recipients/:recipientId', { schema: { params: z.object({ id, recipientId: id }) } }, async (req, reply) => {
    const u = requireUser(req, 'vnd.manage');
    await removeRecipient(u, req.params.id, req.params.recipientId);
    return reply.status(204).send();
  });

  app.post('/:id/send', { schema: { params: idParam } }, async (req) => {
    const u = requireUser(req, 'vnd.manage');
    await sendVnd(u, req.params.id);
    return vndDetail(u, req.params.id);
  });

  app.post('/:id/acknowledge', { schema: { params: idParam, body: VndAcknowledgeInput } }, async (req) => {
    const u = requireUser(req, 'vnd.read');
    await acknowledgeVnd(u, req.params.id, req.body.signingSessionId);
    return vndDetail(u, req.params.id);
  });

  // Acknowledgment sheet (лист ознакомления): Получатель, Подразделение, Должность, Статус, Дата ознакомления.
  app.get('/:id/sheet', { schema: { params: idParam } }, async (req, reply) => {
    const u = requireUser(req, 'vnd.read');
    const doc = await getReadableVnd(u, req.params.id);
    await syncAcknowledgments(prisma, { documentId: doc.id });
    const [rows, le, tz] = await Promise.all([
      prisma.vndRecipient.findMany({
        where: { AND: [{ documentId: doc.id }, await recipientScope(u, doc)] }, include: recipientInclude,
        orderBy: [{ employee: { user: { lastName: 'asc' } } }, { employee: { user: { firstName: 'asc' } } }],
      }),
      prisma.legalEntity.findUniqueOrThrow({ where: { id: doc.legalEntityId }, select: { name: true } }),
      tenantTimezone(u.tenantId),
    ]);
    const done = rows.filter((r) => r.status === 'ACKNOWLEDGED').length;
    const buf = await buildXlsx([{
      name: 'Лист ознакомления',
      caption: [
        `Лист ознакомления: ${doc.title}`,
        `${le.name} · № ${doc.number ?? '—'}${doc.registeredAt ? ` от ${fmtDate(doc.registeredAt)}` : ''} · ознакомлено ${done} из ${rows.length}`,
      ],
      columns: [
        { header: '№', key: 'n', width: 6 },
        { header: 'Получатель', key: 'name', width: 36 },
        { header: 'Подразделение', key: 'department', width: 28 },
        { header: 'Должность', key: 'position', width: 30 },
        { header: 'Статус', key: 'status', width: 18 },
        { header: 'Дата ознакомления', key: 'ackAt', width: 20 },
      ],
      rows: rows.map((r, i) => ({
        n: i + 1,
        name: fullName(r.employee.user),
        department: r.employee.department?.name ?? '',
        position: r.employee.position?.name ?? '',
        status: r.status === 'ACKNOWLEDGED' ? 'Ознакомлен' : 'На ознакомлении',
        ackAt: fmtDateTime(r.acknowledgedAt, tz),
      })),
    }]);
    return sendXlsx(reply, buf, `Лист_ознакомления_${(doc.number ?? doc.title).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80)}.xlsx`);
  });
}
