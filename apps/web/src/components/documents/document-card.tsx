'use client';

import {
  Ban, BookOpenCheck, Check, ChevronDown, FileSignature, Hash, Landmark, MoreHorizontal, Pencil, PenLine, RotateCcw, Send,
  Trash2, X,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toaster';
import { useCurrentUser } from '@/components/shell/me-context';
import { Link, useRouter } from '@/i18n/navigation';
import { isApiError } from '@/lib/api/errors';
import { useDeleteDocument, useDocument, useDocumentAction } from '@/lib/api/hooks/documents';
import type { DocumentDetail } from '@/lib/api/types-documents';
import { formatDate, formatDateTime } from '@/lib/format';
import { can } from '@/lib/permissions';
import { DataView } from './data-fields';
import { CancelDialog, CommentActionDialog, EditDocumentDialog, PaperSignedDialog, RegisterDialog } from './document-dialogs';
import { AttachmentsTab, CommentsTab, LinksTab, VerificationPanel } from './document-tabs';
import { DocStatusPill } from './labels';
import { PdfFrame } from './pdf-frame';
import { RouteTimeline } from './route-timeline';
import { SigningDialog } from './signing-dialog';

function Info({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-subtle">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-fg">{children}</dd>
    </div>
  );
}

function EsutdChip({ esutd }: { esutd: NonNullable<DocumentDetail['esutd']> }) {
  const t = useTranslations('documents.esutd');
  const locale = useLocale();
  const tone = esutd.status === 'SENT' ? 'green' : esutd.status === 'ERROR' ? 'red' : 'gray';
  const label = esutd.status === 'SENT' ? t('sent') : esutd.status === 'ERROR' ? t('error') : t('notSent');
  return (
    <Badge tone={tone} title={esutd.error ?? undefined}>
      <Landmark className="size-3" aria-hidden />
      {t('label')}: {label}
      {esutd.sentAt && ` · ${formatDateTime(esutd.sentAt, locale)}`}
    </Badge>
  );
}

function CardSkeleton() {
  return (
    <div aria-busy className="flex flex-col gap-4">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-10 w-full max-w-xl" />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}

/** Action bar for the current user's pending step (Согласовать / Подписать / Ознакомиться / Вернуть / Отклонить). */
function PendingActionBar({ doc, onSign, onComment }: { doc: DocumentDetail; onSign: () => void; onComment: (k: 'return' | 'reject') => void }) {
  const t = useTranslations('documents.card');
  const tm = useTranslations('documents.myAction');
  const tc = useTranslations('common');
  const locale = useLocale();
  const action = useDocumentAction(doc.id);
  const a = doc.myPendingAction;
  if (!a) return null;
  const approve = () =>
    action.mutate(
      { kind: 'approve' },
      {
        onSuccess: () => toast.success(a === 'ACKNOWLEDGE' ? t('acknowledgedToast') : t('approvedToast')),
        onError: (e) => toast.error(isApiError(e) ? e.message : tc('error')),
      },
    );
  return (
    <div
      role="region"
      aria-label={t('pendingRegion')}
      className="mb-5 flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary-soft px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-center gap-2 text-sm">
        <FileSignature className="size-5 shrink-0 text-primary" aria-hidden />
        <span className="font-medium text-fg">{tm(a)}</span>
        {doc.currentStep?.dueAt && <span className="text-fg-muted">· {t('dueUntil', { date: formatDate(doc.currentStep.dueAt, locale) })}</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        {a === 'APPROVE' && (
          <Button onClick={approve} loading={action.isPending}>
            <Check aria-hidden />
            {t('approve')}
          </Button>
        )}
        {a === 'SIGN' && (
          <Button onClick={onSign}>
            <PenLine aria-hidden />
            {t('sign')}
          </Button>
        )}
        {a === 'ACKNOWLEDGE' && (
          <>
            <Button onClick={approve} loading={action.isPending}>
              <BookOpenCheck aria-hidden />
              {t('acknowledge')}
            </Button>
            <Button variant="outline" onClick={onSign}>
              <PenLine aria-hidden />
              {t('acknowledgeSign')}
            </Button>
          </>
        )}
        <Button variant="outline" onClick={() => onComment('return')}>
          <RotateCcw aria-hidden />
          {t('return')}
        </Button>
        <Button variant="outline" className="text-red-fg" onClick={() => onComment('reject')}>
          <X aria-hidden />
          {t('reject')}
        </Button>
      </div>
    </div>
  );
}

export function DocumentCard({ id }: { id: string }) {
  const t = useTranslations('documents.card');
  const tn = useTranslations('nav.items');
  const tk = useTranslations('documents.kind');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const { me, access } = useCurrentUser();
  const query = useDocument(id);
  const action = useDocumentAction(id);
  const del = useDeleteDocument();
  const [signOpen, setSignOpen] = useState(false);
  const [commentKind, setCommentKind] = useState<'return' | 'reject' | null>(null);
  const [dialog, setDialog] = useState<'edit' | 'register' | 'paper' | 'cancel' | 'delete' | 'start' | null>(null);
  const [tab, setTab] = useState('general');
  const [signedView, setSignedView] = useState(true);

  if (query.isLoading) return <CardSkeleton />;
  if (query.error || !query.data) {
    return (
      <Card>
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </Card>
    );
  }
  const doc = query.data;
  const manage = doc.canEdit || doc.canCancel || doc.canRegister;
  const participant = doc.steps.some((s) => s.assignee.id === me.id || s.actedBy?.id === me.id);
  const canPaper = doc.canRegister && can(access, 'document.manage') && (doc.status === 'IN_ROUTE' || doc.status === 'DRAFT' || doc.status === 'REWORK');
  const editable = doc.status === 'DRAFT' || doc.status === 'REWORK';
  const pdfSrc = signedView && doc.signedPdfUrl ? doc.signedPdfUrl : doc.pdfUrl;

  const start = () =>
    action.mutate(
      { kind: 'start' },
      {
        onSuccess: (d) => {
          toast.success(t('startedToast', { number: d.number ?? '' }));
          setDialog(null);
        },
        onError: (e) => {
          toast.error(isApiError(e) ? e.message : tc('error'));
          setDialog(null);
        },
      },
    );

  const menuItems = [
    doc.canEdit && { key: 'edit', icon: Pencil, label: t('edit'), onSelect: () => setDialog('edit') },
    doc.canRegister && { key: 'register', icon: Hash, label: doc.number ? t('reRegister') : t('register'), onSelect: () => setDialog('register') },
    canPaper && { key: 'paper', icon: FileSignature, label: t('paperSigned'), onSelect: () => setDialog('paper') },
  ].filter(Boolean) as { key: string; icon: typeof Pencil; label: string; onSelect: () => void }[];
  const dangerItems = [
    doc.canCancel && { key: 'cancel', icon: Ban, label: t('cancelDoc'), onSelect: () => setDialog('cancel') },
    doc.canEdit && doc.status === 'DRAFT' && { key: 'delete', icon: Trash2, label: tc('delete'), onSelect: () => setDialog('delete') },
  ].filter(Boolean) as { key: string; icon: typeof Pencil; label: string; onSelect: () => void }[];

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: tn('allDocuments'), href: '/documents' }, { label: doc.number ? `№ ${doc.number}` : doc.title }]}
        title={doc.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <DocStatusPill status={doc.status} />
            <span>{doc.type.name}</span>
            {doc.number && <span className="tabular">· № {doc.number}</span>}
            {doc.registeredAt && <span className="tabular">· {t('from', { date: formatDate(doc.registeredAt, locale) })}</span>}
            {doc.backdated && <Badge tone="orange">{t('backdated')}</Badge>}
            {doc.paperSigned && <Badge tone="gray">{t('paper')}</Badge>}
            {doc.overdue && <Badge tone="red">{t('overdue')}</Badge>}
            {doc.esutd && <EsutdChip esutd={doc.esutd} />}
          </span>
        }
        actions={
          <>
            {doc.canStart && editable && (
              <Button onClick={() => setDialog('start')}>
                <Send aria-hidden />
                {doc.status === 'REWORK' ? t('resend') : t('send')}
              </Button>
            )}
            {(menuItems.length > 0 || dangerItems.length > 0) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <MoreHorizontal aria-hidden />
                    {t('more')}
                    <ChevronDown aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {menuItems.map((m) => (
                    <DropdownMenuItem key={m.key} onSelect={m.onSelect}>
                      <m.icon aria-hidden />
                      {m.label}
                    </DropdownMenuItem>
                  ))}
                  {menuItems.length > 0 && dangerItems.length > 0 && <DropdownMenuSeparator />}
                  {dangerItems.map((m) => (
                    <DropdownMenuItem key={m.key} danger onSelect={m.onSelect}>
                      <m.icon aria-hidden />
                      {m.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />

      <PendingActionBar doc={doc} onSign={() => setSignOpen(true)} onComment={setCommentKind} />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label={t('tabs')}>
          <TabsTrigger value="general">{t('tabGeneral')}</TabsTrigger>
          <TabsTrigger value="document">{t('tabDocument')}</TabsTrigger>
          <TabsTrigger value="data">{t('tabData')}</TabsTrigger>
          <TabsTrigger value="links" count={doc.links.length}>
            {t('tabLinks')}
          </TabsTrigger>
          <TabsTrigger value="files" count={doc.files.length}>
            {t('tabFiles')}
          </TabsTrigger>
          <TabsTrigger value="comments" count={doc.commentsCount}>
            {t('tabComments')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <Card className="p-4 sm:p-5">
              <RouteTimeline steps={doc.steps} status={doc.status} title={doc.number ? t('routeTitleNumber', { title: doc.type.name, number: doc.number }) : doc.type.name} />
            </Card>
            <div className="flex flex-col gap-4">
              <Card className="p-4 sm:p-5">
                <dl className="flex flex-col gap-3.5">
                  <Info label={t('legalEntity')}>{doc.legalEntity.name}</Info>
                  {doc.subject && (
                    <Info label={t('subject')}>
                      {doc.subject.employeeId ? (
                        <Link href={`/employees/${doc.subject.employeeId}`} className="focus-ring rounded font-medium hover:text-primary">
                          {doc.subject.fullName}
                        </Link>
                      ) : (
                        doc.subject.fullName
                      )}
                      {(doc.subject.position || doc.subject.department) && (
                        <span className="block text-xs text-fg-subtle">{[doc.subject.position, doc.subject.department].filter(Boolean).join(', ')}</span>
                      )}
                    </Info>
                  )}
                  <Info label={t('kind')}>{tk(doc.kind)}</Info>
                  <Info label={t('author')}>{doc.author.fullName}</Info>
                  <Info label={t('created')}>{formatDateTime(doc.createdAt, locale)}</Info>
                  {doc.dueAt && <Info label={t('dueAt')}>{formatDate(doc.dueAt, locale)}</Info>}
                  {doc.registeredAt && <Info label={t('registeredAt')}>{formatDate(doc.registeredAt, locale)}</Info>}
                </dl>
                {doc.pdfUrl && (
                  <Button variant="outline" className="mt-4 w-full" onClick={() => setTab('document')}>
                    {t('viewDocument')}
                  </Button>
                )}
              </Card>
              <VerificationPanel doc={doc} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="document">
          {pdfSrc ? (
            <PdfFrame
              src={pdfSrc}
              title={doc.title}
              downloadHref={`${pdfSrc}${pdfSrc.includes('?') ? '&' : '?'}download=true`}
              toolbar={
                doc.signedPdfUrl && (
                  <div className="inline-flex rounded-lg bg-surface-hover p-1" role="group" aria-label={t('pdfVersion')}>
                    {[true, false].map((signed) => (
                      <button
                        key={String(signed)}
                        type="button"
                        aria-pressed={signedView === signed}
                        onClick={() => setSignedView(signed)}
                        className={
                          'focus-ring h-7 rounded-md px-3 text-[13px] font-medium ' +
                          (signedView === signed ? 'bg-surface text-fg shadow-[0_1px_2px_rgb(16_24_40/0.08)]' : 'text-fg-muted hover:text-fg')
                        }
                      >
                        {signed ? t('pdfSigned') : t('pdfOriginal')}
                      </button>
                    ))}
                  </div>
                )
              }
            />
          ) : (
            <Card className="p-6 text-sm text-fg-subtle">{t('noPdf')}</Card>
          )}
        </TabsContent>

        <TabsContent value="data">
          <Card className="p-4 sm:p-5">
            <DataView data={doc.data} />
          </Card>
        </TabsContent>

        <TabsContent value="links">
          <LinksTab doc={doc} canManage={manage} />
        </TabsContent>

        <TabsContent value="files">
          <AttachmentsTab doc={doc} canUpload={(manage || participant) && doc.status !== 'CANCELLED'} />
        </TabsContent>

        <TabsContent value="comments">
          <CommentsTab doc={doc} />
        </TabsContent>
      </Tabs>

      <SigningDialog open={signOpen} onOpenChange={setSignOpen} documentIds={[doc.id]} onSigned={() => void query.refetch()} />
      <CommentActionDialog doc={doc} kind={commentKind} onOpenChange={(o) => !o && setCommentKind(null)} />
      <EditDocumentDialog doc={doc} open={dialog === 'edit'} onOpenChange={(o) => setDialog(o ? 'edit' : null)} />
      <RegisterDialog doc={doc} open={dialog === 'register'} onOpenChange={(o) => setDialog(o ? 'register' : null)} />
      <PaperSignedDialog doc={doc} open={dialog === 'paper'} onOpenChange={(o) => setDialog(o ? 'paper' : null)} />
      <CancelDialog doc={doc} open={dialog === 'cancel'} onOpenChange={(o) => setDialog(o ? 'cancel' : null)} />
      <ConfirmDialog
        open={dialog === 'start'}
        onOpenChange={(o) => setDialog(o ? 'start' : null)}
        tone="primary"
        title={t('startTitle')}
        description={t('startText')}
        confirmLabel={doc.status === 'REWORK' ? t('resend') : t('send')}
        loading={action.isPending}
        onConfirm={start}
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={(o) => setDialog(o ? 'delete' : null)}
        title={t('deleteTitle')}
        description={t('deleteText', { title: doc.title })}
        confirmLabel={tc('delete')}
        loading={del.isPending}
        onConfirm={() =>
          del.mutate(doc.id, {
            onSuccess: () => {
              toast.success(t('deletedToast'));
              router.push('/documents/drafts');
            },
            onError: (e) => toast.error(isApiError(e) ? e.message : tc('error')),
          })
        }
      />
    </div>
  );
}
