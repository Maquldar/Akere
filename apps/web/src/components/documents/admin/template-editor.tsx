'use client';

import {
  AlignCenter, AlignLeft, ArrowDown, ArrowUp, Braces, Heading, List, PenLine, Pilcrow, Plus, Save, Search, Space, Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { FormError, FormField } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { useCurrentUser } from '@/components/shell/me-context';
import { RequireAccess } from '@/components/shell/require-access';
import { useRouter } from '@/i18n/navigation';
import { isApiError } from '@/lib/api/errors';
import { useDocumentTemplate, useSaveDocumentTemplate, useTemplateVariables } from '@/lib/api/hooks/documents';
import { useLegalEntities } from '@/lib/api/hooks/org';
import type { TemplateBlock } from '@/lib/api/types-documents';
import { can } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { EmployeePicker } from '../employee-picker';
import { BlobPdfPane, useTemplatePdf } from '../template-preview';
import { insertAt } from '../template-fields';

type BlockType = TemplateBlock['type'];
type Target = { el: HTMLInputElement | HTMLTextAreaElement; set: (v: string) => void };

const blockIcons: Record<BlockType, typeof Heading> = { heading: Heading, paragraph: Pilcrow, fields: List, signatures: PenLine, spacer: Space };

function emptyBlock(type: BlockType): TemplateBlock {
  switch (type) {
    case 'heading':
      return { type, text: '', align: 'center' };
    case 'paragraph':
      return { type, text: '' };
    case 'fields':
      return { type, rows: [{ label: '', value: '' }] };
    case 'signatures':
      return { type, parties: [{ label: '', name: '' }] };
    default:
      return { type: 'spacer' };
  }
}

/** Client-side checks mirroring the API schema (TemplateBlock). Returns problems per block index. */
function validateBlocks(blocks: TemplateBlock[]): Map<number, string> {
  const out = new Map<number, string>();
  blocks.forEach((b, i) => {
    if ((b.type === 'heading' || b.type === 'paragraph') && !b.text.trim()) out.set(i, 'text');
    if (b.type === 'fields' && (b.rows.length === 0 || b.rows.some((r) => !r.label.trim()))) out.set(i, 'rows');
    if (b.type === 'signatures' && (b.parties.length === 0 || b.parties.some((p) => !p.label.trim()))) out.set(i, 'parties');
  });
  return out;
}

export function TemplateEditor({ id }: { id: string | null }) {
  const t = useTranslations('docAdmin.editor');
  const tc = useTranslations('common');
  const router = useRouter();
  const { me } = useCurrentUser();
  const existing = useDocumentTemplate(id);
  const save = useSaveDocumentTemplate();
  const vars = useTemplateVariables();
  const entities = useLegalEntities();
  const [name, setName] = useState('');
  const [blocks, setBlocks] = useState<TemplateBlock[]>([emptyBlock('heading'), emptyBlock('paragraph')]);
  const [loaded, setLoaded] = useState(!id);
  const [problems, setProblems] = useState<Map<number, string>>(new Map());
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [varQuery, setVarQuery] = useState('');
  const [customKey, setCustomKey] = useState('');
  const [entityId, setEntityId] = useState(me.employee?.legalEntityId ?? '');
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const target = useRef<Target | null>(null);

  useEffect(() => {
    if (existing.data && !loaded) {
      setName(existing.data.name);
      setBlocks(existing.data.body);
      setLoaded(true);
    }
  }, [existing.data, loaded]);
  useEffect(() => {
    if (!entityId && entities.data?.length) setEntityId(entities.data[0]!.id);
  }, [entities.data, entityId]);

  const previewBody = useMemo(() => ({ data: {}, legalEntityId: entityId, subjectEmployeeId: employeeId }), [entityId, employeeId]);
  const pdf = useTemplatePdf(id, previewBody, Boolean(id && entityId));

  const update = (i: number, b: TemplateBlock) => setBlocks((s) => s.map((x, j) => (j === i ? b : x)));
  const move = (i: number, d: -1 | 1) =>
    setBlocks((s) => {
      const j = i + d;
      if (j < 0 || j >= s.length) return s;
      const next = [...s];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const remove = (i: number) => setBlocks((s) => s.filter((_, j) => j !== i));

  /** Props for a text control: tracks focus so the variable helper inserts at the caret. */
  const bind = (value: string, set: (v: string) => void) => ({
    value,
    onChange: (e: { target: { value: string } }) => set(e.target.value),
    onFocus: (e: { currentTarget: HTMLInputElement | HTMLTextAreaElement }) => {
      target.current = { el: e.currentTarget, set };
    },
  });

  const insert = (key: string) => {
    const token = `{{${key}}}`;
    const tg = target.current;
    if (!tg || !document.body.contains(tg.el)) {
      toast.info(t('pickField'));
      return;
    }
    const { value, caret } = insertAt(tg.el.value, tg.el.selectionStart, tg.el.selectionEnd, token);
    tg.set(value);
    requestAnimationFrame(() => {
      tg.el.focus();
      tg.el.setSelectionRange(caret, caret);
    });
  };

  const filteredVars = (vars.data ?? []).filter((v) => {
    const q = varQuery.trim().toLowerCase();
    return !q || v.key.toLowerCase().includes(q) || v.label.toLowerCase().includes(q);
  });

  const submit = () => {
    setFormError(null);
    const p = validateBlocks(blocks);
    setProblems(p);
    setNameError(name.trim() ? null : tc('requiredField'));
    if (!name.trim() || p.size || blocks.length === 0) {
      if (blocks.length === 0) setFormError(t('noBlocks'));
      return;
    }
    const body = blocks.map((b): TemplateBlock => {
      if (b.type === 'fields') return { type: 'fields', rows: b.rows.map((r) => ({ label: r.label.trim(), value: r.value })) };
      if (b.type === 'signatures') return { type: 'signatures', parties: b.parties.map((x) => ({ label: x.label.trim(), name: x.name })) };
      if (b.type === 'heading') return { ...b, text: b.text.trim() };
      if (b.type === 'paragraph') return { ...b, text: b.text.trim() };
      return b;
    });
    save.mutate(
      { id: id ?? undefined, input: { name: name.trim(), body } },
      {
        onSuccess: (tpl) => {
          toast.success(id ? tc('saved') : t('created'));
          if (!id) router.replace(`/admin/document-templates/${tpl.id}`);
          else pdf.refresh();
        },
        onError: (e) => setFormError(isApiError(e) ? e.message : tc('error')),
      },
    );
  };

  if (id && existing.isLoading) return <Skeleton className="h-96" />;
  if (id && existing.error)
    return (
      <Card>
        <ErrorState error={existing.error} onRetry={() => existing.refetch()} />
      </Card>
    );

  const addButtons: BlockType[] = ['heading', 'paragraph', 'fields', 'signatures', 'spacer'];

  return (
    <RequireAccess allow={(a) => can(a, 'document.manage')}>
      <PageHeader
        breadcrumbs={[{ label: t('crumb'), href: '/admin/document-templates' }, { label: id ? name || t('untitled') : t('newTitle') }]}
        title={id ? name || t('untitled') : t('newTitle')}
        subtitle={t('subtitle')}
        actions={
          <Button onClick={submit} loading={save.isPending}>
            <Save aria-hidden />
            {tc('save')}
          </Button>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="p-4 sm:p-5">
            <FormField label={t('name')} required error={nameError}>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
            </FormField>
          </Card>

          <ol className="flex flex-col gap-3" aria-label={t('blocks')}>
            {blocks.map((b, i) => {
              const Icon = blockIcons[b.type];
              const problem = problems.get(i);
              return (
                <li key={i}>
                  <Card className={cn(problem && 'border-red-border')}>
                    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                      <Icon className="size-4 text-fg-subtle" aria-hidden />
                      <span className="flex-1 text-[13px] font-medium text-fg">
                        {i + 1}. {t(`type_${b.type}`)}
                      </span>
                      <Button variant="ghost" size="icon-sm" aria-label={t('moveUp')} disabled={i === 0} onClick={() => move(i, -1)}>
                        <ArrowUp aria-hidden />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={t('moveDown')} disabled={i === blocks.length - 1} onClick={() => move(i, 1)}>
                        <ArrowDown aria-hidden />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={t('removeBlock')} onClick={() => remove(i)}>
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                    <div className="flex flex-col gap-3 p-3">
                      {b.type === 'heading' && (
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Input aria-label={t('headingText')} placeholder={t('headingText')} className="flex-1 font-semibold" {...bind(b.text, (v) => update(i, { ...b, text: v }))} />
                          <div className="inline-flex rounded-md border border-border p-0.5" role="group" aria-label={t('align')}>
                            {(['left', 'center'] as const).map((a) => (
                              <Button
                                key={a}
                                variant={(b.align ?? 'left') === a ? 'secondary' : 'ghost'}
                                size="icon-sm"
                                aria-pressed={(b.align ?? 'left') === a}
                                aria-label={a === 'left' ? t('alignLeft') : t('alignCenter')}
                                onClick={() => update(i, { ...b, align: a })}
                              >
                                {a === 'left' ? <AlignLeft aria-hidden /> : <AlignCenter aria-hidden />}
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}
                      {b.type === 'paragraph' && (
                        <Textarea aria-label={t('paragraphText')} placeholder={t('paragraphText')} rows={4} {...bind(b.text, (v) => update(i, { ...b, text: v }))} />
                      )}
                      {b.type === 'fields' && (
                        <>
                          {b.rows.map((r, ri) => (
                            <div key={ri} className="flex flex-col gap-2 sm:flex-row">
                              <Input
                                aria-label={t('rowLabel')}
                                placeholder={t('rowLabel')}
                                className="sm:w-1/3"
                                {...bind(r.label, (v) => update(i, { ...b, rows: b.rows.map((x, k) => (k === ri ? { ...x, label: v } : x)) }))}
                              />
                              <Input
                                aria-label={t('rowValue')}
                                placeholder={t('rowValue')}
                                className="flex-1"
                                {...bind(r.value, (v) => update(i, { ...b, rows: b.rows.map((x, k) => (k === ri ? { ...x, value: v } : x)) }))}
                              />
                              <Button variant="ghost" size="icon" aria-label={t('removeRow')} disabled={b.rows.length === 1} onClick={() => update(i, { ...b, rows: b.rows.filter((_, k) => k !== ri) })}>
                                <Trash2 aria-hidden />
                              </Button>
                            </div>
                          ))}
                          <div>
                            <Button variant="ghost" size="sm" onClick={() => update(i, { ...b, rows: [...b.rows, { label: '', value: '' }] })}>
                              <Plus aria-hidden />
                              {t('addRow')}
                            </Button>
                          </div>
                        </>
                      )}
                      {b.type === 'signatures' && (
                        <>
                          {b.parties.map((p, pi) => (
                            <div key={pi} className="flex flex-col gap-2 sm:flex-row">
                              <Input
                                aria-label={t('partyLabel')}
                                placeholder={t('partyLabel')}
                                className="sm:w-1/3"
                                {...bind(p.label, (v) => update(i, { ...b, parties: b.parties.map((x, k) => (k === pi ? { ...x, label: v } : x)) }))}
                              />
                              <Input
                                aria-label={t('partyName')}
                                placeholder={t('partyName')}
                                className="flex-1"
                                {...bind(p.name, (v) => update(i, { ...b, parties: b.parties.map((x, k) => (k === pi ? { ...x, name: v } : x)) }))}
                              />
                              <Button variant="ghost" size="icon" aria-label={t('removeParty')} disabled={b.parties.length === 1} onClick={() => update(i, { ...b, parties: b.parties.filter((_, k) => k !== pi) })}>
                                <Trash2 aria-hidden />
                              </Button>
                            </div>
                          ))}
                          {b.parties.length < 4 && (
                            <div>
                              <Button variant="ghost" size="sm" onClick={() => update(i, { ...b, parties: [...b.parties, { label: '', name: '' }] })}>
                                <Plus aria-hidden />
                                {t('addParty')}
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                      {b.type === 'spacer' && <p className="text-xs text-fg-subtle">{t('spacerHint')}</p>}
                      {problem && (
                        <p role="alert" className="text-xs font-medium text-red-fg">
                          {t(`problem_${problem as 'text' | 'rows' | 'parties'}`)}
                        </p>
                      )}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ol>

          <Card className="flex flex-wrap items-center gap-2 p-3">
            <span className="text-[13px] font-medium text-fg-muted">{t('addBlock')}:</span>
            {addButtons.map((type) => {
              const Icon = blockIcons[type];
              return (
                <Button key={type} variant="outline" size="sm" onClick={() => setBlocks((s) => [...s, emptyBlock(type)])}>
                  <Icon aria-hidden />
                  {t(`type_${type}`)}
                </Button>
              );
            })}
          </Card>
          <FormError message={formError} />

          <Card>
            <CardHeader title={t('preview')} />
            <div className="flex flex-col gap-3 p-4 sm:p-5">
              {!id ? (
                <p className="text-sm text-fg-subtle">{t('previewAfterSave')}</p>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField label={t('previewEntity')}>
                      <Select value={entityId || undefined} onValueChange={setEntityId} options={(entities.data ?? []).map((e) => ({ value: e.id, label: e.name }))} />
                    </FormField>
                    <FormField label={t('previewEmployee')} hint={t('previewEmployeeHint')}>
                      <EmployeePicker value={employeeId} onChange={(v) => setEmployeeId(v)} legalEntityId={entityId || undefined} />
                    </FormField>
                  </div>
                  <p className="text-xs text-fg-subtle">{t('previewNote')}</p>
                  <BlobPdfPane {...pdf} onRetry={() => pdf.refresh()} filename={`${name || 'template'}.pdf`} title={t('preview')} className="h-[70dvh]" />
                </>
              )}
            </div>
          </Card>
        </div>

        <aside className="xl:sticky xl:top-4 xl:self-start">
          <Card>
            <CardHeader title={t('variables')} />
            <div className="flex flex-col gap-3 p-3">
              <p className="text-xs text-fg-subtle">{t('variablesHint')}</p>
              <Input
                type="search"
                inputSize="sm"
                leftIcon={<Search />}
                aria-label={t('searchVariables')}
                placeholder={t('searchVariables')}
                value={varQuery}
                onChange={(e) => setVarQuery(e.target.value)}
              />
              <ul className="flex max-h-[50dvh] flex-col gap-0.5 overflow-y-auto">
                {vars.isLoading && <Skeleton className="h-24" />}
                {filteredVars.map((v) => (
                  <li key={v.key}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => insert(v.key)}
                      className="focus-ring flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-surface-hover"
                      title={v.example}
                    >
                      <span className="text-[13px] text-fg">{v.label}</span>
                      <code className="text-[11px] text-primary">{`{{${v.key}}}`}</code>
                    </button>
                  </li>
                ))}
              </ul>
              <form
                className="flex gap-2 border-t border-border pt-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const k = customKey.trim();
                  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(k)) {
                    toast.error(t('customKeyRule'));
                    return;
                  }
                  insert(`data.${k}`);
                  setCustomKey('');
                }}
              >
                <Input inputSize="sm" aria-label={t('customKey')} placeholder={t('customKey')} value={customKey} onChange={(e) => setCustomKey(e.target.value)} className="flex-1" />
                <Button type="submit" size="sm" variant="outline" onMouseDown={(e) => e.preventDefault()} aria-label={t('insertCustom')}>
                  <Braces aria-hidden />
                </Button>
              </form>
              <p className="text-[11px] text-fg-subtle">{t('filtersHint')}</p>
            </div>
          </Card>
        </aside>
      </div>
    </RequireAccess>
  );
}
