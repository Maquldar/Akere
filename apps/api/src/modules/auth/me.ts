import { permissionsForRoles, type Role } from '@akere/shared';
import { prisma } from '../../lib/db';
import { fullName } from '../../lib/names';
import { notFound } from '../../lib/errors';

export async function buildMe(userId: string) {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      roles: true,
      tenant: { select: { id: true, name: true } },
      employee: {
        include: {
          legalEntity: { select: { name: true } },
          department: { select: { name: true } },
          position: { select: { name: true } },
          _count: { select: { reports: { where: { status: 'ACTIVE' } } } },
        },
      },
    },
  });
  if (!u) throw notFound('User');
  const roles = [...new Set(u.roles.map((r) => r.role))] as Role[];
  const unread = await prisma.notification.count({ where: { userId, readAt: null } });
  const e = u.employee;
  return {
    id: u.id,
    email: u.email,
    phone: u.phone,
    firstName: u.firstName,
    lastName: u.lastName,
    middleName: u.middleName,
    fullName: fullName(u),
    locale: u.locale as 'ru' | 'kk' | 'en',
    roles: u.roles.map((r) => ({ role: r.role, legalEntityId: r.legalEntityId, canSign: r.canSign })),
    permissions: permissionsForRoles(roles),
    tenant: u.tenant,
    twoFactorEnabled: u.twoFactorEnabled,
    employee:
      e && e.status === 'ACTIVE'
        ? {
            id: e.id,
            legalEntityId: e.legalEntityId,
            legalEntity: e.legalEntity.name,
            department: e.department?.name ?? null,
            position: e.position?.name ?? null,
            isManager: e._count.reports > 0,
          }
        : null,
    unreadNotifications: unread,
  };
}
