/**
 * P1 API shapes (API.md §0–§3). Keep names identical to API.md / packages/shared schemas.
 */

export type DateStr = string;
export type Role = 'ADMIN' | 'HR' | 'MANAGER' | 'EMPLOYEE';
export type Locale = 'ru' | 'kk' | 'en';
export type ContactChannel = 'EMAIL' | 'SMS' | 'WHATSAPP';
export type Gender = 'MALE' | 'FEMALE';

export type UserRef = {
  id: string;
  fullName: string;
  shortName: string;
  position?: string | null;
  department?: string | null;
};

export type FileRef = { id: string; filename: string; mime: string; size: number; url: string; createdAt: string };
export type Option = { id: string; name: string };

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

export type PageQuery = { page?: number; pageSize?: number };

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'CSRF'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FILE'
  | 'BUSINESS_RULE'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export type ApiErrorBody = { error: { code: ErrorCode; message: string; details?: unknown } };

export type ValidationDetails = { fieldErrors: Record<string, string[]>; formErrors: string[] };

// §1 Auth -------------------------------------------------------------------

export type RoleAssignment = { role: Role; legalEntityId: string | null; canSign: boolean };

export type Me = {
  id: string;
  email: string;
  phone: string | null;
  firstName: string;
  lastName: string;
  middleName: string | null;
  fullName: string;
  locale: Locale;
  roles: RoleAssignment[];
  permissions: string[];
  tenant: { id: string; name: string };
  employee: {
    id: string;
    legalEntityId: string;
    legalEntity: string;
    department: string | null;
    position: string | null;
    isManager: boolean;
  } | null;
  unreadNotifications: number;
  /**
   * Not in API.md's `Me` yet, but `PATCH /me` accepts `twoFactorEnabled`. The profile page
   * reads it when present so the 2FA switch reflects the server state.
   */
  twoFactorEnabled?: boolean;
};

export type LoginInput = { login: string; password: string };

export type LoginResult =
  | { status: 'OK'; me: Me }
  | { status: 'OTP_REQUIRED'; channel: ContactChannel; maskedTarget: string };

export type LoginOk = { status: 'OK'; me: Me };

export type DemoUser = { id: string; fullName: string; roles: Role[]; position: string | null };

// §2 Profile and notifications -----------------------------------------------

export type MeUpdate = { locale?: Locale; phone?: string; twoFactorEnabled?: boolean };

export type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

export type InboxCounts = { documents: number; requests: number; vnd: number; timeRequests: number };

// §3 Organization --------------------------------------------------------------

export type LegalEntity = {
  id: string;
  name: string;
  nameKk: string | null;
  bin: string;
  address: string | null;
  directorName: string | null;
  employeeCount: number;
};
export type LegalEntityInput = {
  name: string;
  nameKk?: string;
  bin: string;
  address?: string;
  directorName?: string;
};

export type Department = {
  id: string;
  legalEntityId: string;
  parentId: string | null;
  name: string;
  nameKk: string | null;
  employeeCount: number;
};
export type DepartmentInput = { legalEntityId: string; parentId?: string | null; name: string; nameKk?: string };

export type Position = { id: string; name: string; nameKk: string | null };
export type PositionInput = { name: string; nameKk?: string };

export type WorkLocation = { id: string; name: string; address: string | null; lat: number; lng: number; radiusM: number };
export type WorkLocationInput = { name: string; address?: string; lat: number; lng: number; radiusM: number };

export type RoleInput = { role: Role; legalEntityId: string | null; canSign: boolean };

export type UserAdmin = {
  id: string;
  email: string;
  phone: string | null;
  fullName: string;
  firstName: string;
  lastName: string;
  middleName: string | null;
  isActive: boolean;
  roles: RoleInput[];
  lastLoginAt: string | null;
  employeeId: string | null;
};

export type UserInput = {
  email: string;
  phone?: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  roles: RoleInput[];
  sendInvite: boolean;
};
export type UserUpdate = Partial<UserInput> & { isActive?: boolean };

export type UserFilter = PageQuery & { q?: string; role?: Role; active?: boolean };

export type Seats = { activeEmployees: number; hrUsers: number; legalEntities: number };

export type AuditEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actor: UserRef | null;
  meta: unknown;
  ip: string | null;
  createdAt: string;
};
export type AuditFilter = PageQuery & {
  entityType?: string;
  entityId?: string;
  actorId?: string;
  from?: DateStr;
  to?: DateStr;
};

export type OutboxMessage = {
  id: string;
  channel: ContactChannel;
  to: string;
  subject: string | null;
  body: string;
  status: 'SENT' | 'FAILED';
  error: string | null;
  createdAt: string;
};
export type OutboxFilter = PageQuery & { channel?: ContactChannel };
