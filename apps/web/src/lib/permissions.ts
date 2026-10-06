import type { Me, Role } from './api/types';

/** Permission keys from API.md (summary table at the bottom). */
export type Permission =
  | 'org.read' | 'org.manage' | 'users.manage' | 'audit.read' | 'apikey.manage'
  | 'employee.read' | 'employee.manage'
  | 'deputy.read' | 'deputy.manage'
  | 'candidate.read' | 'candidate.manage'
  | 'document.read' | 'document.create' | 'document.manage'
  | 'request.create' | 'request.read'
  | 'vacation.read' | 'vacation.manage' | 'vacation.approve'
  | 'vnd.read' | 'vnd.manage'
  | 'esutd.read' | 'esutd.submit'
  | 'sickleave.read' | 'sickleave.manage'
  | 'time.self' | 'time.manage' | 'time.export'
  | 'report.read';

export type AccessContext = {
  permissions: ReadonlySet<string>;
  roles: ReadonlySet<Role>;
  isManager: boolean;
};

export function accessContext(me: Pick<Me, 'permissions' | 'roles' | 'employee'>): AccessContext {
  return {
    permissions: new Set(me.permissions),
    roles: new Set(me.roles.map((r) => r.role)),
    isManager: Boolean(me.employee?.isManager) || me.roles.some((r) => r.role === 'MANAGER'),
  };
}

export function can(ctx: AccessContext, ...anyOf: Permission[]): boolean {
  return anyOf.some((p) => ctx.permissions.has(p));
}

export function hasRole(ctx: AccessContext, ...anyOf: Role[]): boolean {
  return anyOf.some((r) => ctx.roles.has(r));
}

/** Highest role for display ("Администратор" over "Сотрудник"). */
export function primaryRole(roles: readonly Role[]): Role {
  const order: Role[] = ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'];
  return order.find((r) => roles.includes(r)) ?? 'EMPLOYEE';
}
