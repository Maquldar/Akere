import { prisma, type Tx } from '../../lib/db';
import { conflict } from '../../lib/errors';
import { todayUtc } from '../../lib/dates';
import { fullName } from '../../lib/names';

/** Pattern tokens: {seq}, {MM}, {YY}, {YYYY}; everything else is literal (e.g. `{seq}-к/{YY}` → `12-к/26`). */
export function formatNumber(pattern: string, seq: number, date: Date): string {
  const yyyy = String(date.getUTCFullYear());
  return pattern
    .replaceAll('{seq}', String(seq))
    .replaceAll('{MM}', String(date.getUTCMonth() + 1).padStart(2, '0'))
    .replaceAll('{YYYY}', yyyy)
    .replaceAll('{YY}', yyyy.slice(2));
}

async function numberTaken(tx: Tx, doc: { id: string; tenantId: string; legalEntityId: string; documentTypeId: string }, number: string) {
  return (await tx.document.count({
    where: { tenantId: doc.tenantId, legalEntityId: doc.legalEntityId, documentTypeId: doc.documentTypeId, number, id: { not: doc.id } },
  })) > 0;
}

/**
 * Registers a document number (F-21). Manual numbers must be unique per legal entity + type (409);
 * otherwise the per-year NumberSequence is incremented (skipping numbers already taken manually).
 * A registeredAt before today marks the document as backdated. Run inside a transaction.
 */
export async function registerNumber(
  tx: Tx,
  documentId: string,
  opts: { number?: string; registeredAt?: Date } = {},
): Promise<{ number: string; registeredAt: Date; backdated: boolean }> {
  const doc = await tx.document.findUniqueOrThrow({ where: { id: documentId }, include: { documentType: true } });
  const registeredAt = opts.registeredAt ?? doc.registeredAt ?? todayUtc();
  const backdated = registeredAt < todayUtc();
  let number = opts.number?.trim();
  if (number) {
    if (await numberTaken(tx, doc, number)) throw conflict(`Number ${number} is already used for this document type`, { rule: 'NUMBER_TAKEN' });
  } else if (doc.number) {
    number = doc.number;
  } else {
    const year = registeredAt.getUTCFullYear();
    for (let i = 0; i < 1000 && !number; i++) {
      const seq = await tx.numberSequence.upsert({
        where: { legalEntityId_documentTypeId_year: { legalEntityId: doc.legalEntityId, documentTypeId: doc.documentTypeId, year } },
        create: { tenantId: doc.tenantId, legalEntityId: doc.legalEntityId, documentTypeId: doc.documentTypeId, year, lastValue: 1 },
        update: { lastValue: { increment: 1 } },
      });
      const candidate = formatNumber(doc.documentType.numberPattern, seq.lastValue, registeredAt);
      if (!(await numberTaken(tx, doc, candidate))) number = candidate;
    }
    if (!number) throw conflict('Could not allocate a document number');
  }
  await tx.document.update({ where: { id: doc.id }, data: { number, registeredAt, backdated } });
  await refreshSearchText(documentId, tx);
  return { number, registeredAt, backdated };
}

/** searchText = lower(title, number, subject name, type name); queried with ILIKE. */
export async function refreshSearchText(documentId: string, tx: Tx = prisma) {
  const d = await tx.document.findUniqueOrThrow({
    where: { id: documentId },
    include: { documentType: { select: { name: true } }, subject: { include: { user: { select: { firstName: true, lastName: true, middleName: true } } } } },
  });
  const searchText = [d.title, d.number, d.subject ? fullName(d.subject.user) : null, d.subject?.tabNumber, d.documentType.name]
    .filter(Boolean).join(' ').toLowerCase();
  await tx.document.update({ where: { id: d.id }, data: { searchText } });
}
