'use client';

import { DropdownMenu as Menu } from 'radix-ui';
import { Check } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;

export function DropdownMenuContent({
  className,
  align = 'end',
  sideOffset = 4,
  ...props
}: ComponentPropsWithoutRef<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        align={align}
        sideOffset={sideOffset}
        className={cn('z-50 min-w-[200px] rounded-lg border border-border bg-surface p-1 shadow-pop animate-fade-in', className)}
        {...props}
      />
    </Menu.Portal>
  );
}

const itemBase =
  'relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm text-fg outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-surface-hover data-[disabled]:text-fg-subtle [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-subtle';

export function DropdownMenuItem({
  className,
  danger,
  ...props
}: ComponentPropsWithoutRef<typeof Menu.Item> & { danger?: boolean }) {
  return <Menu.Item className={cn(itemBase, danger && 'text-red-fg [&_svg]:text-red-fg', className)} {...props} />;
}

export function DropdownMenuCheckboxItem({ className, children, ...props }: ComponentPropsWithoutRef<typeof Menu.CheckboxItem>) {
  return (
    <Menu.CheckboxItem className={cn(itemBase, 'pl-8', className)} {...props}>
      <span className="absolute left-2 inline-flex size-4 items-center justify-center">
        <Menu.ItemIndicator>
          <Check className="!text-primary" />
        </Menu.ItemIndicator>
      </span>
      {children}
    </Menu.CheckboxItem>
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentPropsWithoutRef<typeof Menu.Label>) {
  return <Menu.Label className={cn('section-label px-2 pb-1 pt-2', className)} {...props} />;
}

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <Menu.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} />;
}

export function DropdownMenuShortcut({ children }: { children: ReactNode }) {
  return <span className="ml-auto text-xs text-fg-subtle">{children}</span>;
}
