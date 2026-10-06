import type { Prisma } from '@prisma/client';
import type { AbsenceView, ShiftColor, ShiftTemplateView, ShiftView, TimeMarkView, TimeRequestView } from '@akere/shared';
import { SHIFT_COLORS } from '@akere/shared';
import { fileUrl } from '../../lib/files';
import { toUserRef, type UserRef } from '../../lib/names';
import { dateStrOf } from '../../lib/calendar';

/** Prisma include producing everything needed for a UserRef from an Employee row. */
export const empRefInclude = {
  user: { select: { id: true, firstName: true, lastName: true, middleName: true } },
  position: { select: { name: true } },
  department: { select: { name: true } },
} as const;

export type EmpForRef = Prisma.EmployeeGetPayload<{ include: typeof empRefInclude }>;

export function empRef(e: EmpForRef): UserRef & { employeeId: string } {
  return { ...toUserRef({ ...e.user, employee: { position: e.position, department: e.department } }), employeeId: e.id };
}

export const asColor = (c: string): ShiftColor => ((SHIFT_COLORS as readonly string[]).includes(c) ? (c as ShiftColor) : 'gray');

export const templateInclude = { location: { select: { id: true, name: true } } } as const;
export function templateView(t: Prisma.ShiftTemplateGetPayload<{ include: typeof templateInclude }>): ShiftTemplateView {
  return {
    id: t.id, name: t.name, startTime: t.startTime, endTime: t.endTime, breakMinutes: t.breakMinutes, color: asColor(t.color),
    location: t.location ? { id: t.location.id, name: t.location.name } : null, isActive: t.isActive,
  };
}

export const shiftInclude = {
  location: { select: { id: true, name: true } },
  claims: { include: { employee: { include: empRefInclude } }, orderBy: { createdAt: 'asc' } },
} as const satisfies Prisma.ShiftInclude;
export type ShiftRow = Prisma.ShiftGetPayload<{ include: typeof shiftInclude }>;

export function shiftView(s: ShiftRow): ShiftView {
  return {
    id: s.id, employeeId: s.employeeId, date: dateStrOf(s.date), startAt: s.startAt.toISOString(), endAt: s.endAt.toISOString(),
    breakMinutes: s.breakMinutes, title: s.title, color: asColor(s.color), status: s.status, templateId: s.templateId,
    location: s.location ? { id: s.location.id, name: s.location.name } : null,
    claims: s.claims.map((c) => {
      const { employeeId: _e, ...ref } = empRef(c.employee);
      return { id: c.id, employee: ref, status: c.status };
    }),
  };
}

export function absenceView(a: { id: string; employeeId: string; kind: AbsenceView['kind']; startDate: Date; endDate: Date; note: string | null; source: AbsenceView['source'] }): AbsenceView {
  return { id: a.id, employeeId: a.employeeId, kind: a.kind, startDate: dateStrOf(a.startDate), endDate: dateStrOf(a.endDate), note: a.note, source: a.source };
}

export const markInclude = { employee: { include: empRefInclude } } as const;
export type MarkRow = Prisma.TimeMarkGetPayload<{ include: typeof markInclude }>;

export function markView(m: MarkRow): TimeMarkView {
  const { employeeId: _e, ...ref } = empRef(m.employee);
  return {
    id: m.id, employee: ref, type: m.type, at: m.at.toISOString(), distanceM: m.distanceM === null ? null : Math.round(m.distanceM),
    verification: m.verification, verificationNote: m.verificationNote, selfieUrl: m.selfieFileId ? fileUrl(m.selfieFileId) : null, source: m.source,
  };
}

export const requestInclude = { employee: { include: empRefInclude } } as const;
export type RequestRow = Prisma.TimeRequestGetPayload<{ include: typeof requestInclude }>;

export function requestView(r: RequestRow, deciders: Map<string, UserRef>): TimeRequestView {
  const { employeeId: _e, ...ref } = empRef(r.employee);
  return {
    id: r.id, kind: r.kind, employee: ref, date: dateStrOf(r.date), data: (r.data ?? {}) as Record<string, unknown>, status: r.status,
    decidedBy: r.decidedById ? (deciders.get(r.decidedById) ?? null) : null, decidedAt: r.decidedAt?.toISOString() ?? null, comment: r.comment,
    createdAt: r.createdAt.toISOString(),
  };
}
