import type { RouteStep, SignMethod, StepAction } from '@prisma/client';
import type { RouteStepDef } from '@akere/shared';
import { prisma, type Tx } from '../../lib/db';
import { businessRule, conflict } from '../../lib/errors';
import { emit } from '../../lib/hooks';
import { audit } from '../../lib/audit';
import { fullName } from '../../lib/names';
import { signBytes, type SignatureResult } from '../../adapters/signing';
import { activePrincipalIds } from '../deputies/service';
import { registerNumber } from './numbering';
import { documentPdfBytes, generateDocumentPdf, generateSignedPdf } from './render';
import { fmtDue, notifyDoc } from './messages';

/**
 * Route engine (F-17, API.md "Route engine rules").
 *  - start: steps are instantiated from the type's RouteTemplate; the lowest order becomes PENDING (parallel steps share an order)
 *  - when every step of the current order is DONE, the next order activates; after the last one the document is COMPLETED,
 *    the signed PDF is generated and `document.completed` fires (inside the caller's transaction)
 *  - return → REWORK, all steps reset (the returning step keeps RETURNED + comment), signatures voided; restart begins at order 1
 *  - reject → REJECTED, remaining steps SKIPPED
 *  - deputies: an active Deputy of the assignee may act (actedById + Signature.onBehalfOfUserId record it);
 *    any HR whose grant covers the document's legal entity may act on a step assigned to another HR of that entity (ROLE_HR pool).
 *    ACKNOWLEDGE steps are never delegated: only the assignee may acknowledge.
 *  - concurrency: completeStep/returnDocument/rejectDocument lock the Document row first (SELECT … FOR UPDATE), so parallel
 *    steps completed at the same time are serialized and the last one always sees the others DONE and advances the route.
 * All functions take a transaction client; callers wrap them in prisma.$transaction.
 */

const DAY = 86_400_000;

type DocForRoute = { id: string; tenantId: string; legalEntityId: string; authorId: string; subjectEmployeeId: string | null };

async function userIfActive(tx: Tx, tenantId: string, userId: string | null | undefined) {
  if (!userId) return null;
  const u = await tx.user.findFirst({ where: { id: userId, tenantId, isActive: true }, select: { id: true } });
  return u?.id ?? null;
}

async function signatoryFor(tx: Tx, doc: DocForRoute): Promise<string | null> {
  const grants = await tx.roleAssignment.findMany({
    where: { canSign: true, OR: [{ legalEntityId: doc.legalEntityId }, { legalEntityId: null }], user: { tenantId: doc.tenantId, isActive: true } },
    include: { user: { select: { id: true, lastName: true, firstName: true } } },
  });
  grants.sort((a, b) => Number(a.legalEntityId === null) - Number(b.legalEntityId === null)
    || a.user.lastName.localeCompare(b.user.lastName) || a.user.id.localeCompare(b.user.id));
  return grants[0]?.user.id ?? null;
}

/** HR users whose grant covers the legal entity (entity-specific grants first, then by name). */
export async function hrUsersFor(tx: Tx, tenantId: string, legalEntityId: string): Promise<string[]> {
  const grants = await tx.roleAssignment.findMany({
    where: { role: 'HR', OR: [{ legalEntityId }, { legalEntityId: null }], user: { tenantId, isActive: true } },
    include: { user: { select: { id: true, lastName: true, firstName: true } } },
  });
  grants.sort((a, b) => Number(a.legalEntityId === null) - Number(b.legalEntityId === null)
    || a.user.lastName.localeCompare(b.user.lastName) || a.user.firstName.localeCompare(b.user.firstName) || a.user.id.localeCompare(b.user.id));
  return [...new Set(grants.map((g) => g.user.id))];
}

/** Resolves a route step rule to a concrete user id. Throws 422 ROUTE_ASSIGNEE_MISSING when nobody fits. */
export async function resolveAssignee(tx: Tx, doc: DocForRoute, def: Pick<RouteStepDef, 'rule' | 'userId'>): Promise<string> {
  const missing = (what: string) => businessRule('ROUTE_ASSIGNEE_MISSING', `Route step "${def.rule}" cannot be assigned: ${what}`, { assigneeRule: def.rule });
  const subject = doc.subjectEmployeeId
    ? await tx.employee.findUnique({ where: { id: doc.subjectEmployeeId }, include: { manager: { select: { userId: true, status: true } } } })
    : null;
  switch (def.rule) {
    case 'USER': {
      const id = await userIfActive(tx, doc.tenantId, def.userId);
      if (!id) throw missing('user not found or inactive');
      return id;
    }
    case 'AUTHOR':
      return doc.authorId;
    case 'SUBJECT': {
      const id = await userIfActive(tx, doc.tenantId, subject?.userId);
      if (!id) throw missing('the document has no subject employee');
      return id;
    }
    case 'MANAGER_OF_SUBJECT': {
      const mgr = subject?.manager?.status === 'ACTIVE' ? await userIfActive(tx, doc.tenantId, subject.manager.userId) : null;
      if (mgr) return mgr;
      const sig = await signatoryFor(tx, doc);
      if (!sig) throw missing('the subject has no manager and the legal entity has no signatory');
      return sig;
    }
    case 'SIGNATORY': {
      const sig = await signatoryFor(tx, doc);
      if (!sig) throw missing('no user with signing authority for the legal entity');
      return sig;
    }
    case 'ROLE_HR': {
      const hr = (await hrUsersFor(tx, doc.tenantId, doc.legalEntityId))[0];
      if (!hr) throw missing('no HR user for the legal entity');
      return hr;
    }
  }
}

async function authorName(tx: Tx, userId: string) {
  const u = await tx.user.findUnique({ where: { id: userId } });
  return u ? fullName(u) : '';
}

/** Starts (or restarts) the route of a DRAFT/REWORK document. Registers the number when missing. */
export async function startRoute(tx: Tx, documentId: string, actorUserId: string): Promise<void> {
  const doc = await tx.document.findUniqueOrThrow({ where: { id: documentId }, include: { documentType: { include: { routeTemplate: true } } } });
  if (doc.status !== 'DRAFT' && doc.status !== 'REWORK') throw conflict(`Document in status ${doc.status} cannot be started`, { rule: 'INVALID_STATUS' });
  const hadNumber = !!doc.number;
  await registerNumber(tx, doc.id);
  if (!hadNumber || !doc.pdfFileId) await generateDocumentPdf(doc.id, tx);

  await tx.signature.deleteMany({ where: { documentId } });
  await tx.routeStep.deleteMany({ where: { documentId } });

  const defs = ((doc.documentType.routeTemplate?.steps ?? []) as RouteStepDef[]).slice().sort((a, b) => a.order - b.order);
  const now = Date.now();
  const orders = [...new Set(defs.map((d) => d.order))];
  // Planned deadlines: cumulative per order (max dueDays of the parallel steps), capped by the document due date.
  let cursor = now;
  const plannedDue = new Map<number, Date | null>();
  for (const o of orders) {
    const days = Math.max(-1, ...defs.filter((d) => d.order === o).map((d) => d.dueDays ?? -1));
    if (days >= 0) {
      cursor += days * DAY;
      const due = new Date(cursor);
      plannedDue.set(o, doc.dueAt && doc.dueAt < due ? doc.dueAt : due);
    } else plannedDue.set(o, doc.dueAt ?? null);
  }
  const seen = new Set<string>();
  const rows: { documentId: string; order: number; action: StepAction; assigneeUserId: string; dueAt: Date | null }[] = [];
  for (const def of defs) {
    const assigneeUserId = await resolveAssignee(tx, doc, def);
    const key = `${def.order}:${def.action}:${assigneeUserId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ documentId, order: def.order, action: def.action, assigneeUserId, dueAt: plannedDue.get(def.order) ?? null });
  }
  await tx.document.update({ where: { id: documentId }, data: { status: 'IN_ROUTE', currentStepOrder: null, completedAt: null, signedPdfFileId: null } });
  if (rows.length) await tx.routeStep.createMany({ data: rows });
  await audit({ tenantId: doc.tenantId, userId: actorUserId }, 'document.start', 'Document', documentId, { steps: rows.length }, { tx });
  await activateNext(tx, documentId);
}

/** Activates the next WAITING order (all its steps → PENDING, assignees notified) or completes the document. */
export async function activateNext(tx: Tx, documentId: string): Promise<'ACTIVATED' | 'COMPLETED' | 'WAITING'> {
  const doc = await tx.document.findUniqueOrThrow({ where: { id: documentId } });
  const pending = await tx.routeStep.count({ where: { documentId, status: 'PENDING' } });
  if (pending > 0) return 'WAITING';
  const next = await tx.routeStep.findFirst({ where: { documentId, status: 'WAITING' }, orderBy: { order: 'asc' } });
  if (!next) {
    await finalizeDocument(tx, documentId);
    return 'COMPLETED';
  }
  const steps = await tx.routeStep.findMany({ where: { documentId, status: 'WAITING', order: next.order } });
  await tx.routeStep.updateMany({ where: { id: { in: steps.map((s) => s.id) } }, data: { status: 'PENDING', viewedAt: null, reminderSentAt: null } });
  await tx.document.update({ where: { id: documentId }, data: { currentStepOrder: next.order } });
  const author = await authorName(tx, doc.authorId);
  for (const s of steps) {
    await notifyDoc(tx, {
      tenantId: doc.tenantId, userId: s.assigneeUserId, documentId, type: 'document.pending',
      titleKey: `doc.pending.${s.action}`, bodyKey: 'doc.pending.body', params: { title: doc.title, author, due: fmtDue(s.dueAt) },
    });
  }
  return 'ACTIVATED';
}

/** Marks the document COMPLETED, builds the signed PDF, notifies the author and fires `document.completed`. */
export async function finalizeDocument(tx: Tx, documentId: string) {
  const doc = await tx.document.update({ where: { id: documentId }, data: { status: 'COMPLETED', completedAt: new Date(), currentStepOrder: null } });
  if (!doc.paperSigned) await generateSignedPdf(documentId, tx);
  await notifyDoc(tx, {
    tenantId: doc.tenantId, userId: doc.authorId, documentId, type: 'document.completed',
    titleKey: 'doc.completed', bodyKey: 'doc.completed.body', params: { title: doc.title },
  });
  await audit({ tenantId: doc.tenantId }, 'document.completed', 'Document', documentId, {}, { tx });
  await emit('document.completed', { tenantId: doc.tenantId, documentId }, tx);
}

export type Actionable = { step: RouteStep; onBehalfOfUserId: string | null; via: 'SELF' | 'DEPUTY' | 'HR_POOL' };

async function hrCovers(tx: Tx, userId: string, legalEntityId: string) {
  return (await tx.roleAssignment.count({ where: { userId, role: 'HR', OR: [{ legalEntityId }, { legalEntityId: null }] } })) > 0;
}

/**
 * The PENDING step of a document the user may act on: own step first, then as an active deputy,
 * then as a member of the HR pool of the legal entity. Returns null when there is nothing to do.
 */
export async function findActionableStep(
  tx: Tx,
  user: { userId: string; principalIds?: string[] },
  documentId: string,
  actions?: StepAction[],
): Promise<Actionable | null> {
  const doc = await tx.document.findUnique({ where: { id: documentId }, select: { status: true, legalEntityId: true } });
  if (!doc || doc.status !== 'IN_ROUTE') return null;
  const steps = await tx.routeStep.findMany({
    where: { documentId, status: 'PENDING', ...(actions ? { action: { in: actions } } : {}) },
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
  });
  if (!steps.length) return null;
  const own = steps.find((s) => s.assigneeUserId === user.userId);
  if (own) return { step: own, onBehalfOfUserId: null, via: 'SELF' };
  // An acknowledgment (ВНД, "ознакомлен") is personal: only the assignee themself may give it — never a deputy or the HR pool.
  const delegable = steps.filter((s) => s.action !== 'ACKNOWLEDGE');
  if (!delegable.length) return null;
  const principals = user.principalIds ?? (await activePrincipalIds(user.userId, tx));
  const dep = delegable.find((s) => principals.includes(s.assigneeUserId));
  if (dep) return { step: dep, onBehalfOfUserId: dep.assigneeUserId, via: 'DEPUTY' };
  if (await hrCovers(tx, user.userId, doc.legalEntityId)) {
    for (const s of delegable) {
      if (await hrCovers(tx, s.assigneeUserId, doc.legalEntityId)) return { step: s, onBehalfOfUserId: s.assigneeUserId, via: 'HR_POOL' };
    }
  }
  return null;
}

/** Serializes route transitions of one document (M2/M3). Must run inside the caller's transaction. */
export async function lockDocument(tx: Tx, documentId: string) {
  await tx.$queryRaw`SELECT id FROM "Document" WHERE id = ${documentId} FOR UPDATE`;
}

async function lockStepDocument(tx: Tx, stepId: string) {
  const ref = await tx.routeStep.findUniqueOrThrow({ where: { id: stepId }, select: { documentId: true } });
  await lockDocument(tx, ref.documentId);
  // Re-read after the lock so the status reflects any transition committed while we waited.
  return tx.routeStep.findUniqueOrThrow({ where: { id: stepId }, include: { document: true } });
}

/**
 * Completes a PENDING step (optimistic: fails with 409 if someone else acted first), stores the signature
 * and advances the route. Returns whether the document is now COMPLETED.
 */
export async function completeStep(
  tx: Tx,
  opts: { stepId: string; actorUserId: string; onBehalfOfUserId?: string | null; comment?: string | null; method: SignMethod; signature?: SignatureResult | null },
): Promise<{ completed: boolean }> {
  const step = await lockStepDocument(tx, opts.stepId);
  if (step.document.status !== 'IN_ROUTE') throw conflict('This step has already been processed', { rule: 'STEP_NOT_PENDING' });
  const claimed = await tx.routeStep.updateMany({
    where: { id: step.id, status: 'PENDING' },
    data: { status: 'DONE', actedAt: new Date(), actedById: opts.actorUserId, comment: opts.comment ?? null },
  });
  if (claimed.count === 0) throw conflict('This step has already been processed', { rule: 'STEP_NOT_PENDING' });
  if (opts.signature) {
    await tx.signature.create({
      data: {
        tenantId: step.document.tenantId, documentId: step.documentId, routeStepId: step.id, signerUserId: opts.actorUserId,
        onBehalfOfUserId: opts.onBehalfOfUserId ?? null, method: opts.method, ...opts.signature,
      },
    });
  }
  await audit({ tenantId: step.document.tenantId, userId: opts.actorUserId }, `document.step_${step.action.toLowerCase()}`, 'Document', step.documentId,
    { stepId: step.id, method: opts.method, onBehalfOf: opts.onBehalfOfUserId ?? null }, { tx });
  const result = await activateNext(tx, step.documentId);
  return { completed: result === 'COMPLETED' };
}

/**
 * Acts on the user's actionable step with a signature over the current PDF (eGov/NCALayer/CLICK).
 * Throws 422 NOTHING_TO_SIGN when the user has no matching PENDING step.
 */
export async function signAndComplete(
  tx: Tx,
  opts: { documentId: string; actorUserId: string; method: Exclude<SignMethod, 'PAPER'>; actions: StepAction[]; comment?: string | null; principalIds?: string[] },
): Promise<{ completed: boolean; stepId: string }> {
  const act = await findActionableStep(tx, { userId: opts.actorUserId, principalIds: opts.principalIds }, opts.documentId, opts.actions);
  if (!act) throw businessRule('NOTHING_TO_SIGN', 'You have no pending step on this document');
  const doc = await tx.document.findUniqueOrThrow({ where: { id: opts.documentId }, include: { legalEntity: true } });
  const actor = await tx.user.findUniqueOrThrow({ where: { id: opts.actorUserId }, include: { employee: { select: { iin: true } } } });
  const { bytes } = await documentPdfBytes(doc.id, tx);
  const signature = await signBytes(actor.id, bytes, {
    fullName: fullName(actor), iin: actor.employee?.iin, organization: doc.legalEntity.name, bin: doc.legalEntity.bin, method: opts.method,
  }, tx);
  const r = await completeStep(tx, { stepId: act.step.id, actorUserId: actor.id, onBehalfOfUserId: act.onBehalfOfUserId, comment: opts.comment, method: opts.method, signature });
  return { ...r, stepId: act.step.id };
}

/** Return for rework (→ REWORK). Steps reset to WAITING, signatures voided, author notified, `document.returned` fires. */
export async function returnDocument(tx: Tx, opts: { stepId: string; actorUserId: string; comment: string }) {
  const step = await lockStepDocument(tx, opts.stepId);
  if (step.status !== 'PENDING' || step.document.status !== 'IN_ROUTE') throw conflict('This step has already been processed', { rule: 'STEP_NOT_PENDING' });
  const doc = step.document;
  const claimed = await tx.routeStep.updateMany({
    where: { id: step.id, status: 'PENDING' },
    data: { status: 'RETURNED', actedAt: new Date(), actedById: opts.actorUserId, comment: opts.comment },
  });
  if (claimed.count === 0) throw conflict('This step has already been processed', { rule: 'STEP_NOT_PENDING' });
  await tx.routeStep.updateMany({
    where: { documentId: doc.id, id: { not: step.id } },
    data: { status: 'WAITING', actedAt: null, actedById: null, viewedAt: null, comment: null, reminderSentAt: null },
  });
  await tx.signature.deleteMany({ where: { documentId: doc.id } });
  await tx.document.update({ where: { id: doc.id }, data: { status: 'REWORK', currentStepOrder: null, signedPdfFileId: null } });
  await tx.documentComment.create({ data: { documentId: doc.id, authorId: opts.actorUserId, text: `Возвращено на доработку: ${opts.comment}` } });
  const actor = await authorName(tx, opts.actorUserId);
  await notifyDoc(tx, {
    tenantId: doc.tenantId, userId: doc.authorId, documentId: doc.id, type: 'document.returned',
    titleKey: 'doc.returned', bodyKey: 'doc.byComment', params: { title: doc.title, actor, comment: opts.comment },
  });
  await audit({ tenantId: doc.tenantId, userId: opts.actorUserId }, 'document.return', 'Document', doc.id, { comment: opts.comment }, { tx });
  await emit('document.returned', { tenantId: doc.tenantId, documentId: doc.id }, tx);
}

/** Reject (→ REJECTED). Remaining steps SKIPPED, author notified, `document.rejected` fires. */
export async function rejectDocument(tx: Tx, opts: { stepId: string; actorUserId: string; comment: string }) {
  const step = await lockStepDocument(tx, opts.stepId);
  if (step.status !== 'PENDING' || step.document.status !== 'IN_ROUTE') throw conflict('This step has already been processed', { rule: 'STEP_NOT_PENDING' });
  const doc = step.document;
  const claimed = await tx.routeStep.updateMany({
    where: { id: step.id, status: 'PENDING' },
    data: { status: 'REJECTED', actedAt: new Date(), actedById: opts.actorUserId, comment: opts.comment },
  });
  if (claimed.count === 0) throw conflict('This step has already been processed', { rule: 'STEP_NOT_PENDING' });
  await tx.routeStep.updateMany({ where: { documentId: doc.id, status: { in: ['WAITING', 'PENDING'] } }, data: { status: 'SKIPPED' } });
  await tx.document.update({ where: { id: doc.id }, data: { status: 'REJECTED', currentStepOrder: null } });
  await tx.documentComment.create({ data: { documentId: doc.id, authorId: opts.actorUserId, text: `Отклонено: ${opts.comment}` } });
  const actor = await authorName(tx, opts.actorUserId);
  await notifyDoc(tx, {
    tenantId: doc.tenantId, userId: doc.authorId, documentId: doc.id, type: 'document.rejected',
    titleKey: 'doc.rejected', bodyKey: 'doc.byComment', params: { title: doc.title, actor, comment: opts.comment },
  });
  await audit({ tenantId: doc.tenantId, userId: opts.actorUserId }, 'document.reject', 'Document', doc.id, { comment: opts.comment }, { tx });
  await emit('document.rejected', { tenantId: doc.tenantId, documentId: doc.id }, tx);
}

/** Convenience wrapper: runs fn in a transaction with a timeout suitable for PDF generation. */
export function inTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction((tx) => fn(tx), { timeout: 60_000, maxWait: 10_000 });
}
