import ExcelJS from 'exceljs';
import type { VacationCampaign } from '@prisma/client';
import { prisma } from '../../lib/db';
import type { UserCtx } from '../../lib/auth';
import { fullName } from '../../lib/names';
import { toDateStr } from '../../lib/dates';
import { fmtShort } from '../requests/days';
import { gridWhere } from './service';

const STATUS_RU: Record<string, string> = { NONE: 'Не запланирован', DRAFT: 'Черновик', SUBMITTED: 'На согласовании', APPROVED: 'Согласован', REJECTED: 'Отклонён' };
const MAX_PERIODS = 4;

/**
 * "График отпусков" in the layout of the unified form Т-7: № п/п, ФИО, табельный №, должность, подразделение,
 * planned periods (date from/to, days), total days, status. Rows follow the grid scope and filters.
 */
export async function buildScheduleXlsx(u: UserCtx, campaign: VacationCampaign, filters: Parameters<typeof gridWhere>[2] = {}): Promise<Buffer> {
  const where = await gridWhere(u, campaign, filters);
  const emps = await prisma.employee.findMany({
    where,
    include: {
      user: { select: { firstName: true, lastName: true, middleName: true } },
      position: { select: { name: true } },
      department: { select: { name: true } },
      legalEntity: { select: { name: true } },
      vacationPlans: { where: { campaignId: campaign.id }, include: { periods: { orderBy: { startDate: 'asc' } } } },
    },
    orderBy: [{ legalEntity: { name: 'asc' } }, { department: { name: 'asc' } }, { user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
    take: 10_000,
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Akere HR';
  const ws = wb.addWorksheet(`График ${campaign.year}`, { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const legalEntities = [...new Set(emps.map((e) => e.legalEntity.name))];
  const periodCols = MAX_PERIODS * 3;
  const lastCol = 5 + periodCols + 2;

  ws.mergeCells(1, 1, 1, lastCol);
  ws.getCell(1, 1).value = legalEntities.join(', ') || '—';
  ws.getCell(1, 1).font = { bold: true, size: 11 };
  ws.mergeCells(2, 1, 2, lastCol);
  ws.getCell(2, 1).value = `ГРАФИК ОТПУСКОВ на ${campaign.year} год (унифицированная форма Т-7)`;
  ws.getCell(2, 1).font = { bold: true, size: 14 };
  ws.getCell(2, 1).alignment = { horizontal: 'center' };

  const head1 = ['№ п/п', 'Фамилия, имя, отчество', 'Табельный номер', 'Должность', 'Структурное подразделение'];
  const h1 = ws.getRow(4);
  const h2 = ws.getRow(5);
  head1.forEach((t, i) => {
    ws.mergeCells(4, i + 1, 5, i + 1);
    h1.getCell(i + 1).value = t;
  });
  for (let k = 0; k < MAX_PERIODS; k++) {
    const c = 6 + k * 3;
    ws.mergeCells(4, c, 4, c + 2);
    h1.getCell(c).value = `Часть ${k + 1}`;
    h2.getCell(c).value = 'с';
    h2.getCell(c + 1).value = 'по';
    h2.getCell(c + 2).value = 'дней';
  }
  const totalCol = 6 + periodCols;
  ws.mergeCells(4, totalCol, 5, totalCol);
  h1.getCell(totalCol).value = 'Всего календарных дней';
  ws.mergeCells(4, totalCol + 1, 5, totalCol + 1);
  h1.getCell(totalCol + 1).value = 'Статус';
  for (const row of [h1, h2]) {
    row.font = { bold: true };
    row.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  }

  let r = 6;
  emps.forEach((e, i) => {
    const plan = e.vacationPlans[0];
    const periods = plan?.periods ?? [];
    const row = ws.getRow(r++);
    row.getCell(1).value = i + 1;
    row.getCell(2).value = fullName(e.user);
    row.getCell(3).value = e.tabNumber;
    row.getCell(4).value = e.position?.name ?? '';
    row.getCell(5).value = e.department?.name ?? '';
    periods.slice(0, MAX_PERIODS).forEach((p, k) => {
      const c = 6 + k * 3;
      row.getCell(c).value = fmtShort(toDateStr(p.startDate));
      row.getCell(c + 1).value = fmtShort(toDateStr(p.endDate));
      row.getCell(c + 2).value = p.days;
    });
    if (periods.length > MAX_PERIODS) {
      row.getCell(6 + (MAX_PERIODS - 1) * 3 + 1).value = periods.slice(MAX_PERIODS - 1).map((p) => `${fmtShort(toDateStr(p.startDate))}–${fmtShort(toDateStr(p.endDate))}`).join('; ');
      row.getCell(6 + (MAX_PERIODS - 1) * 3 + 2).value = periods.slice(MAX_PERIODS - 1).reduce((s, p) => s + p.days, 0);
    }
    row.getCell(totalCol).value = periods.reduce((s, p) => s + p.days, 0);
    row.getCell(totalCol + 1).value = STATUS_RU[plan?.status ?? 'NONE'];
  });

  for (let row = 4; row < r; row++) {
    for (let c = 1; c <= lastCol; c++) {
      ws.getCell(row, c).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    }
  }
  ws.getColumn(1).width = 6;
  ws.getColumn(2).width = 36;
  ws.getColumn(3).width = 11;
  ws.getColumn(4).width = 28;
  ws.getColumn(5).width = 26;
  for (let c = 6; c < totalCol; c++) ws.getColumn(c).width = (c - 6) % 3 === 2 ? 7 : 12;
  ws.getColumn(totalCol).width = 12;
  ws.getColumn(totalCol + 1).width = 18;
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 5 }];

  r += 1;
  ws.getCell(r, 2).value = 'Руководитель кадровой службы ____________________';
  ws.getCell(r + 1, 2).value = `Сформировано в Akere HR ${fmtShort(toDateStr(new Date()))}`;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
