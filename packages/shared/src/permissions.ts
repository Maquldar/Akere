export const ROLES = ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'] as const;
export type Role = (typeof ROLES)[number];

/** Permission keys → roles that hold them. Row scoping (subtree/self) is applied in services. */
export const PERMISSIONS = {
  'org.read': ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'],
  'org.manage': ['ADMIN'],
  'users.manage': ['ADMIN'],
  'audit.read': ['ADMIN'],
  'apikey.manage': ['ADMIN'],
  'employee.read': ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'],
  'employee.manage': ['ADMIN', 'HR'],
  'deputy.read': ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'],
  'deputy.manage': ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'],
  'candidate.read': ['ADMIN', 'HR'],
  'candidate.manage': ['ADMIN', 'HR'],
  'document.read': ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'],
  'document.create': ['ADMIN', 'HR', 'MANAGER'],
  'document.manage': ['ADMIN', 'HR'],
  'request.create': ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'],
  'request.read': ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'],
  'vacation.read': ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'],
  'vacation.manage': ['ADMIN', 'HR'],
  'vacation.approve': ['ADMIN', 'HR', 'MANAGER'],
  'vnd.read': ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'],
  'vnd.manage': ['ADMIN', 'HR'],
  'esutd.read': ['ADMIN', 'HR'],
  'esutd.submit': ['ADMIN', 'HR'],
  'sickleave.read': ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'],
  'sickleave.manage': ['ADMIN', 'HR'],
  'time.self': ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'],
  'time.manage': ['ADMIN', 'HR', 'MANAGER'],
  'time.export': ['ADMIN', 'HR'],
  'report.read': ['ADMIN', 'HR', 'MANAGER'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function permissionsForRoles(roles: readonly Role[]): Permission[] {
  return (Object.keys(PERMISSIONS) as Permission[]).filter((p) =>
    (PERMISSIONS[p] as readonly Role[]).some((r) => roles.includes(r)),
  );
}

export function hasPermission(roles: readonly Role[], permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).some((r) => roles.includes(r));
}
