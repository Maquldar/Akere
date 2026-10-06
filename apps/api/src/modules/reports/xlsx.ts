import ExcelJS from 'exceljs';
import type { FastifyReply } from 'fastify';

export type SheetSpec = {
  name: string;
  /** Optional caption rows above the table (title, period…). */
  caption?: string[];
  columns: { header: string; key: string; width: number }[];
  rows: Record<string, string | number | null>[];
};

/** Builds an xlsx workbook: bold frozen header, optional caption lines, autofilter. */
export async function buildXlsx(sheets: SheetSpec[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Akere HR';
  wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    const caption = s.caption ?? [];
    caption.forEach((line, i) => {
      const row = ws.getRow(i + 1);
      row.getCell(1).value = line;
      row.font = i === 0 ? { bold: true, size: 13 } : { color: { argb: 'FF555555' } };
    });
    const headerRowNo = caption.length ? caption.length + 2 : 1;
    s.columns.forEach((c, i) => {
      ws.getColumn(i + 1).width = c.width;
    });
    const header = ws.getRow(headerRowNo);
    s.columns.forEach((c, i) => {
      header.getCell(i + 1).value = c.header;
    });
    header.font = { bold: true };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF0FB' } };
    s.rows.forEach((r, ri) => {
      const row = ws.getRow(headerRowNo + 1 + ri);
      s.columns.forEach((c, i) => {
        row.getCell(i + 1).value = r[c.key] ?? '';
      });
    });
    ws.views = [{ state: 'frozen', ySplit: headerRowNo }];
    if (s.rows.length) ws.autoFilter = { from: { row: headerRowNo, column: 1 }, to: { row: headerRowNo + s.rows.length, column: s.columns.length } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function sendXlsx(reply: FastifyReply, buffer: Buffer, filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_');
  return reply
    .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .header('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`)
    .send(buffer);
}

/** "06.10.2026 14:30" in the given time zone. */
export function fmtDateTime(d: Date | null | undefined, tz: string): string {
  if (!d) return '';
  const parts = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return parts.replace(',', '');
}

export function fmtDate(d: Date | null | undefined): string {
  if (!d) return '';
  const s = d.toISOString().slice(0, 10);
  return `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
}
