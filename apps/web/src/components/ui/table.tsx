import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/** Scroll container: tables scroll horizontally inside it, never the page. */
export function TableContainer({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('relative w-full overflow-auto', className)} {...props} />;
}

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full border-separate border-spacing-0 text-left text-[13px]', className)} {...props} />;
}

export function THead({ className, sticky, ...props }: HTMLAttributes<HTMLTableSectionElement> & { sticky?: boolean }) {
  return <thead className={cn(sticky && 'sticky top-0 z-10', className)} {...props} />;
}

export function TBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function TR({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('group/row', className)} {...props} />;
}

export function TH({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        'section-label h-9 whitespace-nowrap border-b border-border bg-surface-muted px-3 align-middle font-medium first:pl-4 last:pr-4',
        className,
      )}
      {...props}
    />
  );
}

export function TD({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn(
        'h-12 border-b border-border px-3 py-2 align-middle text-fg first:pl-4 last:pr-4 group-last/row:border-b-0',
        className,
      )}
      {...props}
    />
  );
}
