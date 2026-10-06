import type { AbsenceKind, DocumentKind, Prisma, RequestType } from '@prisma/client';
import type { FormField, RouteStepDef, TemplateBlock } from '@akere/shared';
import { prisma, type Tx } from '../../lib/db';
import { DEFAULT_ROUTES, ensureDocumentType } from '../documents/defaults';

/**
 * Built-in request catalogue (F-26). Each request type points at an application document type (routed
 * manager → HR) and, for leave/trips, an order document type (signatory → employee acknowledgment).
 * SOCIAL_LEAVE and CERTIFICATE use document types defined here (the documents catalogue has none).
 */

const H = (text: string, align: 'left' | 'center' = 'center'): TemplateBlock => ({ type: 'heading', text, align });
const P = (text: string): TemplateBlock => ({ type: 'paragraph', text });
const SP: TemplateBlock = { type: 'spacer' };
const F = (rows: [string, string][]): TemplateBlock => ({ type: 'fields', rows: rows.map(([label, value]) => ({ label, value })) });
const S = (parties: [string, string][]): TemplateBlock => ({ type: 'signatures', parties: parties.map(([label, name]) => ({ label, name })) });
const appHead: TemplateBlock[] = [P('Руководителю {{legalEntity.name}} {{legalEntity.directorShort}}'), P('от {{employee.position}} {{employee.fullName}}'), H('ЗАЯВЛЕНИЕ')];
const appTail: TemplateBlock[] = [SP, F([['Дата', '{{document.date}}']]), S([['Работник', '{{employee.shortName}}']])];

type ExtraDocType = {
  code: string; name: string; nameKk: string; kind: DocumentKind; numberPattern: string;
  template: { name: string; body: TemplateBlock[] }; route: { name: string; steps: RouteStepDef[] };
};

export const CERTIFICATE_ROUTE = { name: 'Справка: HR', steps: [{ order: 1, action: 'APPROVE', rule: 'ROLE_HR', dueDays: 2 }] } satisfies { name: string; steps: RouteStepDef[] };

export const EXTRA_DOC_TYPES: ExtraDocType[] = [
  {
    code: 'SOCIAL_LEAVE_APPLICATION', name: 'Заявление на социальный отпуск', nameKk: 'Әлеуметтік демалысқа өтініш', kind: 'APPLICATION', numberPattern: '{seq}-з/{YY}',
    template: {
      name: 'Заявление на социальный отпуск',
      body: [
        ...appHead,
        P('Прошу предоставить мне социальный отпуск ({{data.leaveKind}}) продолжительностью {{data.days}} календарных дней с {{data.startDate}} по {{data.endDate}} в соответствии со статьёй 96 Трудового кодекса Республики Казахстан.'),
        P('{{data.reason|optional}}'),
        P('Подтверждающий документ прилагается.'),
        ...appTail,
      ],
    },
    route: DEFAULT_ROUTES.application,
  },
  {
    code: 'SOCIAL_LEAVE_ORDER', name: 'Приказ о социальном отпуске', nameKk: 'Әлеуметтік демалыс туралы бұйрық', kind: 'ORDER', numberPattern: '{seq}-о/{YY}',
    template: {
      name: 'Приказ о предоставлении социального отпуска',
      body: [
        H('ПРИКАЗ / БҰЙРЫҚ'), P('№ {{document.number}} от {{document.date}}'), H('О предоставлении социального отпуска'),
        P('В соответствии со статьёй 96 Трудового кодекса Республики Казахстан ПРИКАЗЫВАЮ:'),
        P('1. Предоставить {{employee.fullName}}, {{employee.position}}, социальный отпуск ({{data.leaveKind}}) продолжительностью {{data.days}} календарных дней с {{data.startDate}} по {{data.endDate}}.'),
        P('Основание: заявление работника, подтверждающий документ.'),
        SP, S([['Руководитель', '{{legalEntity.director}}']]),
        P('С приказом ознакомлен(а): {{employee.fullName}}'), S([['Работник', '{{employee.shortName}}']]),
      ],
    },
    route: DEFAULT_ROUTES.order,
  },
  {
    code: 'CERTIFICATE_REQUEST', name: 'Заявление на справку с места работы', nameKk: 'Жұмыс орнынан анықтамаға өтініш', kind: 'APPLICATION', numberPattern: 'СП-{seq}/{YY}',
    template: {
      name: 'Заявление на справку с места работы',
      body: [
        P('В отдел кадров {{legalEntity.name}}'),
        P('от {{employee.position}} {{employee.fullName}}'),
        H('ЗАЯВЛЕНИЕ'),
        P('Прошу выдать мне справку с места работы с указанием должности и стажа работы для предъявления по месту требования: {{data.purpose}}.'),
        F([['Количество экземпляров', '{{data.copies}}'], ['Работает с', '{{employee.hireDate}}'], ['Табельный номер', '{{employee.tabNumber}}']]),
        ...appTail,
      ],
    },
    route: CERTIFICATE_ROUTE,
  },
];

/** Returns a document type by code: built-in catalogue first, then the request-specific ones above. */
export async function ensureRequestDocType(tenantId: string, code: string, tx: Tx = prisma) {
  const extra = EXTRA_DOC_TYPES.find((t) => t.code === code);
  if (!extra) return ensureDocumentType(tenantId, code, tx);
  const existing = await tx.documentType.findUnique({ where: { tenantId_code: { tenantId, code } } });
  if (existing) return existing;
  const templateId = (await tx.documentTemplate.findFirst({ where: { tenantId, name: extra.template.name } }))?.id
    ?? (await tx.documentTemplate.create({ data: { tenantId, name: extra.template.name, body: extra.template.body } })).id;
  const routeTemplateId = (await tx.routeTemplate.findFirst({ where: { tenantId, name: extra.route.name } }))?.id
    ?? (await tx.routeTemplate.create({ data: { tenantId, name: extra.route.name, steps: extra.route.steps } })).id;
  return tx.documentType.upsert({
    where: { tenantId_code: { tenantId, code } },
    create: { tenantId, code, name: extra.name, nameKk: extra.nameKk, kind: extra.kind, numberPattern: extra.numberPattern, templateId, routeTemplateId },
    update: {},
  });
}

type RequestTypeDef = {
  code: string; name: string; nameKk: string; application: string; order: string | null; absenceKind: AbsenceKind | null;
  usesVacationBalance: boolean; requiresAttachment: boolean; fields: FormField[];
};

export const REQUEST_TYPE_DEFS: RequestTypeDef[] = [
  {
    code: 'ANNUAL_LEAVE', name: 'Ежегодный оплачиваемый отпуск', nameKk: 'Жыл сайынғы ақылы демалыс', application: 'VACATION_APPLICATION', order: 'VACATION_ORDER',
    absenceKind: 'VACATION', usesVacationBalance: true, requiresAttachment: false,
    fields: [{ key: 'comment', label: 'Комментарий', labelKk: 'Түсініктеме', type: 'textarea', required: false }],
  },
  {
    code: 'UNPAID_LEAVE', name: 'Отпуск без сохранения заработной платы', nameKk: 'Жалақы сақталмайтын демалыс', application: 'UNPAID_LEAVE_APPLICATION', order: 'UNPAID_LEAVE_ORDER',
    absenceKind: 'UNPAID', usesVacationBalance: false, requiresAttachment: false,
    fields: [{ key: 'reason', label: 'Причина', labelKk: 'Себебі', type: 'textarea', required: true }],
  },
  {
    code: 'BUSINESS_TRIP', name: 'Командировка', nameKk: 'Іссапар', application: 'BUSINESS_TRIP_APPLICATION', order: 'BUSINESS_TRIP_ORDER',
    absenceKind: 'BUSINESS_TRIP', usesVacationBalance: false, requiresAttachment: false,
    fields: [
      { key: 'destination', label: 'Место назначения', labelKk: 'Баратын жері', type: 'text', required: true },
      { key: 'purpose', label: 'Цель командировки', labelKk: 'Іссапар мақсаты', type: 'textarea', required: true },
      { key: 'transport', label: 'Транспорт', labelKk: 'Көлік', type: 'select', required: false, options: ['Авиа', 'Железнодорожный', 'Автомобильный', 'Служебный транспорт'] },
    ],
  },
  {
    code: 'SOCIAL_LEAVE', name: 'Социальный отпуск (по уходу за ребёнком, учебный)', nameKk: 'Әлеуметтік демалыс (бала күтімі, оқу)', application: 'SOCIAL_LEAVE_APPLICATION', order: 'SOCIAL_LEAVE_ORDER',
    absenceKind: 'OTHER', usesVacationBalance: false, requiresAttachment: true,
    fields: [
      { key: 'leaveKind', label: 'Вид отпуска', labelKk: 'Демалыс түрі', type: 'select', required: true, options: ['учебный отпуск', 'отпуск по уходу за ребёнком до достижения им трёх лет', 'отпуск в связи с беременностью и родами'] },
      { key: 'reason', label: 'Комментарий', labelKk: 'Түсініктеме', type: 'textarea', required: false },
    ],
  },
  {
    code: 'CERTIFICATE', name: 'Справка с места работы', nameKk: 'Жұмыс орнынан анықтама', application: 'CERTIFICATE_REQUEST', order: null,
    absenceKind: null, usesVacationBalance: false, requiresAttachment: false,
    fields: [
      { key: 'purpose', label: 'Место предъявления', labelKk: 'Ұсынылатын орны', type: 'text', required: true },
      { key: 'copies', label: 'Количество экземпляров', labelKk: 'Дана саны', type: 'number', required: false },
    ],
  },
];

/** Creates any missing built-in request types (and their document types) for the tenant. Idempotent. */
export async function ensureRequestTypes(tenantId: string, tx: Tx = prisma): Promise<RequestType[]> {
  const existing = await tx.requestType.findMany({ where: { tenantId } });
  const have = new Set(existing.map((t) => t.code));
  for (const def of REQUEST_TYPE_DEFS) {
    if (have.has(def.code)) continue;
    const app = await ensureRequestDocType(tenantId, def.application, tx);
    const order = def.order ? await ensureRequestDocType(tenantId, def.order, tx) : null;
    await tx.requestType.upsert({
      where: { tenantId_code: { tenantId, code: def.code } },
      create: {
        tenantId, code: def.code, name: def.name, nameKk: def.nameKk, fields: def.fields as unknown as Prisma.InputJsonValue,
        applicationDocTypeId: app.id, orderDocTypeId: order?.id ?? null, absenceKind: def.absenceKind,
        usesVacationBalance: def.usesVacationBalance, requiresAttachment: def.requiresAttachment,
      },
      update: {},
    });
  }
  return tx.requestType.findMany({ where: { tenantId } });
}

const ORDER = REQUEST_TYPE_DEFS.map((d) => d.code);
export const sortTypes = <T extends { code: string; name: string }>(rows: T[]) =>
  rows.slice().sort((a, b) => (ORDER.indexOf(a.code) + 1 || 99) - (ORDER.indexOf(b.code) + 1 || 99) || a.name.localeCompare(b.name));

export const hasDates = (t: Pick<RequestType, 'absenceKind'>) => t.absenceKind !== null;

export function toRequestTypeView(t: RequestType) {
  return {
    id: t.id, code: t.code, name: t.name, nameKk: t.nameKk, fields: (t.fields ?? []) as FormField[],
    usesVacationBalance: t.usesVacationBalance, requiresAttachment: t.requiresAttachment, hasDates: hasDates(t), absenceKind: t.absenceKind,
  };
}
