import type { PrismaClient, Role } from '@prisma/client';
import { API_KEY_SCOPES, permissionsForRoles } from '@akere/shared';
import type { UserCtx } from '../../src/lib/auth';
import { sha256 } from '../../src/lib/crypto';
import { PdfBuilder, type Block } from '../../src/lib/pdf';
import { inTx, signAndComplete } from '../../src/modules/documents/route-engine';
import { generateSignedPdf } from '../../src/modules/documents/render';
import { addRecipients, createVnd, sendVnd, syncAcknowledgments } from '../../src/modules/vnd/service';
import { backfillSubmissions } from '../../src/modules/esutd/service';
import { createArchiveDocument } from '../../src/modules/archive/routes';
import { createApiKey } from '../../src/modules/api-keys/service';

type People = Record<string, { userId: string; employeeId: string }>;
type Ctx = {
  tenantId: string;
  legalEntities: { dala: string; altyn: string };
  departments: Record<string, string>;
  people: People;
  documentTypes: Record<string, string>;
  documents: { contracts: Record<string, string> };
};

const DAY = 86_400_000;
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY);
const at = (s: string) => new Date(s);

/** Staff session context built from the DB roles (the services take a UserCtx). */
async function userCtx(prisma: PrismaClient, userId: string): Promise<UserCtx> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { roles: true, employee: { select: { id: true } } } });
  const roles = [...new Set(u.roles.map((r) => r.role))] as Role[];
  return {
    kind: 'user', sessionId: 'seed', userId: u.id, tenantId: u.tenantId, roles,
    grants: u.roles.map((r) => ({ role: r.role, legalEntityId: r.legalEntityId, canSign: r.canSign })),
    permissions: permissionsForRoles(roles), employeeId: u.employee?.id ?? null, locale: u.locale, pending2fa: false,
  };
}

type Section = { heading: string; paragraphs: string[] };

async function regulationPdf(opts: { title: string; company: string; approvedBy: string; approvedAt: string; preamble: string; sections: Section[] }) {
  const pdf = await PdfBuilder.create({ title: opts.title, footer: `${opts.company} · ${opts.title}` });
  const blocks: Block[] = [
    { type: 'paragraph', text: `УТВЕРЖДЕНО\nприказом ${opts.approvedBy}\nот ${opts.approvedAt}`, align: 'right', size: 9 },
    { type: 'spacer', height: 12 },
    { type: 'heading', text: opts.title.toUpperCase(), align: 'center' },
    { type: 'paragraph', text: opts.company, align: 'center' },
    { type: 'spacer' },
    { type: 'paragraph', text: opts.preamble },
  ];
  opts.sections.forEach((s, i) => {
    blocks.push({ type: 'heading', text: `${i + 1}. ${s.heading}`, size: 12 });
    s.paragraphs.forEach((p, j) => blocks.push({ type: 'paragraph', text: `${i + 1}.${j + 1}. ${p}` }));
  });
  blocks.push({ type: 'spacer' }, { type: 'signatures', parties: [{ label: 'Руководитель', name: opts.approvedBy.replace(/^генерального директора |^директора /, '') }] });
  await pdf.add(blocks);
  return pdf.bytes();
}

const DALA = 'ТОО «Dala Tech»';
const ALTYN = 'ТОО «Алтын Логистик»';

const PVTR: Section[] = [
  { heading: 'Общие положения', paragraphs: [
    'Настоящие Правила разработаны в соответствии с Трудовым кодексом Республики Казахстан и определяют трудовой распорядок в Товариществе.',
    'Правила обязательны для всех работников, заключивших трудовой договор с Товариществом, независимо от занимаемой должности.',
    'Работник знакомится с Правилами при приёме на работу до подписания трудового договора и при каждом их изменении.',
  ] },
  { heading: 'Порядок приёма и увольнения', paragraphs: [
    'Приём на работу оформляется трудовым договором и приказом работодателя, которые подписываются электронной цифровой подписью в системе Akere HR.',
    'Сведения о заключении и прекращении трудового договора вносятся в Единую систему учёта трудовых договоров в установленный законодательством срок.',
    'При расторжении трудового договора по инициативе работника он письменно предупреждает работодателя не менее чем за один месяц.',
  ] },
  { heading: 'Рабочее время и время отдыха', paragraphs: [
    'Для работников устанавливается пятидневная рабочая неделя продолжительностью 40 часов с двумя выходными днями — суббота и воскресенье.',
    'Начало рабочего дня — 09:00, окончание — 18:00, перерыв для отдыха и приёма пищи — с 13:00 до 14:00.',
    'Учёт рабочего времени ведётся в электронной форме: работник отмечает приход и уход в мобильном приложении Akere HR.',
    'Ежегодный оплачиваемый трудовой отпуск предоставляется продолжительностью 24 календарных дня по графику отпусков.',
  ] },
  { heading: 'Права и обязанности сторон', paragraphs: [
    'Работник обязан добросовестно выполнять трудовые обязанности, соблюдать трудовую дисциплину, требования по охране труда и сохранять коммерческую тайну.',
    'Работодатель обязан обеспечивать безопасные условия труда, своевременно и в полном объёме выплачивать заработную плату.',
  ] },
  { heading: 'Поощрения и дисциплинарная ответственность', paragraphs: [
    'За добросовестное выполнение обязанностей применяются поощрения: объявление благодарности, премирование, награждение ценным подарком.',
    'За нарушение трудовой дисциплины могут быть применены дисциплинарные взыскания: замечание, выговор, строгий выговор, расторжение трудового договора.',
  ] },
];

const SAFETY: Section[] = [
  { heading: 'Общие требования охраны труда', paragraphs: [
    'К работе допускаются лица, прошедшие вводный инструктаж, инструктаж на рабочем месте и проверку знаний по безопасности и охране труда.',
    'Работник обязан соблюдать требования настоящей инструкции, правила пожарной безопасности и электробезопасности.',
    'Рабочее место с персональным компьютером должно соответствовать санитарным правилам: освещённость не ниже 300 люкс, расстояние до экрана 60–70 см.',
  ] },
  { heading: 'Требования перед началом работы', paragraphs: [
    'Осмотреть рабочее место, убедиться в исправности оборудования, электропроводки, розеток и удлинителей.',
    'Отрегулировать высоту кресла и положение монитора; убрать с рабочего места посторонние предметы.',
  ] },
  { heading: 'Требования во время работы', paragraphs: [
    'При работе за компьютером делать перерывы по 10–15 минут через каждые 1,5–2 часа работы.',
    'Запрещается самостоятельно вскрывать и ремонтировать оргтехнику, оставлять включённые электроприборы без присмотра.',
    'Работники склада обязаны работать в спецодежде и защитной обуви, соблюдать нормы подъёма тяжестей: для мужчин — до 30 кг, для женщин — до 10 кг.',
  ] },
  { heading: 'Требования в аварийных ситуациях', paragraphs: [
    'При возгорании немедленно сообщить по телефону 101, отключить электропитание, приступить к тушению первичными средствами и эвакуироваться по плану эвакуации.',
    'При несчастном случае оказать первую помощь пострадавшему, вызвать скорую помощь по телефону 103 и сообщить непосредственному руководителю.',
  ] },
  { heading: 'Требования по окончании работы', paragraphs: [
    'Выключить оборудование, привести рабочее место в порядок, закрыть окна.',
    'Обо всех неисправностях, обнаруженных в течение рабочего дня, сообщить ответственному за охрану труда.',
  ] },
];

const PAY: Section[] = [
  { heading: 'Общие положения', paragraphs: [
    'Положение устанавливает систему оплаты труда, порядок и сроки выплаты заработной платы, условия премирования работников.',
    'Заработная плата выплачивается в национальной валюте — тенге — путём перечисления на банковский счёт работника.',
  ] },
  { heading: 'Должностные оклады', paragraphs: [
    'Размер должностного оклада устанавливается трудовым договором в соответствии со штатным расписанием и не может быть ниже минимального размера заработной платы.',
    'Пересмотр окладов проводится не реже одного раза в год по результатам оценки эффективности работников.',
  ] },
  { heading: 'Сроки выплаты', paragraphs: [
    'Заработная плата выплачивается не реже одного раза в месяц, не позднее 10 числа месяца, следующего за отработанным.',
    'Работнику ежемесячно направляется расчётный листок с указанием составных частей заработной платы и удержаний.',
  ] },
  { heading: 'Доплаты и компенсации', paragraphs: [
    'Работа в выходные и праздничные дни оплачивается не менее чем в двойном размере.',
    'Сверхурочная работа оплачивается не менее чем в полуторном размере; работа в ночное время — с доплатой 50 % часовой ставки.',
  ] },
  { heading: 'Премирование', paragraphs: [
    'По итогам квартала работникам может выплачиваться премия до 30 % от суммы окладов за квартал при выполнении ключевых показателей.',
    'Премия не начисляется работникам, имеющим неснятое дисциплинарное взыскание.',
  ] },
];

const PRIVACY: Section[] = [
  { heading: 'Цели и правовые основания', paragraphs: [
    'Политика разработана в соответствии с Законом Республики Казахстан «О персональных данных и их защите» и определяет порядок сбора, обработки и защиты персональных данных.',
    'Персональные данные работников и кандидатов обрабатываются для исполнения трудового договора, ведения кадрового учёта и исполнения требований законодательства.',
  ] },
  { heading: 'Состав персональных данных', paragraphs: [
    'Обрабатываются: фамилия, имя, отчество, ИИН, дата рождения, данные документа, удостоверяющего личность, адрес, контактные данные, сведения об образовании, банковские реквизиты.',
  ] },
  { heading: 'Меры защиты', paragraphs: [
    'Доступ к персональным данным предоставляется только работникам, которым он необходим для выполнения обязанностей, и ограничивается ролью в системе Akere HR.',
    'Все действия с персональными данными фиксируются в журнале аудита; хранение осуществляется на серверах, расположенных в Республике Казахстан.',
  ] },
  { heading: 'Права субъекта персональных данных', paragraphs: [
    'Субъект вправе знать о наличии у работодателя своих персональных данных, требовать их изменения и дополнения, отозвать согласие на обработку в случаях, предусмотренных законом.',
  ] },
];

const ETHICS: Section[] = [
  { heading: 'Наши ценности', paragraphs: [
    'Честность, уважение к людям, ответственность за результат и безопасность — основа нашей работы с клиентами, партнёрами и коллегами.',
  ] },
  { heading: 'Конфликт интересов', paragraphs: [
    'Работник обязан сообщать руководителю о ситуациях, при которых личная заинтересованность может повлиять на исполнение обязанностей.',
    'Запрещается получать подарки от поставщиков и клиентов стоимостью свыше 2 МРП.',
  ] },
  { heading: 'Противодействие коррупции', paragraphs: [
    'Компания не допускает дачу и получение взяток, коммерческий подкуп и иные коррупционные правонарушения в любой форме.',
    'О ставших известными фактах коррупции работник может сообщить на горячую линию анонимно.',
  ] },
  { heading: 'Отношения в коллективе', paragraphs: [
    'Недопустимы дискриминация, оскорбления и домогательства. Каждый работник вправе рассчитывать на уважительное отношение.',
  ] },
];

/**
 * Phase 5 seed: ВНД with realistic texts and ЭЦП acknowledgments, the ЕСУТД registry, archive documents and the 1С API key.
 */
export async function seedP5(prisma: PrismaClient, ctx: Ctx) {
  const { tenantId, people: P, departments: D } = ctx;
  const LE = ctx.legalEntities;
  const hr = await userCtx(prisma, P.hr!.userId);
  const hr2 = await userCtx(prisma, P.hr2!.userId);

  async function vnd(u: UserCtx, o: { title: string; legalEntityId: string; company: string; approvedBy: string; approvedAt: string; preamble: string; sections: Section[]; fileName: string; dueInDays?: number }) {
    const bytes = await regulationPdf(o);
    return createVnd(u, {
      title: o.title, legalEntityId: o.legalEntityId, requireSignature: true, dueAt: o.dueInDays !== undefined ? daysFromNow(o.dueInDays) : null,
      file: { filename: o.fileName, buffer: bytes },
    });
  }

  async function acknowledge(docId: string, userId: string) {
    await inTx((tx) => signAndComplete(tx, { documentId: docId, actorUserId: userId, method: 'EGOV_MOBILE', actions: ['ACKNOWLEDGE'], principalIds: [] }));
  }

  /** Moves the ВНД into the past: creation/sending dates, number date and acknowledgment times spread over the following days. */
  async function age(docId: string, sentAt: Date) {
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: docId } });
    const steps = await prisma.routeStep.findMany({ where: { documentId: docId, status: 'DONE' }, orderBy: { id: 'asc' } });
    let last = sentAt.getTime();
    for (const [i, s] of steps.entries()) {
      const t = sentAt.getTime() + (2 + ((i * 7919) % 70)) * 3_600_000 + (i % 5) * 1_380_000;
      last = Math.max(last, t);
      await prisma.routeStep.update({ where: { id: s.id }, data: { actedAt: new Date(t), viewedAt: new Date(t - 900_000) } });
      await prisma.signature.updateMany({ where: { routeStepId: s.id }, data: { signedAt: new Date(t) } });
    }
    await prisma.vndRecipient.updateMany({ where: { documentId: docId }, data: { sentAt } });
    await prisma.vndRecipient.updateMany({ where: { documentId: docId, status: 'ACKNOWLEDGED' }, data: { status: 'PENDING', acknowledgedAt: null, signatureId: null } });
    await syncAcknowledgments(prisma, { documentId: docId });
    await prisma.document.update({
      where: { id: docId },
      data: {
        createdAt: new Date(sentAt.getTime() - 2 * DAY), registeredAt: new Date(`${sentAt.toISOString().slice(0, 10)}T00:00:00Z`), backdated: false,
        data: { ...(doc.data as object), sentAt: sentAt.toISOString() },
        ...(doc.status === 'COMPLETED' ? { completedAt: new Date(last), updatedAt: new Date(last) } : {}),
      },
    });
    if (doc.status === 'COMPLETED') await inTx((tx) => generateSignedPdf(docId, tx));
  }

  const dalaRecipients = async (id: string) => addRecipients(hr, id, { allOfLegalEntity: true });

  // 1. Правила внутреннего трудового распорядка — everyone in Dala Tech acknowledged.
  const pvtr = await vnd(hr, {
    title: 'Правила внутреннего трудового распорядка', legalEntityId: LE.dala, company: DALA, approvedBy: 'генерального директора Байсарина Т.Е.', approvedAt: '12.01.2026 № 3-ОД',
    preamble: 'Правила внутреннего трудового распорядка регулируют порядок приёма и увольнения работников, основные права и обязанности сторон трудового договора, режим рабочего времени и времени отдыха, меры поощрения и взыскания.',
    sections: PVTR, fileName: 'Правила_внутреннего_трудового_распорядка_2026.pdf',
  });
  await dalaRecipients(pvtr);
  await sendVnd(hr, pvtr);
  for (const r of await prisma.vndRecipient.findMany({ where: { documentId: pvtr }, include: { employee: { select: { userId: true } } } })) await acknowledge(pvtr, r.employee.userId);
  await age(pvtr, at('2026-01-15T05:30:00Z'));

  // 2. Кодекс деловой этики — Алтын Логистик, completed.
  const ethics = await vnd(hr2, {
    title: 'Кодекс деловой этики', legalEntityId: LE.altyn, company: ALTYN, approvedBy: 'директора Омарова Б.А.', approvedAt: '27.02.2026 № 11-ОД',
    preamble: 'Кодекс устанавливает единые для всех работников стандарты делового поведения и этические принципы, которыми мы руководствуемся в работе.',
    sections: ETHICS, fileName: 'Кодекс_деловой_этики.pdf',
  });
  await addRecipients(hr2, ethics, { allOfLegalEntity: true });
  await sendVnd(hr2, ethics);
  for (const r of await prisma.vndRecipient.findMany({ where: { documentId: ethics }, include: { employee: { select: { userId: true } } } })) await acknowledge(ethics, r.employee.userId);
  await age(ethics, at('2026-03-02T04:00:00Z'));

  // 3. Инструкция по охране труда — development, sales and support; about half acknowledged, dev1 still pending.
  const safety = await vnd(hr, {
    title: 'Инструкция по охране труда и технике безопасности', legalEntityId: LE.dala, company: DALA, approvedBy: 'генерального директора Байсарина Т.Е.', approvedAt: '22.09.2026 № 41-ОД',
    preamble: 'Инструкция устанавливает требования безопасности и охраны труда для работников офиса и склада при выполнении трудовых обязанностей.',
    sections: SAFETY, fileName: 'Инструкция_по_ОТ_и_ТБ.pdf', dueInDays: 5,
  });
  await addRecipients(hr, safety, { departmentIds: [D.dev!, D.sales!, D.support!, D.mgmt!] });
  await sendVnd(hr, safety);
  {
    const rows = await prisma.vndRecipient.findMany({ where: { documentId: safety }, include: { employee: { select: { userId: true } } }, orderBy: { id: 'asc' } });
    const keep = new Set([P.dev1!.userId, P.ceo!.userId]);
    const ackers = rows.filter((r) => !keep.has(r.employee.userId)).slice(0, Math.floor(rows.length / 2));
    for (const r of ackers) await acknowledge(safety, r.employee.userId);
  }
  await age(safety, daysFromNow(-9));
  await prisma.documentComment.createMany({
    data: [
      { documentId: safety, authorId: P.hr!.userId, text: 'Коллеги, просьба ознакомиться до конца недели — в пятницу проверка Госинспекции труда.', createdAt: daysFromNow(-8) },
      { documentId: safety, authorId: P.saleslead!.userId, text: 'Отдел продаж на выездах до среды, ознакомимся после возвращения.', createdAt: daysFromNow(-7) },
    ],
  });

  // 4. Положение об оплате труда — all of Dala Tech, sent three days ago, a few acknowledgments.
  const pay = await vnd(hr, {
    title: 'Положение об оплате труда', legalEntityId: LE.dala, company: DALA, approvedBy: 'генерального директора Байсарина Т.Е.', approvedAt: '01.10.2026 № 44-ОД',
    preamble: 'Положение разработано в соответствии с главой 6 Трудового кодекса Республики Казахстан и определяет условия и порядок оплаты труда работников.',
    sections: PAY, fileName: 'Положение_об_оплате_труда.pdf', dueInDays: 11,
  });
  await dalaRecipients(pay);
  await sendVnd(hr, pay);
  for (const key of ['ceo', 'admin', 'accountant', 'saleslead', 'staff16']) await acknowledge(pay, P[key]!.userId);
  await age(pay, daysFromNow(-3));
  await prisma.documentComment.create({ data: { documentId: pay, authorId: P.accountant!.userId, text: 'Сроки выплаты согласованы с бухгалтерией.', createdAt: daysFromNow(-2) } });

  // 5. Политика защиты персональных данных — draft with recipients, not sent yet.
  const privacy = await vnd(hr, {
    title: 'Политика защиты персональных данных', legalEntityId: LE.dala, company: DALA, approvedBy: 'генерального директора Байсарина Т.Е.', approvedAt: '05.10.2026 № 46-ОД',
    preamble: 'Политика определяет принципы и порядок обработки персональных данных работников, кандидатов и контрагентов, а также меры по их защите.',
    sections: PRIVACY, fileName: 'Политика_защиты_ПД.pdf', dueInDays: 14,
  });
  await dalaRecipients(privacy);
  await prisma.document.update({ where: { id: privacy }, data: { createdAt: daysFromNow(-1) } });

  // Only notifications about acknowledgments still pending stay unread.
  const pendingRecipients = await prisma.vndRecipient.findMany({ where: { status: 'PENDING', document: { tenantId, status: 'IN_ROUTE' } }, include: { employee: { select: { userId: true } } } });
  await prisma.notification.updateMany({ where: { tenantId, type: { in: ['vnd.pending', 'document.completed'] }, readAt: null }, data: { readAt: new Date() } });
  for (const r of pendingRecipients) {
    await prisma.notification.updateMany({ where: { userId: r.employee.userId, type: 'vnd.pending', link: `/vnd/${r.documentId}` }, data: { readAt: null } });
  }

  // ── ЕСУТД: completed contracts — most sent, a few waiting, one error ──
  await backfillSubmissions(tenantId);
  const subs = await prisma.esutdSubmission.findMany({ where: { tenantId }, include: { document: { select: { id: true, completedAt: true, registeredAt: true } } }, orderBy: { document: { registeredAt: 'asc' } } });
  for (const [i, s] of subs.entries()) {
    const base = s.document.completedAt ?? s.document.registeredAt ?? new Date();
    if (i < subs.length - 5) {
      const sentAt = new Date(base.getTime() + (20 + (i % 4) * 7) * 3_600_000);
      await prisma.esutdSubmission.update({
        where: { id: s.id },
        data: { status: 'SENT', sentAt, attempts: 1, externalId: `ESUTD-${sentAt.getUTCFullYear()}-${sha256(`seed:${s.documentId}`).slice(0, 10).toUpperCase()}` },
      });
    } else if (i === subs.length - 5) {
      await prisma.esutdSubmission.update({
        where: { id: s.id },
        data: { status: 'ERROR', attempts: 1, error: 'ЕСУТД: работник с указанным ИИН не найден в ГБД ФЛ. Проверьте ИИН и повторите отправку.' },
      });
    }
  }

  // ── Electronic archive: three more paper originals ──
  const archive: string[] = [];
  for (const [key, typeCode, title, number, date] of [
    ['staff16', 'SUPPLEMENTARY_AGREEMENT', 'Дополнительное соглашение к трудовому договору (бумажный оригинал)', 'ДС-3/2020', '2020-06-01'],
    ['staff13', 'VACATION_ORDER', 'Приказ о предоставлении ежегодного отпуска (бумажный оригинал)', '45-о/21', '2021-07-12'],
    ['accountant', 'ARCHIVE', 'Личная карточка работника формы Т-2 (скан)', 'Т2-118', '2019-08-05'],
  ] as const) {
    const pdf = await PdfBuilder.create({ title, footer: `Akere HR · электронный архив · ${number}` });
    await pdf.add([
      { type: 'heading', text: title, align: 'center' },
      { type: 'paragraph', text: `№ ${number} от ${date.split('-').reverse().join('.')}`, align: 'center' },
      { type: 'banner', text: 'Скан бумажного оригинала, внесён в электронный архив', color: 'gray' },
      { type: 'paragraph', text: 'Оригинал документа хранится в архиве отдела кадров ТОО «Dala Tech» (г. Астана, пр. Мәңгілік Ел, 55/20), шкаф 2, дело № 14.' },
    ]);
    archive.push(await createArchiveDocument(hr, {
      documentTypeId: ctx.documentTypes[typeCode]!, legalEntityId: LE.dala, title, number, registeredAt: date, subjectEmployeeId: P[key]!.employeeId,
    }, { field: 'files', filename: `${number.replace(/\//g, '-')}.pdf`, buffer: await pdf.bytes() }));
  }

  // ── Public API key for the 1С integration (plaintext shown once, here) ──
  const { row: apiKey, key } = await createApiKey(prisma, { tenantId, name: '1С:ЗУП интеграция', scopes: [...API_KEY_SCOPES], createdById: P.admin!.userId });
  await prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: daysFromNow(-1), createdAt: daysFromNow(-40) } });
  console.log(`  API key «1С:ЗУП интеграция»: ${key}`);

  return { vnd: { pvtr, ethics, safety, pay, privacy }, archiveP5: archive, apiKeyId: apiKey.id };
}
