import { randomBytes } from 'node:crypto';
import type { ApiKey } from '@prisma/client';
import type { ApiKeyScope, ApiKeyView } from '@akere/shared';
import { prisma, type Tx } from '../../lib/db';
import { safeEqual, sha256 } from '../../lib/crypto';

/**
 * Tenant API keys (F-50). Format `ak_<prefix>_<secret>`: prefix = 12 hex chars (unique, stored in clear for lookup),
 * secret = 48 hex chars. Only sha256(full key) is stored; verification is a constant-time comparison.
 */
export const KEY_RE = /^ak_([0-9a-f]{12})_([0-9a-f]{48})$/;

export function generateKey(): { key: string; prefix: string; keyHash: string } {
  const prefix = randomBytes(6).toString('hex');
  const secret = randomBytes(24).toString('hex');
  const key = `ak_${prefix}_${secret}`;
  return { key, prefix, keyHash: sha256(key) };
}

export async function createApiKey(tx: Tx, input: { tenantId: string; name: string; scopes: ApiKeyScope[]; createdById: string }) {
  const { key, prefix, keyHash } = generateKey();
  const row = await tx.apiKey.create({ data: { tenantId: input.tenantId, name: input.name, prefix, keyHash, scopes: [...new Set(input.scopes)], createdById: input.createdById } });
  return { row, key };
}

/** Prefix of a well-formed key (used for rate-limit buckets), or null. */
export const keyPrefix = (raw: string | undefined | null): string | null => {
  const m = raw ? KEY_RE.exec(raw) : null;
  return m ? m[1]! : null;
};

export type KeyCheck = { ok: true; key: ApiKey } | { ok: false; reason: 'MISSING' | 'MALFORMED' | 'INVALID' | 'REVOKED' };

export async function verifyApiKey(authorization: string | undefined): Promise<KeyCheck> {
  if (!authorization) return { ok: false, reason: 'MISSING' };
  const m = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  if (!m) return { ok: false, reason: 'MALFORMED' };
  const raw = m[1]!;
  const prefix = keyPrefix(raw);
  if (!prefix) return { ok: false, reason: 'INVALID' };
  const key = await prisma.apiKey.findUnique({ where: { prefix } });
  // Compare even when the prefix is unknown so timing does not reveal which prefixes exist.
  const matches = safeEqual(sha256(raw), key?.keyHash ?? sha256(`missing:${raw}`));
  if (!key || !matches) return { ok: false, reason: 'INVALID' };
  if (key.revokedAt) return { ok: false, reason: 'REVOKED' };
  return { ok: true, key };
}

export const toApiKeyView = (k: ApiKey): ApiKeyView => ({
  id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes as ApiKeyScope[],
  lastUsedAt: k.lastUsedAt?.toISOString() ?? null, revokedAt: k.revokedAt?.toISOString() ?? null, createdAt: k.createdAt.toISOString(),
});
