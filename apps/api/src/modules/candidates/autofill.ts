import { prisma } from '../../lib/db';
import { businessRule } from '../../lib/errors';
import { saveGenerated } from '../../lib/files';
import { storage } from '../../adapters/storage';
import { AUTOFILL_FILENAMES, personalFile, type GeneratedFile } from '../../adapters/personal-file';
import { visibleFields, type FormFieldDef } from '../onboarding/service';
import { refreshDocStatus } from './service';

/**
 * Fills every auto-fillable document of a request from the personal-file service (F-08):
 * values (limited to the template's field subset), autoFilledKeys and generated files
 * ("Личные данные" PDF on the identity document, the photo on PHOTO). Re-running replaces earlier generated files.
 * Returns the ids of the documents that received data.
 */
export async function applyAutofill(requestId: string, opts: { onlyReturned?: boolean } = {}): Promise<string[]> {
  const r = await prisma.documentRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { candidate: true, documents: { include: { docType: true, files: true }, orderBy: { docType: { sortOrder: 'asc' } } } },
  });
  const c = r.candidate;
  if (!c.iin) throw businessRule('NO_IIN', 'Автозаполнение недоступно: у кандидата нет ИИН');
  const result = await personalFile.fetch(c.iin, c);

  const filled: string[] = [];
  let reportAttached = false;
  const attach = async (docId: string, f: GeneratedFile) => {
    const saved = await saveGenerated(c.tenantId, f.buffer, f.filename, f.mime);
    await prisma.storedFile.update({ where: { id: saved.id }, data: { candidateDocumentId: docId } });
  };

  for (const d of r.documents) {
    if (!d.docType.autoFillable || d.status === 'ACCEPTED' || (opts.onlyReturned && d.status !== 'RETURNED')) continue;
    const data = result.documents[d.docType.code];
    if (!data) continue;
    const allowed = new Set(visibleFields((d.docType.fields ?? []) as FormFieldDef[], (d.fieldKeys ?? []) as string[]).map((f) => f.key));
    const vals = Object.fromEntries(Object.entries(data.values).filter(([k]) => allowed.has(k)));
    if (!Object.keys(vals).length && !data.files.length) continue;

    const old = d.files.filter((f) => f.uploadedById === null && AUTOFILL_FILENAMES.includes(f.filename));
    for (const f of old) {
      await prisma.storedFile.delete({ where: { id: f.id } });
      await storage.delete(f.key).catch(() => undefined);
    }
    for (const f of data.files) {
      await attach(d.id, f);
      if (f === result.report) reportAttached = true;
    }
    await prisma.candidateDocument.update({
      where: { id: d.id },
      data: {
        values: { ...((d.values ?? {}) as Record<string, unknown>), ...vals } as object,
        autoFilledKeys: [...new Set([...d.autoFilledKeys, ...Object.keys(vals)])],
      },
    });
    await refreshDocStatus(d.id);
    filled.push(d.id);
  }
  // No identity document in the template: keep the government report on the first filled document.
  // (Earlier generated copies on that document were removed in the loop above.)
  if (!reportAttached && filled.length) await attach(filled[0]!, result.report);
  return filled;
}
