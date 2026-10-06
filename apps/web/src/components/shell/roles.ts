import type { Tone } from '@/components/ui/badge';
import type { Role } from '@/lib/api/types';

export const roleTone: Record<Role, Tone> = { ADMIN: 'purple', HR: 'blue', MANAGER: 'teal', EMPLOYEE: 'gray' };
export const ROLES: Role[] = ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'];
