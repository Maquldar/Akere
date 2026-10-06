import type { Prisma } from '@prisma/client';
import { prisma } from './db';
import type { UserCtx } from './auth';
import { hasRole } from './auth';

/**
 * Row scoping rules (ARCHITECTURE.md §4):
 *  - ADMIN: whole tenant
 *  - HR: employees of assigned legal entities (a grant with legalEntityId=null = all)
 *  - MANAGER: their reporting subtree (recursive on managerId)
 *  - EMPLOYEE: self
 * A user with several roles gets the union.
 */

/** null = no legal-entity restriction (admin or HR with a tenant-wide grant). */
export function hrLegalEntityIds(u: UserCtx): string[] | null {
  if (hasRole(u, 'ADMIN')) return null;
  const hr = u.grants.filter((g) => g.role === 'HR');
  if (hr.length === 0) return [];
  if (hr.some((g) => g.legalEntityId === null)) return null;
  return hr.map((g) => g.legalEntityId!);
}

export const isHrOrAdmin = (u: UserCtx) => hasRole(u, 'ADMIN', 'HR');

const subtreeCache = new WeakMap<UserCtx, Promise<string[]>>();

/** All employee ids reporting (directly or indirectly) to the user's employee record. */
export function managerSubtree(u: UserCtx): Promise<string[]> {
  if (!u.employeeId || !hasRole(u, 'MANAGER')) return Promise.resolve([]);
  let p = subtreeCache.get(u);
  if (!p) {
    p = prisma
      .$queryRaw<{ id: string }[]>`
        WITH RECURSIVE tree AS (
          SELECT id FROM "Employee" WHERE "managerId" = ${u.employeeId} AND "tenantId" = ${u.tenantId}
          UNION
          SELECT e.id FROM "Employee" e JOIN tree t ON e."managerId" = t.id
        ) SELECT id FROM tree`
      .then((rows) => rows.map((r) => r.id));
    subtreeCache.set(u, p);
  }
  return p;
}

/** Prisma where-clause for Employee rows the user may read. */
export async function employeeScope(u: UserCtx): Promise<Prisma.EmployeeWhereInput> {
  const base: Prisma.EmployeeWhereInput = { tenantId: u.tenantId };
  const le = hrLegalEntityIds(u);
  if (le === null) return base;
  const or: Prisma.EmployeeWhereInput[] = [];
  if (le.length) or.push({ legalEntityId: { in: le } });
  const subtree = await managerSubtree(u);
  if (subtree.length) or.push({ id: { in: subtree } });
  if (u.employeeId) or.push({ id: u.employeeId });
  return { ...base, OR: or.length ? or : [{ id: '__none__' }] };
}

export async function canReadEmployee(u: UserCtx, employeeId: string): Promise<boolean> {
  const where = await employeeScope(u);
  return (await prisma.employee.count({ where: { AND: [where, { id: employeeId }] } })) > 0;
}

/** Managed = employees the user may manage as manager/HR (excludes self unless HR/admin). */
export async function managedEmployeeScope(u: UserCtx): Promise<Prisma.EmployeeWhereInput> {
  const base: Prisma.EmployeeWhereInput = { tenantId: u.tenantId };
  const le = hrLegalEntityIds(u);
  if (le === null) return base;
  const or: Prisma.EmployeeWhereInput[] = [];
  if (le.length) or.push({ legalEntityId: { in: le } });
  const subtree = await managerSubtree(u);
  if (subtree.length) or.push({ id: { in: subtree } });
  return { ...base, OR: or.length ? or : [{ id: '__none__' }] };
}

export function legalEntityAllowed(u: UserCtx, legalEntityId: string): boolean {
  const le = hrLegalEntityIds(u);
  return le === null || le.includes(legalEntityId);
}
