'use client';

import { Tabs as TabsPrimitive } from 'radix-ui';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { CountBadge } from './badge';

export const Tabs = TabsPrimitive.Root;

/** Pill-style segmented tabs (M4 "Сегодня / Отметки / Запросы / Форма Т-13"). */
export function TabsList({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return (
    <div className="-mx-1 max-w-full overflow-x-auto px-1 py-0.5">
      <TabsPrimitive.List
        className={cn('inline-flex items-center gap-0.5 rounded-lg bg-surface-hover p-1', className)}
        {...props}
      />
    </div>
  );
}

export function TabsTrigger({
  className,
  children,
  count,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & { count?: number; children: ReactNode }) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'focus-ring inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[13px] font-medium text-fg-muted transition-colors hover:text-fg data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-[0_1px_2px_rgb(16_24_40/0.08)]',
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined && <CountBadge value={count} />}
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('mt-4 focus-visible:outline-none', className)} {...props} />;
}
