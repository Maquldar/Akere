'use client';

import { Select as SelectPrimitive } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { forwardRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type SelectOption = { value: string; label: ReactNode; disabled?: boolean };

/** Radix does not allow '' as an item value; use this sentinel for "any / not set". */
export const SELECT_NONE = '__none__';

export type SelectProps = {
  value: string | undefined;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  size?: 'sm' | 'md';
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  'aria-required'?: boolean;
  name?: string;
};

export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  { value, onValueChange, options, placeholder, disabled, id, className, size = 'md', name, ...aria },
  ref,
) {
  return (
    <SelectPrimitive.Root value={value || undefined} onValueChange={onValueChange} disabled={disabled} name={name}>
      <SelectPrimitive.Trigger
        ref={ref}
        id={id}
        {...aria}
        className={cn(
          'focus-ring flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 text-left text-sm text-fg transition-colors hover:border-border-strong disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-fg-subtle data-[placeholder]:text-fg-subtle aria-[invalid=true]:border-red-solid',
          size === 'sm' ? 'h-8' : 'h-9',
          className,
        )}
      >
        <span className="truncate">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="size-4 shrink-0 text-fg-subtle" aria-hidden />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-[min(var(--radix-select-content-available-height),320px)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-surface shadow-pop animate-fade-in"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="relative flex cursor-pointer select-none items-center rounded-md py-1.5 pl-2 pr-8 text-sm text-fg outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-surface-hover data-[disabled]:text-fg-subtle"
              >
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2 inline-flex">
                  <Check className="size-4 text-primary" aria-hidden />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
});
