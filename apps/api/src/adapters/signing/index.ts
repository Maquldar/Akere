import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { prisma, type Tx } from '../../lib/db';
import { decrypt, encrypt, hashPassword, sha256, verifyPassword } from '../../lib/crypto';

/**
 * Sandbox signing adapter (AS-03, KNOWN_GAPS): real ECDSA P-256 signatures with a per-user key pair.
 * The private key is stored encrypted (AES-256-GCM, SIGNING_MASTER_KEY); the NCALayer PIN is an argon2 hash.
 * eGov mobile / eGov mobile Business / NCALayer differ only in UX (QR vs PIN) and authority checks,
 * which live in modules/signing. Replacing this file with a НУЦ РК / mgov integration is the go-live path.
 */
export const DEFAULT_SIGNING_PIN = '123456';
export type SandboxMethod = 'EGOV_MOBILE' | 'EGOV_BUSINESS' | 'NCALAYER' | 'CLICK' | 'PAPER';

export type SignatureResult = { docHash: string; signatureB64: string; publicKeyPem: string; certSubject: string };

/** Returns the user's key row, generating the key pair lazily on first use. */
export async function ensureUserKey(userId: string, tx: Tx = prisma) {
  const existing = await tx.userKey.findUnique({ where: { userId } });
  if (existing) return existing;
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const enc = encrypt(privatePem);
  const pinHash = await hashPassword(DEFAULT_SIGNING_PIN);
  // upsert guards against two concurrent first-time signings.
  return tx.userKey.upsert({
    where: { userId },
    create: { userId, publicKeyPem, encPrivateKey: enc.ciphertext, iv: enc.iv, tag: enc.tag, pinHash },
    update: {},
  });
}

/** Sets the sandbox NCALayer PIN for a user (creates the key pair if needed). */
export async function setSigningPin(userId: string, pin: string, tx: Tx = prisma) {
  if (!/^\d{4,32}$/.test(pin)) throw new Error('PIN must be 4–32 digits');
  await ensureUserKey(userId, tx);
  await tx.userKey.update({ where: { userId }, data: { pinHash: await hashPassword(pin) } });
}

export async function verifySigningPin(userId: string, pin: string, tx: Tx = prisma): Promise<boolean> {
  const key = await ensureUserKey(userId, tx);
  return verifyPassword(key.pinHash, pin);
}

/** Signs the given bytes (the document PDF). The signature covers SHA-256 of the bytes. */
export async function signBytes(
  userId: string,
  bytes: Buffer,
  subject: { fullName: string; iin?: string | null; organization?: string | null; bin?: string | null; method: SandboxMethod },
  tx: Tx = prisma,
): Promise<SignatureResult> {
  const key = await ensureUserKey(userId, tx);
  const privateKey = createPrivateKey(decrypt(key.encPrivateKey, key.iv, key.tag));
  const signature = cryptoSign('sha256', bytes, privateKey);
  const parts = [`CN=${subject.fullName}`];
  if (subject.iin) parts.push(`SERIALNUMBER=IIN${subject.iin}`);
  if (subject.method === 'EGOV_BUSINESS' && subject.organization) {
    parts.push(`O=${subject.organization}`);
    if (subject.bin) parts.push(`OU=BIN${subject.bin}`);
  }
  parts.push('C=KZ', `ISSUER=Akere Sandbox CA (${subject.method})`);
  return { docHash: sha256(bytes), signatureB64: signature.toString('base64'), publicKeyPem: key.publicKeyPem, certSubject: parts.join(', ') };
}

/** Verifies a stored signature against the bytes that were signed. */
export function verifyBytes(bytes: Buffer, sig: { docHash: string; signatureB64: string; publicKeyPem: string }): boolean {
  if (sha256(bytes) !== sig.docHash) return false;
  try {
    return cryptoVerify('sha256', bytes, createPublicKey(sig.publicKeyPem), Buffer.from(sig.signatureB64, 'base64'));
  } catch {
    return false;
  }
}

/** Short key fingerprint for the signature sheet (SHA-256 of the SPKI DER, first 16 bytes, hex pairs). */
export function keyFingerprint(publicKeyPem: string): string {
  if (!publicKeyPem) return '—';
  try {
    const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
    return createHash('sha256').update(der).digest('hex').slice(0, 32).match(/../g)!.join(':').toUpperCase();
  } catch {
    return '—';
  }
}
