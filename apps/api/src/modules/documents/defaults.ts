import type { DocumentKind, RouteStepDef, TemplateBlock } from '@akere/shared';
import { prisma, type Tx } from '../../lib/db';

/**
 * Built-in document catalogue: templates (RU, Labor Code RK wording), default routes (AS-07) and
 * document types. Used by the seed and to create missing types on the fly (e.g. when a tenant without
 * the seed catalogue hires an employee). Data keys each template expects are listed in `dataKeys`.
 */

export const DEFAULT_ROUTES = {
  contract: { name: 'Трудовой договор: работодатель → работник', steps: [
    { order: 1, action: 'SIGN', rule: 'SIGNATORY', dueDays: 3 },
    { order: 2, action: 'SIGN', rule: 'SUBJECT', dueDays: 3 },
  ] },
  order: { name: 'Приказ: подписант → ознакомление работника', steps: [
    { order: 1, action: 'SIGN', rule: 'SIGNATORY', dueDays: 2 },
    { order: 2, action: 'ACKNOWLEDGE', rule: 'SUBJECT', dueDays: 3 },
  ] },
  application: { name: 'Заявление: руководитель → HR', steps: [
    { order: 1, action: 'APPROVE', rule: 'MANAGER_OF_SUBJECT', dueDays: 2 },
    { order: 2, action: 'APPROVE', rule: 'ROLE_HR', dueDays: 2 },
  ] },
} satisfies Record<string, { name: string; steps: RouteStepDef[] }>;
export type DefaultRouteKey = keyof typeof DEFAULT_ROUTES;

const H = (text: string, align: 'left' | 'center' = 'center'): TemplateBlock => ({ type: 'heading', text, align });
const P = (text: string): TemplateBlock => ({ type: 'paragraph', text });
const SP: TemplateBlock = { type: 'spacer' };
const F = (rows: [string, string][]): TemplateBlock => ({ type: 'fields', rows: rows.map(([label, value]) => ({ label, value })) });
const S = (parties: [string, string][]): TemplateBlock => ({ type: 'signatures', parties: parties.map(([label, name]) => ({ label, name })) });

const orderHead = (title: string): TemplateBlock[] => [
  H('ПРИКАЗ / БҰЙРЫҚ'),
  P('№ {{document.number}} от {{document.date}}'),
  H(title),
];
const orderTail = (ack = true): TemplateBlock[] => [
  SP,
  S([['Руководитель', '{{legalEntity.director}}']]),
  ...(ack ? [P('С приказом ознакомлен(а): {{employee.fullName}}'), S([['Работник', '{{employee.shortName}}']])] : []),
];

export const DEFAULT_TEMPLATES: Record<string, { name: string; dataKeys: string[]; body: TemplateBlock[] }> = {
  EMPLOYMENT_CONTRACT: {
    name: 'Трудовой договор',
    dataKeys: ['salary', 'probationMonths', 'startDate', 'workSchedule'],
    body: [
      H('ТРУДОВОЙ ДОГОВОР № {{document.number}}'),
      P('г. Астана, {{document.date}}'),
      P('{{legalEntity.name}} (БИН {{legalEntity.bin}}), именуемое в дальнейшем «Работодатель», в лице руководителя {{legalEntity.director}}, действующего на основании Устава, с одной стороны, и гражданин(ка) {{employee.fullName}} (ИИН {{employee.iin}}), именуемый(ая) в дальнейшем «Работник», с другой стороны, заключили настоящий трудовой договор в соответствии с Трудовым кодексом Республики Казахстан (далее — ТК РК) о нижеследующем.'),
      H('1. Предмет договора', 'left'),
      P('1.1. Работодатель принимает Работника на должность «{{employee.position}}» в подразделение «{{employee.department}}» и обязуется обеспечить условия труда, предусмотренные ТК РК, а Работник обязуется лично выполнять трудовую функцию и соблюдать трудовой распорядок.'),
      P('1.2. Место выполнения работы: {{legalEntity.address}}. Дата начала работы: {{employee.hireDate}}. Договор заключён на неопределённый срок.'),
      P('1.3. Срок испытания: {{data.probationMonths}} мес. (статья 36 ТК РК).'),
      H('2. Оплата труда', 'left'),
      P('2.1. Работнику устанавливается должностной оклад в размере {{data.salary|money}} в месяц. Заработная плата выплачивается не реже одного раза в месяц, не позднее первой декады месяца, следующего за отработанным, путём перечисления на банковский счёт Работника.'),
      P('2.2. Из заработной платы удерживаются индивидуальный подоходный налог, обязательные пенсионные взносы и взносы на обязательное социальное медицинское страхование в порядке, установленном законодательством Республики Казахстан.'),
      H('3. Режим рабочего времени и отдыха', 'left'),
      P('3.1. Работнику устанавливается пятидневная рабочая неделя продолжительностью 40 часов с двумя выходными днями (суббота, воскресенье). Время начала и окончания работы определяется актом работодателя.'),
      P('3.2. Работнику предоставляется ежегодный оплачиваемый трудовой отпуск продолжительностью 24 календарных дня (статья 88 ТК РК).'),
      H('4. Права и обязанности сторон', 'left'),
      P('4.1. Права и обязанности Работника и Работодателя определяются статьями 22 и 23 ТК РК, актами работодателя и настоящим договором. Работник обязуется не разглашать сведения, составляющие служебную, коммерческую или иную охраняемую законом тайну.'),
      H('5. Прочие условия', 'left'),
      P('5.1. Договор вступает в силу с момента подписания сторонами посредством электронной цифровой подписи и подлежит регистрации в единой системе учёта трудовых договоров (ЕСУТД). Изменения оформляются дополнительными соглашениями. Расторжение договора производится по основаниям, предусмотренным ТК РК.'),
      SP,
      F([
        ['Работодатель', '{{legalEntity.name}}, БИН {{legalEntity.bin}}, {{legalEntity.address}}'],
        ['Работник', '{{employee.fullName}}, ИИН {{employee.iin}}, {{employee.address}}'],
      ]),
      S([['Работодатель', '{{legalEntity.director}}'], ['Работник', '{{employee.fullName}}']]),
    ],
  },
  HIRE_ORDER: {
    name: 'Приказ о приёме на работу',
    dataKeys: ['salary', 'probationMonths'],
    body: [
      ...orderHead('О приёме на работу'),
      P('В соответствии со статьёй 34 Трудового кодекса Республики Казахстан и на основании трудового договора ПРИКАЗЫВАЮ:'),
      P('1. Принять {{employee.fullName}} (ИИН {{employee.iin}}) на должность «{{employee.position}}» в подразделение «{{employee.department}}» с {{employee.hireDate}}.'),
      P('2. Установить должностной оклад в размере {{data.salary|money}}.'),
      P('3. Установить срок испытания {{data.probationMonths}} мес.'),
      P('4. Присвоить табельный номер {{employee.tabNumber}}.'),
      P('Основание: трудовой договор, заявление работника.'),
      ...orderTail(),
    ],
  },
  TRANSFER_ORDER: {
    name: 'Приказ о переводе',
    dataKeys: ['effectiveDate', 'fromDepartment', 'fromPosition', 'toDepartment', 'toPosition', 'toManager', 'salary', 'reason'],
    body: [
      ...orderHead('О переводе на другую работу'),
      P('В соответствии со статьёй 41 Трудового кодекса Республики Казахстан ПРИКАЗЫВАЮ:'),
      P('1. Перевести {{employee.fullName}}, табельный № {{employee.tabNumber}}, с {{data.effectiveDate}}:'),
      F([
        ['Прежнее подразделение', '{{data.fromDepartment}}'],
        ['Прежняя должность', '{{data.fromPosition}}'],
        ['Новое подразделение', '{{data.toDepartment}}'],
        ['Новая должность', '{{data.toPosition}}'],
        ['Непосредственный руководитель', '{{data.toManager}}'],
        ['Должностной оклад', '{{data.salary|money}}'],
      ]),
      P('2. Внести соответствующие изменения в трудовой договор путём заключения дополнительного соглашения.'),
      P('Основание: {{data.reason}}.'),
      ...orderTail(),
    ],
  },
  DISMISSAL_ORDER: {
    name: 'Приказ о расторжении трудового договора',
    dataKeys: ['effectiveDate', 'reason', 'article', 'compensationDays'],
    body: [
      ...orderHead('О расторжении трудового договора'),
      P('ПРИКАЗЫВАЮ:'),
      P('1. Расторгнуть трудовой договор с {{employee.fullName}} (ИИН {{employee.iin}}), должность «{{employee.position}}», подразделение «{{employee.department}}», {{data.effectiveDate}} по основанию: {{data.article}}.'),
      P('2. Бухгалтерии произвести окончательный расчёт и выплатить компенсацию за неиспользованные дни ежегодного оплачиваемого трудового отпуска в соответствии со статьёй 99 ТК РК.'),
      P('3. Отделу кадров внести сведения о прекращении трудового договора в ЕСУТД.'),
      P('Основание: {{data.reason}}.'),
      ...orderTail(),
    ],
  },
  VACATION_APPLICATION: {
    name: 'Заявление на ежегодный оплачиваемый трудовой отпуск',
    dataKeys: ['startDate', 'endDate', 'days', 'comment'],
    body: [
      P('Руководителю {{legalEntity.name}} {{legalEntity.directorShort}}'),
      P('от {{employee.position}} {{employee.fullName}}'),
      H('ЗАЯВЛЕНИЕ'),
      P('Прошу предоставить мне ежегодный оплачиваемый трудовой отпуск продолжительностью {{data.days}} календарных дней с {{data.startDate}} по {{data.endDate}} включительно.'),
      P('{{data.comment|optional}}'),
      SP,
      F([['Дата', '{{document.date}}']]),
      S([['Работник', '{{employee.shortName}}']]),
    ],
  },
  VACATION_ORDER: {
    name: 'Приказ о предоставлении ежегодного трудового отпуска',
    dataKeys: ['startDate', 'endDate', 'days', 'periodFrom', 'periodTo'],
    body: [
      ...orderHead('О предоставлении ежегодного оплачиваемого трудового отпуска'),
      P('В соответствии со статьями 88 и 94 Трудового кодекса Республики Казахстан ПРИКАЗЫВАЮ:'),
      P('1. Предоставить {{employee.fullName}}, {{employee.position}}, ежегодный оплачиваемый трудовой отпуск продолжительностью {{data.days}} календарных дней с {{data.startDate}} по {{data.endDate}}.'),
      P('2. Бухгалтерии произвести оплату отпускных не позднее чем за три календарных дня до начала отпуска.'),
      P('Основание: заявление работника.'),
      ...orderTail(),
    ],
  },
  UNPAID_LEAVE_APPLICATION: {
    name: 'Заявление на отпуск без сохранения заработной платы',
    dataKeys: ['startDate', 'endDate', 'days', 'reason'],
    body: [
      P('Руководителю {{legalEntity.name}} {{legalEntity.directorShort}}'),
      P('от {{employee.position}} {{employee.fullName}}'),
      H('ЗАЯВЛЕНИЕ'),
      P('Прошу предоставить мне отпуск без сохранения заработной платы продолжительностью {{data.days}} календарных дней с {{data.startDate}} по {{data.endDate}} в соответствии со статьёй 95 Трудового кодекса Республики Казахстан.'),
      P('Причина: {{data.reason}}.'),
      SP,
      F([['Дата', '{{document.date}}']]),
      S([['Работник', '{{employee.shortName}}']]),
    ],
  },
  UNPAID_LEAVE_ORDER: {
    name: 'Приказ об отпуске без сохранения заработной платы',
    dataKeys: ['startDate', 'endDate', 'days', 'reason'],
    body: [
      ...orderHead('О предоставлении отпуска без сохранения заработной платы'),
      P('В соответствии со статьёй 95 Трудового кодекса Республики Казахстан ПРИКАЗЫВАЮ:'),
      P('1. Предоставить {{employee.fullName}}, {{employee.position}}, отпуск без сохранения заработной платы продолжительностью {{data.days}} календарных дней с {{data.startDate}} по {{data.endDate}}.'),
      P('Основание: заявление работника ({{data.reason}}).'),
      ...orderTail(),
    ],
  },
  BUSINESS_TRIP_APPLICATION: {
    name: 'Заявление на командировку',
    dataKeys: ['startDate', 'endDate', 'days', 'destination', 'purpose'],
    body: [
      P('Руководителю {{legalEntity.name}} {{legalEntity.directorShort}}'),
      P('от {{employee.position}} {{employee.fullName}}'),
      H('ЗАЯВЛЕНИЕ'),
      P('Прошу направить меня в служебную командировку в {{data.destination}} с {{data.startDate}} по {{data.endDate}} ({{data.days}} календарных дней).'),
      P('Цель командировки: {{data.purpose}}.'),
      SP,
      F([['Дата', '{{document.date}}']]),
      S([['Работник', '{{employee.shortName}}']]),
    ],
  },
  BUSINESS_TRIP_ORDER: {
    name: 'Приказ о направлении в командировку',
    dataKeys: ['startDate', 'endDate', 'days', 'destination', 'purpose', 'perDiem'],
    body: [
      ...orderHead('О направлении работника в командировку'),
      P('В соответствии со статьёй 127 Трудового кодекса Республики Казахстан ПРИКАЗЫВАЮ:'),
      P('1. Направить {{employee.fullName}}, {{employee.position}}, в служебную командировку в {{data.destination}} сроком на {{data.days}} календарных дней с {{data.startDate}} по {{data.endDate}}.'),
      P('2. Цель командировки: {{data.purpose}}.'),
      P('3. Бухгалтерии выдать аванс на командировочные расходы и возместить суточные, расходы по проезду и найму жилого помещения в порядке, установленном законодательством Республики Казахстан.'),
      P('Основание: служебная записка / заявление работника.'),
      ...orderTail(),
    ],
  },
  SUPPLEMENTARY_AGREEMENT: {
    name: 'Дополнительное соглашение к трудовому договору',
    dataKeys: ['contractNumber', 'contractDate', 'changes', 'effectiveDate'],
    body: [
      H('ДОПОЛНИТЕЛЬНОЕ СОГЛАШЕНИЕ № {{document.number}}'),
      P('к трудовому договору № {{data.contractNumber}} от {{data.contractDate}}'),
      P('г. Астана, {{document.date}}'),
      P('{{legalEntity.name}} (БИН {{legalEntity.bin}}) в лице руководителя {{legalEntity.director}}, с одной стороны, и {{employee.fullName}} (ИИН {{employee.iin}}), с другой стороны, в соответствии со статьёй 33 Трудового кодекса Республики Казахстан заключили настоящее дополнительное соглашение о нижеследующем:'),
      P('1. Внести в трудовой договор следующие изменения: {{data.changes}}.'),
      P('2. Изменения вступают в силу с {{data.effectiveDate}}. Остальные условия трудового договора остаются без изменений.'),
      P('3. Соглашение подписано электронными цифровыми подписями сторон и является неотъемлемой частью трудового договора.'),
      SP,
      S([['Работодатель', '{{legalEntity.director}}'], ['Работник', '{{employee.fullName}}']]),
    ],
  },
};

export type DefaultTypeDef = {
  code: string; name: string; nameKk: string; kind: DocumentKind; numberPattern: string;
  template: string | null; route: DefaultRouteKey | null; esutdRequired: boolean;
};

export const DEFAULT_TYPES: DefaultTypeDef[] = [
  { code: 'EMPLOYMENT_CONTRACT', name: 'Трудовой договор', nameKk: 'Еңбек шарты', kind: 'CONTRACT', numberPattern: 'ТД-{seq}/{YYYY}', template: 'EMPLOYMENT_CONTRACT', route: 'contract', esutdRequired: true },
  { code: 'SUPPLEMENTARY_AGREEMENT', name: 'Дополнительное соглашение к ТД', nameKk: 'Еңбек шартына қосымша келісім', kind: 'SUPPLEMENTARY', numberPattern: 'ДС-{seq}/{YYYY}', template: 'SUPPLEMENTARY_AGREEMENT', route: 'contract', esutdRequired: true },
  { code: 'HIRE_ORDER', name: 'Приказ о приёме на работу', nameKk: 'Жұмысқа қабылдау туралы бұйрық', kind: 'ORDER', numberPattern: '{seq}-к/{YY}', template: 'HIRE_ORDER', route: 'order', esutdRequired: false },
  { code: 'TRANSFER_ORDER', name: 'Приказ о переводе', nameKk: 'Ауыстыру туралы бұйрық', kind: 'ORDER', numberPattern: '{seq}-к/{YY}', template: 'TRANSFER_ORDER', route: 'order', esutdRequired: false },
  { code: 'DISMISSAL_ORDER', name: 'Приказ об увольнении', nameKk: 'Жұмыстан босату туралы бұйрық', kind: 'ORDER', numberPattern: '{seq}-к/{YY}', template: 'DISMISSAL_ORDER', route: 'order', esutdRequired: false },
  { code: 'VACATION_APPLICATION', name: 'Заявление на отпуск', nameKk: 'Демалысқа өтініш', kind: 'APPLICATION', numberPattern: '{seq}-з/{YY}', template: 'VACATION_APPLICATION', route: 'application', esutdRequired: false },
  { code: 'VACATION_ORDER', name: 'Приказ об отпуске', nameKk: 'Демалыс туралы бұйрық', kind: 'ORDER', numberPattern: '{seq}-о/{YY}', template: 'VACATION_ORDER', route: 'order', esutdRequired: false },
  { code: 'UNPAID_LEAVE_APPLICATION', name: 'Заявление на отпуск без сохранения з/п', nameKk: 'Жалақы сақталмайтын демалысқа өтініш', kind: 'APPLICATION', numberPattern: '{seq}-з/{YY}', template: 'UNPAID_LEAVE_APPLICATION', route: 'application', esutdRequired: false },
  { code: 'UNPAID_LEAVE_ORDER', name: 'Приказ об отпуске без сохранения з/п', nameKk: 'Жалақы сақталмайтын демалыс туралы бұйрық', kind: 'ORDER', numberPattern: '{seq}-о/{YY}', template: 'UNPAID_LEAVE_ORDER', route: 'order', esutdRequired: true },
  { code: 'BUSINESS_TRIP_APPLICATION', name: 'Заявление на командировку', nameKk: 'Іссапарға өтініш', kind: 'APPLICATION', numberPattern: '{seq}-з/{YY}', template: 'BUSINESS_TRIP_APPLICATION', route: 'application', esutdRequired: false },
  { code: 'BUSINESS_TRIP_ORDER', name: 'Приказ о командировке', nameKk: 'Іссапар туралы бұйрық', kind: 'ORDER', numberPattern: '{seq}-ком/{YY}', template: 'BUSINESS_TRIP_ORDER', route: 'order', esutdRequired: false },
  { code: 'VND', name: 'Внутренний нормативный документ', nameKk: 'Ішкі нормативтік құжат', kind: 'VND', numberPattern: 'ВНД-{seq}/{YY}', template: null, route: null, esutdRequired: false },
  { code: 'ARCHIVE', name: 'Архивный документ', nameKk: 'Мұрағаттық құжат', kind: 'ARCHIVE', numberPattern: 'А-{seq}/{YYYY}', template: null, route: null, esutdRequired: false },
];

/**
 * Returns the tenant's document type by code, creating it (with its default template and route)
 * from the built-in definition when missing. Template/route rows are reused by name when present.
 */
export async function ensureDocumentType(tenantId: string, code: string, tx: Tx = prisma) {
  const existing = await tx.documentType.findUnique({ where: { tenantId_code: { tenantId, code } } });
  if (existing) return existing;
  const def = DEFAULT_TYPES.find((t) => t.code === code);
  if (!def) throw new Error(`Unknown built-in document type ${code}`);
  let templateId: string | null = null;
  if (def.template) {
    const tpl = DEFAULT_TEMPLATES[def.template]!;
    templateId = (await tx.documentTemplate.findFirst({ where: { tenantId, name: tpl.name } }))?.id
      ?? (await tx.documentTemplate.create({ data: { tenantId, name: tpl.name, body: tpl.body } })).id;
  }
  let routeTemplateId: string | null = null;
  if (def.route) {
    const route = DEFAULT_ROUTES[def.route];
    routeTemplateId = (await tx.routeTemplate.findFirst({ where: { tenantId, name: route.name } }))?.id
      ?? (await tx.routeTemplate.create({ data: { tenantId, name: route.name, steps: route.steps } })).id;
  }
  return tx.documentType.upsert({
    where: { tenantId_code: { tenantId, code } },
    create: {
      tenantId, code, name: def.name, nameKk: def.nameKk, kind: def.kind, numberPattern: def.numberPattern,
      templateId, routeTemplateId, esutdRequired: def.esutdRequired,
    },
    update: {},
  });
}
