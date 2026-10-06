import ExcelJS from 'exceljs';
import { CandidateInput } from '@akere/shared';
import { AppError } from '../../lib/errors';
import { zipStats } from '../../lib/zip';

/** Columns of the bulk-import template (F-03). `key` is the CandidateInput field reported in row errors. */
const COLUMNS = [
  { key: 'lastName', header: 'Фамилия*', width: 20 },
  { key: 'firstName', header: 'Имя*', width: 18 },
  { key: 'middleName', header: 'Отчество', width: 20 },
  { key: 'iin', header: 'ИИН', width: 16 },
  { key: 'noIin', header: 'ИИН отсутствует', width: 16 },
  { key: 'birthDate', header: 'Дата рождения (ДД.ММ.ГГГГ)', width: 18 },
  { key: 'gender', header: 'Пол', width: 12 },
  { key: 'channels', header: 'Канал связи*', width: 24 },
  { key: 'email', header: 'Электронный адрес', width: 28 },
  { key: 'phone', header: 'Номер телефона (+7XXXXXXXXXX)', width: 22 },
  { key: 'tags', header: 'Теги (через запятую)', width: 22 },
  { key: 'comment', header: 'Комментарий', width: 30 },
] as const;
type ColKey = (typeof COLUMNS)[number]['key'];

const GENDERS = ['Мужской', 'Женский'];
const CHANNEL_OPTIONS = ['Email', 'SMS', 'WhatsApp', 'Email + SMS', 'Email + WhatsApp', 'SMS + WhatsApp', 'Email + SMS + WhatsApp'];
const YES_NO = ['Да', 'Нет'];
export const MAX_IMPORT_ROWS = 1000;
/** Upload cap for the import workbook and limits checked on its ZIP central directory before parsing (M7). */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
export const MAX_IMPORT_ZIP_ENTRIES = 1000;

/** Rejects (413) workbooks that would inflate beyond the limits; malformed archives are left to the parser's error. */
export function assertImportArchiveSize(buffer: Buffer) {
  if (buffer.length > MAX_IMPORT_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'The import file must not exceed 2 MB');
  const z = zipStats(buffer);
  if (!z) throw new AppError(413, 'FILE_TOO_LARGE', 'The import file is not a supported XLSX archive');
  if (z.entries > MAX_IMPORT_ZIP_ENTRIES || z.uncompressedBytes > MAX_IMPORT_UNCOMPRESSED_BYTES) {
    throw new AppError(413, 'FILE_TOO_LARGE', 'The import file is too large when unpacked', { entries: z.entries, uncompressedBytes: z.uncompressedBytes });
  }
}

export async function buildImportTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Akere HR';
  const ws = wb.addWorksheet('Кандидаты');
  const lists = wb.addWorksheet('Справочники', { state: 'veryHidden' });
  GENDERS.forEach((g, i) => (lists.getCell(i + 1, 1).value = g));
  CHANNEL_OPTIONS.forEach((g, i) => (lists.getCell(i + 1, 2).value = g));
  YES_NO.forEach((g, i) => (lists.getCell(i + 1, 3).value = g));

  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2433D6' } };
  head.alignment = { vertical: 'middle', wrapText: true };
  head.height = 32;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const key of ['iin', 'phone', 'birthDate'] as const) ws.getColumn(key).numFmt = '@';

  const col = (key: ColKey) => COLUMNS.findIndex((c) => c.key === key) + 1;
  const letter = (key: ColKey) => ws.getColumn(col(key)).letter;
  for (let row = 2; row <= MAX_IMPORT_ROWS + 1; row++) {
    ws.getCell(`${letter('gender')}${row}`).dataValidation = {
      type: 'list', allowBlank: true, formulae: ['Справочники!$A$1:$A$2'], showErrorMessage: true, errorTitle: 'Пол', error: 'Выберите значение из списка',
    };
    ws.getCell(`${letter('channels')}${row}`).dataValidation = {
      type: 'list', allowBlank: false, formulae: [`Справочники!$B$1:$B$${CHANNEL_OPTIONS.length}`], showErrorMessage: true, errorTitle: 'Канал связи', error: 'Выберите значение из списка',
    };
    ws.getCell(`${letter('noIin')}${row}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['Справочники!$C$1:$C$2'] };
  }

  const help = wb.addWorksheet('Инструкция');
  help.getColumn(1).width = 110;
  [
    'Как заполнить шаблон',
    '1. Одна строка — один кандидат. Поля со звёздочкой (*) обязательны.',
    '2. ИИН — 12 цифр. Если ИИН нет (иностранный гражданин), оставьте поле пустым и выберите «Да» в колонке «ИИН отсутствует».',
    '3. Канал связи — по нему кандидат получит приглашение и код входа. Для Email заполните электронный адрес, для SMS/WhatsApp — номер телефона.',
    '4. Дата рождения — в формате ДД.ММ.ГГГГ. Если указан ИИН, дату рождения и пол можно не заполнять — они определятся по ИИН.',
    '5. Сохраните файл и загрузите его в окне «Массовое добавление». Сначала система проверит файл и покажет ошибки по строкам.',
  ].forEach((line, i) => {
    const cell = help.getCell(i + 1, 1);
    cell.value = line;
    if (i === 0) cell.font = { bold: true, size: 14 };
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export type ImportRowError = { row: number; field: string; message: string };
export type ParsedRow = { row: number; data: CandidateInput };

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('text' in v && typeof v.text === 'string') return v.text.trim(); // hyperlink
    if ('richText' in v) return v.richText.map((t) => t.text).join('').trim();
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    return '';
  }
  return String(v).trim();
}

function parseDate(s: string): string | null | undefined {
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return undefined; // invalid
}

function parseChannels(s: string): string[] | undefined {
  const out: string[] = [];
  for (const raw of s.split(/[+,;/]|\s{2,}/).map((x) => x.trim().toLowerCase()).filter(Boolean)) {
    if (['email', 'e-mail', 'почта', 'электронная почта', 'электронный адрес'].includes(raw)) out.push('EMAIL');
    else if (['sms', 'смс', 'телефон', 'номер телефона'].includes(raw)) out.push('SMS');
    else if (['whatsapp', 'ватсап', 'вотсап', 'whats app'].includes(raw)) out.push('WHATSAPP');
    else return undefined;
  }
  return [...new Set(out)];
}

/** Parses the uploaded workbook into validated CandidateInput rows + row-level errors. */
export async function parseImport(buffer: Buffer, legalEntityId: string): Promise<{ rows: ParsedRow[]; errors: ImportRowError[] }> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    return { rows: [], errors: [{ row: 0, field: 'file', message: 'Не удалось прочитать файл XLSX' }] };
  }
  const ws = wb.getWorksheet('Кандидаты') ?? wb.worksheets[0];
  if (!ws) return { rows: [], errors: [{ row: 0, field: 'file', message: 'Файл не содержит листов' }] };

  const norm = (s: string) => s.toLowerCase().replace(/\*|\(.*?\)/g, '').trim();
  const colIndex = new Map<ColKey, number>();
  ws.getRow(1).eachCell((cell, idx) => {
    const h = norm(cellText(cell.value));
    const c = COLUMNS.find((x) => norm(x.header) === h);
    if (c) colIndex.set(c.key, idx);
  });
  const missing = (['lastName', 'firstName', 'channels'] as const).filter((k) => !colIndex.has(k));
  if (missing.length) return { rows: [], errors: missing.map((k) => ({ row: 1, field: k, message: `Нет колонки «${COLUMNS.find((c) => c.key === k)!.header}»` })) };

  const rows: ParsedRow[] = [];
  const errors: ImportRowError[] = [];
  const seenIin = new Map<string, number>();
  let count = 0;
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (k: ColKey) => (colIndex.has(k) ? cellText(row.getCell(colIndex.get(k)!).value) : '');
    if (COLUMNS.every((c) => !get(c.key))) continue;
    if (++count > MAX_IMPORT_ROWS) {
      errors.push({ row: r, field: 'file', message: `Не более ${MAX_IMPORT_ROWS} строк за одну загрузку` });
      break;
    }
    const rowErrors: ImportRowError[] = [];
    let iin = get('iin').replace(/\s/g, '');
    if (/^\d{1,11}$/.test(iin)) iin = iin.padStart(12, '0'); // Excel drops leading zeros
    const birth = parseDate(get('birthDate'));
    if (birth === undefined) rowErrors.push({ row: r, field: 'birthDate', message: 'Неверная дата, используйте ДД.ММ.ГГГГ' });
    const genderText = get('gender').toLowerCase();
    const gender = !genderText ? null : genderText.startsWith('м') ? 'MALE' : genderText.startsWith('ж') ? 'FEMALE' : undefined;
    if (gender === undefined) rowErrors.push({ row: r, field: 'gender', message: 'Пол: «Мужской» или «Женский»' });
    const channels = parseChannels(get('channels'));
    if (!channels) rowErrors.push({ row: r, field: 'channels', message: 'Канал связи: Email, SMS или WhatsApp' });
    const phoneRaw = get('phone').replace(/[\s()-]/g, '');
    const phone = !phoneRaw ? null : /^[78]\d{10}$/.test(phoneRaw) ? `+7${phoneRaw.slice(1)}` : phoneRaw;
    const input = {
      legalEntityId,
      lastName: get('lastName'),
      firstName: get('firstName'),
      middleName: get('middleName') || null,
      iin: iin || null,
      noIin: /^(да|yes|true|1|\+)$/i.test(get('noIin')),
      birthDate: birth ?? null,
      gender: gender ?? null,
      channels: channels ?? [],
      email: get('email') || null,
      phone,
      tags: get('tags') ? get('tags').split(',').map((t) => t.trim()).filter(Boolean) : [],
      comment: get('comment') || null,
    };
    const parsed = CandidateInput.safeParse(input);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? 'row');
        if (!rowErrors.some((e) => e.field === field)) rowErrors.push({ row: r, field, message: issue.message });
      }
    }
    if (input.iin && !input.noIin) {
      const prev = seenIin.get(input.iin);
      if (prev) rowErrors.push({ row: r, field: 'iin', message: `ИИН повторяется (строка ${prev})` });
      else seenIin.set(input.iin, r);
    }
    if (rowErrors.length || !parsed.success) errors.push(...rowErrors);
    else rows.push({ row: r, data: parsed.data });
  }
  if (count === 0 && !errors.length) errors.push({ row: 0, field: 'file', message: 'В файле нет строк с кандидатами' });
  return { rows, errors };
}
