import type { Tx } from '../../lib/db';
import { defineMessages, tx as tr } from '../../lib/i18n';
import { notify } from '../../lib/notify';

defineMessages({
  'doc.pending.SIGN': { ru: 'Требуется подписать: {title}', kk: 'Қол қою қажет: {title}', en: 'Signature required: {title}' },
  'doc.pending.APPROVE': { ru: 'Требуется согласовать: {title}', kk: 'Келісу қажет: {title}', en: 'Approval required: {title}' },
  'doc.pending.ACKNOWLEDGE': { ru: 'Требуется ознакомиться: {title}', kk: 'Танысу қажет: {title}', en: 'Acknowledgment required: {title}' },
  'doc.pending.body': { ru: 'Автор: {author}. Срок: {due}.', kk: 'Авторы: {author}. Мерзімі: {due}.', en: 'Author: {author}. Due: {due}.' },
  'doc.completed': { ru: 'Документ подписан: {title}', kk: 'Құжатқа қол қойылды: {title}', en: 'Document completed: {title}' },
  'doc.completed.body': { ru: 'Все участники маршрута завершили свои шаги.', kk: 'Бағыттың барлық қатысушылары қадамдарын аяқтады.', en: 'All route participants have finished their steps.' },
  'doc.returned': { ru: 'Требуется доработать: {title}', kk: 'Пысықтау қажет: {title}', en: 'Rework required: {title}' },
  'doc.rejected': { ru: 'Документ отклонён: {title}', kk: 'Құжат қабылданбады: {title}', en: 'Document rejected: {title}' },
  'doc.byComment': { ru: '{actor}: {comment}', kk: '{actor}: {comment}', en: '{actor}: {comment}' },
  'doc.cancelled': { ru: 'Документ отменён: {title}', kk: 'Құжат жойылды: {title}', en: 'Document cancelled: {title}' },
  'doc.reminder.due': { ru: 'Срок истекает: {title}', kk: 'Мерзімі аяқталуда: {title}', en: 'Due soon: {title}' },
  'doc.reminder.overdue': { ru: 'Просрочено: {title}', kk: 'Мерзімі өтті: {title}', en: 'Overdue: {title}' },
  'doc.reminder.body': { ru: 'Срок выполнения шага: {due}.', kk: 'Қадамның орындалу мерзімі: {due}.', en: 'Step due: {due}.' },
  'doc.noDue': { ru: 'не установлен', kk: 'белгіленбеген', en: 'not set' },
});

export const docLink = (locale: string, documentId: string) => `/${locale}/documents/${documentId}`;

/** In-app + email notification in the recipient's language. */
export async function notifyDoc(
  tx: Tx,
  opts: { tenantId: string; userId: string; documentId: string; type: string; titleKey: string; bodyKey?: string; params: Record<string, string | undefined> },
) {
  const user = await tx.user.findUnique({ where: { id: opts.userId }, select: { locale: true, isActive: true } });
  if (!user || !user.isActive) return;
  const lang = user.locale;
  const params: Record<string, string> = { due: tr('doc.noDue', lang) };
  for (const [k, v] of Object.entries(opts.params)) if (v !== undefined) params[k] = v;
  await notify({
    tenantId: opts.tenantId,
    userId: opts.userId,
    type: opts.type,
    title: tr(opts.titleKey, lang, params),
    body: opts.bodyKey ? tr(opts.bodyKey, lang, params) : undefined,
    link: docLink(lang, opts.documentId),
  }, tx);
}

export const fmtDue = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : undefined);
