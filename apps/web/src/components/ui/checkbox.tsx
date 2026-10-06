'use client';

import { Checkbox as CheckboxPrimitive, RadioGroup as RadioPrimitive, Switch as SwitchPrimitive } from 'radix-ui';
import { Check, Minus } from 'lucide-react';
import { forwardRef, useId, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type CheckboxProps = ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & { label?: ReactNode; description?: ReactNode };

export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(function Checkbox(
  { className, label, description, id, ...props },
  ref,
) {
  const autoId = useId();
  const cid = id ?? autoId;
  const box = (
    <CheckboxPrimitive.Root
      ref={ref}
      id={cid}
      className={cn(
        'focus-ring peer inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-border-strong bg-surface transition-colors hover:border-fg-subtle disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary text-white',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        {props.checked === 'indeterminate' ? <Minus className="size-3" strokeWidth={3} /> : <Check className="size-3" strokeWidth={3} />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
  if (!label) return box;
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 flex">{box}</span>
      <div className="flex flex-col">
        <label htmlFor={cid} className="cursor-pointer text-sm text-fg">
          {label}
        </label>
        {description && <span className="text-xs text-fg-subtle">{description}</span>}
      </div>
    </div>
  );
});

export type RadioOption = { value: string; label: ReactNode; description?: ReactNode; disabled?: boolean };

export function RadioGroup({
  options,
  className,
  orientation = 'vertical',
  ...props
}: ComponentPropsWithoutRef<typeof RadioPrimitive.Root> & { options: RadioOption[] }) {
  const base = useId();
  return (
    <RadioPrimitive.Root
      orientation={orientation}
      className={cn('flex gap-2.5', orientation === 'vertical' ? 'flex-col' : 'flex-row flex-wrap gap-x-5', className)}
      {...props}
    >
      {options.map((o) => {
        const id = `${base}-${o.value}`;
        return (
          <div key={o.value} className="flex items-start gap-2">
            <RadioPrimitive.Item
              id={id}
              value={o.value}
              disabled={o.disabled}
              className="focus-ring mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface data-[state=checked]:border-primary disabled:opacity-50"
            >
              <RadioPrimitive.Indicator className="size-2 rounded-full bg-primary" />
            </RadioPrimitive.Item>
            <div className="flex flex-col">
              <label htmlFor={id} className="cursor-pointer text-sm text-fg">
                {o.label}
              </label>
              {o.description && <span className="text-xs text-fg-subtle">{o.description}</span>}
            </div>
          </div>
        );
      })}
    </RadioPrimitive.Root>
  );
}

export type SwitchProps = ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> & { label?: ReactNode; description?: ReactNode };

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { className, label, description, id, ...props },
  ref,
) {
  const autoId = useId();
  const sid = id ?? autoId;
  const control = (
    <SwitchPrimitive.Root
      ref={ref}
      id={sid}
      className={cn(
        'focus-ring relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-border-strong transition-colors data-[state=checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  );
  if (!label) return control;
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col">
        <label htmlFor={sid} className="cursor-pointer text-sm font-medium text-fg">
          {label}
        </label>
        {description && <span className="text-xs text-fg-subtle">{description}</span>}
      </div>
      {control}
    </div>
  );
});
