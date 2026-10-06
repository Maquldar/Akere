'use client';

import { Label as LabelPrimitive } from 'radix-ui';
import {
  cloneElement, isValidElement, useId, type ComponentPropsWithoutRef, type ReactElement, type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

export function Label({
  className,
  required,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & { required?: boolean }) {
  return (
    <LabelPrimitive.Root className={cn('text-[13px] font-medium text-fg', className)} {...props}>
      {children}
      {/* Required state is announced via aria-required on the control (FormField). */}
      {required && (
        <span className="ml-0.5 text-red-fg" aria-hidden>
          *
        </span>
      )}
    </LabelPrimitive.Root>
  );
}

type ControlProps = {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  'aria-required'?: boolean;
};

export type FormFieldProps = {
  label: ReactNode;
  /** Single form control; it receives id / aria-describedby / aria-invalid. */
  children: ReactElement<ControlProps>;
  required?: boolean;
  error?: string | null;
  hint?: ReactNode;
  className?: string;
  id?: string;
  /** Visually hide the label (still read by screen readers). */
  hideLabel?: boolean;
};

/** Label + control + hint + error with correct ARIA wiring. */
export function FormField({ label, children, required, error, hint, className, id, hideLabel }: FormFieldProps) {
  const autoId = useId();
  const controlId = id ?? children.props.id ?? `f${autoId}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [children.props['aria-describedby'], hintId, errorId].filter(Boolean).join(' ') || undefined;

  const control = isValidElement(children)
    ? cloneElement(children, {
        id: controlId,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        'aria-required': required || undefined,
      })
    : children;

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <Label htmlFor={controlId} required={required} className={hideLabel ? 'sr-only' : undefined}>
        {label}
      </Label>
      {control}
      {hint && !error && (
        <div id={hintId} className="text-xs text-fg-subtle">
          {hint}
        </div>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-red-fg">
          {error}
        </p>
      )}
    </div>
  );
}

/** Form-level error (e.g. RHF `errors.root.server`). */
export function FormError({ message, className }: { message?: string | null; className?: string }) {
  if (!message) return null;
  return (
    <div role="alert" className={cn('rounded-md border border-red-border bg-red-bg px-3 py-2 text-[13px] text-red-fg', className)}>
      {message}
    </div>
  );
}
