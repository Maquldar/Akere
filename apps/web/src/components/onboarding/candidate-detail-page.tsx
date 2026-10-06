'use client';

import { BadgeCheck, Mail, MoreHorizontal, Send, Trash2, UserCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { PageHeader, type Crumb } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toaster';
import { RequireAccess } from '@/components/shell/require-access';
import { useCurrentUser } from '@/components/shell/me-context';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { isApiError } from '@/lib/api/errors';
import { useCandidate, useDeleteCandidate, useResendInvite } from '@/lib/api/hooks/onboarding';
import { formatDateTime } from '@/lib/format';
import { can } from '@/lib/permissions';
import { CandidateForm } from './candidate-form';
import { CommentsPanel } from './comments-panel';
import { HireDialog } from './hire-dialog';
import { OPEN_REQUEST } from './model';
import { CheckPill, CandidateStatusPill, DocRequestPill, InvitationPill } from './pills';
import { RequestDocumentsDialog } from './request-documents-dialog';
import { ReviewPanel } from './review-panel';

const TABS = ['card', 'request', 'comments'] as const;
type Tab = (typeof TABS)[number];

export function CandidateDetailPage({ id }: { id: string }) {
  const t = useTranslations('onboarding.detail');
  const tr = useTranslations('onboarding.registry');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { can: canDo } = useCurrentUser();
  const canManage = canDo('candidate.manage');
  const canHire = canManage && canDo('employee.manage');
  const candidate = useCandidate(id);
  const resend = useResendInvite();
  const del = useDeleteCandidate();
  const [requestOpen, setRequestOpen] = useState(false);
  const [hireOpen, setHireOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const tabParam = search.get('tab');
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? '') ? (tabParam as Tab) : 'card';
  const setTab = (v: string) => router.replace(v === 'card' ? pathname : `${pathname}?tab=${v}`, { scroll: false });

  const c = candidate.data;

  if (candidate.isLoading) {
    return (
      <div className="grid gap-4" aria-busy>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-9 w-80" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (candidate.error || !c) {
    return (
      <Card>
        <ErrorState error={candidate.error} onRetry={() => candidate.refetch()} />
      </Card>
    );
  }

  const hired = Boolean(c.employeeId);
  const canResend = canManage && !hired && c.status !== 'BLOCKED' && OPEN_REQUEST.includes(c.docRequestStatus);
  const canRequest = canManage && !hired && c.status !== 'BLOCKED' && c.status !== 'ACCEPTED' && c.status !== 'EXPORTED' && !['SENT', 'FILLING', 'UPLOADED', 'RETURNED'].includes(c.docRequestStatus);
  const canHireNow = canHire && !hired && (c.status === 'ACCEPTED' || c.status === 'EXPORTED');
  const canDelete = canManage && c.status === 'NEW' && c.docRequestStatus === 'NONE';

  const doResend = () =>
    resend.mutate(c.id, {
      onSuccess: () => toast.success(t('inviteResent')),
      onError: (e) => toast.error(isApiError(e) ? e.message : tc('error')),
    });

  const doDelete = () =>
    del.mutate(c.id, {
      onSuccess: () => {
        toast.success(t('deleted', { name: c.fullName }));
        router.replace('/candidates');
      },
      onError: (e) => {
        setDeleteOpen(false);
        toast.error(isApiError(e) && e.code === 'CONFLICT' ? t('deleteConflict') : isApiError(e) ? e.message : tc('error'));
      },
    });

  const crumbs: Crumb[] = [{ label: tr('title'), href: '/candidates' }, { label: c.fullName, href: `/candidates/${c.id}` }];
  if (tab === 'request') crumbs.push({ label: t('tabRequest') });

  return (
    <RequireAccess allow={(a) => can(a, 'candidate.read')}>
      <PageHeader
        title={c.fullName}
        breadcrumbs={crumbs}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <CandidateStatusPill value={c.status} />
            <span className="inline-flex items-center gap-1.5 text-[13px]">
              <span className="text-fg-subtle">{tr('colInvitation')}:</span> <InvitationPill value={c.invitationStatus} />
            </span>
            <span className="inline-flex items-center gap-1.5 text-[13px]">
              <span className="text-fg-subtle">{tr('colDocRequest')}:</span> <DocRequestPill value={c.docRequestStatus} />
            </span>
            {c.checkStatus !== 'NONE' && <CheckPill value={c.checkStatus} />}
          </span>
        }
        actions={
          <>
            {hired && (
              <Button variant="outline" asChild>
                <Link href={`/employees/${c.employeeId}`}>
                  <BadgeCheck />
                  {t('openEmployee')}
                </Link>
              </Button>
            )}
            {canRequest && (
              <Button variant="outline" onClick={() => setRequestOpen(true)}>
                <Send />
                {t('requestDocuments')}
              </Button>
            )}
            {canHireNow && (
              <Button onClick={() => setHireOpen(true)}>
                <UserCheck />
                {t('hire')}
              </Button>
            )}
            {(canResend || canDelete) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label={tc('actionsFor', { name: c.fullName })}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {canResend && (
                    <DropdownMenuItem onSelect={doResend} disabled={resend.isPending}>
                      <Mail aria-hidden />
                      {t('resendInvite')}
                    </DropdownMenuItem>
                  )}
                  {canResend && canDelete && <DropdownMenuSeparator />}
                  {canDelete && (
                    <DropdownMenuItem danger onSelect={() => setDeleteOpen(true)}>
                      <Trash2 aria-hidden />
                      {tc('delete')}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />
      {hired && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-green-border bg-green-bg px-3 py-2 text-[13px] text-green-fg">
          <BadgeCheck className="size-4 shrink-0" aria-hidden />
          {t('hiredBanner')}
        </div>
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label={t('tabsLabel')}>
          <TabsTrigger value="card">{t('tabCard')}</TabsTrigger>
          <TabsTrigger value="request">{t('tabRequest')}</TabsTrigger>
          <TabsTrigger value="comments" count={c.commentsCount}>
            {t('tabComments')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="card">
          <div className="grid max-w-4xl gap-4">
            <CandidateForm candidate={c} formId="candidate-edit" readOnly={!canManage} onSaved={() => undefined} />
            <p className="text-xs text-fg-subtle">
              {t('meta', { created: formatDateTime(c.createdAt, locale), updated: formatDateTime(c.updatedAt, locale) })}
              {c.exportedAt ? ` · ${t('exportedAt', { date: formatDateTime(c.exportedAt, locale) })}` : ''}
            </p>
          </div>
        </TabsContent>
        <TabsContent value="request">
          <ReviewPanel candidate={c} canManage={canManage} onRequestDocuments={canRequest ? () => setRequestOpen(true) : undefined} />
        </TabsContent>
        <TabsContent value="comments">
          <CommentsPanel candidateId={c.id} candidateName={c.fullName} canWrite={canManage} />
        </TabsContent>
      </Tabs>

      <RequestDocumentsDialog open={requestOpen} onOpenChange={setRequestOpen} candidates={[{ id: c.id, fullName: c.fullName }]} onDone={() => void candidate.refetch()} />
      {(canHireNow || hireOpen) && <HireDialog open={hireOpen} onOpenChange={setHireOpen} candidate={c} />}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('deleteTitle')}
        description={t('deleteText', { name: c.fullName })}
        confirmLabel={tc('delete')}
        onConfirm={doDelete}
        loading={del.isPending}
      />
    </RequireAccess>
  );
}
