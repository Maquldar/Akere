import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '../../lib/db';
import type { UserCtx } from '../../lib/auth';
import { businessRule, notFound } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { hrLegalEntityIds, isHrOrAdmin, legalEntityAllowed, managerSubtree } from '../../lib/scope';
import { fileUrl, toFileRef } from '../../lib/files';
import { shortName, toUserRef, userRefSelect, type UserRef } from '../../lib/names';
import { optDateStr } from '../../lib/dates';
import { activePrincipalIds } from '../deputies/service';
import { refreshSearchText } from './numbering';
import { generateDocumentPdf } from './render';
import { findActionableStep, startRoute } from './route-engine';

// ───────────────────────── Visibility ─────────────────────────

/**
 * document.read scope (API.md §7): author, assignee (or acting deputy) of any step, HR of the legal entity,
 * subject employee and the subject's managers (the latter two only once the document has left DRAFT). ADMIN: tenant.
 */
export async function documentScope(u: UserCtx, tx: Tx = prisma): Promise<Prisma.DocumentWhereInput> {
  const base: Prisma.DocumentWhereInput = { tenantId: u.tenantId };
  const le = hrLegalEntityIds(u);
  if (le === null) return base;
  const principals = await activePrincipalIds(u.userId, tx);
  const or: Prisma.DocumentWhereInput[] = [
    { authorId: u.userId },
    { steps: { some: { OR: [{ assigneeUserId: { in: [u.userId, ...principals] } }, { actedById: u.userId }] } } },
  ];
  if (le.length) or.push({ legalEntityId: { in: le } });
  if (u.employeeId) or.push({ subjectEmployeeId: u.employeeId, status: { not: 'DRAFT' } });
  const subtree = await managerSubtree(u);
  if (subtree.length) or.push({ subjectEmployeeId: { in: subtree }, status: { not: 'DRAFT' } });
  return { ...base, OR: or };
}

export async function canReadDocument(u: UserCtx, documentId: string): Promise<boolean> {
  return (await prisma.document.count({ where: { AND: [await documentScope(u), { id: documentId }] } })) > 0;
}

/** Loads a document the user may read; 404 otherwise (never leaks existence). */
export async function getReadableDocument(u: UserCtx, documentId: string) {
  const doc = await prisma.document.findFirst({ where: { AND: [await documentScope(u), { id: documentId }] } });
  if (!doc) throw notFound('Document');
  return doc;
}

/** HR/ADMIN whose scope covers the document's legal entity. */
export const isDocHr = (u: UserCtx, legalEntityId: string) => isHrOrAdmin(u) && legalEntityAllowed(u, legalEntityId);
export const canManageDoc = (u: UserCtx, doc: { authorId: string; legalEntityId: string }) => doc.authorId === u.userId || isDocHr(u, doc.legalEntityId);

// ───────────────────────── Create / update ─────────────────────────

export type CreateDocumentInput = {
  tenantId: string;
  authorUserId: string;
  documentTypeId: string;
  legalEntityId: string;
  title?: string | null;
  subjectEmployeeId?: string | null;
  data?: Record<string, unknown>;
  dueAt?: Date | null;
  startRoute?: boolean;
};

/**
 * Creates a document (generating its PDF from the type's template) and optionally starts its route.
 * Default title = type name + subject short name. Reusable by requests/ВНД/onboarding modules. Run in a transaction.
 */
export async function createDocument(tx: Tx, input: CreateDocumentInput): Promise<string> {
  const type = await tx.documentType.findFirst({ where: { id: input.documentTypeId, tenantId: input.tenantId } });
  if (!type) throw notFound('Document type');
  if (!type.isActive) throw businessRule('DOCUMENT_TYPE_INACTIVE', 'Document type is inactive');
  const le = await tx.legalEntity.findFirst({ where: { id: input.legalEntityId, tenantId: input.tenantId } });
  if (!le) throw notFound('Legal entity');
  let subjectName = '';
  if (input.subjectEmployeeId) {
    const subject = await tx.employee.findFirst({ where: { id: input.subjectEmployeeId, tenantId: input.tenantId }, include: { user: true } });
    if (!subject) throw notFound('Employee');
    if (subject.legalEntityId !== le.id) throw businessRule('SUBJECT_LEGAL_ENTITY_MISMATCH', 'The employee belongs to another legal entity');
    subjectName = shortName(subject.user);
  }
  const title = input.title?.trim() || [type.name, subjectName].filter(Boolean).join(' — ');
  const doc = await tx.document.create({
    data: {
      tenantId: input.tenantId, legalEntityId: le.id, documentTypeId: type.id, kind: type.kind, title,
      data: (input.data ?? {}) as Prisma.InputJsonValue, authorId: input.authorUserId, subjectEmployeeId: input.subjectEmployeeId ?? null,
      dueAt: input.dueAt ?? null,
    },
  });
  await refreshSearchText(doc.id, tx);
  // startRoute registers the number and renders the PDF itself; avoid rendering twice.
  if (!input.startRoute) await generateDocumentPdf(doc.id, tx);
  await audit({ tenantId: input.tenantId, userId: input.authorUserId }, 'document.create', 'Document', doc.id, { type: type.code, title }, { tx });
  if (input.startRoute) await startRoute(tx, doc.id, input.authorUserId);
  return doc.id;
}

/** Edits a DRAFT/REWORK document and regenerates its PDF. */
export async function updateDocument(tx: Tx, documentId: string, actorUserId: string, patch: { title?: string; data?: Record<string, unknown>; dueAt?: Date | null }) {
  const doc = await tx.document.findUniqueOrThrow({ where: { id: documentId } });
  if (doc.status !== 'DRAFT' && doc.status !== 'REWORK') throw businessRule('NOT_EDITABLE', 'Only drafts and documents returned for rework can be edited');
  await tx.document.update({
    where: { id: documentId },
    data: {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.data !== undefined ? { data: patch.data as Prisma.InputJsonValue } : {}),
      ...(patch.dueAt !== undefined ? { dueAt: patch.dueAt } : {}),
    },
  });
  await refreshSearchText(documentId, tx);
  await generateDocumentPdf(documentId, tx);
  await audit({ tenantId: doc.tenantId, userId: actorUserId }, 'document.update', 'Document', documentId, { fields: Object.keys(patch) }, { tx });
}

// ───────────────────────── Views ─────────────────────────

export const listInclude = {
  documentType: { select: { id: true, name: true, code: true, esutdRequired: true } },
  legalEntity: { select: { id: true, name: true } },
  subject: { select: { id: true, user: { select: userRefSelect } } },
  steps: { orderBy: [{ order: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.DocumentInclude;
export type DocListRow = Prisma.DocumentGetPayload<{ include: typeof listInclude }>;

async function userRefs(ids: string[], tx: Tx = prisma): Promise<Map<string, UserRef>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const rows = await tx.user.findMany({ where: { id: { in: uniq } }, select: userRefSelect });
  return new Map(rows.map((r) => [r.id, toUserRef(r)]));
}

const unknownRef = (id: string): UserRef => ({ id, fullName: '—', shortName: '—', position: null, department: null });

export type ViewerCtx = { userId: string; principalIds: string[]; hrLegalEntities: string[] | null | 'none' };

export async function viewerCtx(u: UserCtx, tx: Tx = prisma): Promise<ViewerCtx> {
  const hr = u.grants.filter((g) => g.role === 'HR');
  return {
    userId: u.userId,
    principalIds: await activePrincipalIds(u.userId, tx),
    hrLegalEntities: hr.length === 0 ? 'none' : hr.some((g) => g.legalEntityId === null) ? null : hr.map((g) => g.legalEntityId!),
  };
}

const isOverdue = (d: DocListRow, now = new Date()) =>
  d.status === 'IN_ROUTE' && ((!!d.dueAt && d.dueAt < now) || d.steps.some((s) => s.status === 'PENDING' && !!s.dueAt && s.dueAt < now));

/** Maps documents to DocumentListItem (batching user lookups). */
export async function toListItems(rows: DocListRow[], viewer: ViewerCtx, tx: Tx = prisma) {
  const ids = rows.flatMap((d) => [d.authorId, ...d.steps.filter((s) => s.status === 'PENDING').map((s) => s.assigneeUserId)]);
  const refs = await userRefs(ids, tx);
  // HR pool: which pending assignees are HR of the doc's legal entity (only needed when the viewer is HR).
  let hrAssignees = new Set<string>();
  if (viewer.hrLegalEntities !== 'none') {
    const assignees = [...new Set(rows.flatMap((d) => d.steps.filter((s) => s.status === 'PENDING').map((s) => s.assigneeUserId)))];
    const grants = assignees.length ? await tx.roleAssignment.findMany({ where: { userId: { in: assignees }, role: 'HR' } }) : [];
    hrAssignees = new Set(grants.map((g) => `${g.userId}:${g.legalEntityId ?? '*'}`));
  }
  const viewerHrCovers = (le: string) => viewer.hrLegalEntities === null || (Array.isArray(viewer.hrLegalEntities) && viewer.hrLegalEntities.includes(le));
  const now = new Date();
  return rows.map((d) => {
    const pending = d.steps.filter((s) => s.status === 'PENDING');
    const current = pending[0] ?? null;
    let mine = pending.find((s) => s.assigneeUserId === viewer.userId) ?? pending.find((s) => viewer.principalIds.includes(s.assigneeUserId));
    if (!mine && viewerHrCovers(d.legalEntityId)) {
      mine = pending.find((s) => hrAssignees.has(`${s.assigneeUserId}:${d.legalEntityId}`) || hrAssignees.has(`${s.assigneeUserId}:*`));
    }
    return {
      id: d.id,
      title: d.title,
      number: d.number,
      kind: d.kind,
      type: { id: d.documentType.id, name: d.documentType.name },
      status: d.status,
      legalEntity: { id: d.legalEntity.id, name: d.legalEntity.name },
      subject: d.subject ? { ...toUserRef(d.subject.user), employeeId: d.subject.id } : null,
      author: refs.get(d.authorId) ?? unknownRef(d.authorId),
      currentStep: current && d.status === 'IN_ROUTE'
        ? { action: current.action, assignee: refs.get(current.assigneeUserId) ?? unknownRef(current.assigneeUserId), dueAt: current.dueAt?.toISOString() ?? null }
        : null,
      myPendingAction: d.status === 'IN_ROUTE' ? (mine?.action ?? null) : null,
      dueAt: d.dueAt?.toISOString() ?? null,
      overdue: isOverdue(d, now),
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    };
  });
}

export const detailInclude = {
  ...listInclude,
  signatures: true,
  files: { orderBy: { createdAt: 'asc' }, include: { versions: { orderBy: { version: 'desc' }, include: { storedFile: true } } } },
  linksFrom: { include: { to: { select: { id: true, title: true, number: true, status: true } } } },
  linksTo: { include: { from: { select: { id: true, title: true, number: true, status: true } } } },
  esutd: true,
  _count: { select: { comments: true } },
} satisfies Prisma.DocumentInclude;
type DocDetailRow = Prisma.DocumentGetPayload<{ include: typeof detailInclude }>;

type FileRow = DocDetailRow['files'][number];
export async function toFileViews(files: FileRow[], tx: Tx = prisma) {
  const refs = await userRefs(files.flatMap((f) => f.versions.map((v) => v.uploadedById)), tx);
  return files.map((f) => ({
    id: f.id,
    name: f.name,
    currentVersion: f.currentVersion,
    versions: f.versions.map((v) => ({
      version: v.version, file: toFileRef(v.storedFile), uploadedBy: refs.get(v.uploadedById) ?? unknownRef(v.uploadedById), createdAt: v.createdAt.toISOString(),
    })),
  }));
}

/** Full DocumentDetail for the viewer. */
export async function getDocumentDetail(u: UserCtx, documentId: string, tx: Tx = prisma) {
  const d = await tx.document.findUniqueOrThrow({ where: { id: documentId }, include: detailInclude });
  const viewer = await viewerCtx(u, tx);
  const [item] = await toListItems([d], viewer, tx);
  const refs = await userRefs(d.steps.flatMap((s) => [s.assigneeUserId, s.actedById ?? '']), tx);
  const sigByStep = new Map(d.signatures.filter((s) => s.routeStepId).map((s) => [s.routeStepId!, s]));
  const request = await tx.request.findFirst({ where: { OR: [{ applicationDocumentId: d.id }, { orderDocumentId: d.id }] }, select: { id: true, status: true } });
  const manage = canManageDoc(u, d);
  const hr = isDocHr(u, d.legalEntityId);
  const editable = d.status === 'DRAFT' || d.status === 'REWORK';
  return {
    ...item!,
    data: d.data as Record<string, unknown>,
    registeredAt: optDateStr(d.registeredAt),
    backdated: d.backdated,
    paperSigned: d.paperSigned,
    pdfUrl: d.pdfFileId ? `/api/v1/documents/${d.id}/pdf` : null,
    signedPdfUrl: d.signedPdfFileId ? `/api/v1/documents/${d.id}/pdf?signed=true` : null,
    pdfFileUrl: d.pdfFileId ? fileUrl(d.pdfFileId) : null,
    steps: d.steps.map((s) => {
      const sig = sigByStep.get(s.id);
      const onBehalf = sig?.onBehalfOfUserId ?? (s.actedById && s.actedById !== s.assigneeUserId ? s.assigneeUserId : null);
      return {
        id: s.id, order: s.order, action: s.action, status: s.status,
        assignee: refs.get(s.assigneeUserId) ?? unknownRef(s.assigneeUserId),
        actedBy: s.actedById ? (refs.get(s.actedById) ?? unknownRef(s.actedById)) : null,
        onBehalfOf: onBehalf ? (refs.get(onBehalf) ?? unknownRef(onBehalf)) : null,
        dueAt: s.dueAt?.toISOString() ?? null, viewedAt: s.viewedAt?.toISOString() ?? null, actedAt: s.actedAt?.toISOString() ?? null,
        comment: s.comment, signatureMethod: sig?.method ?? null,
      };
    }),
    files: await toFileViews(d.files, tx),
    links: [
      ...d.linksFrom.map((l) => ({ id: l.id, relation: l.relation, direction: 'from' as const, document: l.to })),
      ...d.linksTo.map((l) => ({ id: l.id, relation: l.relation, direction: 'to' as const, document: l.from })),
    ],
    commentsCount: d._count.comments,
    esutd: d.esutd ? { status: d.esutd.status, sentAt: d.esutd.sentAt?.toISOString() ?? null, error: d.esutd.error } : null,
    canEdit: manage && editable,
    canStart: manage && editable,
    canCancel: manage && !['COMPLETED', 'CANCELLED', 'REJECTED'].includes(d.status),
    canRegister: hr && !['CANCELLED', 'REJECTED'].includes(d.status),
    request,
  };
}

/** Marks the viewer's own (or deputy) pending step as viewed (first view only). */
export async function markViewed(u: UserCtx, documentId: string) {
  const act = await findActionableStep(prisma, { userId: u.userId }, documentId);
  if (act && act.via !== 'HR_POOL' && !act.step.viewedAt) {
    await prisma.routeStep.update({ where: { id: act.step.id }, data: { viewedAt: new Date() } });
  }
}

/** Count of PENDING steps the user can act on directly or as an active deputy (sidebar badge). */
export async function pendingStepCount(userId: string, tx: Tx = prisma): Promise<number> {
  const principals = await activePrincipalIds(userId, tx);
  return tx.routeStep.count({ where: { status: 'PENDING', assigneeUserId: { in: [userId, ...principals] }, document: { status: 'IN_ROUTE' } } });
}
