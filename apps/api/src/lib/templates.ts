import type { TemplateBlock } from '@akere/shared';
import { prisma, type Tx } from './db';
import { PdfBuilder, type Block } from './pdf';
import { fullName, shortName } from './names';

/**
 * Document template rendering (F-14): TemplateBlock[] with {{path}} / {{path|filter}} placeholders
 * filled from a context built from the legal entity, subject employee, author, document and its data.
 * Filters: date (06 октября 2026 г.), short (06.10.2026), money (350 000 ₸), upper, lower, number.
 * ISO dates (YYYY-MM-DD) are formatted as RU long dates automatically.
 */

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const BLANK = '________';

const toDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(ISO_DATE.test(v) ? `${v}T00:00:00Z` : v));

/** "06 октября 2026 г." */
export function formatDateRu(v: Date | string | null | undefined): string {
  if (!v) return '';
  const d = toDate(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS_GEN[d.getUTCMonth()]} ${d.getUTCFullYear()} г.`;
}

/** "06.10.2026" */
export function formatDateShort(v: Date | string | null | undefined): string {
  if (!v) return '';
  const d = toDate(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
}

const groupDigits = (n: number, frac = 0) => {
  const [int, dec] = Math.abs(n).toFixed(frac).split('.');
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${n < 0 ? '−' : ''}${grouped}${dec && Number(dec) !== 0 ? `,${dec}` : ''}`;
};

/** "350 000 ₸" */
export function formatMoney(v: unknown): string {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[\s,]/g, (c) => (c === ',' ? '.' : '')));
  if (!Number.isFinite(n)) return String(v ?? '');
  return `${groupDigits(n, 2)} ₸`;
}

export type TemplateContext = {
  legalEntity: { name: string; nameKk: string; bin: string; address: string; director: string; directorShort: string };
  employee: {
    fullName: string; shortName: string; iin: string; position: string; department: string; hireDate: string; tabNumber: string;
    address: string; birthDate: string; email: string; phone: string;
  } | null;
  author: { fullName: string; shortName: string; position: string } | null;
  document: { number: string; date: string; title: string; type: string };
  data: Record<string, unknown>;
  today: string;
};

const directorShort = (name: string | null) => {
  if (!name) return '';
  const [last, first, middle] = name.split(/\s+/);
  return last && first ? shortName({ lastName: last, firstName: first, middleName: middle }) : name;
};

/** Builds the variable context for a document. Missing pieces are null and render as blanks. */
export async function buildTemplateContext(
  opts: {
    legalEntityId: string;
    subjectEmployeeId?: string | null;
    authorUserId?: string | null;
    documentTypeId?: string | null;
    document?: { number?: string | null; registeredAt?: Date | null; createdAt?: Date | null; title?: string | null };
    data?: Record<string, unknown>;
  },
  tx: Tx = prisma,
): Promise<TemplateContext> {
  const [le, emp, author, type] = await Promise.all([
    tx.legalEntity.findUnique({ where: { id: opts.legalEntityId } }),
    opts.subjectEmployeeId
      ? tx.employee.findUnique({ where: { id: opts.subjectEmployeeId }, include: { user: true, position: true, department: true } })
      : null,
    opts.authorUserId
      ? tx.user.findUnique({ where: { id: opts.authorUserId }, include: { employee: { include: { position: true } } } })
      : null,
    opts.documentTypeId ? tx.documentType.findUnique({ where: { id: opts.documentTypeId } }) : null,
  ]);
  const personal = (emp?.personal ?? {}) as Record<string, unknown>;
  const date = opts.document?.registeredAt ?? opts.document?.createdAt ?? new Date();
  return {
    legalEntity: {
      name: le?.name ?? '', nameKk: le?.nameKk ?? '', bin: le?.bin ?? '', address: le?.address ?? '',
      director: le?.directorName ?? '', directorShort: directorShort(le?.directorName ?? null),
    },
    employee: emp
      ? {
          fullName: fullName(emp.user), shortName: shortName(emp.user), iin: emp.iin ?? '', position: emp.position?.name ?? '',
          department: emp.department?.name ?? '', hireDate: emp.hireDate.toISOString().slice(0, 10), tabNumber: emp.tabNumber,
          address: typeof personal.address === 'string' ? personal.address : '', birthDate: emp.birthDate?.toISOString().slice(0, 10) ?? '',
          email: emp.user.email, phone: emp.user.phone ?? '',
        }
      : null,
    author: author ? { fullName: fullName(author), shortName: shortName(author), position: author.employee?.position?.name ?? '' } : null,
    document: {
      number: opts.document?.number ?? 'б/н',
      date: date.toISOString().slice(0, 10),
      title: opts.document?.title ?? type?.name ?? '',
      type: type?.name ?? '',
    },
    data: opts.data ?? {},
    today: new Date().toISOString().slice(0, 10),
  };
}

function resolvePath(ctx: unknown, path: string): unknown {
  let cur: unknown = ctx;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function formatValue(v: unknown, filter?: string): string {
  if (v === undefined || v === null || v === '') return filter === 'optional' ? '' : BLANK;
  switch (filter) {
    case 'money':
      return formatMoney(v);
    case 'date':
      return formatDateRu(v instanceof Date ? v : String(v));
    case 'short':
      return formatDateShort(v instanceof Date ? v : String(v));
    case 'upper':
      return formatValue(v).toUpperCase();
    case 'lower':
      return formatValue(v).toLowerCase();
    case 'number':
      return typeof v === 'number' ? groupDigits(v, 2) : String(v);
    default:
      break;
  }
  if (v instanceof Date) return formatDateRu(v);
  if (typeof v === 'string') return ISO_DATE.test(v) ? formatDateRu(v) : v;
  if (typeof v === 'boolean') return v ? 'Да' : 'Нет';
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map((x) => formatValue(x)).join(', ');
  return JSON.stringify(v);
}

/** Replaces {{path}} / {{path|filter}} placeholders. Unknown or empty values render as a blank line. */
export function renderText(text: string, ctx: TemplateContext): string {
  return text.replace(/\{\{\s*([\w.]+)\s*(?:\|\s*(\w+)\s*)?\}\}/g, (_, path: string, filter?: string) => formatValue(resolvePath(ctx, path), filter));
}

export function renderBlocks(body: TemplateBlock[], ctx: TemplateContext): Block[] {
  return body.map((b): Block => {
    switch (b.type) {
      case 'heading':
        return { type: 'heading', text: renderText(b.text, ctx), align: b.align };
      case 'paragraph':
        return { type: 'paragraph', text: renderText(b.text, ctx), align: 'left' };
      case 'fields':
        return { type: 'fields', rows: b.rows.map((r) => ({ label: renderText(r.label, ctx), value: renderText(r.value, ctx) })) };
      case 'signatures':
        return { type: 'signatures', parties: b.parties.map((p) => ({ label: renderText(p.label, ctx), name: renderText(p.name, ctx) })) };
      case 'spacer':
        return { type: 'spacer' };
    }
  });
}

/** Renders the document PDF: legal-entity header with БИН, body blocks, footer "Akere HR · <number>". */
export async function renderTemplatePdf(body: TemplateBlock[], ctx: TemplateContext, title?: string): Promise<Buffer> {
  const docTitle = title ?? ctx.document.title;
  const pdf = await PdfBuilder.create({ title: docTitle, footer: `Akere HR · ${ctx.document.number}` });
  const header: Block[] = [
    { type: 'paragraph', text: ctx.legalEntity.name, bold: true, size: 11, align: 'right' },
    ...(ctx.legalEntity.nameKk ? [{ type: 'paragraph' as const, text: ctx.legalEntity.nameKk, size: 9, align: 'right' as const }] : []),
    { type: 'paragraph', text: `БИН ${ctx.legalEntity.bin}`, size: 9, align: 'right' },
    ...(ctx.legalEntity.address ? [{ type: 'paragraph' as const, text: ctx.legalEntity.address, size: 9, align: 'right' as const }] : []),
    { type: 'spacer', height: 10 },
  ];
  await pdf.add([...header, ...renderBlocks(body, ctx)]);
  return pdf.bytes();
}

/** Fallback PDF for documents whose type has no template (title, number and data as fields). */
export async function renderPlainPdf(ctx: TemplateContext): Promise<Buffer> {
  const rows = Object.entries(ctx.data)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
    .map(([k, v]) => ({ label: k, value: formatValue(v) }));
  const body: TemplateBlock[] = [
    { type: 'heading', text: '{{document.title}}' },
    { type: 'paragraph', text: '№ {{document.number}} от {{document.date}}' },
    ...(ctx.employee ? [{ type: 'paragraph' as const, text: 'Работник: {{employee.fullName}}, {{employee.position}}' }] : []),
    ...(rows.length ? [{ type: 'fields' as const, rows }] : []),
  ];
  return renderTemplatePdf(body, ctx);
}

/** Catalogue for GET /document-templates/variables. */
export const TEMPLATE_VARIABLES: { key: string; label: string; example: string }[] = [
  { key: 'legalEntity.name', label: 'Наименование юрлица', example: 'ТОО «Dala Tech»' },
  { key: 'legalEntity.nameKk', label: 'Наименование юрлица (каз.)', example: '«Dala Tech» ЖШС' },
  { key: 'legalEntity.bin', label: 'БИН', example: '190340104215' },
  { key: 'legalEntity.address', label: 'Юридический адрес', example: 'г. Астана, пр. Мәңгілік Ел, 55/20' },
  { key: 'legalEntity.director', label: 'Руководитель (ФИО)', example: 'Байсарин Тимур Ерланович' },
  { key: 'legalEntity.directorShort', label: 'Руководитель (Фамилия И.О.)', example: 'Байсарин Т.Е.' },
  { key: 'employee.fullName', label: 'ФИО работника', example: 'Серикова Әлия Болатовна' },
  { key: 'employee.shortName', label: 'Работник (Фамилия И.О.)', example: 'Серикова Ә.Б.' },
  { key: 'employee.iin', label: 'ИИН работника', example: '960714400123' },
  { key: 'employee.position', label: 'Должность', example: 'Frontend-разработчик' },
  { key: 'employee.department', label: 'Подразделение', example: 'Frontend' },
  { key: 'employee.hireDate', label: 'Дата приёма', example: '11 апреля 2022 г.' },
  { key: 'employee.tabNumber', label: 'Табельный номер', example: '000108' },
  { key: 'employee.address', label: 'Адрес работника', example: 'г. Астана' },
  { key: 'employee.birthDate', label: 'Дата рождения', example: '14 июля 1996 г.' },
  { key: 'author.fullName', label: 'Автор документа', example: 'Сулейменова Жанара Нурлановна' },
  { key: 'author.position', label: 'Должность автора', example: 'Кадровый специалист' },
  { key: 'document.number', label: 'Номер документа', example: '12-10/26' },
  { key: 'document.date', label: 'Дата документа', example: '06 октября 2026 г.' },
  { key: 'document.title', label: 'Заголовок документа', example: 'Приказ о приёме на работу' },
  { key: 'today', label: 'Сегодняшняя дата', example: formatDateRu(new Date()) },
  { key: 'data.startDate', label: 'Дата начала (из данных)', example: '19 октября 2026 г.' },
  { key: 'data.endDate', label: 'Дата окончания (из данных)', example: '01 ноября 2026 г.' },
  { key: 'data.days', label: 'Количество дней', example: '14' },
  { key: 'data.salary|money', label: 'Оклад (₸)', example: '450 000 ₸' },
  { key: 'data.effectiveDate', label: 'Дата вступления в силу', example: '01 ноября 2026 г.' },
  { key: 'data.reason', label: 'Основание', example: 'Заявление работника' },
];
