import type { PrismaClient, SignMethod } from '@prisma/client';
import type { Tx } from '../../src/lib/db';
import { DEFAULT_TYPES, ensureDocumentType } from '../../src/modules/documents/defaults';
import { createDocument } from '../../src/modules/documents/service';
import { registerNumber } from '../../src/modules/documents/numbering';
import { generateDocumentPdf, generateSignedPdf } from '../../src/modules/documents/render';
import { inTx, rejectDocument, returnDocument, signAndComplete, startRoute, findActionableStep } from '../../src/modules/documents/route-engine';
import { saveGenerated } from '../../src/lib/files';
import { PdfBuilder } from '../../src/lib/pdf';

type People = Record<string, { userId: string; employeeId: string }>;
type Ctx = { tenantId: string; legalEntities: { dala: string; altyn: string }; people: People };

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY);
const dateOnly = (d: Date) => new Date(`${iso(d)}T00:00:00Z`);

/**
 * Phase 3 seed: document catalogue (types, RU templates, default routes) and ~35 documents in every state,
 * with real sandbox signatures, so each demo inbox (ceo, devlead, dev1, hr) has work waiting.
 */
export async function seedDocuments(prisma: PrismaClient, ctx: Ctx) {
  const { tenantId, people: P } = ctx;
  const LE = ctx.legalEntities;

  const types: Record<string, string> = {};
  for (const def of DEFAULT_TYPES) types[def.code] = (await ensureDocumentType(tenantId, def.code)).id;

  // Active deputy: Руслан Алимов (devlead) replaces the CEO while he is on a business trip.
  await prisma.deputy.create({
    data: { tenantId, principalUserId: P.ceo!.userId, deputyUserId: P.devlead!.userId, startDate: dateOnly(daysFromNow(-2)), endDate: dateOnly(daysFromNow(12)) },
  });

  const le = (key: string) => ([ 'altynDirector', 'hr2', 'warehouseLead' ].includes(key) || /^staff(1[89]|2[0-3])$/.test(key) ? LE.altyn : LE.dala);
  const hrOf = (key: string) => (le(key) === LE.altyn ? P.hr2!.userId : P.hr!.userId);
  const emp = async (key: string) => prisma.employee.findUniqueOrThrow({ where: { id: P[key]!.employeeId }, include: { position: true, department: true } });

  const ids = {
    completed: [] as string[], pending: { ceo: [] as string[], devlead: [] as string[], dev1: [] as string[], hr: [] as string[], other: [] as string[] },
    returned: '' as string, rejected: '' as string, overdue: '' as string, drafts: [] as string[], archive: [] as string[], contracts: {} as Record<string, string>,
  };

  async function make(code: string, subject: string, opts: { author?: string; data?: Record<string, unknown>; start?: boolean; registeredAt?: Date; title?: string } = {}) {
    return inTx(async (tx) => {
      const id = await createDocument(tx, {
        tenantId, authorUserId: opts.author ?? hrOf(subject), documentTypeId: types[code]!, legalEntityId: le(subject),
        subjectEmployeeId: P[subject]!.employeeId, data: opts.data ?? {}, title: opts.title,
      });
      if (opts.registeredAt) {
        await registerNumber(tx, id, { registeredAt: opts.registeredAt });
        await tx.document.update({ where: { id }, data: { backdated: false } });
        await generateDocumentPdf(id, tx);
      }
      if (opts.start !== false) await startRoute(tx, id, opts.author ?? hrOf(subject));
      return id;
    });
  }

  /** Acts on the current step as `who` (sign/approve); APPROVE steps use CLICK. */
  async function act(docId: string, who: string, method: Exclude<SignMethod, 'PAPER'> = 'EGOV_MOBILE') {
    await inTx(async (tx: Tx) => {
      const step = await findActionableStep(tx, { userId: P[who]!.userId }, docId);
      if (!step) throw new Error(`seed: ${who} has nothing to do on ${docId}`);
      const m = step.step.action === 'APPROVE' ? 'CLICK' : method;
      await signAndComplete(tx, { documentId: docId, actorUserId: P[who]!.userId, method: m, actions: [step.step.action] });
    });
  }

  /** Spreads timestamps into the past so the registry looks lived-in (signatures stay valid: they cover the PDF bytes). */
  async function age(docId: string, createdAt: Date) {
    const steps = await prisma.routeStep.findMany({ where: { documentId: docId }, orderBy: [{ order: 'asc' }, { id: 'asc' }] });
    let t = createdAt.getTime();
    for (const s of steps) {
      if (!s.actedAt) continue;
      t += (3 + (s.order * 7) % 20) * 3_600_000;
      await prisma.routeStep.update({ where: { id: s.id }, data: { actedAt: new Date(t), viewedAt: new Date(t - 1_800_000) } });
      await prisma.signature.updateMany({ where: { routeStepId: s.id }, data: { signedAt: new Date(t) } });
    }
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: docId } });
    await prisma.document.update({
      where: { id: docId },
      data: { createdAt, updatedAt: new Date(t), ...(doc.status === 'COMPLETED' ? { completedAt: new Date(t) } : {}) },
    });
    if (doc.status === 'COMPLETED' && !doc.paperSigned) await inTx((tx) => generateSignedPdf(docId, tx)); // sheet shows the aged times
  }

  // ── Completed employment contracts (signatory eGov Business → employee eGov mobile) ──
  const contractFor = async (key: string, salary: number, signer: string) => {
    const e = await emp(key);
    const id = await make('EMPLOYMENT_CONTRACT', key, { data: { salary, probationMonths: 3, startDate: iso(e.hireDate) }, registeredAt: e.hireDate });
    await act(id, signer, 'EGOV_BUSINESS');
    await act(id, key, 'EGOV_MOBILE');
    await age(id, new Date(e.hireDate.getTime() - 3 * DAY + 9 * 3_600_000));
    ids.contracts[key] = id;
    ids.completed.push(id);
    return id;
  };
  const salaries: [string, number][] = [
    ['devlead', 1_350_000], ['saleslead', 950_000], ['supportlead', 780_000], ['accountant', 900_000], ['dev1', 820_000],
    ['staff0', 750_000], ['staff3', 690_000], ['staff8', 420_000],
  ];
  for (const [key, salary] of salaries) await contractFor(key, salary, 'ceo');
  for (const [key, salary] of [['warehouseLead', 520_000], ['staff18', 310_000]] as [string, number][]) await contractFor(key, salary, 'altynDirector');

  // Contract signed by the deputy on behalf of the CEO ("Является заместителем").
  {
    const e = await emp('staff4');
    const id = await make('EMPLOYMENT_CONTRACT', 'staff4', { data: { salary: 640_000, probationMonths: 3, startDate: iso(e.hireDate) }, registeredAt: e.hireDate });
    await act(id, 'devlead', 'EGOV_BUSINESS');
    await act(id, 'staff4', 'EGOV_MOBILE');
    await age(id, new Date(e.hireDate.getTime() - 2 * DAY));
    ids.contracts.staff4 = id;
    ids.completed.push(id);
  }

  // ── Completed hire orders ──
  for (const key of ['dev1', 'staff0']) {
    const e = await emp(key);
    const id = await make('HIRE_ORDER', key, { data: { salary: key === 'dev1' ? 820_000 : 750_000, probationMonths: 3 }, registeredAt: e.hireDate });
    await act(id, 'ceo', 'EGOV_BUSINESS');
    await act(id, key);
    await age(id, new Date(e.hireDate.getTime() - DAY));
    ids.completed.push(id);
  }

  // ── A completed vacation: application (manager → HR) and the order (CEO → employee) ──
  {
    const data = { startDate: '2026-08-03', endDate: '2026-08-16', days: 14, comment: 'Ежегодный отпуск по графику' };
    const app = await make('VACATION_APPLICATION', 'staff12', { author: P.staff12!.userId, data });
    await act(app, 'supportlead');
    await act(app, 'hr');
    const order = await make('VACATION_ORDER', 'staff12', { data });
    await prisma.documentLink.create({ data: { fromId: order, toId: app, relation: 'ORDER_FOR' } });
    await act(order, 'ceo', 'EGOV_BUSINESS');
    await act(order, 'staff12');
    await age(app, new Date('2026-07-10T05:30:00Z'));
    await age(order, new Date('2026-07-14T08:00:00Z'));
    ids.completed.push(app, order);
  }

  // ── Waiting for the CEO (signatory) ──
  {
    const e = await emp('staff17');
    ids.pending.ceo.push(await make('EMPLOYMENT_CONTRACT', 'staff17', { data: { salary: 380_000, probationMonths: 2, startDate: iso(e.hireDate) } }));
    ids.pending.ceo.push(await make('VACATION_ORDER', 'staff5', { data: { startDate: iso(daysFromNow(14)), endDate: iso(daysFromNow(27)), days: 14 } }));
    ids.pending.ceo.push(await make('BUSINESS_TRIP_ORDER', 'saleslead', {
      data: { destination: 'г. Шымкент', purpose: 'Переговоры с дистрибьютором и подписание договора поставки', startDate: iso(daysFromNow(9)), endDate: iso(daysFromNow(12)), days: 4 },
    }));
    const st9 = await emp('staff9');
    ids.pending.ceo.push(await make('TRANSFER_ORDER', 'staff9', {
      data: {
        effectiveDate: iso(daysFromNow(25)), reason: 'Заявление работника, служебная записка руководителя', positionId: ctx.people.saleslead ? (await emp('saleslead')).positionId : null,
        fromDepartment: st9.department?.name, fromPosition: st9.position?.name, toDepartment: st9.department?.name, toPosition: 'Руководитель отдела продаж', toManager: 'Байсарин Тимур Ерланович', salary: 720_000,
      },
    }));
  }

  // ── Waiting for the dev lead (manager approvals) ──
  ids.pending.devlead.push(await make('VACATION_APPLICATION', 'dev1', { author: P.dev1!.userId, data: { startDate: iso(daysFromNow(30)), endDate: iso(daysFromNow(43)), days: 14, comment: 'Прошу согласовать по графику отпусков' } }));
  ids.pending.devlead.push(await make('BUSINESS_TRIP_APPLICATION', 'staff1', { author: P.staff1!.userId, data: { destination: 'г. Алматы', purpose: 'Конференция Kolesa Conf 2026', startDate: iso(daysFromNow(16)), endDate: iso(daysFromNow(18)), days: 3 } }));
  ids.pending.devlead.push(await make('UNPAID_LEAVE_APPLICATION', 'staff2', { author: P.staff2!.userId, data: { startDate: iso(daysFromNow(6)), endDate: iso(daysFromNow(7)), days: 2, reason: 'Семейные обстоятельства' } }));

  // ── Waiting for Әлия Серикова (dev1): acknowledge a vacation order, sign a supplementary agreement ──
  {
    const order = await make('VACATION_ORDER', 'dev1', { data: { startDate: iso(daysFromNow(3)), endDate: iso(daysFromNow(9)), days: 7 } });
    await act(order, 'ceo', 'EGOV_BUSINESS');
    ids.pending.dev1.push(order);
    const sa = await make('SUPPLEMENTARY_AGREEMENT', 'dev1', {
      data: { contractNumber: (await prisma.document.findUniqueOrThrow({ where: { id: ids.contracts.dev1! } })).number, contractDate: '2022-04-11', changes: 'должностной оклад устанавливается в размере 950 000 (девятьсот пятьдесят тысяч) тенге', effectiveDate: iso(daysFromNow(25)) },
    });
    await prisma.documentLink.create({ data: { fromId: sa, toId: ids.contracts.dev1!, relation: 'AMENDS' } });
    await act(sa, 'ceo', 'EGOV_BUSINESS');
    ids.pending.dev1.push(sa);
  }

  // ── Waiting for HR (second approval) ──
  {
    const a = await make('VACATION_APPLICATION', 'staff6', { author: P.staff6!.userId, data: { startDate: iso(daysFromNow(20)), endDate: iso(daysFromNow(33)), days: 14 } });
    await act(a, 'devlead');
    const b = await make('UNPAID_LEAVE_APPLICATION', 'staff10', { author: P.staff10!.userId, data: { startDate: iso(daysFromNow(10)), endDate: iso(daysFromNow(12)), days: 3, reason: 'Переезд' } });
    await act(b, 'saleslead');
    ids.pending.hr.push(a, b);
  }

  // ── Returned, rejected, overdue, drafts ──
  {
    const r = await make('VACATION_APPLICATION', 'staff7', { author: P.staff7!.userId, data: { startDate: iso(daysFromNow(5)), endDate: iso(daysFromNow(18)), days: 14 } });
    await inTx(async (tx) => {
      const s = (await findActionableStep(tx, { userId: P.devlead!.userId }, r))!;
      await returnDocument(tx, { stepId: s.step.id, actorUserId: P.devlead!.userId, comment: 'Пересекается с релизом 2.4 — перенесите, пожалуйста, на неделю позже' });
    });
    ids.returned = r;
    const j = await make('BUSINESS_TRIP_APPLICATION', 'staff11', { author: P.staff11!.userId, data: { destination: 'г. Ташкент', purpose: 'Выставка ритейла', startDate: iso(daysFromNow(4)), endDate: iso(daysFromNow(8)), days: 5 } });
    await inTx(async (tx) => {
      const s = (await findActionableStep(tx, { userId: P.saleslead!.userId }, j))!;
      await rejectDocument(tx, { stepId: s.step.id, actorUserId: P.saleslead!.userId, comment: 'Командировка не согласована бюджетом квартала' });
    });
    ids.rejected = j;
    const o = await make('VACATION_ORDER', 'staff13', { data: { startDate: iso(daysFromNow(1)), endDate: iso(daysFromNow(14)), days: 14 } });
    await prisma.routeStep.updateMany({ where: { documentId: o, status: 'PENDING' }, data: { dueAt: daysFromNow(-3) } });
    await prisma.document.update({ where: { id: o }, data: { createdAt: daysFromNow(-6) } });
    ids.overdue = o;
    ids.pending.ceo.push(o);
    ids.drafts.push(await make('HIRE_ORDER', 'staff14', { data: { salary: 400_000, probationMonths: 3 }, start: false }));
    ids.drafts.push(await make('SUPPLEMENTARY_AGREEMENT', 'staff15', { data: { contractNumber: '—', contractDate: '2023-02-01', changes: 'режим работы: гибкий график 08:00–17:00', effectiveDate: iso(daysFromNow(30)) }, start: false }));
  }

  // ── Алтын Логистик ──
  ids.pending.other.push(await make('DISMISSAL_ORDER', 'staff21', { author: P.hr2!.userId, data: { effectiveDate: iso(daysFromNow(14)), reason: 'Заявление работника', article: 'по инициативе работника (статья 56 ТК РК)', compensationDays: 11.5 } }));
  ids.pending.other.push(await make('VACATION_APPLICATION', 'staff19', { author: P.staff19!.userId, data: { startDate: iso(daysFromNow(21)), endDate: iso(daysFromNow(34)), days: 14 } }));

  // ── Electronic archive (F-25): paper originals registered as COMPLETED / ARCHIVE ──
  for (const [key, title, number, date] of [
    ['staff16', 'Трудовой договор (бумажный оригинал)', 'ТД-14/2019', '2019-08-05'],
    ['staff20', 'Приказ о приёме на работу (бумажный оригинал)', '31-к/18', '2018-04-02'],
  ] as const) {
    const id = await inTx(async (tx) => {
      const pdf = await PdfBuilder.create({ title, footer: `Akere HR · архив · ${number}` });
      await pdf.add([{ type: 'heading', text: title }, { type: 'paragraph', text: `№ ${number} от ${date}. Скан бумажного документа, внесён в электронный архив.` }]);
      const file = await saveGenerated(tenantId, await pdf.bytes(), `${number.replace('/', '-')}.pdf`, 'application/pdf', tx);
      const doc = await tx.document.create({
        data: {
          tenantId, legalEntityId: le(key), documentTypeId: types.ARCHIVE!, kind: 'ARCHIVE', title, number, registeredAt: new Date(`${date}T00:00:00Z`),
          paperSigned: true, status: 'COMPLETED', authorId: hrOf(key), subjectEmployeeId: P[key]!.employeeId, pdfFileId: file.id, signedPdfFileId: file.id,
          completedAt: new Date(`${date}T10:00:00Z`), searchText: `${title} ${number}`.toLowerCase(),
        },
      });
      const df = await tx.documentFile.create({ data: { documentId: doc.id, name: 'Скан оригинала' } });
      await tx.fileVersion.create({ data: { documentFileId: df.id, version: 1, storedFileId: file.id, uploadedById: hrOf(key) } });
      return doc.id;
    });
    ids.archive.push(id);
  }

  // Only notifications about work that is still waiting stay unread.
  await prisma.notification.updateMany({ where: { tenantId, readAt: null }, data: { readAt: new Date() } });
  const pendingSteps = await prisma.routeStep.findMany({ where: { status: 'PENDING', document: { tenantId, status: 'IN_ROUTE' } }, select: { documentId: true, assigneeUserId: true } });
  for (const s of pendingSteps) {
    await prisma.notification.updateMany({ where: { userId: s.assigneeUserId, type: 'document.pending', link: { endsWith: s.documentId } }, data: { readAt: null } });
  }
  for (const id of [ids.returned, ids.rejected]) {
    const d = await prisma.document.findUniqueOrThrow({ where: { id } });
    await prisma.notification.updateMany({ where: { userId: d.authorId, link: { endsWith: id }, type: { in: ['document.returned', 'document.rejected'] } }, data: { readAt: null } });
  }

  return { documentTypes: types, documents: ids };
}
