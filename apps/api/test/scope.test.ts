import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db';
import { resolveAuth, type UserCtx } from '../src/lib/auth';
import { canReadEmployee, employeeScope, hrLegalEntityIds, managerSubtree } from '../src/lib/scope';
import { Client, createApp, makeTenant, resetDb, type TestApp } from './helpers';

let app: TestApp;
beforeAll(async () => {
  app = await createApp();
});
afterAll(() => app.close());
beforeEach(resetDb);

async function ctxFor(email: string): Promise<UserCtx> {
  const c = new Client(app);
  await c.login(email);
  const token = decodeURIComponent(c.cookie.split('=')[1]!);
  return (await resolveAuth({ cookies: { akere_session: token } } as never)) as UserCtx;
}

describe('row scoping', () => {
  it('managers see their recursive subtree, employees only themselves', async () => {
    const t = await makeTenant();
    const boss = await t.person({ email: 'boss@test.kz', roles: [{ role: 'MANAGER' }] });
    const lead = await t.person({ email: 'lead@test.kz', roles: [{ role: 'MANAGER' }], managerEmployeeId: boss.employeeId });
    const dev = await t.person({ email: 'dev@test.kz', managerEmployeeId: lead.employeeId });
    const outsider = await t.person({ email: 'out@test.kz' });

    const bossCtx = await ctxFor('boss@test.kz');
    expect((await managerSubtree(bossCtx)).sort()).toEqual([lead.employeeId, dev.employeeId].sort());
    expect(await canReadEmployee(bossCtx, dev.employeeId)).toBe(true);
    expect(await canReadEmployee(bossCtx, outsider.employeeId)).toBe(false);

    const devCtx = await ctxFor('dev@test.kz');
    const visible = await prisma.employee.findMany({ where: await employeeScope(devCtx) });
    expect(visible.map((e) => e.id)).toEqual([dev.employeeId]);
  });

  it('HR grants restrict by legal entity', async () => {
    const t = await makeTenant();
    const le2 = await prisma.legalEntity.create({ data: { tenantId: t.tenantId, name: 'Второе', bin: '000740001307' } });
    await t.person({ email: 'hr1@test.kz', roles: [{ role: 'HR', legalEntityId: le2.id }] });
    const inLe1 = await t.person({ email: 'e1@test.kz' });
    const inLe2 = await t.person({ email: 'e2@test.kz', legalEntityId: le2.id });
    const ctx = await ctxFor('hr1@test.kz');
    expect(hrLegalEntityIds(ctx)).toEqual([le2.id]);
    expect(await canReadEmployee(ctx, inLe2.employeeId)).toBe(true);
    expect(await canReadEmployee(ctx, inLe1.employeeId)).toBe(false);
  });
});
