'use client';

import { Accordion as AccordionPrimitive } from 'radix-ui';
import { ChevronDown } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const Accordion = AccordionPrimitive.Root;

export function AccordionItem({ className, ...props }: ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>) {
  return <AccordionPrimitive.Item className={cn('border-b border-border last:border-b-0', className)} {...props} />;
}

export function AccordionTrigger({ className, children, extra, ...props }: ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger> & { extra?: ReactNode }) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        className={cn(
          'focus-ring group flex flex-1 items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-fg hover:bg-surface-muted',
          className,
        )}
        {...props}
      >
        <span className="min-w-0 flex-1">{children}</span>
        {extra}
        <ChevronDown className="size-4 shrink-0 text-fg-subtle transition-transform group-data-[state=open]:rotate-180" aria-hidden />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

export function AccordionContent({ className, ...props }: ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>) {
  return <AccordionPrimitive.Content className={cn('px-4 pb-4 text-sm text-fg-muted', className)} {...props} />;
}
