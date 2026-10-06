'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { RequireAccess } from '@/components/shell/require-access';
import { Link, useRouter } from '@/i18n/navigation';
import { can } from '@/lib/permissions';
import { CandidateForm } from './candidate-form';

export function CandidateNewPage() {
  const t = useTranslations('onboarding');
  const tc = useTranslations('common');
  const router = useRouter();
  return (
    <RequireAccess allow={(a) => can(a, 'candidate.manage')}>
      <div className="mx-auto w-full max-w-4xl">
        <PageHeader
          title={t('form.newTitle')}
          breadcrumbs={[{ label: t('registry.title'), href: '/candidates' }, { label: t('form.newTitle') }]}
          actions={
            <>
              <Button variant="outline" asChild>
                <Link href="/candidates">{tc('cancel')}</Link>
              </Button>
              <Button type="submit" form="candidate-new">
                {tc('save')}
              </Button>
            </>
          }
        />
        <CandidateForm candidate={null} formId="candidate-new" onSaved={(c) => router.replace(`/candidates/${c.id}`)} />
      </div>
    </RequireAccess>
  );
}
