import type { LightMyRequestResponse } from 'fastify';
import type { Role } from '@prisma/client';
import { buildApp } from '../src/app';
import { prisma } from '../src/lib/db';
import { hashPassword } from '../src/lib/crypto';

export const PASSWORD = 'TestPassword123';
let pwHash: string | null = null;

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

export async function createApp() {
  return buildApp({ logger: false });
}
export type TestApp = Awaited<ReturnType<typeof createApp>>;

let seq = 0;

/** Creates a tenant with one legal entity and helpers to add people. */
export async function makeTenant(name = 'Test Co') {
  pwHash ??= await hashPassword(PASSWORD);
  const n = ++seq;
  const tenant = await prisma.tenant.create({ data: { name, slug: `t${n}-${Date.now()}`, settings: { requireSelfie: false, requireGeofence: false } } });
  const le = await prisma.legalEntity.create({ data: { tenantId: tenant.id, name: `ТОО ${name}`, bin: `19034010421${n % 10}` } });
  const dept = await prisma.department.create({ data: { tenantId: tenant.id, legalEntityId: le.id, name: 'Отдел' } });
  const position = await prisma.position.create({ data: { tenantId: tenant.id, name: `Специалист ${n}` } });
  let tab = 1;

  async function person(opts: { email: string; roles?: { role: Role; legalEntityId?: string | null; canSign?: boolean }[]; managerEmployeeId?: string; firstName?: string; lastName?: string; employee?: boolean; legalEntityId?: string }) {
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id, email: opts.email, passwordHash: pwHash, firstName: opts.firstName ?? 'Иван', lastName: opts.lastName ?? 'Тестов',
        roles: { create: [{ role: 'EMPLOYEE' }, ...(opts.roles ?? []).map((r) => ({ role: r.role, legalEntityId: r.legalEntityId ?? null, canSign: r.canSign ?? false }))] },
      },
    });
    const employee = opts.employee === false ? null : await prisma.employee.create({
      data: {
        tenantId: tenant.id, userId: user.id, legalEntityId: opts.legalEntityId ?? le.id, departmentId: dept.id, positionId: position.id,
        managerId: opts.managerEmployeeId ?? null, tabNumber: String(tab++).padStart(6, '0'), hireDate: new Date('2024-01-10T00:00:00Z'),
      },
    });
    return { user, employee: employee!, userId: user.id, employeeId: employee?.id ?? '' };
  }
  return { tenant, le, dept, position, person, tenantId: tenant.id };
}

export class Client {
  cookie = '';
  constructor(private app: TestApp) {}

  async req(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, body?: unknown, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> {
    const res = await this.app.inject({
      method,
      url: url.startsWith('/api') ? url : `/api/v1${url}`,
      headers: {
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(method !== 'GET' ? { 'x-requested-with': 'akere' } : {}),
        ...(body !== undefined && !(typeof body === 'object' && body && 'pipe' in body) ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      payload: body === undefined ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body),
    });
    const set = res.headers['set-cookie'];
    if (set) {
      const c = (Array.isArray(set) ? set : [set]).find((x) => x.startsWith('akere_session='));
      if (c) this.cookie = c.split(';')[0]!.endsWith('=') ? '' : c.split(';')[0]!;
    }
    return res;
  }
  get = (url: string) => this.req('GET', url);
  post = (url: string, body?: unknown) => this.req('POST', url, body ?? {});
  patch = (url: string, body: unknown) => this.req('PATCH', url, body);
  put = (url: string, body: unknown) => this.req('PUT', url, body);
  del = (url: string) => this.req('DELETE', url);

  async login(email: string, password = PASSWORD) {
    const res = await this.post('/auth/login', { login: email, password });
    if (res.statusCode !== 200) throw new Error(`login failed ${res.statusCode} ${res.body}`);
    return res.json();
  }

  /** Multipart upload helper. */
  async upload(url: string, files: { field?: string; filename: string; content: Buffer; contentType?: string }[], fields: Record<string, string> = {}) {
    const boundary = `----akere${Date.now()}`;
    const parts: Buffer[] = [];
    for (const [k, v] of Object.entries(fields)) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    }
    for (const f of files) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.field ?? 'file'}"; filename="${f.filename}"\r\nContent-Type: ${f.contentType ?? 'application/octet-stream'}\r\n\r\n`));
      parts.push(f.content, Buffer.from('\r\n'));
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    return this.req('POST', url, Buffer.concat(parts), { 'content-type': `multipart/form-data; boundary=${boundary}` });
  }
}

/** Latest OTP code sent to a target (read from the sandbox outbox). */
export async function lastCode(to: string): Promise<string> {
  const m = await prisma.outbox.findFirst({ where: { to }, orderBy: { createdAt: 'desc' } });
  const code = m?.body.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error(`no code sent to ${to}`);
  return code;
}

/** Minimal valid files for upload tests. */
export const SAMPLE_PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
export const SAMPLE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
