import QRCode from 'qrcode';
import type { SigningSession } from '@prisma/client';
import { prisma } from '../../lib/db';
import type { UserCtx } from '../../lib/auth';
import { AppError, businessRule, conflict, notFound } from '../../lib/errors';
import { randomToken, sha256 } from '../../lib/crypto';
import { audit } from '../../lib/audit';
import { config } from '../../config';
import { activePrincipalIds } from '../deputies/service';
import { findActionableStep, inTx, signAndComplete } from '../documents/route-engine';

/**
 * Signing sessions (F-18, F-20 bulk sign). A session bundles the documents where the user has a PENDING
 * SIGN/ACKNOWLEDGE step (own or as an active deputy). eGov methods show a QR that opens the in-app
 * "eGov mobile (sandbox)" page; NCALayer confirms with the signing PIN. Tokens are stored hashed; 5 min expiry.
 */
export const SESSION_TTL_MS = 5 * 60_000;
export type SessionMethod = 'EGOV_MOBILE' | 'EGOV_BUSINESS' | 'NCALAYER';
const SIGN_ACTIONS = ['SIGN', 'ACKNOWLEDGE'] as const;

type Signer = Pick<UserCtx, 'userId' | 'tenantId' | 'grants'>;

const canSignFor = (u: Signer, legalEntityId: string) => u.grants.some((g) => g.canSign && (g.legalEntityId === null || g.legalEntityId === legalEntityId));

/** Documents (of the given ids) the user can sign now; throws 422 NOTHING_TO_SIGN / NOT_SIGNATORY. */
export async function signableDocuments(u: Signer, documentIds: string[], method: SessionMethod) {
  const principalIds = await activePrincipalIds(u.userId);
  const docs = await prisma.document.findMany({ where: { id: { in: [...new Set(documentIds)] }, tenantId: u.tenantId, status: 'IN_ROUTE' } });
  const eligible: typeof docs = [];
  for (const d of docs) {
    if (await findActionableStep(prisma, { userId: u.userId, principalIds }, d.id, [...SIGN_ACTIONS])) eligible.push(d);
  }
  if (!eligible.length) throw businessRule('NOTHING_TO_SIGN', 'There are no documents awaiting your signature');
  if (method === 'EGOV_BUSINESS') {
    const denied = eligible.filter((d) => !canSignFor(u, d.legalEntityId));
    if (denied.length) throw businessRule('NOT_SIGNATORY', 'You have no signing authority for the legal entity of these documents', { documentIds: denied.map((d) => d.id) });
  }
  // Keep the caller's order.
  const order = new Map(documentIds.map((id, i) => [id, i]));
  return eligible.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export async function sessionView(s: SigningSession, qr?: { qrUrl: string; qrDataUrl: string } | null) {
  let status = s.status;
  if (status === 'PENDING' && s.expiresAt < new Date()) {
    status = 'EXPIRED';
    await prisma.signingSession.updateMany({ where: { id: s.id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
  }
  const signedCount = await prisma.signature.count({ where: { documentId: { in: s.documentIds }, signerUserId: s.userId, signedAt: { gte: s.createdAt } } });
  return {
    id: s.id, method: s.method, status, qrDataUrl: qr?.qrDataUrl ?? null, qrUrl: qr?.qrUrl ?? null, expiresAt: s.expiresAt.toISOString(),
    documentIds: s.documentIds, signedCount,
  };
}

export async function createSigningSession(u: Signer, documentIds: string[], method: SessionMethod) {
  const docs = await signableDocuments(u, documentIds, method);
  const token = randomToken(24);
  const session = await prisma.signingSession.create({
    data: { tenantId: u.tenantId, userId: u.userId, method, documentIds: docs.map((d) => d.id), tokenHash: sha256(token), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
  let qr: { qrUrl: string; qrDataUrl: string } | null = null;
  if (method !== 'NCALAYER') {
    const qrUrl = `${config.APP_URL}/ru/sign/${token}`;
    qr = { qrUrl, qrDataUrl: await QRCode.toDataURL(qrUrl, { errorCorrectionLevel: 'M', margin: 1, width: 320 }) };
  }
  await audit({ tenantId: u.tenantId, userId: u.userId }, 'signing.session_create', 'SigningSession', session.id, { method, documents: session.documentIds.length });
  return sessionView(session, qr);
}

export async function getOwnSession(u: Signer, id: string) {
  const s = await prisma.signingSession.findFirst({ where: { id, userId: u.userId, tenantId: u.tenantId } });
  if (!s) throw notFound('Signing session');
  return s;
}

export async function getSessionByToken(u: Signer, token: string) {
  const s = await prisma.signingSession.findUnique({ where: { tokenHash: sha256(token) } });
  if (!s || s.userId !== u.userId) throw notFound('Signing session');
  return s;
}

/**
 * Claims a PENDING session and signs each document (SHA-256 of the current PDF, ECDSA P-256), completing the steps.
 * Documents that can no longer be signed (e.g. signed meanwhile by a deputy) are skipped.
 */
export async function signSession(u: Signer, session: SigningSession) {
  if (session.status === 'PENDING' && session.expiresAt < new Date()) {
    await prisma.signingSession.update({ where: { id: session.id }, data: { status: 'EXPIRED' } });
    throw businessRule('SESSION_EXPIRED', 'The signing session has expired, start a new one');
  }
  const claimed = await prisma.signingSession.updateMany({ where: { id: session.id, status: 'PENDING' }, data: { status: 'COMPLETED' } });
  if (claimed.count === 0) throw conflict(`Signing session is ${session.status.toLowerCase()}`, { rule: 'SESSION_NOT_PENDING' });
  const method = session.method as SessionMethod;
  const principalIds = await activePrincipalIds(u.userId);
  let signed = 0;
  for (const documentId of session.documentIds) {
    const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { legalEntityId: true } });
    if (!doc || (method === 'EGOV_BUSINESS' && !canSignFor(u, doc.legalEntityId))) continue;
    try {
      await inTx((tx) => signAndComplete(tx, { documentId, actorUserId: u.userId, method, actions: [...SIGN_ACTIONS], principalIds }));
      signed++;
    } catch (e) {
      if (!(e instanceof AppError)) throw e; // business/conflict errors → skip this document
    }
  }
  if (signed === 0) {
    await prisma.signingSession.update({ where: { id: session.id }, data: { status: 'CANCELLED' } });
    throw businessRule('NOTHING_TO_SIGN', 'None of the documents in this session can be signed anymore');
  }
  await audit({ tenantId: u.tenantId, userId: u.userId }, 'signing.session_signed', 'SigningSession', session.id, { method, signed });
  return sessionView(await prisma.signingSession.findUniqueOrThrow({ where: { id: session.id } }));
}

export async function declineSession(u: Signer, session: SigningSession) {
  const res = await prisma.signingSession.updateMany({ where: { id: session.id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
  if (res.count === 0) throw conflict(`Signing session is ${session.status.toLowerCase()}`, { rule: 'SESSION_NOT_PENDING' });
  await audit({ tenantId: u.tenantId, userId: u.userId }, 'signing.session_declined', 'SigningSession', session.id, {});
  return sessionView(await prisma.signingSession.findUniqueOrThrow({ where: { id: session.id } }));
}
