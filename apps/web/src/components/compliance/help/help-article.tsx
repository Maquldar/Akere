'use client';

import { ArrowLeft, LifeBuoy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Link } from '@/i18n/navigation';
import { useHelpArticles } from '@/lib/api/hooks/compliance';
import { HELP_CATEGORIES } from '@/lib/api/types-compliance';
import { Markdown } from './markdown';

/** /help/[slug] — one knowledge-base article rendered from markdown. */
export function HelpArticlePage({ slug }: { slug: string }) {
  const t = useTranslations('help');
  const articles = useHelpArticles();
  const article = articles.data?.find((a) => a.slug === slug);
  const related = articles.data?.filter((a) => a.slug !== slug && a.category === article?.category).slice(0, 5) ?? [];
  const catLabel = (c: string) => ((HELP_CATEGORIES as readonly string[]).includes(c) ? t(`categories.${c as 'start'}`) : c);

  if (articles.isLoading) {
    return (
      <div className="grid max-w-3xl gap-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (articles.error) {
    return (
      <Card>
        <ErrorState error={articles.error} onRetry={() => articles.refetch()} />
      </Card>
    );
  }
  if (!article) {
    return (
      <Card className="mx-auto mt-6 max-w-lg">
        <EmptyState
          title={t('notFound')}
          description={t('notFoundHint')}
          action={
            <Button asChild size="sm" variant="outline">
              <Link href="/help">
                <ArrowLeft aria-hidden />
                {t('back')}
              </Link>
            </Button>
          }
        />
      </Card>
    );
  }
  return (
    <>
      <PageHeader breadcrumbs={[{ label: t('title'), href: '/help' }, { label: catLabel(article.category) }]} title={article.title} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <Card className="min-w-0">
          <CardBody className="sm:p-7">
            <article>
              <Markdown>{article.body}</Markdown>
            </article>
          </CardBody>
        </Card>
        <aside className="grid content-start gap-4">
          {related.length > 0 && (
            <Card>
              <CardBody>
                <h2 className="mb-2 text-[13px] font-semibold text-fg">{t('related')}</h2>
                <ul className="grid gap-1.5 text-[13px]">
                  {related.map((a) => (
                    <li key={a.slug}>
                      <Link href={`/help/${encodeURIComponent(a.slug)}`} className="focus-ring rounded text-primary hover:underline">
                        {a.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
          <Card>
            <CardBody className="grid gap-2">
              <p className="text-[13px] font-semibold text-fg">{t('stillQuestions')}</p>
              <p className="text-[13px] text-fg-muted">{t('stillQuestionsText')}</p>
              <Button asChild variant="outline" size="sm" className="justify-self-start">
                <Link href="/support">
                  <LifeBuoy aria-hidden />
                  {t('contactSupport')}
                </Link>
              </Button>
            </CardBody>
          </Card>
          <Button asChild variant="ghost" size="sm" className="justify-self-start">
            <Link href="/help">
              <ArrowLeft aria-hidden />
              {t('back')}
            </Link>
          </Button>
        </aside>
      </div>
    </>
  );
}
