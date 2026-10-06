import { z } from 'zod';
import { boolQuery, dateStr, id, pageQuery } from '../validators';

export const EMPLOYEE_STATUSES = ['ACTIVE', 'TERMINATED'] as const;

export const EmployeeFilter = pageQuery.extend({
  q: z.string().trim().max(100).optional(),
  legalEntityId: id.optional(),
  departmentId: id.optional(),
  positionId: id.optional(),
  managerId: id.optional(),
  status: z.enum(EMPLOYEE_STATUSES).optional(),
  sort: z.enum(['lastName', 'hireDate', 'tabNumber']).default('lastName'),
  order: z.enum(['asc', 'desc']).default('asc'),
});
export const EmployeeOptionsQuery = z.object({ q: z.string().trim().max(100).optional(), legalEntityId: id.optional() });

export const EmployeeUpdate = z.object({
  departmentId: id.nullish(),
  positionId: id.nullish(),
  managerId: id.nullish(),
  locationId: id.nullish(),
  tabNumber: z.string().trim().min(1).max(20).optional(),
  vacationDaysPerYear: z.number().int().min(0).max(366).optional(),
  personal: z.record(z.string(), z.unknown()).optional(),
});
export const VacationAdjustmentInput = z.object({
  days: z.number().min(-366).max(366).refine((d) => d !== 0, 'Must not be zero'),
  date: dateStr,
  note: z.string().trim().min(1).max(500),
});
export const TransferInput = z.object({
  effectiveDate: dateStr,
  departmentId: id.optional(),
  positionId: id.optional(),
  managerId: id.optional(),
  salary: z.number().positive().max(1_000_000_000).optional(),
  reason: z.string().trim().max(1000).optional(),
}).refine((v) => v.departmentId || v.positionId || v.managerId || v.salary, { message: 'Nothing to change', path: ['departmentId'] });
export const DismissalInput = z.object({
  effectiveDate: dateStr,
  reason: z.string().trim().min(1).max(1000),
  article: z.string().trim().min(1).max(200),
});
export const DeputyFilter = z.object({ mine: boolQuery.optional() });
export const DeputyInput = z.object({ principalUserId: id.optional(), deputyUserId: id, startDate: dateStr, endDate: dateStr })
  .refine((v) => v.startDate <= v.endDate, { message: 'endDate must not be before startDate', path: ['endDate'] });
