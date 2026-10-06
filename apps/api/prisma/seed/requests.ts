import type { PlanStatus, PrismaClient, SignMethod } from '@prisma/client';
import type { Tx } from '../../src/lib/db';
import type { UserCtx } from '../../src/lib/auth';
import { DEFAULT_TZ, addDaysStr, diffDays, todayLocal } from '../../src/lib/calendar';
import { findActionableStep, inTx, rejectDocument, returnDocument, signAndComplete } from '../../src/modules/documents/route-engine';
import { ensureRequestTypes } from '../../src/modules/requests/types';
import { cancelRequest, createRequest } from '../../src/modules/requests/service';
import { leaveDays } from '../../src/modules/requests/days';
import { saveUpload } from '../../src/modules/uploads/service';
import '../../src/modules/requests/hooks';

type People = Record<string, { userId: string; employeeId: string }>;
type Ctx = { tenantId: string; legalEntities: { dala: string; altyn: string }; people: People };

const HOUR = 3_600_000;
const d0 = (s: string) => new Date(`${s}T00:00:00Z`);
const SAMPLE_PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

/**
 * Phase 4 seed: built-in request types; ~17 requests in every status driven through the real route engine
 * (application → manager → HR → order → signatory → acknowledgment, sandbox signatures), with absences and
 * vacation-ledger usage for completed leave; vacation campaigns: current year CLOSED (approved plans) and
 * next year ACTIVE (~60 % of employees planned, mixed statuses — the dev lead has plans to bulk-approve).
 */
export async function seedRequests(prisma: PrismaClient, ctx: Ctx) {
  const { tenantId, people: P } = ctx;
  const types = Object.fromEntries((await ensureRequestTypes(tenantId)).map((t) => [t.code, t]));
  const today = todayLocal(DEFAULT_TZ);
  const day = (offset: number) => addDaysStr(today, offset);

  /** Acting context of an employee; `backdate` grants the HR right to file past-dated requests (history import). */
  const as = (key: string, backdate = false): UserCtx => ({
    kind: 'user', sessionId: 'seed', userId: P[key]!.userId, tenantId, roles: backdate ? ['EMPLOYEE', 'HR'] : ['EMPLOYEE'], grants: [], permissions: [],
    employeeId: P[key]!.employeeId, locale: 'ru', pending2fa: false,
  });

  async function file(key: string, code: string, body: { start?: string; end?: string; data?: Record<string, unknown>; submit?: boolean; attachmentFileIds?: string[] }) {
    // Annual leave: stretch the end date so public holidays inside the period do not shorten it below the planned length.
    if (code === 'ANNUAL_LEAVE' && body.start && body.end) {
      const want = diffDays(body.start, body.end) + 1;
      while ((await leaveDays(body.start, body.end, 'VACATION')).days < want) body.end = addDaysStr(body.end, 1);
    }
    return inTx((tx) => createRequest(tx, as(key, !!body.start && body.start < today), {
      requestTypeId: types[code]!.id, startDate: body.start ?? null, endDate: body.end ?? null, data: body.data ?? {},
      attachmentFileIds: body.attachmentFileIds ?? [], submit: body.submit ?? true,
    }));
  }

  const docOf = async (requestId: string, which: 'app' | 'order') => {
    const r = await prisma.request.findUniqueOrThrow({ where: { id: requestId } });
    const id = which === 'app' ? r.applicationDocumentId : r.orderDocumentId;
    if (!id) throw new Error(`seed: request ${requestId} has no ${which} document`);
    return id;
  };

  /** Current step of the request's application/order acted on by `who`. APPROVE uses CLICK; SIGN/ACKNOWLEDGE use eGov. */
  async function act(requestId: string, which: 'app' | 'order', who: string, method: Exclude<SignMethod, 'PAPER'> = 'EGOV_MOBILE') {
    const docId = await docOf(requestId, which);
    await inTx(async (tx: Tx) => {
      const step = await findActionableStep(tx, { userId: P[who]!.userId }, docId);
      if (!step) throw new Error(`seed: ${who} has nothing to do on ${docId}`);
      await signAndComplete(tx, { documentId: docId, actorUserId: P[who]!.userId, method: step.step.action === 'APPROVE' ? 'CLICK' : method, actions: [step.step.action] });
    });
  }
  async function decide(requestId: string, who: string, kind: 'return' | 'reject', comment: string) {
    const docId = await docOf(requestId, 'app');
    await inTx(async (tx: Tx) => {
      const step = await findActionableStep(tx, { userId: P[who]!.userId }, docId);
      if (!step) throw new Error(`seed: ${who} has nothing to do on ${docId}`);
      await (kind === 'return' ? returnDocument : rejectDocument)(tx, { stepId: step.step.id, actorUserId: P[who]!.userId, comment });
    });
  }
  /** Full approval chain: manager → HR (→ signatory → employee acknowledgment when `toEnd`). */
  async function approveAll(id: string, key: string, mgr: string, hr: string, signer?: string) {
    await act(id, 'app', mgr);
    await act(id, 'app', hr);
    if (signer) {
      await act(id, 'order', signer, 'EGOV_BUSINESS');
      await act(id, 'order', key);
    }
  }

  /** Spreads timestamps into the past (signatures stay valid: they cover the PDF bytes, not the time). */
  async function age(requestId: string, createdAt: Date) {
    const r = await prisma.request.findUniqueOrThrow({ where: { id: requestId } });
    let t = createdAt.getTime();
    const next = (h: number) => new Date((t += h * HOUR));
    await prisma.request.update({ where: { id: r.id }, data: { createdAt, submittedAt: r.submittedAt ? next(0.2) : null } });
    for (const docId of [r.applicationDocumentId, r.orderDocumentId]) {
      if (!docId) continue;
      await prisma.document.update({ where: { id: docId }, data: { createdAt: new Date(t) } });
      const steps = await prisma.routeStep.findMany({ where: { documentId: docId, actedAt: { not: null } }, orderBy: [{ actedAt: 'asc' }] });
      for (const s of steps) {
        const at = next(5 + (s.order * 7) % 18);
        await prisma.routeStep.update({ where: { id: s.id }, data: { actedAt: at, viewedAt: new Date(at.getTime() - 40 * 60_000) } });
        await prisma.signature.updateMany({ where: { routeStepId: s.id }, data: { signedAt: at } });
      }
      const doc = await prisma.document.findUniqueOrThrow({ where: { id: docId } });
      if (doc.completedAt) await prisma.document.update({ where: { id: docId }, data: { completedAt: new Date(t) } });
    }
    if (r.completedAt) await prisma.request.update({ where: { id: r.id }, data: { completedAt: new Date(t) } });
    const logs = await prisma.auditLog.findMany({ where: { entityType: 'Request', entityId: r.id }, orderBy: { createdAt: 'asc' } });
    let lt = createdAt.getTime();
    for (const [i, l] of logs.entries()) {
      lt = i === 0 ? lt : Math.min(lt + 2 * HOUR, t);
      await prisma.auditLog.update({ where: { id: l.id }, data: { createdAt: new Date(lt) } });
    }
    if (r.completedAt) await prisma.auditLog.updateMany({ where: { entityType: 'Request', entityId: r.id, action: 'request.completed' }, data: { createdAt: new Date(t) } });
  }
  const ago = (days: number) => new Date(Date.now() - days * 24 * HOUR);

  const ids: Record<string, string> = {};

  // ── Әлия Серикова (dev1): history + a draft ──
  ids.dev1Vacation = await file('dev1', 'ANNUAL_LEAVE', { start: day(-124), end: day(-111), data: { comment: 'Ежегодный отпуск по графику' } });
  await approveAll(ids.dev1Vacation, 'dev1', 'devlead', 'hr', 'ceo');
  await age(ids.dev1Vacation, ago(150));
  ids.dev1Trip = await file('dev1', 'BUSINESS_TRIP', { start: day(-84), end: day(-82), data: { destination: 'г. Алматы', purpose: 'Конференция frontend-разработчиков Frontend Fest', transport: 'Авиа' } });
  await approveAll(ids.dev1Trip, 'dev1', 'devlead', 'hr', 'ceo');
  await age(ids.dev1Trip, ago(100));
  ids.dev1Cert = await file('dev1', 'CERTIFICATE', { data: { purpose: 'Посольство Республики Корея (виза)', copies: 1 } });
  await act(ids.dev1Cert, 'app', 'hr');
  await age(ids.dev1Cert, ago(20));
  ids.dev1Draft = await file('dev1', 'ANNUAL_LEAVE', { start: day(62), end: day(75), data: { comment: 'Отпуск на новогодние праздники' }, submit: false });

  // ── Waiting for the dev lead (manager approval) ──
  ids.staff0Vacation = await file('staff0', 'ANNUAL_LEAVE', { start: day(25), end: day(38), data: { comment: 'Прошу согласовать по графику' } });
  await age(ids.staff0Vacation, ago(1));
  const studyPdf = await saveUpload({ tenantId, userId: P.staff2!.userId, buffer: SAMPLE_PDF, filename: 'Справка-вызов КазНУ.pdf' });
  ids.staff2Social = await file('staff2', 'SOCIAL_LEAVE', { start: day(45), end: day(64), data: { leaveKind: 'учебный отпуск', reason: 'Сессия, заочное отделение магистратуры' }, attachmentFileIds: [studyPdf.id] });
  await age(ids.staff2Social, ago(2));

  // ── Waiting for HR (manager approved) ──
  ids.staff4Unpaid = await file('staff4', 'UNPAID_LEAVE', { start: day(21), end: day(23), data: { reason: 'Переезд в новую квартиру' } });
  await act(ids.staff4Unpaid, 'app', 'devlead');
  await age(ids.staff4Unpaid, ago(3));
  ids.staff13Cert = await file('staff13', 'CERTIFICATE', { data: { purpose: 'АО «Kaspi Bank» (кредит)', copies: 2 } });
  await age(ids.staff13Cert, ago(1));

  // ── Order waiting for the CEO's signature ──
  ids.staff8Vacation = await file('staff8', 'ANNUAL_LEAVE', { start: day(30), end: day(43), data: {} });
  await approveAll(ids.staff8Vacation, 'staff8', 'saleslead', 'hr');
  await age(ids.staff8Vacation, ago(4));

  // ── Rejected / returned / cancelled ──
  ids.staff10Rejected = await file('staff10', 'ANNUAL_LEAVE', { start: day(18), end: day(31), data: { comment: 'Семейная поездка' } });
  await decide(ids.staff10Rejected, 'saleslead', 'reject', 'Пиковый сезон продаж, перенесите отпуск на январь');
  await age(ids.staff10Rejected, ago(6));
  ids.staff16Rework = await file('staff16', 'ANNUAL_LEAVE', { start: day(50), end: day(63), data: {} });
  await decide(ids.staff16Rework, 'accountant', 'return', 'Уточните даты: годовой отчёт сдаём до конца месяца');
  await age(ids.staff16Rework, ago(2));
  ids.staff9Cancelled = await file('staff9', 'UNPAID_LEAVE', { start: day(35), end: day(36), data: { reason: 'Личные обстоятельства' } });
  await inTx((tx) => cancelRequest(tx, as('staff9'), ids.staff9Cancelled!));
  await age(ids.staff9Cancelled, ago(5));

  // ── Completed: past vacations and a business trip (absences + ledger) ──
  ids.staff6Vacation = await file('staff6', 'ANNUAL_LEAVE', { start: day(-152), end: day(-139), data: {} });
  await approveAll(ids.staff6Vacation, 'staff6', 'devlead', 'hr', 'ceo');
  await age(ids.staff6Vacation, ago(170));
  ids.staff12Trip = await file('staff12', 'BUSINESS_TRIP', { start: day(-72), end: day(-69), data: { destination: 'г. Караганда', purpose: 'Обучение сотрудников партнёра работе с системой', transport: 'Железнодорожный' } });
  await approveAll(ids.staff12Trip, 'staff12', 'supportlead', 'hr', 'ceo');
  await age(ids.staff12Trip, ago(85));
  ids.staff18Vacation = await file('staff18', 'ANNUAL_LEAVE', { start: day(-101), end: day(-88), data: {} });
  await approveAll(ids.staff18Vacation, 'staff18', 'warehouseLead', 'hr2', 'altynDirector');
  await age(ids.staff18Vacation, ago(120));
  // Completed upcoming vacation (order signed and acknowledged).
  ids.staff14Vacation = await file('staff14', 'ANNUAL_LEAVE', { start: day(40), end: day(53), data: { comment: 'По графику отпусков' } });
  await approveAll(ids.staff14Vacation, 'staff14', 'supportlead', 'hr', 'ceo');
  await age(ids.staff14Vacation, ago(9));

  // ── Altyn branch: business trip waiting for its HR ──
  ids.staff20Trip = await file('staff20', 'BUSINESS_TRIP', { start: day(22), end: day(26), data: { destination: 'г. Астана', purpose: 'Приёмка оборудования на центральном складе', transport: 'Служебный транспорт' } });
  await act(ids.staff20Trip, 'app', 'warehouseLead');
  await age(ids.staff20Trip, ago(2));

  // ── Vacation schedule ──
  const curYear = Number(today.slice(0, 4));
  const active = await prisma.employee.findMany({ where: { tenantId, status: 'ACTIVE' }, include: { user: true }, orderBy: [{ tabNumber: 'asc' }] });

  /** Deterministic plan: a 14+ day main part and a second part, inside the year; days exclude public holidays. */
  async function planPeriods(year: number, i: number) {
    const out: { startDate: Date; endDate: Date; days: number }[] = [];
    const mainMonth = 2 + (i * 5) % 10; // Mar … Dec
    const secondMonth = ((mainMonth + 4) % 11) + 1;
    for (const [month, want] of [[mainMonth, 14], [secondMonth, 10]] as const) {
      const start = `${year}-${String(month).padStart(2, '0')}-${String(1 + (i * 3) % 14).padStart(2, '0')}`;
      let end = addDaysStr(start, want - 1);
      while ((await leaveDays(start, end, 'VACATION')).days < want) end = addDaysStr(end, 1);
      out.push({ startDate: d0(start), endDate: d0(end), days: want });
    }
    return out.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  }

  // Current year: closed, every employee with an approved schedule.
  const closed = await prisma.vacationCampaign.create({ data: { tenantId, year: curYear, status: 'CLOSED', deadline: d0(`${curYear - 1}-12-15`), createdAt: d0(`${curYear - 1}-11-01`) } });
  const hrUser = P.hr!.userId;
  for (const [i, e] of active.entries()) {
    await prisma.vacationPlan.create({
      data: {
        campaignId: closed.id, employeeId: e.id, status: 'APPROVED', approvedById: hrUser, approvedAt: d0(`${curYear - 1}-12-20`),
        periods: { create: await planPeriods(curYear, i) },
      },
    });
  }

  // Next year: active; ~60 % planned. The dev team mostly submitted (bulk approval demo: 7 of 8 approvable).
  const next = await prisma.vacationCampaign.create({ data: { tenantId, year: curYear + 1, status: 'ACTIVE', deadline: d0(`${curYear}-12-15`) } });
  const devTeam = new Set(['staff0', 'staff1', 'staff2', 'staff3', 'staff4', 'staff5', 'staff6', 'staff7'].map((k) => P[k]!.employeeId));
  const skip = new Set([P.dev1!.employeeId]); // the demo employee plans herself
  const statusFor = (i: number, empId: string): PlanStatus | null => {
    if (skip.has(empId)) return null;
    if (devTeam.has(empId)) return empId === P.staff7!.employeeId ? 'DRAFT' : 'SUBMITTED';
    const r = i % 10;
    if (r < 3) return 'APPROVED';
    if (r < 5) return 'SUBMITTED';
    if (r === 5) return 'REJECTED';
    if (r === 6) return 'DRAFT';
    return null;
  };
  let planned = 0;
  for (const [i, e] of active.entries()) {
    const status = statusFor(i, e.id);
    if (!status) continue;
    planned++;
    await prisma.vacationPlan.create({
      data: {
        campaignId: next.id, employeeId: e.id, status,
        approvedById: status === 'APPROVED' ? hrUser : null, approvedAt: status === 'APPROVED' ? ago(3) : null,
        comment: status === 'REJECTED' ? 'Пересекается с отпуском второго специалиста отдела, выберите другие даты' : null,
        periods: { create: await planPeriods(curYear + 1, i + 3) },
      },
    });
  }

  const counts = await prisma.request.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } });
  console.log(`  requests: ${counts.map((c) => `${c.status}=${c._count._all}`).join(', ')}; ${curYear + 1} plans: ${planned}/${active.length}`);
  return { requests: ids, vacationCampaigns: { current: closed.id, next: next.id } };
}
