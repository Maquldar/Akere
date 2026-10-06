'use client';

import { useTranslations } from 'next-intl';
import { StatusPill } from '@/components/ui/badge';
import type { CandidateCheck, CandidateStatus, DocRequestStatus, InvitationStatus } from '@/lib/api/types-onboarding';
import { checkTone, docRequestTone, invitationTone, statusTone } from './model';

const Dash = () => <span className="text-fg-subtle">—</span>;

export function CandidateStatusPill({ value }: { value: CandidateStatus }) {
  const t = useTranslations('onboarding.enums.status');
  return <StatusPill tone={statusTone[value]}>{t(value)}</StatusPill>;
}

export function InvitationPill({ value }: { value: InvitationStatus }) {
  const t = useTranslations('onboarding.enums.invitation');
  if (value === 'NONE') return <Dash />;
  return (
    <StatusPill variant="dot" tone={invitationTone[value]}>
      {t(value)}
    </StatusPill>
  );
}

export function DocRequestPill({ value }: { value: DocRequestStatus }) {
  const t = useTranslations('onboarding.enums.docRequest');
  if (value === 'NONE') return <Dash />;
  return <StatusPill tone={docRequestTone[value]}>{t(value)}</StatusPill>;
}

export function CheckPill({ value }: { value: CandidateCheck }) {
  const t = useTranslations('onboarding.enums.check');
  if (value === 'NONE') return <Dash />;
  return <StatusPill tone={checkTone[value]}>{t(value)}</StatusPill>;
}
