'use client';

import { BookOpen, ChevronRight, LifeBuoy, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Link } from '@/i18n/navigation';
import { useHelpArticles } from '@/lib/api/hooks/compliance';
import { HELP_CATEGORIES, type HelpArticle } from '@/lib/api/types-compliance';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { cn } from '@/lib/utils';
import { excerpt } from './markdown';

const ALL = 'all';

/** /help — knowledge base: search, categories, article list. */
export function HelpCenter() {
  const t = useTranslations('help');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string>(ALL);
  const debouncedQ = useDebounced(q.trim(), 300);
  const articles = useHelpArticles(debouncedQ || undefined);
  const catLabel = (c: string) => ((HELP_CATEGORIES as readonly string[]).includes(c) ? t(`categories.${c as 'start'}`) : c);

  const present = useMemo(() => {
    const set = new Set((articles.data ?? []).map((a) => a.category));
    return [...HELP_CATEGORIES.filter((c) => set.has(c)), ...[...set].filter((c) => !(HELP_CATEGORIES as readonly string[]).includes(c))];
  }, [articles.data]);
  const shown = (articles.data ?? []).filter((a) => category === ALL || a.category === category);
  const grouped = useMemo(() => {
    const m = new Map<string, HelpArticle[]>();
    for (const a of shown) m.set(a.category, [...(m.get(a.category) ?? []), a]);
    return [...m.entries()];
  }, [shown]);

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Button asChild variant="outline">
            <Link href="/support">
              <LifeBuoy aria-hidden />
              {t('contactSupport')}
            </Link>
          </Button>
        }
      />
      <div className="mb-5 flex flex-col gap-3">
        <Input
          type="search"
          aria-label={t('searchLabel')}
          placeholder={t('searchPlaceholder')}
          leftIcon={<Search />}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full sm:max-w-xl"
        />
        {present.length > 1 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('categoriesLabel')}>
            {[ALL, ...present].map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={category === c}
                onClick={() => setCategory(c)}
                className={cn(
                  'focus-ring rounded-full border px-3 py-1 text-[13px] font-medium transition-colors',
                  category === c ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-fg-muted hover:bg-surface-hover',
                )}
              >
                {c === ALL ? t('allCategories') : catLabel(c)}
              </button>
            ))}
          </div>
        )}
      </div>

      {articles.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Card key={i} className="p-4">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="mt-3 h-3 w-full" />
              <Skeleton className="mt-1.5 h-3 w-4/5" />
            </Card>
          ))}
        </div>
      ) : articles.error ? (
        <Card>
          <ErrorState error={articles.error} onRetry={() => articles.refetch()} />
        </Card>
      ) : !shown.length ? (
        <Card>
          <EmptyState
            icon={<BookOpen aria-hidden />}
            title={debouncedQ ? t('nothingFound') : t('empty')}
            description={debouncedQ ? t('nothingFoundHint') : undefined}
            action={
              <Button asChild size="sm" variant="outline">
                <Link href="/support">{t('contactSupport')}</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-6">
          {grouped.map(([cat, list]) => (
            <section key={cat} aria-labelledby={`help-cat-${cat}`}>
              <h2 id={`help-cat-${cat}`} className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-fg-subtle">
                {catLabel(cat)}
              </h2>
              <ul className="grid gap-3 md:grid-cols-2">
                {list.map((a) => (
                  <li key={a.slug}>
                    <Link
                      href={`/help/${encodeURIComponent(a.slug)}`}
                      className="focus-ring group flex h-full items-start gap-3 rounded-xl border border-border bg-surface p-4 shadow-card transition-colors hover:bg-surface-hover"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary" aria-hidden>
                        <BookOpen className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-fg">{a.title}</span>
                        <span className="mt-1 line-clamp-2 block text-[13px] text-fg-muted">{excerpt(a.body)}</span>
                      </span>
                      <ChevronRight className="mt-1 size-4 shrink-0 text-fg-subtle group-hover:text-fg" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
