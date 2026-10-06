import type { Prisma } from '@prisma/client';
import type { EsutdItem } from '@akere/shared';
import { prisma, type Tx } from '../../lib/db';
import type { UserCtx } from '../../lib/auth';
import { audit } from '../../lib/audit';
import { fullName, toUserRef, userRefSelect } from '../../lib/names';
import { optDateStr } from '../../lib/dates';
import { hrLegalEntityIds } from '../../lib/scope';
import { esutd, validateEsutdPayload, type EsutdPayload } from '../../adapters/esutd';

/**
 * ЕСУТД registry (F-24). Every COMPLETED document whose type has esutdRequired gets an EsutdSubmission (NOT_SENT) —
 * created by the `document.completed` hook and lazily backfilled for older documents. HR queues documents
 * (validation first), the `esutd-queue` job sends QUEUED rows through the adapter: SENT + externalId, or ERROR + reason.
 * ERROR rows can be queued again.
 */

/** Creates the NOT_SENT row for a completed esutdRequired document (idempotent). */
export async function ensureSubmissionFor(tx: Tx, documentId: string) {
  const doc = await tx.document.findUnique({ where: { id: documentId }, select: { id: true, tenantId: true, status: true, kind: true, documentType: { select: { esutdRequired: true } } } });
  if (!doc || doc.status !== 'COMPLETED' || doc.kind === 'ARCHIVE' || !doc.documentType.esutdRequired) return;
  await tx.esutdSubmission.upsert({ where: { documentId: doc.id }, create: { tenantId: doc.tenantId, documentId: doc.id }, update: {} });
}

/** Backfill: completed esutdRequired documents without a submission row appear as NOT_SENT. */
export async function backfillSubmissions(tenantId: string, tx: Tx = prisma): Promise<number> {
  const missing = await tx.document.findMany({
    where: { tenantId, status: 'COMPLETED', kind: { not: 'ARCHIVE' }, documentType: { esutdRequired: true }, esutd: { is: null } },
    select: { id: true },
    take: 5000,
  });
  if (!missing.length) return 0;
  const res = await tx.esutdSubmission.createMany({ data: missing.map((d) => ({ tenantId, documentId: d.id })), skipDuplicates: true });
  return res.count;
}

export function esutdScope(u: UserCtx): Prisma.EsutdSubmissionWhereInput {
  const le = hrLegalEntityIds(u);
  return { tenantId: u.tenantId, document: { status: 'COMPLETED', ...(le === null ? {} : { legalEntityId: { in: le } }) } };
}

export const esutdInclude = {
  document: {
    include: {
      documentType: { select: { id: true, name: true } },
      subject: { select: { id: true, userId: true, user: { select: userRefSelect } } },
      signatures: { orderBy: { signedAt: 'asc' }, select: { signerUserId: true, onBehalfOfUserId: true, method: true } },
    },
  },
} satisfies Prisma.EsutdSubmissionInclude;
type Row = Prisma.EsutdSubmissionGetPayload<{ include: typeof esutdInclude }>;

export async function toEsutdItems(rows: Row[]): Promise<EsutdItem[]> {
  const signerOf = (r: Row) => {
    const s = r.document.signatures.find((x) => x.method !== 'PAPER' && x.signerUserId !== r.document.subject?.userId);
    return s ? (s.onBehalfOfUserId ?? s.signerUserId) : null;
  };
  const ids = [...new Set(rows.map(signerOf).filter((x): x is string => !!x))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: userRefSelect }) : [];
  const refs = new Map(users.map((x) => [x.id, toUserRef(x)]));
  return rows.map((r) => {
    const signer = signerOf(r);
    return {
      documentId: r.documentId,
      number: r.document.number,
      type: r.document.documentType,
      title: r.document.title,
      employee: r.document.subject ? { ...toUserRef(r.document.subject.user), employeeId: r.document.subject.id } : null,
      signer: signer ? (refs.get(signer) ?? null) : null,
      status: r.status,
      sentAt: r.sentAt?.toISOString() ?? null,
      externalId: r.externalId,
      error: r.error,
      attempts: r.attempts,
      registeredAt: optDateStr(r.document.registeredAt),
    };
  });
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v && !Number.isNaN(Number(v)) ? Number(v) : null);

/** Builds the ЕСУТД payload from the document, its subject and legal entity. */
export async function buildPayload(documentId: string, attempt: number, tx: Tx = prisma): Promise<EsutdPayload | { errors: string[] }> {
  const d = await tx.document.findUniqueOrThrow({
    where: { id: documentId },
    include: { documentType: true, legalEntity: true, subject: { include: { user: true, position: true } } },
  });
  const data = (d.data ?? {}) as Record<string, unknown>;
  const startDate = str(data.startDate) ?? str(data.effectiveDate) ?? (d.kind === 'CONTRACT' && d.subject ? optDateStr(d.subject.hireDate) : null);
  const draft = {
    documentId: d.id, documentKind: d.kind, documentType: d.documentType.name, number: d.number ?? '', date: optDateStr(d.registeredAt) ?? '',
    employer: { bin: d.legalEntity.bin, name: d.legalEntity.name },
    employee: d.subject ? { iin: d.subject.iin ?? '', fullName: fullName(d.subject.user), position: d.subject.position?.name ?? null } : null,
    contract: { startDate, endDate: str(data.endDate), salary: num(data.salary) },
    attempt,
  };
  const errors = validateEsutdPayload(draft);
  if (errors.length || !draft.employee) return { errors };
  return { ...draft, employee: draft.employee };
}

export type SubmitResult = { succeeded: string[]; failed: { id: string; reason: string }[] };

/** Queues documents for sending (COMPLETED + esutdRequired, not yet SENT/QUEUED); validation failures become ERROR rows. */
export async function submitDocuments(u: UserCtx, documentIds: string[]): Promise<SubmitResult> {
  const le = hrLegalEntityIds(u);
  const out: SubmitResult = { succeeded: [], failed: [] };
  for (const id of [...new Set(documentIds)]) {
    const doc = await prisma.document.findFirst({
      where: { id, tenantId: u.tenantId, ...(le === null ? {} : { legalEntityId: { in: le } }) },
      include: { documentType: { select: { esutdRequired: true } }, esutd: true },
    });
    if (!doc) {
      out.failed.push({ id, reason: 'NOT_FOUND' });
      continue;
    }
    if (doc.status !== 'COMPLETED') {
      out.failed.push({ id, reason: 'NOT_COMPLETED' });
      continue;
    }
    if (!doc.documentType.esutdRequired || doc.kind === 'ARCHIVE') {
      out.failed.push({ id, reason: 'ESUTD_NOT_REQUIRED' });
      continue;
    }
    if (doc.esutd?.status === 'SENT') {
      out.failed.push({ id, reason: 'ALREADY_SENT' });
      continue;
    }
    if (doc.esutd?.status === 'QUEUED') {
      out.failed.push({ id, reason: 'ALREADY_QUEUED' });
      continue;
    }
    const payload = await buildPayload(id, (doc.esutd?.attempts ?? 0) + 1);
    if ('errors' in payload) {
      const error = `Не отправлено: ${payload.errors.join('; ')}.`;
      await prisma.esutdSubmission.upsert({
        where: { documentId: id }, create: { tenantId: u.tenantId, documentId: id, status: 'ERROR', error }, update: { status: 'ERROR', error },
      });
      out.failed.push({ id, reason: error });
      continue;
    }
    await prisma.esutdSubmission.upsert({
      where: { documentId: id }, create: { tenantId: u.tenantId, documentId: id, status: 'QUEUED' }, update: { status: 'QUEUED', error: null },
    });
    out.succeeded.push(id);
  }
  await audit(u, 'esutd.submit', 'EsutdSubmission', null, { queued: out.succeeded, failed: out.failed.length });
  return out;
}

/** Job body: sends QUEUED submissions through the adapter (oldest first). */
export async function processEsutdQueue(limit = 100): Promise<{ sent: number; errors: number }> {
  const queued = await prisma.esutdSubmission.findMany({ where: { status: 'QUEUED' }, orderBy: { updatedAt: 'asc' }, take: limit });
  let sent = 0;
  let errors = 0;
  for (const s of queued) {
    const attempt = s.attempts + 1;
    const payload = await buildPayload(s.documentId, attempt);
    const result = 'errors' in payload
      ? { ok: false as const, error: `ЕСУТД отклонил документ: ${payload.errors.join('; ')}.` }
      : await esutd.submit(payload).catch((e: Error) => ({ ok: false as const, error: `ЕСУТД: ошибка соединения (${e.message.slice(0, 200)})` }));
    // Claim only rows still QUEUED (another worker or a resubmission may have changed it).
    const res = await prisma.esutdSubmission.updateMany({
      where: { id: s.id, status: 'QUEUED' },
      data: result.ok
        ? { status: 'SENT', externalId: result.externalId, sentAt: new Date(), error: null, attempts: attempt }
        : { status: 'ERROR', error: result.error, attempts: attempt },
    });
    if (!res.count) continue;
    if (result.ok) sent++;
    else errors++;
    await audit({ tenantId: s.tenantId }, result.ok ? 'esutd.sent' : 'esutd.error', 'Document', s.documentId, result.ok ? { externalId: result.externalId } : { error: result.error });
  }
  return { sent, errors };
}

export async function esutdCounts(u: UserCtx) {
  await backfillSubmissions(u.tenantId);
  const scope = esutdScope(u);
  const [notSent, errors] = await Promise.all([
    prisma.esutdSubmission.count({ where: { AND: [scope, { status: 'NOT_SENT' }] } }),
    prisma.esutdSubmission.count({ where: { AND: [scope, { status: 'ERROR' }] } }),
  ]);
  return { notSent, errors };
}
