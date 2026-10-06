'use client';

import { ChevronDown, Search, Wand2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Checkbox, Switch } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { FormError, FormField } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select, SELECT_NONE } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toaster';
import { RequireAccess } from '@/components/shell/require-access';
import { Link, useRouter } from '@/i18n/navigation';
import { isApiError } from '@/lib/api/errors';
import { usePersonalDocTypes, useQuestionnaires, useRequestTemplate, useSaveRequestTemplate } from '@/lib/api/hooks/onboarding';
import type { PersonalDocTypeView, RequestTemplateView } from '@/lib/api/types-onboarding';
import { can } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { docTypeName, fieldLabel } from './model';

type ItemState = { required: boolean; fieldKeys: string[] /* [] = all */ };

function initialItems(tpl: RequestTemplateView | undefined): Record<string, ItemState> {
  const out: Record<string, ItemState> = {};
  for (const i of tpl?.items ?? []) out[i.personalDocType.id] = { required: i.required, fieldKeys: i.fieldKeys };
  return out;
}

/** Request template editor (F-04, M3 0:20): name + tab "Документы" + tab "Анкета". */
export function RequestTemplateEditor({ id }: { id?: string }) {
  const t = useTranslations('onboarding.templates');
  const tc = useTranslations('common');
  const tn = useTranslations('nav.items');
  const locale = useLocale();
  const router = useRouter();
  const tpl = useRequestTemplate(id);
  const docTypes = usePersonalDocTypes();
  const questionnaires = useQuestionnaires();
  const save = useSaveRequestTemplate();

  const [name, setName] = useState('');
  const [questionnaireId, setQuestionnaireId] = useState<string>(SELECT_NONE);
  const [items, setItems] = useState<Record<string, ItemState>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [errors, setErrors] = useState<{ name?: string; items?: string; root?: string }>({});
  const [tab, setTab] = useState('docs');

  useEffect(() => {
    if (!tpl.data) return;
    setName(tpl.data.name);
    setQuestionnaireId(tpl.data.questionnaire?.id ?? SELECT_NONE);
    setItems(initialItems(tpl.data));
  }, [tpl.data]);

  const selectedCount = Object.keys(items).length;
  const filteredTypes = useMemo(() => {
    const s = q.trim().toLocaleLowerCase();
    const all = docTypes.data ?? [];
    return s ? all.filter((d) => docTypeName(d, locale).toLocaleLowerCase().includes(s) || d.name.toLocaleLowerCase().includes(s)) : all;
  }, [docTypes.data, q, locale]);

  const toggleDoc = (d: PersonalDocTypeView, on: boolean) =>
    setItems((cur) => {
      const next = { ...cur };
      if (on) next[d.id] = { required: true, fieldKeys: [] };
      else delete next[d.id];
      return next;
    });

  const toggleField = (d: PersonalDocTypeView, key: string, on: boolean) =>
    setItems((cur) => {
      const it = cur[d.id];
      if (!it) return cur;
      const allKeys = d.fields.map((f) => f.key);
      const current = it.fieldKeys.length ? it.fieldKeys : allKeys;
      let next = on ? allKeys.filter((k) => k === key || current.includes(k)) : current.filter((k) => k !== key);
      if (next.length === 0) return cur;
      if (next.length === allKeys.length) next = [];
      return { ...cur, [d.id]: { ...it, fieldKeys: next } };
    });

  const submit = async () => {
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = tc('requiredField');
    if (!selectedCount) errs.items = t('pickDocs');
    setErrors(errs);
    if (Object.keys(errs).length) {
      if (errs.items && !errs.name) setTab('docs');
      return;
    }
    const order = (docTypes.data ?? []).map((d) => d.id);
    const input = {
      name: name.trim(),
      questionnaireTemplateId: questionnaireId === SELECT_NONE ? null : questionnaireId,
      items: Object.entries(items)
        .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
        .map(([personalDocTypeId, it]) => ({ personalDocTypeId, required: it.required, fieldKeys: it.fieldKeys })),
    };
    try {
      const saved = await save.mutateAsync({ id, input });
      toast.success(id ? tc('saved') : t('created', { name: saved.name }));
      router.push('/onboarding/request-templates');
    } catch (e) {
      if (isApiError(e) && e.code === 'VALIDATION_ERROR') {
        const fe = e.fieldErrors;
        setErrors({ name: fe.name?.[0], items: fe.items?.[0] ?? Object.entries(fe).find(([k]) => k.startsWith('items'))?.[1]?.[0], root: e.formErrors[0] ?? (!fe.name && !Object.keys(fe).some((k) => k.startsWith('items')) ? e.message : undefined) });
      } else setErrors({ root: isApiError(e) ? e.message : tc('error') });
    }
  };

  const loading = (id && tpl.isLoading) || docTypes.isLoading;
  const loadError = (id && tpl.error) || docTypes.error;
  const title = id ? (tpl.data?.name ?? t('editTitle')) : t('newTitle');

  return (
    <RequireAccess allow={(a) => can(a, 'candidate.manage')}>
      <div className="mx-auto w-full max-w-4xl">
        <PageHeader
          title={title}
          breadcrumbs={[{ label: tn('requestTemplates'), href: '/onboarding/request-templates' }, { label: id ? t('editTitle') : t('newTitle') }]}
          actions={
            <>
              <Button variant="outline" asChild>
                <Link href="/onboarding/request-templates">{tc('cancel')}</Link>
              </Button>
              <Button onClick={submit} loading={save.isPending} disabled={Boolean(loading || loadError)}>
                {tc('save')}
              </Button>
            </>
          }
        />
        {loadError ? (
          <Card>
            <ErrorState error={loadError} onRetry={() => (id ? void tpl.refetch() : void docTypes.refetch())} />
          </Card>
        ) : loading ? (
          <div className="grid gap-3" aria-busy>
            <Skeleton className="h-9 w-full max-w-md" />
            <Skeleton className="h-8 w-56" />
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <div className="grid gap-5">
            <FormError message={errors.root} />
            <FormField label={t('name')} required error={errors.name} className="max-w-md">
              <Input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} placeholder={t('namePlaceholder')} />
            </FormField>
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList aria-label={t('tabsLabel')}>
                <TabsTrigger value="docs" count={selectedCount}>
                  {t('tabDocs')}
                </TabsTrigger>
                <TabsTrigger value="questionnaire">{t('tabQuestionnaire')}</TabsTrigger>
              </TabsList>
              <TabsContent value="docs">
                <Card>
                  <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                    <div>
                      <h2 className="text-[15px] font-semibold text-fg">{t('docsTitle')}</h2>
                      <p className="text-[13px] text-fg-muted">{t('docsHint')}</p>
                    </div>
                    <Input type="search" inputSize="sm" leftIcon={<Search />} aria-label={t('searchDocs')} placeholder={t('searchDocs')} value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:w-60" />
                  </div>
                  {errors.items && (
                    <p role="alert" className="border-b border-border bg-red-bg px-4 py-2 text-[13px] font-medium text-red-fg sm:px-5">
                      {errors.items}
                    </p>
                  )}
                  <ul className="divide-y divide-border">
                    {filteredTypes.map((d) => {
                      const it = items[d.id];
                      const on = Boolean(it);
                      const open = expanded === d.id && on;
                      const chosen = it ? (it.fieldKeys.length ? it.fieldKeys.length : d.fields.length) : 0;
                      return (
                        <li key={d.id} className={cn('px-4 py-3 sm:px-5', on && 'bg-primary-soft/30')}>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                            <div className="min-w-0 flex-1">
                              <Checkbox
                                id={`doc-${d.id}`}
                                checked={on}
                                onCheckedChange={(v) => toggleDoc(d, v === true)}
                                label={
                                  <span className="inline-flex flex-wrap items-center gap-1.5">
                                    {docTypeName(d, locale)}
                                    {d.autoFillable && (
                                      <Badge tone="purple" className="gap-1">
                                        <Wand2 className="size-3" aria-hidden />
                                        {t('autoFillable')}
                                      </Badge>
                                    )}
                                  </span>
                                }
                              />
                            </div>
                            {on && (
                              <div className="flex items-center gap-3 pl-6 sm:pl-0">
                                <Switch
                                  label={t('required')}
                                  checked={it!.required}
                                  onCheckedChange={(v) => setItems((cur) => ({ ...cur, [d.id]: { ...cur[d.id]!, required: v } }))}
                                />
                                {d.fields.length > 0 ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-expanded={open}
                                    aria-controls={`fields-${d.id}`}
                                    onClick={() => setExpanded(open ? null : d.id)}
                                  >
                                    {t('fieldsCount', { chosen, total: d.fields.length })}
                                    <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
                                  </Button>
                                ) : (
                                  <span className="text-xs text-fg-subtle">{t('fileOnly')}</span>
                                )}
                              </div>
                            )}
                          </div>
                          {open && (
                            <fieldset id={`fields-${d.id}`} className="mt-3 rounded-lg border border-border bg-surface p-3 sm:ml-6">
                              <legend className="px-1 text-xs font-medium text-fg-muted">{t('fieldsLegend')}</legend>
                              <div className="grid gap-2 sm:grid-cols-2">
                                {d.fields.map((f) => {
                                  const checked = it!.fieldKeys.length === 0 || it!.fieldKeys.includes(f.key);
                                  const last = checked && (it!.fieldKeys.length === 1 || (it!.fieldKeys.length === 0 && d.fields.length === 1));
                                  return (
                                    <Checkbox
                                      key={f.key}
                                      checked={checked}
                                      disabled={last}
                                      onCheckedChange={(v) => toggleField(d, f.key, v === true)}
                                      label={
                                        <>
                                          {fieldLabel(f, locale)}
                                          {f.required && (
                                            <span className="ml-0.5 text-red-fg" aria-hidden>
                                              *
                                            </span>
                                          )}
                                        </>
                                      }
                                    />
                                  );
                                })}
                              </div>
                            </fieldset>
                          )}
                        </li>
                      );
                    })}
                    {filteredTypes.length === 0 && <li className="px-5 py-8 text-center text-[13px] text-fg-subtle">{tc('nothingFound')}</li>}
                  </ul>
                </Card>
              </TabsContent>
              <TabsContent value="questionnaire">
                <Card>
                  <CardBody className="grid gap-4">
                    <div>
                      <h2 className="text-[15px] font-semibold text-fg">{t('questionnaireTitle')}</h2>
                      <p className="text-[13px] text-fg-muted">{t('questionnaireHint')}</p>
                    </div>
                    <FormField label={t('questionnaire')} className="max-w-md">
                      <Select
                        value={questionnaireId}
                        onValueChange={setQuestionnaireId}
                        options={[{ value: SELECT_NONE, label: t('noQuestionnaire') }, ...(questionnaires.data ?? []).map((qq) => ({ value: qq.id, label: qq.name }))]}
                      />
                    </FormField>
                    {questionnaireId !== SELECT_NONE && (
                      <QuestionnairePreview fields={questionnaires.data?.find((x) => x.id === questionnaireId)?.fields ?? []} />
                    )}
                    <div>
                      <Button variant="outline" size="sm" asChild>
                        <Link href="/onboarding/questionnaires/new">{t('newQuestionnaire')}</Link>
                      </Button>
                    </div>
                  </CardBody>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>
    </RequireAccess>
  );
}

function QuestionnairePreview({ fields }: { fields: { key: string; label: string; labelKk?: string; required: boolean; type: string }[] }) {
  const t = useTranslations('onboarding.questionnaires');
  const locale = useLocale();
  return (
    <ul className="grid gap-1.5 rounded-lg border border-border bg-surface-muted p-3 text-[13px]">
      {fields.map((f) => (
        <li key={f.key} className="flex items-center justify-between gap-3">
          <span className="text-fg">
            {fieldLabel(f, locale)}
            {f.required && <span className="ml-0.5 text-red-fg">*</span>}
          </span>
          <span className="text-xs text-fg-subtle">{t(`types.${f.type as 'text'}`)}</span>
        </li>
      ))}
    </ul>
  );
}
