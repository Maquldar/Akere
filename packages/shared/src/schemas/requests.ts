import { z } from 'zod';
import { dateStr, id, pageQuery } from '../validators';
import type { AbsenceKind } from './time';
import type { FormField } from './onboarding';

/** Employee requests (API.md §8) and vacation schedule (API.md §9). */

export const REQUEST_STATUSES = ['DRAFT', 'IN_APPROVAL', 'REWORK', 'ORDER_SIGNING', 'COMPLETED', 'REJECTED', 'CANCELLED'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const REQUEST_TYPE_CODES = ['ANNUAL_LEAVE', 'UNPAID_LEAVE', 'BUSINESS_TRIP', 'SOCIAL_LEAVE', 'CERTIFICATE'] as const;
export const REQUEST_SCOPES = ['mine', 'team', 'all'] as const;
export const CAMPAIGN_STATUSES = ['DRAFT', 'ACTIVE', 'CLOSED'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export const PLAN_STATUSES = ['NONE', 'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

// ── Requests ──
export const RequestInput = z
  .object({
    requestTypeId: id,
    startDate: dateStr.nullish(),
    endDate: dateStr.nullish(),
    data: z.record(z.string(), z.unknown()).default({}),
    attachmentFileIds: z.array(id).max(20).default([]),
    submit: z.boolean().default(false),
  })
  .refine((r) => !r.startDate || !r.endDate || r.endDate >= r.startDate, { message: 'endDate must not be before startDate', path: ['endDate'] });
export type RequestInput = z.infer<typeof RequestInput>;

export const RequestsQuery = pageQuery.extend({
  scope: z.enum(REQUEST_SCOPES).default('mine'),
  status: z.enum(REQUEST_STATUSES).optional(),
  requestTypeId: id.optional(),
  employeeId: id.optional(),
});
export type RequestsQuery = z.infer<typeof RequestsQuery>;

type Ref = { id: string; name: string };
type UserRefLite = { id: string; fullName: string; shortName: string; position: string | null; department: string | null };
export type RequestTypeView = {
  id: string; code: string; name: string; nameKk: string | null; fields: FormField[]; usesVacationBalance: boolean;
  requiresAttachment: boolean; hasDates: boolean; absenceKind: AbsenceKind | null;
};
export type RequestListItem = {
  id: string; type: Ref & { code: string }; employee: UserRefLite & { employeeId: string }; status: RequestStatus;
  startDate: string | null; endDate: string | null; days: number | null; createdAt: string; submittedAt: string | null;
};
export type RequestPreview = { days: number; balanceAfter: number | null; pdfDataUrl: string; warnings: string[] };

// ── Vacation schedule ──
export const CampaignInput = z.object({
  year: z.number().int().min(2000).max(2100),
  deadline: dateStr.nullish(),
  /** Extension: campaigns open immediately unless created as DRAFT. */
  status: z.enum(['DRAFT', 'ACTIVE']).default('ACTIVE'),
});
export const CampaignUpdate = z.object({ status: z.enum(['ACTIVE', 'CLOSED']).optional(), deadline: dateStr.nullish() });

export const VacationGridQuery = pageQuery.extend({
  status: z.enum(PLAN_STATUSES).optional(),
  employeeId: id.optional(),
  departmentId: id.optional(),
  positionId: id.optional(),
  q: z.string().trim().max(100).optional(),
});

export const VacationPlanInput = z.object({
  periods: z
    .array(z.object({ startDate: dateStr, endDate: dateStr }).refine((p) => p.endDate >= p.startDate, { message: 'endDate must not be before startDate', path: ['endDate'] }))
    .max(12),
  submit: z.boolean().default(false),
});
export type VacationPlanInput = z.infer<typeof VacationPlanInput>;

export const VacationApproveInput = z.object({
  employeeIds: z.array(id).min(1).max(500),
  decision: z.enum(['APPROVE', 'REJECT']),
  comment: z.string().trim().max(1000).nullish(),
  /** Extension: validate only (for the "selected 8, can approve 7" dialog). */
  dryRun: z.boolean().default(false),
});

export type CampaignView = { id: string; year: number; status: CampaignStatus; deadline: string | null; totals: { employees: number; submitted: number; approved: number } };
export type PlanRow = {
  employee: UserRefLite & { employeeId: string }; status: PlanStatus; entitlement: number; planned: number;
  periods: { id: string; startDate: string; endDate: string; days: number }[]; comment: string | null; canApprove: boolean;
};
export type BulkResult = { succeeded: string[]; failed: { employeeId: string; reason: string }[] };
