import ExcelJS from 'exceljs';
import type { Candidate } from '@prisma/client';
import { prisma } from '../../lib/db';
import { optDateStr } from '../../lib/dates';
import { fullName } from '../../lib/names';
import { acceptedValues, personalData } from './service';

/** One record of the 1С export (F-13): ФИО, ИИН, DOB, gender, contacts, address, ID document, education, IBAN. */
export async function exportRecord(c: Candidate & { legalEntity: { name: string; bin: string } }) {
  const { values, photoFileId } = await acceptedValues(c.id);
  const p = personalData(values);
  return {
    id: c.id,
    lastName: c.lastName,
    firstName: c.firstName,
    middleName: c.middleName,
    fullName: fullName(c),
    iin: c.iin,
    birthDate: optDateStr(c.birthDate) ?? ((values.ID_CARD?.birthDate as string | undefined) ?? null),
    gender: c.gender,
    email: c.email,
    phone: c.phone,
    status: c.status,
    tags: c.tags,
    legalEntity: { name: c.legalEntity.name, bin: c.legalEntity.bin },
    plannedHireDate: optDateStr(c.plannedHireDate),
    citizenship: p.citizenship,
    birthPlace: p.birthPlace,
    address: p.address,
    idDocument: p.idDocument,
    education: p.education,
    iban: p.bank,
    photoUrl: photoFileId ? `/api/v1/files/${photoFileId}` : null,
    updatedAt: c.updatedAt.toISOString(),
  };
}
export type ExportRecord = Awaited<ReturnType<typeof exportRecord>>;

export async function buildRecords(ids: string[]) {
  const rows = await prisma.candidate.findMany({ where: { id: { in: ids } }, include: { legalEntity: { select: { name: true, bin: true } } }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] });
  const out: ExportRecord[] = [];
  for (const r of rows) out.push(await exportRecord(r));
  return out;
}

const xmlEsc = (s: string) => s.replace(/[<>&'"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[ch]!);
const tag = (name: string, v: unknown): string => {
  if (v === null || v === undefined) return `<${name}/>`;
  if (Array.isArray(v)) return `<${name}>${v.map((x) => tag('Item', x)).join('')}</${name}>`;
  if (typeof v === 'object') {
    return `<${name}>${Object.entries(v as Record<string, unknown>).map(([k, x]) => tag(k.charAt(0).toUpperCase() + k.slice(1), x)).join('')}</${name}>`;
  }
  return `<${name}>${xmlEsc(String(v))}</${name}>`;
};

export function toXml(records: ExportRecord[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Candidates exportedAt="${new Date().toISOString()}" count="${records.length}">\n${records
    .map((r) => `  ${tag('Candidate', r)}`)
    .join('\n')}\n</Candidates>\n`;
}

export async function toXlsx(records: ExportRecord[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Akere HR';
  const ws = wb.addWorksheet('Кандидаты');
  ws.columns = [
    { header: 'Фамилия', key: 'lastName', width: 18 }, { header: 'Имя', key: 'firstName', width: 16 }, { header: 'Отчество', key: 'middleName', width: 18 },
    { header: 'ИИН', key: 'iin', width: 15 }, { header: 'Дата рождения', key: 'birthDate', width: 13 }, { header: 'Пол', key: 'gender', width: 10 },
    { header: 'Email', key: 'email', width: 26 }, { header: 'Телефон', key: 'phone', width: 15 }, { header: 'Юрлицо', key: 'legalEntity', width: 24 },
    { header: 'Гражданство', key: 'citizenship', width: 18 }, { header: 'Адрес регистрации', key: 'address', width: 50 },
    { header: 'Документ', key: 'idType', width: 30 }, { header: 'Номер документа', key: 'idNumber', width: 14 }, { header: 'Дата выдачи', key: 'idIssue', width: 12 },
    { header: 'Срок действия', key: 'idExpiry', width: 12 }, { header: 'Кем выдан', key: 'idIssuer', width: 12 },
    { header: 'Образование', key: 'eduCategory', width: 20 }, { header: 'Учебное заведение', key: 'eduInstitution', width: 40 }, { header: 'Специальность', key: 'eduSpecialty', width: 28 },
    { header: 'Банк', key: 'bank', width: 18 }, { header: 'IBAN', key: 'iban', width: 26 }, { header: 'Статус', key: 'status', width: 12 }, { header: 'Теги', key: 'tags', width: 20 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of records) {
    ws.addRow({
      lastName: r.lastName, firstName: r.firstName, middleName: r.middleName ?? '', iin: r.iin ?? '', birthDate: r.birthDate ?? '',
      gender: r.gender === 'MALE' ? 'Мужской' : r.gender === 'FEMALE' ? 'Женский' : '', email: r.email ?? '', phone: r.phone ?? '', legalEntity: r.legalEntity.name,
      citizenship: r.citizenship ?? '', address: r.address ?? '', idType: r.idDocument?.type ?? '', idNumber: r.idDocument?.number ?? '',
      idIssue: r.idDocument?.issueDate ?? '', idExpiry: r.idDocument?.expiryDate ?? '', idIssuer: r.idDocument?.issuedBy ?? '',
      eduCategory: r.education?.category ?? '', eduInstitution: r.education?.institution ?? '', eduSpecialty: r.education?.specialty ?? '',
      bank: r.iban?.bank ?? '', iban: r.iban?.iban ?? '', status: r.status, tags: r.tags.join(', '),
    });
  }
  ws.getColumn('iin').numFmt = '@';
  return Buffer.from(await wb.xlsx.writeBuffer());
}
