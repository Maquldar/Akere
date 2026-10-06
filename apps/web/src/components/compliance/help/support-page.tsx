'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { BookOpen, CheckCircle2, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { FormError, FormField } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { toast } from '@/components/ui/toaster';
import { useCurrentUser } from '@/components/shell/me-context';
import { Link } from '@/i18n/navigation';
import { isApiError } from '@/lib/api/errors';
import { applyServerErrors } from '@/lib/api/form-errors';
import { useCreateTicket } from '@/lib/api/hooks/compliance';

/** /support — support ticket form (F-48). */
export function SupportPage() {
  const t = useTranslations('support');
  const tc = useTranslations('common');
  const { me } = useCurrentUser();
  const create = useCreateTicket();
  const [ticketId, setTicketId] = useState<string | null>(null);
  const schema = z.object({
    subject: z.string().trim().min(1, tc('requiredField')).max(200),
    message: z.string().trim().min(10, t('messageShort')).max(5000),
  });
  type Form = z.infer<typeof schema>;
  const form = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { subject: '', message: '' } });
  const e = form.formState.errors;
  const messageLen = form.watch('message').length;

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const res = await create.mutateAsync(v);
      setTicketId(res.id);
      toast.success(t('sent'));
      form.reset();
    } catch (err) {
      if (applyServerErrors(err, form.setError, { fields: ['subject', 'message'] })) return;
      form.setError('root.server', { message: isApiError(err) ? err.message : tc('error') });
    }
  });

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,640px)_1fr]">
        {ticketId ? (
          <Card>
            <CardBody className="flex flex-col items-center gap-3 py-10 text-center" role="status">
              <span className="flex size-12 items-center justify-center rounded-full bg-green-bg text-green-fg">
                <CheckCircle2 className="size-6" aria-hidden />
              </span>
              <h2 className="text-base font-semibold text-fg">{t('successTitle')}</h2>
              <p className="max-w-sm text-[13px] text-fg-muted">{t('successText', { email: me.email })}</p>
              <p className="text-xs text-fg-subtle">
                {t('ticketNumber')} <code className="font-mono">{ticketId}</code>
              </p>
              <Button variant="outline" onClick={() => setTicketId(null)}>
                {t('another')}
              </Button>
            </CardBody>
          </Card>
        ) : (
          <Card>
            <form onSubmit={onSubmit} noValidate>
              <CardBody className="grid gap-4">
                <FormError message={e.root?.server?.message} />
                <FormField label={t('subject')} required error={e.subject?.message}>
                  <Input autoComplete="off" maxLength={200} placeholder={t('subjectPlaceholder')} {...form.register('subject')} />
                </FormField>
                <FormField label={t('message')} required error={e.message?.message} hint={t('messageHint', { count: messageLen, max: 5000 })}>
                  <Textarea rows={8} maxLength={5000} placeholder={t('messagePlaceholder')} {...form.register('message')} />
                </FormField>
                <p className="text-xs text-fg-subtle">{t('replyTo', { email: me.email })}</p>
              </CardBody>
              <CardFooter>
                <Button type="submit" loading={create.isPending}>
                  <Send />
                  {t('submit')}
                </Button>
              </CardFooter>
            </form>
          </Card>
        )}
        <Card className="h-fit">
          <CardBody className="grid gap-2">
            <p className="text-[13px] font-semibold text-fg">{t('kbTitle')}</p>
            <p className="text-[13px] text-fg-muted">{t('kbText')}</p>
            <Button asChild variant="outline" size="sm" className="justify-self-start">
              <Link href="/help">
                <BookOpen aria-hidden />
                {t('kbLink')}
              </Link>
            </Button>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
