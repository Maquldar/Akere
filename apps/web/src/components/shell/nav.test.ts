import { describe, expect, it } from 'vitest';
import { accessContext } from '@/lib/permissions';
import type { Me } from '@/lib/api/types';
import { isActive, navSections, resolveRoute, visibleSections } from './nav';

function me(permissions: string[], roles: Me['roles'][number]['role'][]): Pick<Me, 'permissions' | 'roles' | 'employee'> {
  return { permissions, roles: roles.map((role) => ({ role, legalEntityId: null, canSign: false })), employee: null };
}

describe('nav', () => {
  it('shows admin items only to admins and only when ready', () => {
    const admin = visibleSections(accessContext(me(['org.manage', 'users.manage', 'audit.read', 'apikey.manage'], ['ADMIN'])));
    const adminSection = admin.find((s) => s.key === 'admin');
    expect(adminSection?.items.map((i) => i.key)).toEqual(expect.arrayContaining(['orgStructure', 'users', 'audit', 'outbox', 'apiKeys']));
    expect(adminSection?.items.every((i) => i.ready)).toBe(true);

    const employee = visibleSections(accessContext(me(['org.read', 'document.read', 'time.self'], ['EMPLOYEE'])));
    expect(employee.find((s) => s.key === 'admin')).toBeUndefined();
    expect(employee.every((s) => s.items.every((i) => i.ready))).toBe(true);
  });
  it('has unique keys', () => {
    const keys = navSections.flatMap((s) => s.items.map((i) => i.key));
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('matches active items', () => {
    expect(isActive({ href: '/', exact: true }, '/')).toBe(true);
    expect(isActive({ href: '/', exact: true }, '/admin')).toBe(false);
    expect(isActive({ href: '/admin/users' }, '/admin/users/123')).toBe(true);
  });
  it('resolves header crumbs by longest prefix', () => {
    expect(resolveRoute('/admin/users')?.item.key).toBe('users');
    expect(resolveRoute('/admin/users')?.section).toBe('admin');
    expect(resolveRoute('/notifications')?.item.key).toBe('notifications');
    expect(resolveRoute('/')?.item.key).toBe('home');
  });
});
