'use client';

import { MessageSquare, Send } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Textarea } from '@/components/ui/input';
import { SkeletonList } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { isApiError } from '@/lib/api/errors';
import { useAddComment, useCandidateComments } from '@/lib/api/hooks/onboarding';
import { formatDateTime } from '@/lib/format';

/** Candidate comments thread (F-11). */
export function CommentsPanel({ candidateId, candidateName, canWrite }: { candidateId: string; candidateName: string; canWrite: boolean }) {
  const t = useTranslations('onboarding.comments');
  const tc = useTranslations('common');
  const locale = useLocale();
  const comments = useCandidateComments(candidateId);
  const add = useAddComment(candidateId);
  const [text, setText] = useState('');

  const submit = () => {
    const v = text.trim();
    if (!v) return;
    add.mutate(v, {
      onSuccess: () => {
        setText('');
        toast.success(t('added'));
      },
      onError: (e) => toast.error(isApiError(e) ? e.message : tc('error')),
    });
  };

  return (
    <Card className="max-w-3xl">
      <CardHeader title={t('title')} count={comments.data?.length} />
      <CardBody className="grid gap-5">
        {comments.isLoading ? (
          <SkeletonList rows={3} />
        ) : comments.error ? (
          <ErrorState error={comments.error} onRetry={() => comments.refetch()} compact />
        ) : comments.data && comments.data.length > 0 ? (
          <ol className="grid gap-4" aria-label={t('title')}>
            {comments.data.map((c) => {
              const name = c.byCandidate ? candidateName : (c.author?.fullName ?? t('system'));
              return (
                <li key={c.id} className="flex gap-3">
                  <Avatar name={name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-medium text-fg">{name}</span>
                      {c.byCandidate && <span className="text-xs text-primary">{t('candidate')}</span>}
                      <time dateTime={c.createdAt} className="text-xs text-fg-subtle tabular">
                        {formatDateTime(c.createdAt, locale)}
                      </time>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-surface-muted px-3 py-2 text-sm text-fg">{c.text}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <EmptyState compact icon={<MessageSquare aria-hidden />} title={t('empty')} description={canWrite ? t('emptyHint') : undefined} />
        )}
        {canWrite && (
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label htmlFor="new-comment" className="text-[13px] font-medium text-fg">
              {t('new')}
            </label>
            <Textarea
              id="new-comment"
              value={text}
              maxLength={2000}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('placeholder')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
              }}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-fg-subtle">{t('shortcut')}</span>
              <Button type="submit" size="sm" loading={add.isPending} disabled={!text.trim()}>
                {!add.isPending && <Send />}
                {t('send')}
              </Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
