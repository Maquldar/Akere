import type { CandidateCheck, CandidateStatus, ContactChannel, DocRequestStatus, Gender, InvitationStatus, PrismaClient } from '@prisma/client';
import { FEMALE, MALE, makeIin, pick, rng, translit } from './kz';
import type { OrgCtx } from './org';
import { ensurePersonalDocCatalog } from '../../src/modules/onboarding/service';
import { applyAutofill } from '../../src/modules/candidates/autofill';
import { docCompleteness } from '../../src/modules/candidates/service';
import { decodeIin } from '../../src/adapters/personal-file';

type Stage = 'NEW' | 'SENT' | 'OPENED' | 'FILLING' | 'UPLOADED' | 'RETURNED' | 'ACCEPTED' | 'EXPORTED' | 'BLOCKED' | 'BLOCKED_EARLY';

const BANKS = [
  { bank: 'АО «Kaspi Bank»', code: '722', bic: 'CASPKZKA' },
  { bank: 'АО «Народный Банк Казахстана»', code: '601', bic: 'HSBKKZKX' },
  { bank: 'АО «ForteBank»', code: '965', bic: 'IRTYKZKA' },
  { bank: 'АО «First Heartland Jusan Bank»', code: '998', bic: 'TSESKZKA' },
];

/** Valid KZ IBAN (ISO 13616 mod-97 check digits). */
function makeIban(bankCode: string, r: () => number) {
  const account = Array.from({ length: 13 }, () => Math.floor(r() * 10)).join('');
  const bban = `${bankCode}${account}`;
  const numeric = `${bban}KZ00`.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let mod = 0;
  for (const d of numeric) mod = (mod * 10 + Number(d)) % 97;
  return `KZ${String(98 - mod).padStart(2, '0')}${bban}`;
}

const daysAgo = (n: number, h = 10) => new Date(Date.now() - n * 86_400_000 + (h - 12) * 3_600_000);

export async function seedCandidates(prisma: PrismaClient, ctx: OrgCtx) {
  const r = rng(51151220);
  await ensurePersonalDocCatalog(prisma);
  const types = await prisma.personalDocType.findMany({ where: { tenantId: null } });
  const T = (code: string) => types.find((t) => t.code === code)!.id;
  const hr = ctx.people.hr!.userId;
  const hr2 = ctx.people.hr2!.userId;

  const questionnaire = await prisma.questionnaireTemplate.create({
    data: {
      tenantId: ctx.tenantId,
      name: 'Анкета кандидата',
      fields: [
        { key: 'maritalStatus', label: 'Семейное положение', labelKk: 'Отбасылық жағдайы', type: 'select', required: true, options: ['Холост / не замужем', 'Женат / замужем', 'Разведён(а)', 'Вдовец / вдова'] },
        { key: 'childrenCount', label: 'Количество детей', labelKk: 'Балалар саны', type: 'number', required: false },
        { key: 'emergencyContact', label: 'Контакт на случай ЧС (ФИО, телефон)', labelKk: 'Төтенше жағдайға байланыс', type: 'text', required: true },
        { key: 'languages', label: 'Владение языками', labelKk: 'Тілдерді меңгеруі', type: 'text', required: false },
        { key: 'source', label: 'Откуда узнали о вакансии', labelKk: 'Бос орын туралы қайдан білдіңіз', type: 'select', required: false, options: ['hh.kz', 'Enbek.kz', 'Рекомендация сотрудника', 'Сайт компании', 'Instagram / Telegram'] },
        { key: 'relatives', label: 'Родственники, работающие в компании', labelKk: 'Компанияда жұмыс істейтін туыстары', type: 'textarea', required: false },
        { key: 'personalDataConsent', label: 'Согласен(а) на сбор и обработку персональных данных', labelKk: 'Дербес деректерді жинауға және өңдеуге келісемін', type: 'checkbox', required: true },
      ],
    },
  });

  const tpl = async (name: string, items: [string, boolean, string[]?][], questionnaireTemplateId: string | null) =>
    prisma.requestTemplate.create({
      data: {
        tenantId: ctx.tenantId, name, questionnaireTemplateId,
        items: { create: items.map(([code, required, fieldKeys], i) => ({ personalDocTypeId: T(code), required, fieldKeys: fieldKeys ?? [], sortOrder: i })) },
      },
      include: { items: true },
    });
  const standard = await tpl('Стандартный пакет при приёме', [
    ['ID_CARD', true], ['ADDRESS', true], ['EDUCATION', true], ['WORK_HISTORY', false], ['MED_075', true], ['PHOTO', true], ['IBAN', true], ['MILITARY_ID', false], ['MARRIAGE_CERT', false], ['CHILD_BIRTH_CERT', false],
  ], questionnaire.id);
  const drivers = await tpl('Водители и склад', [
    ['ID_CARD', true], ['ADDRESS', true], ['DRIVER_LICENSE', true], ['MED_075', true], ['NARCO_DISPENSARY', true], ['PSYCHO_DISPENSARY', true], ['TB_DISPENSARY', true], ['NO_CRIMINAL_RECORD', true], ['PHOTO', true], ['IBAN', true],
  ], questionnaire.id);
  const minimal = await tpl('Минимальный', [
    ['ID_CARD', true, ['iin', 'lastName', 'firstName', 'middleName', 'birthDate', 'docNumber', 'issueDate', 'expiryDate']], ['ADDRESS', true], ['IBAN', true],
  ], null);

  const d = ctx.departments;
  const p = ctx.positions;
  const dala = ctx.legalEntities.dala;
  const altyn = ctx.legalEntities.altyn;
  type Spec = { stage: Stage; male: boolean; le: string; dept: string; pos: string; channels: ContactChannel[]; tags: string[]; tpl?: typeof standard; noIin?: boolean; check?: CandidateCheck; plannedIn?: number };
  const specs: Spec[] = [
    { stage: 'NEW', male: true, le: dala, dept: d.backend, pos: p['Backend-разработчик']!, channels: ['EMAIL'], tags: ['IT', 'Senior'] },
    { stage: 'NEW', male: false, le: dala, dept: d.sales, pos: p['Менеджер по продажам']!, channels: ['EMAIL', 'WHATSAPP'], tags: ['Продажи'] },
    { stage: 'NEW', male: true, le: altyn, dept: d.aWarehouse, pos: p['Кладовщик']!, channels: ['SMS'], tags: ['Склад'] },
    { stage: 'NEW', male: false, le: dala, dept: d.support, pos: p['Специалист поддержки']!, channels: ['WHATSAPP'], tags: ['Стажёр'] },
    { stage: 'NEW', male: true, le: dala, dept: d.frontend, pos: p['Frontend-разработчик']!, channels: ['EMAIL'], tags: ['IT', 'Иностранец'], noIin: true },
    { stage: 'SENT', male: false, le: dala, dept: d.dev, pos: p['QA-инженер']!, channels: ['EMAIL'], tags: ['IT'], tpl: standard },
    { stage: 'SENT', male: true, le: altyn, dept: d.aTransport, pos: p['Водитель-экспедитор']!, channels: ['SMS', 'WHATSAPP'], tags: ['Водители'], tpl: drivers },
    { stage: 'SENT', male: false, le: dala, dept: d.finance, pos: p['Бухгалтер']!, channels: ['EMAIL', 'SMS'], tags: [], tpl: standard },
    { stage: 'OPENED', male: true, le: dala, dept: d.sales, pos: p['Менеджер по продажам']!, channels: ['WHATSAPP'], tags: ['Продажи'], tpl: minimal },
    { stage: 'FILLING', male: true, le: altyn, dept: d.aWarehouse, pos: p['Кладовщик']!, channels: ['SMS'], tags: ['Склад'], tpl: drivers },
    { stage: 'FILLING', male: false, le: dala, dept: d.support, pos: p['Специалист поддержки']!, channels: ['EMAIL'], tags: [], tpl: standard },
    { stage: 'FILLING', male: true, le: dala, dept: d.backend, pos: p['Backend-разработчик']!, channels: ['EMAIL', 'WHATSAPP'], tags: ['IT', 'Middle'], tpl: standard },
    { stage: 'UPLOADED', male: false, le: dala, dept: d.frontend, pos: p['Frontend-разработчик']!, channels: ['EMAIL'], tags: ['IT'], tpl: standard, plannedIn: 14 },
    { stage: 'UPLOADED', male: true, le: altyn, dept: d.aTransport, pos: p['Водитель-экспедитор']!, channels: ['SMS'], tags: ['Водители'], tpl: drivers, plannedIn: 7 },
    { stage: 'UPLOADED', male: false, le: dala, dept: d.sales, pos: p['Менеджер по продажам']!, channels: ['EMAIL', 'SMS'], tags: ['Продажи'], tpl: standard, plannedIn: 10 },
    { stage: 'UPLOADED', male: true, le: dala, dept: d.dev, pos: p['Product Manager']!, channels: ['EMAIL'], tags: ['IT'], tpl: minimal, plannedIn: 21 },
    { stage: 'RETURNED', male: false, le: dala, dept: d.support, pos: p['Специалист поддержки']!, channels: ['WHATSAPP'], tags: [], tpl: standard },
    { stage: 'RETURNED', male: true, le: altyn, dept: d.aWarehouse, pos: p['Кладовщик']!, channels: ['SMS'], tags: ['Склад'], tpl: drivers },
    { stage: 'ACCEPTED', male: true, le: dala, dept: d.backend, pos: p['Backend-разработчик']!, channels: ['EMAIL'], tags: ['IT', 'Senior'], tpl: standard, check: 'RECOMMENDED', plannedIn: 5 },
    { stage: 'ACCEPTED', male: false, le: dala, dept: d.finance, pos: p['Бухгалтер']!, channels: ['EMAIL', 'SMS'], tags: [], tpl: standard, check: 'CONDITIONAL', plannedIn: 12 },
    { stage: 'ACCEPTED', male: true, le: altyn, dept: d.aTransport, pos: p['Водитель-экспедитор']!, channels: ['SMS', 'WHATSAPP'], tags: ['Водители'], tpl: drivers, check: 'RECOMMENDED', plannedIn: 3 },
    { stage: 'EXPORTED', male: false, le: dala, dept: d.mgmt, pos: p['Офис-менеджер']!, channels: ['EMAIL'], tags: ['1С'], tpl: standard, check: 'RECOMMENDED', plannedIn: 2 },
    { stage: 'BLOCKED', male: true, le: altyn, dept: d.aTransport, pos: p['Водитель-экспедитор']!, channels: ['SMS'], tags: ['Водители'], tpl: drivers, check: 'NOT_RECOMMENDED' },
    { stage: 'BLOCKED_EARLY', male: false, le: dala, dept: d.sales, pos: p['Менеджер по продажам']!, channels: ['EMAIL'], tags: ['Продажи'], check: 'NONE' },
    { stage: 'SENT', male: true, le: dala, dept: d.support, pos: p['Специалист поддержки']!, channels: ['EMAIL', 'SMS', 'WHATSAPP'], tags: ['Стажёр'], tpl: minimal },
  ];

  const used = new Set<string>();
  const ids: Record<string, string> = {};
  let serial = 7000;
  for (const [i, s] of specs.entries()) {
    const pool = s.male ? MALE : FEMALE;
    let first = '';
    let last = '';
    do {
      first = pick(r, pool.first);
      last = pick(r, pool.last);
    } while (used.has(first + last));
    used.add(first + last);
    const middle = s.noIin ? null : pick(r, pool.middle);
    const birth = new Date(Date.UTC(1984 + Math.floor(r() * 17), Math.floor(r() * 12), 1 + Math.floor(r() * 27)));
    const iin = s.noIin ? null : makeIin(birth, s.male, serial++);
    const gender: Gender = s.male ? 'MALE' : 'FEMALE';
    const email = s.channels.includes('EMAIL') || r() < 0.4 ? `${translit(first)}.${translit(last)}${i}@${pick(r, ['gmail.com', 'mail.ru', 'mail.kz', 'yandex.kz'])}` : null;
    const phone = s.channels.some((c) => c !== 'EMAIL') || r() < 0.5 ? `+77${pick(r, ['01', '02', '05', '07', '47', '75', '77'])}${String(1000000 + Math.floor(r() * 8999999))}` : null;
    const responsibleUserId = s.le === altyn ? hr2 : hr;
    const createdAt = daysAgo(30 - i, 9 + (i % 8));

    const statusMap: Record<Stage, [CandidateStatus, InvitationStatus, DocRequestStatus, CandidateCheck]> = {
      NEW: ['NEW', 'NONE', 'NONE', 'NONE'],
      SENT: ['IN_PROGRESS', 'SENT', 'SENT', 'NONE'],
      OPENED: ['IN_PROGRESS', 'ACCEPTED', 'SENT', 'NONE'],
      FILLING: ['IN_PROGRESS', 'ACCEPTED', 'FILLING', 'NONE'],
      UPLOADED: ['IN_PROGRESS', 'ACCEPTED', 'UPLOADED', 'ON_REVIEW'],
      RETURNED: ['IN_PROGRESS', 'ACCEPTED', 'RETURNED', 'ON_REVIEW'],
      ACCEPTED: ['ACCEPTED', 'ACCEPTED', 'COMPLETED', s.check ?? 'RECOMMENDED'],
      EXPORTED: ['EXPORTED', 'ACCEPTED', 'COMPLETED', s.check ?? 'RECOMMENDED'],
      BLOCKED: ['BLOCKED', 'ACCEPTED', 'UPLOADED', s.check ?? 'NOT_RECOMMENDED'],
      BLOCKED_EARLY: ['BLOCKED', 'NONE', 'NONE', 'NONE'],
    };
    const [status, invitationStatus, docRequestStatus, checkStatus] = statusMap[s.stage];
    const c = await prisma.candidate.create({
      data: {
        tenantId: ctx.tenantId, legalEntityId: s.le, departmentId: s.dept, positionId: s.pos, lastName: last, firstName: first, middleName: middle,
        iin, noIin: !!s.noIin, birthDate: iin ? new Date(`${decodeIin(iin)!.birthDate}T00:00:00Z`) : birth, gender, channels: s.channels, email, phone,
        tags: s.tags, responsibleUserId, status, invitationStatus, docRequestStatus, checkStatus,
        plannedHireDate: s.plannedIn ? new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + s.plannedIn)) : null,
        comment: s.noIin ? 'Гражданин Узбекистана, документы — паспорт иностранного гражданина и вид на жительство.' : null,
        createdAt,
      },
    });
    ids[`${s.stage.toLowerCase()}${i}`] = c.id;

    if (s.tpl) {
      const sentAt = new Date(createdAt.getTime() + 3 * 3_600_000);
      const req = await prisma.documentRequest.create({
        data: {
          tenantId: ctx.tenantId, candidateId: c.id, requestTemplateId: s.tpl.id, sentById: responsibleUserId, status: docRequestStatus === 'NONE' ? 'SENT' : docRequestStatus,
          createdAt: sentAt,
          documents: { create: s.tpl.items.map((it) => ({ personalDocTypeId: it.personalDocTypeId, required: it.required, fieldKeys: it.fieldKeys ?? [] })) },
        },
      });
      const filledStages: Stage[] = ['FILLING', 'UPLOADED', 'RETURNED', 'ACCEPTED', 'EXPORTED', 'BLOCKED'];
      if (filledStages.includes(s.stage)) {
        const autofill = s.stage !== 'FILLING' || i % 2 === 0;
        if (autofill && iin) {
          await applyAutofill(req.id);
          await prisma.documentRequest.update({ where: { id: req.id }, data: { consentStatus: 'GRANTED', consentAt: new Date(sentAt.getTime() + 86_400_000) } });
        } else {
          const addr = await prisma.candidateDocument.findFirst({ where: { documentRequestId: req.id, personalDocTypeId: T('ADDRESS') } });
          if (addr) {
            await prisma.candidateDocument.update({
              where: { id: addr.id },
              data: { values: { country: 'Казахстан', region: 'г. Алматы', city: 'Алматы', street: 'ул. Жандосова', building: String(10 + i), apartment: String(5 + i) }, status: 'FILLED' },
            });
          }
        }
        if (s.stage !== 'FILLING') {
          // Manual parts the government service doesn't provide.
          const bank = pick(r, BANKS);
          const docs = await prisma.candidateDocument.findMany({ where: { documentRequestId: req.id }, include: { docType: true, files: true } });
          for (const doc of docs) {
            if (doc.docType.code === 'IBAN') {
              await prisma.candidateDocument.update({ where: { id: doc.id }, data: { values: { bank: bank.bank, iban: makeIban(bank.code, r), bic: bank.bic } } });
            }
            if (doc.docType.code === 'DRIVER_LICENSE' && !docCompleteness(doc).complete) {
              await prisma.candidateDocument.update({ where: { id: doc.id }, data: { values: { docNumber: `KZ ${100000 + Math.floor(r() * 899999)}`, categories: 'B, C, CE', issueDate: '2019-04-16', expiryDate: '2029-04-15' } } });
            }
          }
          const answers = {
            maritalStatus: pick(r, ['Холост / не замужем', 'Женат / замужем']), childrenCount: Math.floor(r() * 3),
            emergencyContact: `${pick(r, FEMALE.last)} ${pick(r, FEMALE.first)}, +7701${String(1000000 + Math.floor(r() * 8999999))}`,
            languages: 'Казахский, русский' + (r() < 0.5 ? ', английский (B2)' : ''), source: pick(r, ['hh.kz', 'Enbek.kz', 'Рекомендация сотрудника', 'Сайт компании']),
            personalDataConsent: true,
          };
          const finalDocs = await prisma.candidateDocument.findMany({ where: { documentRequestId: req.id }, include: { docType: true, files: true } });
          const readyAt = new Date(sentAt.getTime() + 2 * 86_400_000);
          for (const doc of finalDocs) {
            const complete = docCompleteness(doc).complete;
            const st = ['ACCEPTED', 'EXPORTED'].includes(s.stage) ? 'ACCEPTED' : complete ? 'FILLED' : 'PENDING';
            await prisma.candidateDocument.update({ where: { id: doc.id }, data: { status: st } });
          }
          let reviewComment: string | null = null;
          if (s.stage === 'RETURNED') {
            reviewComment = 'Фото нечитаемое, загрузите, пожалуйста, фото 3×4 на светлом фоне. Проверьте адрес регистрации.';
            const toReturn = finalDocs.filter((x) => ['PHOTO', 'ADDRESS'].includes(x.docType.code)).map((x) => x.id);
            await prisma.candidateDocument.updateMany({ where: { id: { in: toReturn } }, data: { status: 'RETURNED', returnComment: reviewComment } });
          }
          if (s.stage === 'BLOCKED') reviewComment = 'Не прошёл проверку службы безопасности.';
          if (s.stage === 'ACCEPTED' && s.check === 'CONDITIONAL') reviewComment = 'Принят условно: оригинал диплома предоставить в первый рабочий день.';
          const reviewed = ['RETURNED', 'ACCEPTED', 'EXPORTED', 'BLOCKED'].includes(s.stage);
          await prisma.documentRequest.update({
            where: { id: req.id },
            data: {
              questionnaireAnswers: s.tpl.questionnaireTemplateId ? answers : {}, readyAt, reviewComment,
              reviewedAt: reviewed ? new Date(readyAt.getTime() + 86_400_000) : null,
            },
          });
        }
      }
    }
    if (s.stage === 'EXPORTED') await prisma.candidate.update({ where: { id: c.id }, data: { exportedAt: daysAgo(1, 15) } });
    // Registry "Дата изменения": spread over the last month.
    await prisma.candidate.update({ where: { id: c.id }, data: { updatedAt: new Date(Math.min(Date.now(), createdAt.getTime() + (2 + (i % 5)) * 86_400_000)) } });
  }

  // Comments thread (F-11).
  const commentFor = Object.entries(ids);
  const comments: [number, string, string][] = [
    [0, hr, 'Прошёл техническое интервью, оффер согласован с руководителем разработки.'],
    [0, hr, 'Выход планируется после отработки на текущем месте (2 недели).'],
    [4, hr, 'Нужно уточнить статус вида на жительство перед отправкой запроса документов.'],
    [12, hr, 'Пакет загружен, проверить диплом — в анкете указан другой год окончания.'],
    [16, hr, 'Вернули на доработку фото и адрес. Кандидат обещал исправить до пятницы.'],
    [18, hr, 'Рекомендован. Подготовить рабочее место и доступы.'],
    [22, hr2, 'По результатам проверки — отказ. Кандидат уведомлён.'],
  ];
  for (const [idx, author, text] of comments) {
    const [, candidateId] = commentFor[idx]!;
    await prisma.candidateComment.create({ data: { candidateId, authorUserId: author, text, createdAt: daysAgo(20 - idx / 2) } });
  }

  return { candidates: ids, requestTemplates: { standard: standard.id, drivers: drivers.id, minimal: minimal.id }, questionnaires: { main: questionnaire.id } };
}
