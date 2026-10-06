import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ChangePasswordInput, DemoLoginInput, ForgotInput, LoginInput, OtpInput, ResetInput } from '@akere/shared';
import { config } from '../../config';
import { prisma } from '../../lib/db';
import { createSession, destroySession, requireUser } from '../../lib/auth';
import { hashPassword, verifyPassword } from '../../lib/crypto';
import { AppError, badRequest, notFound, unauthenticated } from '../../lib/errors';
import { issueOtp, verifyOtp } from '../../lib/otp';
import { fullName, maskTarget } from '../../lib/names';
import { audit } from '../../lib/audit';
import { buildMe } from './me';

const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60_000;

/**
 * Limiter for credential endpoints: 20 requests / 15 min per login identifier + IP.
 * Password guessing is stopped earlier by the account lockout (5 failures → 15 min).
 */
const credentialLimit = {
  rateLimit: {
    max: 20,
    timeWindow: '15 minutes',
    hook: 'preHandler' as const,
    keyGenerator: (req: FastifyRequest) => `${req.ip}:${String((req.body as { login?: string } | undefined)?.login ?? '').toLowerCase()}`,
  },
};

function normalizeLogin(login: string) {
  const l = login.trim().toLowerCase();
  if (l.includes('@')) return { email: l };
  return { phone: l.replace(/[\s()-]/g, '').replace(/^8(\d{10})$/, '+7$1') };
}

export default async function authRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post('/login', { schema: { body: LoginInput }, config: credentialLimit }, async (req, reply) => {
    const user = await prisma.user.findFirst({ where: normalizeLogin(req.body.login) });
    const invalid = new AppError(401, 'UNAUTHENTICATED', 'Неверный логин или пароль');
    if (!user || !user.isActive) {
      await verifyPassword('$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$Zm9v', req.body.password); // equalize timing
      throw invalid;
    }
    const locked = (until: Date | null) =>
      new AppError(429, 'RATE_LIMITED', 'Account temporarily locked', { retryAfterSec: Math.max(1, Math.ceil(((until?.getTime() ?? Date.now() + LOCK_MS) - Date.now()) / 1000)) });
    if (user.lockedUntil && user.lockedUntil > new Date()) throw locked(user.lockedUntil);
    // Reserve an attempt atomically BEFORE the (slow) password check, so parallel guesses cannot all slip past the
    // counter: the attempt that reaches LOCK_AFTER sets the lock at once and later ones are refused without verifying.
    // An expired lock restarts the count. A successful login clears both fields.
    const lockMs = LOCK_MS;
    const reserved = await prisma.$queryRaw<{ failedLogins: number }[]>`
      UPDATE "User" SET
        "failedLogins" = CASE WHEN "lockedUntil" IS NOT NULL THEN 1 ELSE "failedLogins" + 1 END,
        "lockedUntil" = CASE WHEN (CASE WHEN "lockedUntil" IS NOT NULL THEN 1 ELSE "failedLogins" + 1 END) >= ${LOCK_AFTER}
          THEN now() + make_interval(secs => ${lockMs / 1000}) ELSE NULL END
      WHERE id = ${user.id} AND ("lockedUntil" IS NULL OR "lockedUntil" <= now())
        AND (CASE WHEN "lockedUntil" IS NOT NULL THEN 0 ELSE "failedLogins" END) < ${LOCK_AFTER}
      RETURNING "failedLogins"`;
    if (!reserved.length) {
      const cur = await prisma.user.findUnique({ where: { id: user.id }, select: { lockedUntil: true } });
      throw locked(cur?.lockedUntil ?? null);
    }
    if (!(await verifyPassword(user.passwordHash, req.body.password))) {
      await audit({ tenantId: user.tenantId, userId: user.id }, 'auth.login_failed', 'User', user.id, {}, { ip: req.ip });
      throw invalid;
    }
    await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    if (user.twoFactorEnabled) {
      const channel = user.phone ? 'SMS' : 'EMAIL';
      const target = user.phone ?? user.email;
      await createSession(reply, req, { userId: user.id, pending2fa: true });
      await issueOtp({ purpose: 'LOGIN_2FA', target, channel, tenantId: user.tenantId, userId: user.id, lang: user.locale });
      return { status: 'OTP_REQUIRED' as const, channel, maskedTarget: maskTarget(target) };
    }
    await createSession(reply, req, { userId: user.id });
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await audit({ tenantId: user.tenantId, userId: user.id }, 'auth.login', 'User', user.id, {}, { ip: req.ip });
    return { status: 'OK' as const, me: await buildMe(user.id) };
  });

  app.post('/login/otp', { schema: { body: OtpInput }, config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req) => {
    const a = req.auth;
    if (!a || a.kind !== 'user' || !a.pending2fa) throw unauthenticated();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: a.userId } });
    const ok = await verifyOtp({ purpose: 'LOGIN_2FA', target: user.phone ?? user.email, code: req.body.code, userId: user.id });
    if (!ok) throw badRequest('Неверный или просроченный код', { fieldErrors: { code: ['Invalid code'] }, formErrors: [] });
    await prisma.session.update({ where: { id: a.sessionId }, data: { pending2fa: false } });
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await audit(a, 'auth.login', 'User', user.id, { twoFactor: true }, { ip: req.ip });
    return { status: 'OK' as const, me: await buildMe(user.id) };
  });

  app.post('/logout', async (req, reply) => {
    await destroySession(req, reply);
    return reply.status(204).send();
  });

  app.get('/me', async (req) => {
    const u = requireUser(req);
    return buildMe(u.userId);
  });

  app.post('/password/forgot', { schema: { body: ForgotInput }, config: credentialLimit }, async (req, reply) => {
    const user = await prisma.user.findFirst({ where: normalizeLogin(req.body.login) });
    if (user?.isActive) {
      const byPhone = !req.body.login.includes('@') && user.phone;
      await issueOtp({
        purpose: 'PASSWORD_RESET',
        target: byPhone ? user.phone! : user.email,
        channel: byPhone ? 'SMS' : 'EMAIL',
        tenantId: user.tenantId,
        userId: user.id,
        lang: user.locale,
      }).catch(() => undefined); // never reveal throttling or existence
    }
    return reply.status(204).send();
  });

  app.post('/password/reset', { schema: { body: ResetInput }, config: credentialLimit }, async (req, reply) => {
    const user = await prisma.user.findFirst({ where: normalizeLogin(req.body.login) });
    const byPhone = !req.body.login.includes('@');
    const target = user ? (byPhone ? user.phone : user.email) : null;
    const ok = user && target && (await verifyOtp({ purpose: 'PASSWORD_RESET', target, code: req.body.code, userId: user.id }));
    if (!ok || !user) throw badRequest('Неверный или просроченный код', { fieldErrors: { code: ['Invalid code'] }, formErrors: [] });
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(req.body.newPassword), failedLogins: 0, lockedUntil: null } }),
      prisma.session.deleteMany({ where: { userId: user.id } }),
    ]);
    await audit({ tenantId: user.tenantId, userId: user.id }, 'auth.password_reset', 'User', user.id, {}, { ip: req.ip });
    return reply.status(204).send();
  });

  app.post('/password/change', { schema: { body: ChangePasswordInput } }, async (req, reply) => {
    const u = requireUser(req);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: u.userId } });
    if (!(await verifyPassword(user.passwordHash, req.body.currentPassword))) {
      throw badRequest('Текущий пароль неверен', { fieldErrors: { currentPassword: ['Wrong password'] }, formErrors: [] });
    }
    await prisma.$transaction([
      prisma.user.update({ where: { id: u.userId }, data: { passwordHash: await hashPassword(req.body.newPassword) } }),
      prisma.session.deleteMany({ where: { userId: u.userId, id: { not: u.sessionId } } }),
    ]);
    await audit(u, 'auth.password_change', 'User', u.userId, {}, { ip: req.ip });
    return reply.status(204).send();
  });

  // Demo helpers (A-04). Disabled unless DEMO_MODE=true.
  app.get('/demo-users', async () => {
    if (!config.DEMO_MODE) throw notFound('Route');
    const users = await prisma.user.findMany({
      where: { isActive: true, demoListed: true },
      include: { roles: true, employee: { select: { position: { select: { name: true } } } } },
      orderBy: { demoOrder: 'asc' },
      take: 20,
    });
    return users.map((u) => ({
      id: u.id,
      fullName: fullName(u),
      roles: [...new Set(u.roles.map((r) => r.role))],
      position: u.employee?.position?.name ?? null,
    }));
  });

  app.post('/demo-login', { schema: { body: DemoLoginInput } }, async (req, reply) => {
    if (!config.DEMO_MODE) throw notFound('Route');
    const user = await prisma.user.findFirst({ where: { id: req.body.userId, isActive: true, demoListed: true } });
    if (!user) throw notFound('User');
    await createSession(reply, req, { userId: user.id });
    await audit({ tenantId: user.tenantId, userId: user.id }, 'auth.demo_login', 'User', user.id, {}, { ip: req.ip });
    return { status: 'OK' as const, me: await buildMe(user.id) };
  });
}
