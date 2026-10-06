import type { FastifyReply, FastifyRequest } from 'fastify';
import { hasPermission, permissionsForRoles, type Permission, type Role } from '@akere/shared';
import { config, isProd } from '../config';
import { prisma } from './db';
import { randomToken, sha256 } from './crypto';
import { forbidden, unauthenticated } from './errors';

export const SESSION_COOKIE = 'akere_session';

export type RoleGrant = { role: Role; legalEntityId: string | null; canSign: boolean };

export type UserCtx = {
  kind: 'user';
  sessionId: string;
  userId: string;
  tenantId: string;
  roles: Role[];
  grants: RoleGrant[];
  permissions: Permission[];
  employeeId: string | null;
  locale: string;
  pending2fa: boolean;
};

export type CandidateCtx = { kind: 'candidate'; sessionId: string; candidateId: string; tenantId: string };
export type AuthCtx = UserCtx | CandidateCtx;

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthCtx | null;
  }
}

const ttlMs = () => config.SESSION_TTL_HOURS * 3_600_000;

export async function createSession(
  reply: FastifyReply,
  req: FastifyRequest,
  subject: { userId: string; pending2fa?: boolean } | { candidateId: string },
) {
  const token = randomToken();
  const data =
    'userId' in subject
      ? { subjectType: 'USER' as const, userId: subject.userId, pending2fa: subject.pending2fa ?? false }
      : { subjectType: 'CANDIDATE' as const, candidateId: subject.candidateId };
  const session = await prisma.session.create({
    data: {
      ...data,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + ttlMs()),
      ip: req.ip,
      userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
    },
  });
  setSessionCookie(reply, token);
  return session;
}

export function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.COOKIE_SECURE ?? isProd,
    maxAge: Math.floor(ttlMs() / 1000),
  });
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply) {
  if (req.auth) await prisma.session.deleteMany({ where: { id: req.auth.sessionId } });
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Resolves the cookie into req.auth. Sliding expiry: extends the session when past half its life. */
export async function resolveAuth(req: FastifyRequest): Promise<AuthCtx | null> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: {
      user: { include: { roles: true, employee: { select: { id: true, status: true } } } },
      candidate: { select: { id: true, tenantId: true, status: true } },
    },
  });
  if (!session || session.expiresAt < new Date()) return null;
  if (session.expiresAt.getTime() - Date.now() < ttlMs() / 2) {
    await prisma.session.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() + ttlMs()) } });
  }
  if (session.subjectType === 'CANDIDATE') {
    if (!session.candidate || session.candidate.status === 'BLOCKED') return null;
    return { kind: 'candidate', sessionId: session.id, candidateId: session.candidate.id, tenantId: session.candidate.tenantId };
  }
  const user = session.user;
  if (!user || !user.isActive) return null;
  const roles = [...new Set(user.roles.map((r) => r.role))] as Role[];
  return {
    kind: 'user',
    sessionId: session.id,
    userId: user.id,
    tenantId: user.tenantId,
    roles,
    grants: user.roles.map((r) => ({ role: r.role, legalEntityId: r.legalEntityId, canSign: r.canSign })),
    permissions: permissionsForRoles(roles),
    employeeId: user.employee?.status === 'ACTIVE' ? user.employee.id : null,
    locale: user.locale,
    pending2fa: session.pending2fa,
  };
}

/** Use at the top of every staff handler. Throws 401/403. */
export function requireUser(req: FastifyRequest, ...perms: Permission[]): UserCtx {
  const a = req.auth;
  if (!a || a.kind !== 'user' || a.pending2fa) throw unauthenticated();
  for (const p of perms) if (!hasPermission(a.roles, p)) throw forbidden();
  return a;
}

export function requireCandidate(req: FastifyRequest): CandidateCtx {
  const a = req.auth;
  if (!a || a.kind !== 'candidate') throw unauthenticated();
  return a;
}

export const can = (u: UserCtx, p: Permission) => hasPermission(u.roles, p);
export const hasRole = (u: UserCtx, ...roles: Role[]) => u.roles.some((r) => roles.includes(r));
