import type { Tone } from '@/components/ui/badge';
import type {
  CandidateCheck, CandidateDocStatus, CandidateDocumentView, CandidateStatus, DocRequestStatus, FormField, InvitationStatus,
  PersonalDocTypeView,
} from '@/lib/api/types-onboarding';

export const statusTone: Record<CandidateStatus, Tone> = {
  NEW: 'blue',
  IN_PROGRESS: 'orange',
  ACCEPTED: 'green',
  EXPORTED: 'teal',
  BLOCKED: 'red',
};

export const invitationTone: Record<InvitationStatus, Tone> = { NONE: 'gray', SENT: 'blue', ACCEPTED: 'green' };

export const docRequestTone: Record<DocRequestStatus, Tone> = {
  NONE: 'gray',
  SENT: 'gray',
  FILLING: 'orange',
  UPLOADED: 'purple',
  COMPLETED: 'green',
  RETURNED: 'red',
};

export const checkTone: Record<CandidateCheck, Tone> = {
  NONE: 'gray',
  ON_REVIEW: 'blue',
  RECOMMENDED: 'green',
  CONDITIONAL: 'orange',
  NOT_RECOMMENDED: 'red',
};

export const docStatusTone: Record<CandidateDocStatus, Tone> = { PENDING: 'gray', FILLED: 'blue', ACCEPTED: 'green', RETURNED: 'red' };

/** Candidate request states in which the portal is still open for editing. */
export const OPEN_REQUEST: DocRequestStatus[] = ['SENT', 'FILLING', 'RETURNED'];

/** Status transitions the API allows from the inline dropdown (candidates/routes.ts `assertStatusChange`). */
export function allowedStatus(c: { status: CandidateStatus; docRequestStatus: DocRequestStatus; employeeId?: string | null }, to: CandidateStatus): boolean {
  if (c.employeeId) return false;
  if (to === c.status) return true;
  if (to === 'ACCEPTED') return c.docRequestStatus === 'COMPLETED';
  if (to === 'EXPORTED') return c.status === 'ACCEPTED';
  if (to === 'NEW') return c.docRequestStatus === 'NONE';
  return true;
}

/** Label in the UI language (kk uses labelKk when present). */
export function fieldLabel(f: Pick<FormField, 'label' | 'labelKk'>, locale: string): string {
  return locale === 'kk' && f.labelKk ? f.labelKk : f.label;
}

export function docTypeName(d: Pick<PersonalDocTypeView, 'name' | 'nameKk'>, locale: string): string {
  return locale === 'kk' && d.nameKk ? d.nameKk : d.name;
}

/** Fields of a doc type shown for a request item (`fieldKeys = []` means all). Mirrors the API. */
export function visibleFields(fields: FormField[], fieldKeys: string[]): FormField[] {
  return fieldKeys.length ? fields.filter((f) => fieldKeys.includes(f.key)) : fields;
}

export function docFields(d: Pick<CandidateDocumentView, 'docType' | 'fieldKeys'>): FormField[] {
  return visibleFields(d.docType.fields ?? [], d.fieldKeys ?? []).filter((f) => f.type !== 'file');
}

export const isEmptyValue = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/** Same rule as the API (`docCompleteness`): a file, or all required fields (any value if none required). PHOTO needs a file. */
export function docComplete(d: Pick<CandidateDocumentView, 'docType' | 'fieldKeys' | 'values' | 'files'>): boolean {
  const fields = docFields(d);
  const hasFile = d.files.length > 0;
  if (d.docType.code === 'PHOTO' || fields.length === 0) return hasFile;
  if (hasFile) return true;
  const required = fields.filter((f) => f.required);
  if (required.length === 0) return fields.some((f) => !isEmptyValue(d.values[f.key]));
  return required.every((f) => !isEmptyValue(d.values[f.key]));
}

/** Form draft (strings/booleans) from stored values. */
export function toDraft(fields: FormField[], values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.key];
    if (f.type === 'checkbox') out[f.key] = v === true;
    else out[f.key] = v === null || v === undefined ? '' : String(v);
  }
  return out;
}

/** API payload from a draft: '' → null, numbers parsed, checkbox booleans. Only changed keys. */
export function fromDraft(fields: FormField[], draft: Record<string, unknown>, original: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = draft[f.key];
    let v: unknown;
    if (f.type === 'checkbox') v = raw === true;
    else if (typeof raw !== 'string' || raw.trim() === '') v = null;
    else if (f.type === 'number') {
      const n = Number(raw.replace(',', '.'));
      v = Number.isFinite(n) ? n : raw;
    } else v = raw.trim();
    const before = original[f.key] ?? (f.type === 'checkbox' ? false : null);
    if (JSON.stringify(before) !== JSON.stringify(v)) out[f.key] = v;
  }
  return out;
}

export function isDraftDirty(fields: FormField[], draft: Record<string, unknown> | undefined, original: Record<string, unknown>): boolean {
  if (!draft) return false;
  return Object.keys(fromDraft(fields, draft, original)).length > 0;
}

/** ИИН/БИН: 12 digits with the official checksum (packages/shared validators). */
export function isValidIin(value: string): boolean {
  if (!/^\d{12}$/.test(value)) return false;
  const d = value.split('').map(Number);
  const w1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const w2 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2];
  let sum = w1.reduce((s, w, i) => s + w * d[i]!, 0) % 11;
  if (sum === 10) {
    sum = w2.reduce((s, w, i) => s + w * d[i]!, 0) % 11;
    if (sum === 10) return false;
  }
  return sum === d[11];
}

/** Birth date and gender encoded in an ИИН (digits 1–7), or null. */
export function decodeIin(iin: string): { birthDate: string; gender: 'MALE' | 'FEMALE' } | null {
  if (!/^\d{12}$/.test(iin)) return null;
  const c = Number(iin[6]);
  if (c < 1 || c > 6) return null;
  const century = c <= 2 ? 1800 : c <= 4 ? 1900 : 2000;
  const year = century + Number(iin.slice(0, 2));
  const month = Number(iin.slice(2, 4));
  const day = Number(iin.slice(4, 6));
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return { birthDate: d.toISOString().slice(0, 10), gender: c % 2 === 1 ? 'MALE' : 'FEMALE' };
}

/** Latin key from a label for questionnaire fields (`^[a-zA-Z][a-zA-Z0-9_]{0,59}$`). */
const TRANSLIT: Record<string, string> = {
  а: 'a', ә: 'a', б: 'b', в: 'v', г: 'g', ғ: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', қ: 'k', л: 'l',
  м: 'm', н: 'n', ң: 'n', о: 'o', ө: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ұ: 'u', ү: 'u', ф: 'f', х: 'h', һ: 'h', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', і: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya',
};
export function keyFromLabel(label: string): string {
  const latin = label
    .toLowerCase()
    .split('')
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');
  const key = /^[a-z]/.test(latin) ? latin : `field${latin}`;
  return key.slice(0, 60) || 'field';
}

/** Copy of a record without one key. */
export function omitKey<T>(o: Record<string, T>, key: string): Record<string, T> {
  const next = { ...o };
  delete next[key];
  return next;
}
