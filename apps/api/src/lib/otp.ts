import type { ContactChannel, OtpPurpose } from '@prisma/client';
import { messaging } from '../adapters/messaging';
import { prisma } from './db';
import { randomCode, sha256 } from './crypto';
import { rateLimited } from './errors';
import { t } from './i18n';

const TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_15_MIN = 5;

export async function issueOtp(opts: {
  purpose: OtpPurpose;
  target: string;
  channel: ContactChannel;
  tenantId: string;
  userId?: string;
  candidateId?: string;
  lang: string;
}) {
  const recent = await prisma.otpCode.count({
    where: { target: opts.target, purpose: opts.purpose, createdAt: { gt: new Date(Date.now() - 15 * 60_000) } },
  });
  if (recent >= MAX_SENDS_PER_15_MIN) throw rateLimited(15 * 60);
  const code = randomCode(6);
  await prisma.otpCode.create({
    data: {
      purpose: opts.purpose,
      target: opts.target,
      codeHash: sha256(`${opts.target}:${code}`),
      userId: opts.userId,
      candidateId: opts.candidateId,
      expiresAt: new Date(Date.now() + TTL_MS),
    },
  });
  const text = t(opts.purpose === 'PASSWORD_RESET' ? 'otp.reset' : 'otp.login', opts.lang, { code });
  await messaging(opts.channel).send({ tenantId: opts.tenantId, to: opts.target, subject: t('otp.subject', opts.lang), text, sensitive: true });
}

/** Returns true and consumes the latest code when it matches; counts failed attempts. */
export async function verifyOtp(opts: { purpose: OtpPurpose; target: string; code: string; userId?: string; candidateId?: string }) {
  const otp = await prisma.otpCode.findFirst({
    where: {
      purpose: opts.purpose,
      target: opts.target,
      consumedAt: null,
      expiresAt: { gt: new Date() },
      ...(opts.userId ? { userId: opts.userId } : {}),
      ...(opts.candidateId ? { candidateId: opts.candidateId } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!otp || otp.attempts >= MAX_ATTEMPTS) return false;
  // Count the attempt atomically BEFORE comparing, so parallel guesses cannot exceed MAX_ATTEMPTS.
  const counted = await prisma.otpCode.updateMany({ where: { id: otp.id, attempts: { lt: MAX_ATTEMPTS }, consumedAt: null }, data: { attempts: { increment: 1 } } });
  if (counted.count !== 1) return false;
  if (otp.codeHash !== sha256(`${opts.target}:${opts.code}`)) return false;
  // Single use: only one concurrent verification of the right code may consume it.
  const consumed = await prisma.otpCode.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: new Date() } });
  return consumed.count === 1;
}
