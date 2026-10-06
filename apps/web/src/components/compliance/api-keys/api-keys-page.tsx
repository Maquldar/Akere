'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, Check, Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge, StatusPill } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { DataTable } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { FormError, FormField } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/states';
import { toast } from '@/components/ui/toaster';
import { RequireAccess } from '@/components/shell/require-access';
import { isApiError } from '@/lib/api/errors';
import { applyServerErrors } from '@/lib/api/form-errors';
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from '@/lib/api/hooks/compliance';
import { API_KEY_SCOPES, type ApiKeyScope, type ApiKeyView } from '@/lib/api/types-compliance';
import { formatDateTime } from '@/lib/format';
import { can } from '@/lib/permissions';

/** /admin/api-keys — public API keys for 1С/ERP integrations (F-50, API.md §15). */
export function ApiKeysPage() {
  const t = useTranslations('apiKeys');
  const tc = useTranslations('common');
  const locale = useLocale();
  const keys = useApiKeys();
  const revoke = useRevokeApiKey();
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const [toRevoke, setToRevoke] = useState<ApiKeyView | null>(null);

  const columns = useMemo<ColumnDef<ApiKeyView, unknown>[]>(
    () => [
      {
        id: 'name',
        header: t('colName'),
        meta: { label: t('colName'), hideable: false },
        cell: ({ row }) => (
          <div className="min-w-[160px]">
            <div className="font-medium text-fg">{row.original.name}</div>
            <div className="text-xs text-fg-subtle">{t('createdAt', { date: formatDateTime(row.original.createdAt, locale) })}</div>
          </div>
        ),
      },
      {
        id: 'prefix',
        header: t('colPrefix'),
        meta: { label: t('colPrefix'), className: 'whitespace-nowrap' },
        cell: ({ row }) => <code className="rounded bg-surface-hover px-1.5 py-0.5 font-mono text-xs text-fg">ak_{row.original.prefix}_…</code>,
      },
      {
        id: 'scopes',
        header: t('colScopes'),
        meta: { label: t('colScopes') },
        cell: ({ row }) => (
          <div className="flex min-w-[200px] flex-wrap gap-1">
            {row.original.scopes.map((s) => (
              <Badge key={s} tone="blue" className="font-mono">
                {s}
              </Badge>
            ))}
          </div>
        ),
      },
      {
        id: 'lastUsed',
        header: t('colLastUsed'),
        meta: { label: t('colLastUsed'), className: 'whitespace-nowrap tabular text-fg-muted' },
        cell: ({ row }) => (row.original.lastUsedAt ? formatDateTime(row.original.lastUsedAt, locale) : t('never')),
      },
      {
        id: 'status',
        header: t('colStatus'),
        meta: { label: t('colStatus') },
        cell: ({ row }) =>
          row.original.revokedAt ? (
            <div className="flex flex-col gap-0.5">
              <StatusPill tone="gray">{t('revoked')}</StatusPill>
              <span className="text-xs text-fg-subtle tabular">{formatDateTime(row.original.revokedAt, locale)}</span>
            </div>
          ) : (
            <StatusPill tone="green">{t('active')}</StatusPill>
          ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{tc('actions')}</span>,
        meta: { hideable: false, className: 'w-px whitespace-nowrap text-right' },
        cell: ({ row }) =>
          row.original.revokedAt ? null : (
            <Button variant="ghost" size="sm" className="text-red-fg" onClick={() => setToRevoke(row.original)}>
              <Trash2 aria-hidden />
              {t('revoke')}
            </Button>
          ),
      },
    ],
    [t, tc, locale],
  );

  return (
    <RequireAccess allow={(a) => can(a, 'apikey.manage')}>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            {t('create')}
          </Button>
        }
      />
      <div className="grid gap-5">
        <DataTable
          label={t('title')}
          columns={columns}
          data={keys.data}
          getRowId={(k) => k.id}
          isLoading={keys.isLoading}
          isFetching={keys.isFetching}
          error={keys.error}
          onRetry={() => keys.refetch()}
          skeletonRows={3}
          empty={
            <EmptyState
              compact
              icon={<KeyRound aria-hidden />}
              title={t('empty')}
              description={t('emptyHint')}
              action={
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus />
                  {t('create')}
                </Button>
              }
            />
          }
        />
        <UsageDocs />
      </div>
      <CreateKeyDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={(name, key) => setCreated({ name, key })} />
      <ShowKeyDialog created={created} onClose={() => setCreated(null)} />
      <ConfirmDialog
        open={toRevoke !== null}
        onOpenChange={(o) => !o && setToRevoke(null)}
        title={t('revokeTitle')}
        description={toRevoke ? t('revokeText', { name: toRevoke.name }) : undefined}
        confirmLabel={t('revoke')}
        loading={revoke.isPending}
        onConfirm={() =>
          toRevoke &&
          revoke.mutate(toRevoke.id, {
            onSuccess: () => {
              toast.success(t('revokedToast', { name: toRevoke.name }));
              setToRevoke(null);
            },
            onError: (e) => toast.error(isApiError(e) ? e.message : tc('error')),
          })
        }
      />
    </RequireAccess>
  );
}

function CreateKeyDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (name: string, key: string) => void }) {
  const t = useTranslations('apiKeys');
  const tc = useTranslations('common');
  const create = useCreateApiKey();
  const schema = z.object({
    name: z.string().trim().min(1, tc('requiredField')).max(120),
    scopes: z.array(z.enum(API_KEY_SCOPES)).min(1, t('scopesRequired')),
  });
  type Form = z.infer<typeof schema>;
  const form = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { name: '', scopes: ['candidates:read'] } });
  const e = form.formState.errors;
  const close = (o: boolean) => {
    if (create.isPending) return;
    onOpenChange(o);
    if (!o) form.reset();
  };
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const res = await create.mutateAsync(v);
      onCreated(v.name, res.key);
      close(false);
    } catch (err) {
      if (applyServerErrors(err, form.setError, { fields: ['name', 'scopes'] })) return;
      form.setError('root.server', { message: isApiError(err) ? err.message : tc('error') });
    }
  });
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={t('createTitle')}
      description={t('createDescription')}
      dismissible={!create.isPending}
      footer={
        <>
          <Button variant="outline" onClick={() => close(false)} disabled={create.isPending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="api-key-form" loading={create.isPending}>
            {t('createSubmit')}
          </Button>
        </>
      }
    >
      <form id="api-key-form" onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormError message={e.root?.server?.message} />
        <FormField label={t('name')} required error={e.name?.message} hint={t('nameHint')}>
          <Input autoComplete="off" placeholder="1С:ЗУП" {...form.register('name')} />
        </FormField>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-[13px] font-medium text-fg">
            {t('scopes')}
            <span className="ml-0.5 text-red-fg" aria-hidden>
              *
            </span>
          </legend>
          <Controller
            control={form.control}
            name="scopes"
            render={({ field }) => (
              <div className="grid gap-2.5">
                {API_KEY_SCOPES.map((s) => (
                  <Checkbox
                    key={s}
                    checked={field.value.includes(s)}
                    onCheckedChange={(v) =>
                      field.onChange(v === true ? [...field.value, s] : field.value.filter((x: ApiKeyScope) => x !== s))
                    }
                    label={<code className="font-mono text-[13px]">{s}</code>}
                    description={t(`scope.${s.replace(':', '_') as 'candidates_read'}`)}
                  />
                ))}
              </div>
            )}
          />
          {e.scopes && (
            <p role="alert" className="text-xs font-medium text-red-fg">
              {e.scopes.message}
            </p>
          )}
        </fieldset>
      </form>
    </Dialog>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const t = useTranslations('apiKeys');
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast.success(t('copied'));
          setTimeout(() => setCopied(false), 2000);
        } catch {
          toast.error(t('copyFailed'));
        }
      }}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {label}
    </Button>
  );
}

function ShowKeyDialog({ created, onClose }: { created: { name: string; key: string } | null; onClose: () => void }) {
  const t = useTranslations('apiKeys');
  return (
    <Dialog
      open={created !== null}
      onOpenChange={(o) => !o && onClose()}
      title={t('keyCreatedTitle')}
      description={created?.name}
      dismissible={false}
      footer={<Button onClick={onClose}>{t('savedIt')}</Button>}
    >
      {created && (
        <div className="grid gap-3" data-dialog-body>
          <div role="alert" className="flex gap-2 rounded-lg border border-orange-border bg-orange-bg px-3 py-2 text-[13px] text-orange-fg">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t('onceWarning')}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code
              className="min-w-0 flex-1 select-all break-all rounded-md border border-border bg-surface-muted px-3 py-2 font-mono text-[13px] text-fg"
              data-testid="api-key-value"
            >
              {created.key}
            </code>
            <CopyButton value={created.key} label={t('copy')} />
          </div>
        </div>
      )}
    </Dialog>
  );
}

function UsageDocs() {
  const t = useTranslations('apiKeys.docs');
  const [origin, setOrigin] = useState('https://akere.example');
  useEffect(() => setOrigin(window.location.origin), []);
  const curl = `curl -H "Authorization: Bearer ak_<prefix>_<secret>" \\\n  "${origin}/api/v1/public/candidates?status=ACCEPTED&page=1&pageSize=50"`;
  const endpoints: [string, string, string][] = [
    ['GET', '/public/candidates', 'candidates:read'],
    ['POST', '/public/candidates/mark-exported', 'candidates:write'],
    ['GET', '/public/employees', 'employees:read'],
    ['GET', '/public/timesheet?year&month', 'timesheet:read'],
    ['GET', '/public/documents', 'documents:read'],
  ];
  return (
    <Card>
      <CardHeader title={t('title')} />
      <CardBody className="grid gap-4 text-[13px]">
        <p className="text-fg-muted">{t('intro')}</p>
        <div className="relative">
          <pre className="overflow-x-auto rounded-lg bg-fg p-3 font-mono text-xs leading-relaxed text-white">
            <code>{curl}</code>
          </pre>
          <div className="absolute right-2 top-2">
            <CopyButton value={curl.replace('\\\n  ', '')} label={t('copyExample')} />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left">
            <caption className="sr-only">{t('endpoints')}</caption>
            <thead className="text-xs text-fg-subtle">
              <tr>
                <th className="py-1.5 pr-3 font-medium">{t('method')}</th>
                <th className="py-1.5 pr-3 font-medium">{t('path')}</th>
                <th className="py-1.5 font-medium">{t('scope')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {endpoints.map(([m, p, s]) => (
                <tr key={p}>
                  <td className="py-1.5 pr-3 font-mono text-xs font-semibold text-fg">{m}</td>
                  <td className="py-1.5 pr-3 font-mono text-xs text-fg">/api/v1{p}</td>
                  <td className="py-1.5">
                    <Badge tone="blue" className="font-mono">
                      {s}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-fg-subtle">{t('limits')}</p>
      </CardBody>
    </Card>
  );
}
