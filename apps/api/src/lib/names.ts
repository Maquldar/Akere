type NameParts = { firstName: string; lastName: string; middleName?: string | null };

export const fullName = (u: NameParts) => [u.lastName, u.firstName, u.middleName].filter(Boolean).join(' ');
/** "Сулейменова Ж.А." style short name used in registries. */
export const shortName = (u: NameParts) =>
  `${u.lastName} ${u.firstName.charAt(0)}.${u.middleName ? ` ${u.middleName.charAt(0)}.` : ''}`.replace(/\s+(?=\S\.$)/, '');

export type UserRef = { id: string; fullName: string; shortName: string; position: string | null; department: string | null };

export const userRefSelect = {
  id: true,
  firstName: true,
  lastName: true,
  middleName: true,
  employee: { select: { position: { select: { name: true } }, department: { select: { name: true } } } },
} as const;

type UserForRef = NameParts & {
  id: string;
  employee?: { position: { name: string } | null; department: { name: string } | null } | null;
};

export function toUserRef(u: UserForRef): UserRef {
  return {
    id: u.id,
    fullName: fullName(u),
    shortName: shortName(u),
    position: u.employee?.position?.name ?? null,
    department: u.employee?.department?.name ?? null,
  };
}

export function maskTarget(target: string): string {
  if (target.includes('@')) {
    const [name, domain] = target.split('@');
    return `${name!.slice(0, 2)}***@${domain}`;
  }
  return `${target.slice(0, 4)}*****${target.slice(-2)}`;
}
