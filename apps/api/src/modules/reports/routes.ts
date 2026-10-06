import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { HeadcountQuery, ReportExportParams, ReportExportQuery, ReportPeriodQuery } from '@akere/shared';
import { prisma } from '../../lib/db';
import { requireUser, type UserCtx } from '../../lib/auth';
import { fullName } from '../../lib/names';
import { tenantTimezone } from '../../lib/calendar';
import { buildDashboard, buildHeadcount, buildMovements, reportScope, resolvePeriod } from './service';
import { buildXlsx, fmtDate, fmtDateTime, sendXlsx, type SheetSpec } from './xlsx';

const STATUS_RU: Record<string, string> = {
  DRAFT: 'Черновик', IN_ROUTE: 'На согласовании', REWORK: 'На доработке', COMPLETED: 'Завершён', REJECTED: 'Отклонён', CANCELLED: 'Отменён',
};
const VND_STATUS_RU: Record<string, string> = { DRAFT: 'Черновик', IN_ROUTE: 'На ознакомлении', COMPLETED: 'Завершен' };
const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const monthLabel = (m: string) => `${MONTHS_RU[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const ru = (s: string) => s.split('-').reverse().join('.');

async function scopeCaption(u: UserCtx, legalEntityId?: string) {
  if (legalEntityId) return (await prisma.legalEntity.findFirst({ where: { id: legalEntityId, tenantId: u.tenantId }, select: { name: true } }))?.name ?? '';
  return (await prisma.tenant.findUnique({ where: { id: u.tenantId }, select: { name: true } }))?.name ?? '';
}

async function documentsSheet(u: UserCtx, q: { legalEntityId?: string; from?: string; to?: string }): Promise<SheetSpec> {
  const s = await reportScope(u, q.legalEntityId);
  const p = await resolvePeriod(u.tenantId, q);
  const tz = await tenantTimezone(u.tenantId);
  const now = new Date();
  const where: Prisma.DocumentWhereInput = { AND: [s.doc, { kind: { notIn: ['VND'] }, createdAt: { gte: p.fromD, lt: p.toEnd } }] };
  const rows = await prisma.document.findMany({
    where,
    include: {
      documentType: { select: { name: true } }, legalEntity: { select: { name: true } },
      subject: { select: { user: { select: { firstName: true, lastName: true, middleName: true } } } },
      steps: { where: { status: 'PENDING' }, select: { dueAt: true } },
    },
    orderBy: [{ createdAt: 'desc' }],
    take: 20_000,
  });
  return {
    name: 'Документы',
    caption: [`Документы за период ${ru(p.from)} — ${ru(p.to)}`, `${await scopeCaption(u, q.legalEntityId)} · всего ${rows.length}`],
    columns: [
      { header: 'Номер', key: 'number', width: 16 }, { header: 'Дата регистрации', key: 'registeredAt', width: 16 },
      { header: 'Тип документа', key: 'type', width: 34 }, { header: 'Название', key: 'title', width: 44 },
      { header: 'Сотрудник', key: 'subject', width: 32 }, { header: 'Юрлицо', key: 'le', width: 26 },
      { header: 'Статус', key: 'status', width: 18 }, { header: 'Просрочен', key: 'overdue', width: 11 },
      { header: 'Создан', key: 'createdAt', width: 17 }, { header: 'Завершён', key: 'completedAt', width: 17 },
    ],
    rows: rows.map((d) => ({
      number: d.number ?? '', registeredAt: fmtDate(d.registeredAt), type: d.documentType.name, title: d.title,
      subject: d.subject ? fullName(d.subject.user) : '', le: d.legalEntity.name, status: d.kind === 'ARCHIVE' ? 'Архив' : (STATUS_RU[d.status] ?? d.status),
      overdue: d.status === 'IN_ROUTE' && ((d.dueAt && d.dueAt < now) || d.steps.some((x) => x.dueAt && x.dueAt < now)) ? 'Да' : '',
      createdAt: fmtDateTime(d.createdAt, tz), completedAt: fmtDateTime(d.completedAt, tz),
    })),
  };
}

async function vndSheet(u: UserCtx, q: { legalEntityId?: string; from?: string; to?: string }): Promise<SheetSpec> {
  const s = await reportScope(u, q.legalEntityId);
  const where: Prisma.DocumentWhereInput = {
    tenantId: u.tenantId, kind: 'VND', status: { in: s.hr ? ['DRAFT', 'IN_ROUTE', 'COMPLETED'] : ['IN_ROUTE', 'COMPLETED'] },
    ...(s.legalEntityIds === null ? {} : { legalEntityId: { in: s.legalEntityIds } }),
    ...(s.hr ? {} : { vndRecipients: { some: { employee: s.emp } } }),
    ...(q.from || q.to ? { registeredAt: { ...(q.from ? { gte: new Date(`${q.from}T00:00:00Z`) } : {}), ...(q.to ? { lte: new Date(`${q.to}T00:00:00Z`) } : {}) } } : {}),
  };
  const docs = await prisma.document.findMany({ where, include: { legalEntity: { select: { name: true } }, documentType: { select: { name: true } } }, orderBy: { createdAt: 'desc' } });
  const ids = docs.map((d) => d.id);
  const groups = ids.length
    ? await prisma.vndRecipient.groupBy({ by: ['documentId', 'status'], where: { documentId: { in: ids }, ...(s.hr ? {} : { employee: s.emp }) }, _count: { _all: true } })
    : [];
  return {
    name: 'ВНД',
    caption: ['Ознакомление с ВНД', `${await scopeCaption(u, q.legalEntityId)} · документов ${docs.length}`],
    columns: [
      { header: 'Номер', key: 'number', width: 14 }, { header: 'Название', key: 'title', width: 50 }, { header: 'Тип документа', key: 'type', width: 30 },
      { header: 'Дата отправки', key: 'sentAt', width: 15 }, { header: 'Ознакомлено', key: 'done', width: 13 }, { header: 'Всего', key: 'total', width: 9 },
      { header: '% ознакомления', key: 'pct', width: 15 }, { header: 'Статус', key: 'status', width: 18 }, { header: 'Юрлицо', key: 'le', width: 26 },
    ],
    rows: docs.map((d) => {
      const g = groups.filter((x) => x.documentId === d.id);
      const total = g.reduce((a, x) => a + x._count._all, 0);
      const done = g.find((x) => x.status === 'ACKNOWLEDGED')?._count._all ?? 0;
      return {
        number: d.number ?? '', title: d.title, type: d.documentType.name, sentAt: fmtDate(d.registeredAt), done, total,
        pct: total ? Math.round((done / total) * 1000) / 10 : 0, status: VND_STATUS_RU[d.status] ?? d.status, le: d.legalEntity.name,
      };
    }),
  };
}

export default async function reportsRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/dashboard', { schema: { querystring: ReportPeriodQuery } }, async (req) => {
    const u = requireUser(req, 'report.read');
    return buildDashboard(u, req.query);
  });

  app.get('/headcount', { schema: { querystring: HeadcountQuery } }, async (req) => {
    const u = requireUser(req, 'report.read');
    return buildHeadcount(u, req.query);
  });

  app.get('/movements', { schema: { querystring: ReportPeriodQuery } }, async (req) => {
    const u = requireUser(req, 'report.read');
    return buildMovements(u, req.query);
  });

  app.get('/:report/export', { schema: { params: ReportExportParams, querystring: ReportExportQuery } }, async (req, reply) => {
    const u = requireUser(req, 'report.read');
    const q = req.query;
    const caption = await scopeCaption(u, q.legalEntityId);
    let sheets: SheetSpec[];
    switch (req.params.report) {
      case 'headcount': {
        const h = await buildHeadcount(u, q);
        sheets = [
          {
            name: 'По подразделениям', caption: [`Численность на ${ru(h.date)}`, `${caption} · всего ${h.total}`],
            columns: [{ header: 'Подразделение', key: 'name', width: 40 }, { header: 'Численность', key: 'count', width: 14 }],
            rows: [...h.byDepartment.map((r) => ({ name: r.department.name, count: r.count })), { name: 'Итого', count: h.total }],
          },
          {
            name: 'По должностям', caption: [`Численность на ${ru(h.date)}`, `${caption} · всего ${h.total}`],
            columns: [{ header: 'Должность', key: 'name', width: 40 }, { header: 'Численность', key: 'count', width: 14 }],
            rows: [...h.byPosition.map((r) => ({ name: r.position.name, count: r.count })), { name: 'Итого', count: h.total }],
          },
        ];
        break;
      }
      case 'movements': {
        const m = await buildMovements(u, q);
        const sum = (k: 'hired' | 'dismissed' | 'transferred') => m.months.reduce((a, x) => a + x[k], 0);
        sheets = [{
          name: 'Движение кадров', caption: [`Движение кадров ${ru(m.from)} — ${ru(m.to)}`, caption],
          columns: [
            { header: 'Месяц', key: 'month', width: 18 }, { header: 'Принято', key: 'hired', width: 12 },
            { header: 'Уволено', key: 'dismissed', width: 12 }, { header: 'Переведено', key: 'transferred', width: 12 },
          ],
          rows: [...m.months.map((x) => ({ ...x, month: monthLabel(x.month) })), { month: 'Итого', hired: sum('hired'), dismissed: sum('dismissed'), transferred: sum('transferred') }],
        }];
        break;
      }
      case 'documents':
        sheets = [await documentsSheet(u, q)];
        break;
      case 'vnd':
        sheets = [await vndSheet(u, q)];
        break;
    }
    const names: Record<string, string> = { headcount: 'Численность', movements: 'Движение_кадров', documents: 'Документы', vnd: 'ВНД' };
    return sendXlsx(reply, await buildXlsx(sheets), `${names[req.params.report]}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  });
}
