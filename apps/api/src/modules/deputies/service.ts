import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '../../lib/db';
import { todayUtc, toDateStr } from '../../lib/dates';
import { toUserRef, userRefSelect } from '../../lib/names';

/** Users on whose behalf `userId` may act today (active Deputy records, F-19). */
export async function activePrincipalIds(userId: string, tx: Tx = prisma, at: Date = todayUtc()): Promise<string[]> {
  const rows = await tx.deputy.findMany({
    where: { deputyUserId: userId, startDate: { lte: at }, endDate: { gte: at } },
    select: { principalUserId: true },
  });
  return [...new Set(rows.map((r) => r.principalUserId))];
}

/** Is `deputyUserId` an active deputy of `principalUserId` today? */
export async function isActiveDeputy(deputyUserId: string, principalUserId: string, tx: Tx = prisma): Promise<boolean> {
  const at = todayUtc();
  return (await tx.deputy.count({ where: { deputyUserId, principalUserId, startDate: { lte: at }, endDate: { gte: at } } })) > 0;
}

export const deputyInclude = { principal: { select: userRefSelect }, deputy: { select: userRefSelect } } as const;
export type DeputyRow = Prisma.DeputyGetPayload<{ include: typeof deputyInclude }>;

export function toDeputyItem(d: DeputyRow) {
  const today = todayUtc();
  return {
    id: d.id,
    principal: toUserRef(d.principal),
    deputy: toUserRef(d.deputy),
    startDate: toDateStr(d.startDate),
    endDate: toDateStr(d.endDate),
    active: d.startDate <= today && d.endDate >= today,
  };
}
