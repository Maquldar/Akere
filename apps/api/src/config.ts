import { z } from 'zod';

/**
 * TRUST_PROXY → Fastify `trustProxy`: 'false' (default; req.ip = socket address, X-Forwarded-For ignored),
 * 'true' (trust every hop — only when the API is unreachable except through the proxy), a hop count (e.g. '1'),
 * or a comma-separated list of trusted proxy IPs/CIDRs.
 */
export function parseTrustProxy(v: string | undefined): boolean | number | string[] {
  const s = (v ?? '').trim();
  if (!s || s === 'false' || s === '0') return false;
  if (s === 'true') return true;
  if (/^\d+$/.test(s)) return Number(s);
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().default('http://localhost:3000'),
  DEMO_MODE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  COOKIE_SECURE: z.enum(['true', 'false']).optional().transform((v) => (v === undefined ? undefined : v === 'true')),
  SESSION_TTL_HOURS: z.coerce.number().default(12),
  SIGNING_MASTER_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'SIGNING_MASTER_KEY must be 32 bytes hex'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_DIR: z.string().default('./data/files'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('Akere HR <no-reply@akere.local>'),
  SUPPORT_EMAIL: z.string().default('support@akere.local'),
  JOBS_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  LOG_LEVEL: z.string().default('info'),
  TRUST_PROXY: z.string().optional().transform(parseTrustProxy),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    // Fail fast with a readable message; never print secret values.
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const config = loadConfig();
export const isProd = config.NODE_ENV === 'production';
