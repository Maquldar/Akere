'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { FormError, FormField, Label } from '@/components/ui/label';
import { Select, SELECT_NONE } from '@/components/ui/select';
import { toast } from '@/components/ui/toaster';
import { ROLES } from '@/components/shell/roles';
import { applyServerErrors } from '@/lib/api/form-errors';
import { isApiError } from '@/lib/api/errors';
import { useLegalEntities, useSaveUser } from '@/lib/api/hooks/org';
import type { Role, UserAdmin, UserInput, UserUpdate } from '@/lib/api/types';
import { cleanOptional } from '@/lib/forms';
import { KZ_PHONE_RE, normalizePhone } from '@/lib/validation';

export function UserDialog({ open, onOpenChange, user }: { open: boolean; onOpenChange: (o: boolean) => void; user: UserAdmin | null }) {
  const t = useTranslations('admin.users');
  const tc = useTranslations('common');
  const tr = useTranslations('roles');
  const save = useSaveUser();
  const entities = useLegalEntities();

  const schema = z.object({
    lastName: z.string().trim().min(1, tc('requiredField')).max(100),
    firstName: z.string().trim().min(1, tc('requiredField')).max(100),
    middleName: z.string().max(100),
    email: z.string().trim().min(1, tc('requiredField')).pipe(z.email(t('emailInvalid'))),
    phone: z
      .string()
      .trim()
      .transform((v) => (v ? normalizePhone(v) : ''))
      .refine((v) => v === '' || KZ_PHONE_RE.test(v), t('phoneInvalid')),
    roles: z
      .array(
        z
          .object({ role: z.enum(['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE']), legalEntityId: z.string(), canSign: z.boolean() })
          .refine((r) => !r.canSign || r.legalEntityId !== SELECT_NONE, { path: ['legalEntityId'], message: t('canSignNeedsEntity') }),
      )
      .min(1, t('rolesRequired'))
      .refine((rs) => new Set(rs.map((r) => `${r.role}:${r.legalEntityId}`)).size === rs.length, t('rolesDuplicate')),
    sendInvite: z.boolean(),
  });
  type FormIn = z.input<typeof schema>;
  type FormOut = z.output<typeof schema>;

  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema),
    values: {
      lastName: user?.lastName ?? '',
      firstName: user?.firstName ?? '',
      middleName: user?.middleName ?? '',
      email: user?.email ?? '',
      phone: user?.phone ?? '',
      roles: user?.roles.map((r) => ({ role: r.role, legalEntityId: r.legalEntityId ?? SELECT_NONE, canSign: r.canSign })) ?? [
        { role: 'EMPLOYEE', legalEntityId: SELECT_NONE, canSign: false },
      ],
      sendInvite: true,
    },
  });
  const roles = useFieldArray({ control: form.control, name: 'roles' });
  const e = form.formState.errors;

  const entityOptions = [
    { value: SELECT_NONE, label: t('allEntities') },
    ...(entities.data ?? []).map((le) => ({ value: le.id, label: le.name })),
  ];

  const onSubmit = form.handleSubmit(async (v) => {
    const base = cleanOptional(
      { lastName: v.lastName, firstName: v.firstName, middleName: v.middleName, email: v.email, phone: v.phone },
      user,
    );
    const roleInputs = v.roles.map((r) => ({
      role: r.role as Role,
      legalEntityId: r.legalEntityId === SELECT_NONE ? null : r.legalEntityId,
      canSign: r.canSign,
    }));
    try {
      if (user) {
        const input: UserUpdate = { ...base, roles: roleInputs };
        await save.mutateAsync({ id: user.id, input });
        toast.success(tc('saved'));
      } else {
        const input = { ...base, roles: roleInputs, sendInvite: v.sendInvite } as UserInput;
        await save.mutateAsync({ input });
        toast.success(v.sendInvite ? t('createdInvited') : t('created'));
      }
      onOpenChange(false);
    } catch (err) {
      if (applyServerErrors(err, form.setError, { fields: Object.keys(schema.shape) })) return;
      if (isApiError(err) && err.code === 'CONFLICT') form.setError('email', { message: t('emailTaken') });
      else form.setError('root.server', { message: isApiError(err) ? err.message : tc('error') });
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={user ? t('editTitle') : t('createTitle')}
      dismissible={!save.isPending}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="user-form" loading={save.isPending}>
            {user ? tc('save') : t('create')}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={onSubmit} noValidate className="grid gap-5">
        <FormError message={e.root?.server?.message} />
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label={t('lastName')} required error={e.lastName?.message}>
            <Input autoComplete="off" {...form.register('lastName')} />
          </FormField>
          <FormField label={t('firstName')} required error={e.firstName?.message}>
            <Input autoComplete="off" {...form.register('firstName')} />
          </FormField>
          <FormField label={t('middleName')} error={e.middleName?.message}>
            <Input autoComplete="off" {...form.register('middleName')} />
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('email')} required error={e.email?.message}>
            <Input type="email" autoComplete="off" {...form.register('email')} />
          </FormField>
          <FormField label={t('phone')} error={e.phone?.message} hint={t('phoneHint')}>
            <Input type="tel" autoComplete="off" placeholder="+77011234567" {...form.register('phone')} />
          </FormField>
        </div>

        <fieldset className="grid gap-3">
          <legend className="mb-1 text-[13px] font-medium text-fg">
            {t('roles')}
            <span className="ml-0.5 text-red-fg" aria-hidden>
              *
            </span>
          </legend>
          <p className="-mt-1 text-xs text-fg-subtle">{t('rolesHint')}</p>
          {roles.fields.map((field, i) => {
            const re = e.roles?.[i];
            return (
              <div key={field.id} className="grid gap-3 rounded-lg border border-border bg-surface-muted p-3 sm:grid-cols-[160px_1fr_auto_auto] sm:items-end">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`role-${i}`}>{t('role')}</Label>
                  <Select
                    id={`role-${i}`}
                    value={form.watch(`roles.${i}.role`)}
                    onValueChange={(v) => form.setValue(`roles.${i}.role`, v as Role, { shouldDirty: true })}
                    options={ROLES.map((r) => ({ value: r, label: tr(r) }))}
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Label htmlFor={`le-${i}`}>{t('scope')}</Label>
                  <Select
                    id={`le-${i}`}
                    value={form.watch(`roles.${i}.legalEntityId`)}
                    onValueChange={(v) => form.setValue(`roles.${i}.legalEntityId`, v, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })}
                    options={entityOptions}
                    aria-invalid={re?.legalEntityId ? true : undefined}
                    aria-describedby={re?.legalEntityId ? `le-${i}-err` : undefined}
                  />
                  {re?.legalEntityId && (
                    <p id={`le-${i}-err`} role="alert" className="text-xs font-medium text-red-fg">
                      {re.legalEntityId.message}
                    </p>
                  )}
                </div>
                <div className="flex h-9 items-center">
                  <Checkbox
                    label={t('canSign')}
                    checked={form.watch(`roles.${i}.canSign`)}
                    onCheckedChange={(v) => form.setValue(`roles.${i}.canSign`, v === true, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })}
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => roles.remove(i)}
                  disabled={roles.fields.length === 1}
                  aria-label={t('removeRole')}
                >
                  <Trash2 />
                </Button>
              </div>
            );
          })}
          {(e.roles?.message || e.roles?.root?.message) && (
            <p role="alert" className="text-xs font-medium text-red-fg">
              {e.roles?.message ?? e.roles?.root?.message}
            </p>
          )}
          <div>
            <Button variant="outline" size="sm" onClick={() => roles.append({ role: 'EMPLOYEE', legalEntityId: SELECT_NONE, canSign: false })}>
              <Plus />
              {t('addRole')}
            </Button>
          </div>
        </fieldset>

        {!user && (
          <Checkbox
            label={t('sendInvite')}
            description={t('sendInviteHint')}
            checked={form.watch('sendInvite')}
            onCheckedChange={(v) => form.setValue('sendInvite', v === true)}
          />
        )}
      </form>
    </Dialog>
  );
}
