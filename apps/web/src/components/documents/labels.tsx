'use client';

import { useTranslations } from 'next-intl';
import { StatusPill, type Tone } from '@/components/ui/badge';
import type { DocumentStatus, StepAction } from '@/lib/api/types-documents';

export const statusTone: Record<DocumentStatus, Tone> = {
  DRAFT: 'gray',
  IN_ROUTE: 'blue',
  REWORK: 'orange',
  COMPLETED: 'green',
  REJECTED: 'red',
  CANCELLED: 'gray',
};

export function DocStatusPill({ status, className }: { status: DocumentStatus; className?: string }) {
  const t = useTranslations('documents.status');
  return (
    <StatusPill tone={statusTone[status]} className={className}>
      {t(status)}
    </StatusPill>
  );
}

export const actionTone: Record<StepAction, Tone> = { APPROVE: 'teal', SIGN: 'purple', ACKNOWLEDGE: 'blue' };

/** "Требуется подпись" style badge for the current user's pending action. */
export function MyActionBadge({ action }: { action: StepAction }) {
  const t = useTranslations('documents.myAction');
  return (
    <StatusPill tone={actionTone[action]} variant="pill">
      {t(action)}
    </StatusPill>
  );
}

/** Builds an app-relative path from a full sandbox QR URL so it opens on the current origin/locale. */
export function localSignPath(qrUrl: string, locale: string): string {
  try {
    const u = new URL(qrUrl, 'http://local');
    return u.pathname.replace(/^\/(ru|kk|en)\//, `/${locale}/`);
  } catch {
    return qrUrl;
  }
}
