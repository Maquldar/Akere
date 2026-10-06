import { prisma, type Tx } from '../../lib/db';
import { on } from '../../lib/hooks';
import { registerFileAccess } from '../../lib/files';
import { AppError } from '../../lib/errors';
import { toDateStr } from '../../lib/dates';
import { registerJob } from '../../jobs';
import { registerInboxCounter } from '../me/routes';
import { canReadDocument, createDocument, pendingStepCount } from './service';
import { ensureDocumentType } from './defaults';
import { inTx, startRoute } from './route-engine';
import { fmtDue, notifyDoc } from './messages';

// ── Sidebar badge: my pending steps (incl. as active deputy) ──
registerInboxCounter('documents', (u) => pendingStepCount(u.userId));

// ── File access: document PDFs, signed PDFs and attachment versions are readable by document readers ──
registerFileAccess(async (ctx, file) => {
  if (ctx.kind !== 'user') return false;
  const doc = await prisma.document.findFirst({
    where: {
      tenantId: ctx.tenantId,
      OR: [{ pdfFileId: file.id }, { signedPdfFileId: file.id }, { files: { some: { versions: { some: { storedFileId: file.id } } } } }],
    },
    select: { id: true },
  });
  return !!doc && canReadDocument(ctx, doc.id);
});

// ── Reminders (F-22): hourly; steps due within 24 h or overdue, at most once per day per step ──
export async function runDocumentReminders(now: Date = new Date()): Promise<{ notified: number }> {
  const soon = new Date(now.getTime() + 24 * 3_600_000);
  const dayAgo = new Date(now.getTime() - 24 * 3_600_000);
  const steps = await prisma.routeStep.findMany({
    where: {
      status: 'PENDING',
      dueAt: { not: null, lte: soon },
      document: { status: 'IN_ROUTE' },
      OR: [{ reminderSentAt: null }, { reminderSentAt: { lte: dayAgo } }],
    },
    include: { document: { select: { id: true, tenantId: true, title: true } } },
    take: 5000,
  });
  for (const s of steps) {
    const overdue = s.dueAt! < now;
    await prisma.$transaction(async (tx) => {
      await notifyDoc(tx, {
        tenantId: s.document.tenantId, userId: s.assigneeUserId, documentId: s.document.id,
        type: overdue ? 'document.overdue' : 'document.due_soon', titleKey: overdue ? 'doc.reminder.overdue' : 'doc.reminder.due',
        bodyKey: 'doc.reminder.body', params: { title: s.document.title, due: fmtDue(s.dueAt) },
      });
      await tx.routeStep.update({ where: { id: s.id }, data: { reminderSentAt: now } });
    });
  }
  return { notified: steps.length };
}
registerJob('document-reminders', '0 * * * *', async () => {
  await runDocumentReminders();
});

// ── Onboarding hire conversion (F-12 → F-14): generate the hire order + employment contract and start their routes ──
async function startIfPossible(tx: Tx, documentId: string, actorUserId: string) {
  try {
    await startRoute(tx, documentId, actorUserId);
  } catch (e) {
    // Missing signatory/HR must not block the hire: the document stays a draft for HR to fix and start.
    if (!(e instanceof AppError)) throw e;
  }
}

export async function generateHireDocuments(
  tx: Tx,
  p: { tenantId: string; employeeId: string; actorUserId: string; salary: number; probationMonths?: number },
): Promise<string[]> {
  const emp = await tx.employee.findFirstOrThrow({ where: { id: p.employeeId, tenantId: p.tenantId } });
  const contractType = await ensureDocumentType(p.tenantId, 'EMPLOYMENT_CONTRACT', tx);
  const orderType = await ensureDocumentType(p.tenantId, 'HIRE_ORDER', tx);
  const data = { salary: p.salary, probationMonths: p.probationMonths ?? 0, startDate: toDateStr(emp.hireDate) };
  const contractId = await createDocument(tx, {
    tenantId: p.tenantId, authorUserId: p.actorUserId, documentTypeId: contractType.id, legalEntityId: emp.legalEntityId, subjectEmployeeId: emp.id, data,
  });
  const orderId = await createDocument(tx, {
    tenantId: p.tenantId, authorUserId: p.actorUserId, documentTypeId: orderType.id, legalEntityId: emp.legalEntityId, subjectEmployeeId: emp.id, data,
  });
  await tx.documentLink.create({ data: { fromId: orderId, toId: contractId, relation: 'BASED_ON' } });
  await startIfPossible(tx, contractId, p.actorUserId);
  await startIfPossible(tx, orderId, p.actorUserId);
  return [contractId, orderId];
}

on('employee.hired', async (payload, tx) => {
  if (!payload.generateDocuments) return;
  const ids = tx ? await generateHireDocuments(tx, payload) : await inTx((t) => generateHireDocuments(t, payload));
  payload.documentIds.push(...ids);
});
