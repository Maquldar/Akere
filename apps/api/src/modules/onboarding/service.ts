import type { PersonalDocType, Prisma, PrismaClient, QuestionnaireTemplate } from '@prisma/client';
import { prisma, type Tx } from '../../lib/db';
import { PERSONAL_DOC_CATALOG, type CatalogField } from './catalog';

export type FormFieldDef = CatalogField | { key: string; label: string; labelKk?: string; type: CatalogField['type']; required: boolean; options?: string[] };

/**
 * Idempotently writes the system personal-document catalogue (tenantId = null).
 * Postgres treats NULLs as distinct in unique indexes, so we match on code manually.
 */
export async function ensurePersonalDocCatalog(db: Tx | PrismaClient = prisma) {
  const existing = await db.personalDocType.findMany({ where: { tenantId: null } });
  const byCode = new Map(existing.map((d) => [d.code, d]));
  for (const [i, doc] of PERSONAL_DOC_CATALOG.entries()) {
    const data = { name: doc.name, nameKk: doc.nameKk, fields: doc.fields as unknown as Prisma.InputJsonValue, autoFillable: doc.autoFillable, sortOrder: (i + 1) * 10 };
    const found = byCode.get(doc.code);
    if (found) await db.personalDocType.update({ where: { id: found.id }, data });
    else await db.personalDocType.create({ data: { ...data, tenantId: null, code: doc.code } });
  }
}

export type PersonalDocTypeView = { id: string; code: string; name: string; nameKk: string | null; fields: FormFieldDef[]; autoFillable: boolean };
export const docTypeView = (d: PersonalDocType): PersonalDocTypeView => ({
  id: d.id, code: d.code, name: d.name, nameKk: d.nameKk, fields: (d.fields ?? []) as FormFieldDef[], autoFillable: d.autoFillable,
});

/** System catalogue + tenant-specific types. Re-creates the catalogue if it is missing (fresh DB). */
export async function listDocTypes(tenantId: string) {
  const where = { OR: [{ tenantId: null }, { tenantId }] };
  let rows = await prisma.personalDocType.findMany({ where, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  if (!rows.some((r) => r.tenantId === null)) {
    await ensurePersonalDocCatalog();
    rows = await prisma.personalDocType.findMany({ where, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  }
  return rows;
}

export type QuestionnaireView = { id: string; name: string; fields: FormFieldDef[]; updatedAt: string };
export const questionnaireView = (q: QuestionnaireTemplate): QuestionnaireView => ({
  id: q.id, name: q.name, fields: (q.fields ?? []) as FormFieldDef[], updatedAt: q.updatedAt.toISOString(),
});

export const templateInclude = {
  questionnaire: { select: { id: true, name: true } },
  items: { include: { docType: true }, orderBy: { sortOrder: 'asc' } },
} as const satisfies Prisma.RequestTemplateInclude;
type TemplateRow = Prisma.RequestTemplateGetPayload<{ include: typeof templateInclude }>;

export const templateView = (t: TemplateRow) => ({
  id: t.id,
  name: t.name,
  questionnaire: t.questionnaire ? { id: t.questionnaire.id, name: t.questionnaire.name } : null,
  items: t.items.map((i) => ({ personalDocType: docTypeView(i.docType), required: i.required, fieldKeys: (i.fieldKeys ?? []) as string[] })),
  updatedAt: t.updatedAt.toISOString(),
});

/** Fields of a doc type shown for a request item (fieldKeys = [] means all). */
export function visibleFields(fields: FormFieldDef[], fieldKeys: string[]): FormFieldDef[] {
  return fieldKeys.length ? fields.filter((f) => fieldKeys.includes(f.key)) : fields;
}
