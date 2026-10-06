import ExcelJS from 'exceljs';
import { daysInMonth } from '../../lib/calendar';
import type { T13Data } from './service';

export const T13_LEGEND: [string, string][] = [
  ['Я', 'Продолжительность работы в дневное время'],
  ['Н', 'Продолжительность работы в ночное время (22:00–06:00)'],
  ['С', 'Сверхурочная работа'],
  ['РВ', 'Работа в выходной или нерабочий праздничный день'],
  ['В', 'Выходной день'],
  ['П', 'Нерабочий праздничный день'],
  ['О', 'Ежегодный оплачиваемый отпуск'],
  ['БС', 'Отпуск без сохранения заработной платы'],
  ['Б', 'Временная нетрудоспособность (больничный)'],
  ['К', 'Служебная командировка'],
  ['НН', 'Неявка по невыясненным причинам'],
];

const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const thin = { style: 'thin' as const, color: { argb: 'FF9CA3AF' } };
const border = { top: thin, left: thin, bottom: thin, right: thin };
const grey: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F2F4' } };
const head: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };

/** Renders the T-13 sheet as xlsx: two rows per employee (codes / hours), totals, legend. */
export async function renderT13Xlsx(sheet: T13Data): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Akere HR';
  wb.created = new Date();
  const ws = wb.addWorksheet(`Т-13 ${String(sheet.month).padStart(2, '0')}.${sheet.year}`, {
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: 'frozen', xSplit: 4, ySplit: 7 }],
  });
  const n = daysInMonth(sheet.year, sheet.month);
  const firstDayCol = 5;
  const totalsCol = firstDayCol + n;
  const lastCol = totalsCol + 5;
  const mm = String(sheet.month).padStart(2, '0');

  ws.mergeCells(1, 1, 1, lastCol);
  ws.getCell(1, 1).value = 'ТАБЕЛЬ УЧЕТА РАБОЧЕГО ВРЕМЕНИ (форма Т-13)';
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.getCell(1, 1).alignment = { horizontal: 'center' };
  ws.mergeCells(2, 1, 2, lastCol);
  ws.getCell(2, 1).value = `Организация: ${sheet.meta.legalEntityName ?? sheet.meta.tenantName}`;
  ws.mergeCells(3, 1, 3, lastCol);
  ws.getCell(3, 1).value = `Структурное подразделение: ${sheet.meta.departmentName ?? 'все подразделения'}`;
  ws.mergeCells(4, 1, 4, lastCol);
  ws.getCell(4, 1).value = `Отчетный период: ${MONTHS[sheet.month - 1]} ${sheet.year} (01.${mm}.${sheet.year} — ${String(n).padStart(2, '0')}.${mm}.${sheet.year}). Норма: ${sheet.rows[0]?.normHours ?? sheet.totals.normHours} ч`;

  // Header (rows 6–7).
  const h1 = 6, h2 = 7;
  const fixed = ['№ п/п', 'Фамилия, инициалы', 'Должность', 'Таб. №'];
  fixed.forEach((t, i) => {
    ws.mergeCells(h1, i + 1, h2, i + 1);
    ws.getCell(h1, i + 1).value = t;
  });
  for (const d of sheet.days) {
    const c = firstDayCol + d.day - 1;
    ws.getCell(h1, c).value = d.day;
    ws.getCell(h2, c).value = WD[d.weekday];
    if (d.isWeekend) [h1, h2].forEach((r) => (ws.getCell(r, c).fill = grey));
  }
  const totals = ['План, ч', 'Факт, ч', 'Норма, ч', '1.5x, ч', '2x, ч', 'Откл.'];
  totals.forEach((t, i) => {
    ws.mergeCells(h1, totalsCol + i, h2, totalsCol + i);
    ws.getCell(h1, totalsCol + i).value = t;
  });
  for (const r of [h1, h2]) {
    for (let c = 1; c <= lastCol; c++) {
      const cell = ws.getCell(r, c);
      cell.font = { bold: true, size: 9 };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = border;
      if (!cell.fill || (cell.fill as ExcelJS.FillPattern).pattern !== 'solid') cell.fill = head;
    }
  }

  // Body: codes row + hours row per employee.
  let r = h2 + 1;
  sheet.rows.forEach((row, idx) => {
    const meta = sheet.rowsMeta[idx]!;
    const vals = [idx + 1, row.employee.shortName, meta.position ?? '', meta.tabNumber];
    vals.forEach((v, i) => {
      ws.mergeCells(r, i + 1, r + 1, i + 1);
      ws.getCell(r, i + 1).value = v;
    });
    for (const cell of row.cells) {
      const c = firstDayCol + cell.day - 1;
      const codes = cell.codes.filter((x) => x !== 'Я' || cell.codes.length === 1);
      ws.getCell(r, c).value = codes.join(' ') || (cell.hours !== null ? 'Я' : '');
      ws.getCell(r + 1, c).value = cell.hours ?? '';
      if (cell.deviation) [r, r + 1].forEach((rr) => (ws.getCell(rr, c).font = { color: { argb: 'FFDC2626' }, bold: true, size: 9 }));
      if (sheet.days[cell.day - 1]?.isWeekend) [r, r + 1].forEach((rr) => (ws.getCell(rr, c).fill = grey));
    }
    [row.planHours, row.factHours, row.normHours, row.overtime15, row.overtime2, row.deviations].forEach((v, i) => {
      ws.mergeCells(r, totalsCol + i, r + 1, totalsCol + i);
      ws.getCell(r, totalsCol + i).value = v;
    });
    for (const rr of [r, r + 1]) {
      for (let c = 1; c <= lastCol; c++) {
        const cell = ws.getCell(rr, c);
        cell.border = border;
        cell.alignment = { horizontal: c === 2 || c === 3 ? 'left' : 'center', vertical: 'middle', wrapText: c === 3 };
        if (!cell.font?.color) cell.font = { size: 9 };
      }
    }
    r += 2;
  });

  // Totals row.
  ws.mergeCells(r, 1, r, 4);
  ws.getCell(r, 1).value = 'ИТОГО';
  sheet.totals.perDay.forEach((v, i) => (ws.getCell(r, firstDayCol + i).value = v || ''));
  [sheet.totals.planHours, sheet.totals.factHours, sheet.totals.normHours, sheet.totals.overtime15, sheet.totals.overtime2, sheet.deviationsTotal].forEach(
    (v, i) => (ws.getCell(r, totalsCol + i).value = v),
  );
  for (let c = 1; c <= lastCol; c++) {
    const cell = ws.getCell(r, c);
    cell.font = { bold: true, size: 9 };
    cell.border = border;
    cell.fill = head;
    cell.alignment = { horizontal: c === 1 ? 'left' : 'center', vertical: 'middle' };
  }

  // Confirmation + legend.
  r += 2;
  ws.getCell(r, 1).value = `Подтверждение руководителями: ${sheet.confirmation.confirmed}/${sheet.confirmation.total}`;
  r += 2;
  ws.getCell(r, 1).value = 'Условные обозначения';
  ws.getCell(r, 1).font = { bold: true };
  for (const [code, label] of T13_LEGEND) {
    r++;
    ws.getCell(r, 1).value = code;
    ws.getCell(r, 1).font = { bold: true };
    ws.getCell(r, 1).alignment = { horizontal: 'center' };
    ws.mergeCells(r, 2, r, 10);
    ws.getCell(r, 2).value = label;
  }
  r += 2;
  ws.getCell(r, 2).value = 'Ответственное лицо: ____________________   Руководитель: ____________________';

  ws.getColumn(1).width = 5;
  ws.getColumn(2).width = 24;
  ws.getColumn(3).width = 22;
  ws.getColumn(4).width = 8;
  for (let c = firstDayCol; c < totalsCol; c++) ws.getColumn(c).width = 4.6;
  for (let c = totalsCol; c <= lastCol; c++) ws.getColumn(c).width = 8;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
