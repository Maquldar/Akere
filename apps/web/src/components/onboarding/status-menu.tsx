'use client';

import { Check, ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { StatusPill } from '@/components/ui/badge';
import { toast } from '@/components/ui/toaster';
import { isApiError } from '@/lib/api/errors';
import { useSaveCandidate } from '@/lib/api/hooks/onboarding';
import { CANDIDATE_STATUSES, type CandidateStatus, type DocRequestStatus } from '@/lib/api/types-onboarding';
import { cn } from '@/lib/utils';
import { allowedStatus, statusTone } from './model';

/** Inline status dropdown (M1 registry): PATCH /candidates/:id { status }. */
export function StatusMenu({
  candidate,
  disabled,
}: {
  candidate: { id: string; fullName: string; status: CandidateStatus; docRequestStatus: DocRequestStatus; employeeId?: string | null };
  disabled?: boolean;
}) {
  const t = useTranslations('onboarding.enums.status');
  const tr = useTranslations('onboarding.registry');
  const tc = useTranslations('common');
  const save = useSaveCandidate();
  const locked = disabled || Boolean(candidate.employeeId);

  const change = (status: CandidateStatus) => {
    if (status === candidate.status) return;
    save.mutate(
      { id: candidate.id, input: { status } },
      {
        onSuccess: () => toast.success(tr('statusChanged', { name: candidate.fullName, status: t(status) })),
        onError: (e) => toast.error(isApiError(e) ? e.message : tc('error')),
      },
    );
  };

  if (locked) return <StatusPill tone={statusTone[candidate.status]}>{t(candidate.status)}</StatusPill>;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          disabled={save.isPending}
          aria-label={tr('changeStatus', { name: candidate.fullName, status: t(candidate.status) })}
          className={cn('focus-ring group inline-flex items-center gap-0.5 rounded-full disabled:opacity-60')}
        >
          <StatusPill tone={statusTone[candidate.status]} className="pr-1.5 group-hover:brightness-95">
            {t(candidate.status)}
            <ChevronDown className="size-3 opacity-70" aria-hidden />
          </StatusPill>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[180px]" onClick={(e) => e.stopPropagation()}>
        {CANDIDATE_STATUSES.map((s) => (
          <DropdownMenuItem key={s} disabled={!allowedStatus(candidate, s)} onSelect={() => change(s)}>
            <StatusPill tone={statusTone[s]} className="flex-none">
              {t(s)}
            </StatusPill>
            {s === candidate.status && <Check className="ml-auto !text-primary" aria-hidden />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
