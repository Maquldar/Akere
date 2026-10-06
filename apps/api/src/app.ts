import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider, hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { config } from './config';
import { AppError } from './lib/errors';
import { resolveAuth } from './lib/auth';
import { MAX_FILE_BYTES } from './lib/files';
import { registerModules } from './modules';

export type App = FastifyInstance;

function zodDetails(issues: { path: PropertyKey[]; message: string }[]) {
  const fieldErrors: Record<string, string[]> = {};
  const formErrors: string[] = [];
  for (const i of issues) {
    const key = i.path.map(String).join('.');
    if (key) (fieldErrors[key] ??= []).push(i.message);
    else formErrors.push(i.message);
  }
  return { fieldErrors, formErrors };
}

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: config.LOG_LEVEL, redact: ['req.headers.cookie', 'req.headers.authorization'] },
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-origin' } });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: MAX_FILE_BYTES, files: 50, fields: 50 } });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, ctx) => {
      const err = new AppError(429, 'RATE_LIMITED', 'Too many requests, try again later', { retryAfterSec: Math.ceil(ctx.ttl / 1000) });
      return err;
    },
  });

  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (req) => {
    // CSRF: cookie-authenticated mutations must carry the custom header (cross-site forms can't set it).
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const isPublicApi = req.url.startsWith('/api/v1/public/');
    if (mutating && !isPublicApi && req.headers['x-requested-with'] !== 'akere') {
      throw new AppError(403, 'CSRF', 'Missing X-Requested-With header');
    }
    if (!isPublicApi) req.auth = await resolveAuth(req);
  });

  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    if (err instanceof AppError) {
      if (err.status === 429) reply.header('Retry-After', String((err.details as { retryAfterSec?: number })?.retryAfterSec ?? 60));
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      const issues = err.validation.map((v) => ({ path: (v.instancePath || '').split('/').filter(Boolean), message: v.message ?? 'Invalid value' }));
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: zodDetails(issues) } });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: zodDetails(err.issues) } });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') return reply.status(409).send({ error: { code: 'CONFLICT', message: 'Already exists', details: { fields: err.meta?.target } } });
      if (err.code === 'P2025') return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
    }
    const fe = err as FastifyError;
    if (fe.code === 'FST_REQ_FILE_TOO_LARGE' || fe.code === 'FST_FILES_LIMIT') {
      return reply.status(413).send({ error: { code: 'FILE_TOO_LARGE', message: 'File is too large' } });
    }
    if (fe.statusCode && fe.statusCode < 500) {
      return reply.status(fe.statusCode).send({ error: { code: 'VALIDATION_ERROR', message: fe.message } });
    }
    req.log.error(err);
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Internal server error' } });
  });

  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));

  await app.register(registerModules, { prefix: '/api/v1' });
  return app;
}
