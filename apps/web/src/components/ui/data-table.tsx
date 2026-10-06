'use client';

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowData,
  type RowSelectionState,
  type VisibilityState,
} from '@tanstack/react-table';
import { Settings2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocalStorage } from '@/lib/hooks/use-local-storage';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Checkbox } from './checkbox';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger,
} from './dropdown-menu';
import { Pagination } from './pagination';
import { Skeleton } from './skeleton';
import { EmptyState, ErrorState } from './states';
import { Table, TableContainer, TBody, TD, TH, THead, TR } from './table';

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Name in the column settings menu (defaults to the column id). */
    label?: string;
    /** Control rendered in the filter row under the header. */
    filter?: ReactNode;
    className?: string;
    headerClassName?: string;
    /** Set false to keep the column out of the visibility menu. */
    hideable?: boolean;
  }
}

export type Selection = { ids: string[]; allMatching: boolean };

export type DataTableProps<T> = {
  columns: ColumnDef<T, unknown>[];
  /** Rows of the current page. */
  data: T[] | undefined;
  getRowId: (row: T) => string;
  /** Accessible name of the table. */
  label: string;
  /** Server-side pagination (API `Page<T>`). Omit for a client list without pagination. */
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
    onPageSizeChange?: (size: number) => void;
  };
  isLoading?: boolean;
  isFetching?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Enables row checkboxes and the bulk action bar. */
  bulkActions?: (selection: Selection, clear: () => void) => ReactNode;
  /** Allow "select all N matching" beyond the current page. */
  allowSelectAllMatching?: boolean;
  toolbar?: ReactNode;
  toolbarRight?: ReactNode;
  /** localStorage key to remember hidden columns. */
  columnVisibilityKey?: string;
  initialHidden?: string[];
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  skeletonRows?: number;
  maxHeight?: string;
  className?: string;
};

const SELECT_COL = '__select__';

export function DataTable<T>({
  columns,
  data,
  getRowId,
  label,
  pagination,
  isLoading,
  isFetching,
  error,
  onRetry,
  bulkActions,
  allowSelectAllMatching = true,
  toolbar,
  toolbarRight,
  columnVisibilityKey,
  initialHidden = [],
  empty,
  onRowClick,
  skeletonRows = 8,
  maxHeight = 'min(72dvh, 760px)',
  className,
}: DataTableProps<T>) {
  const t = useTranslations('table');
  const selectable = Boolean(bulkActions);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [allMatching, setAllMatching] = useState(false);
  const [hidden, setHidden] = useLocalStorage<string[]>(
    columnVisibilityKey ? `akere.cols.${columnVisibilityKey}` : undefined,
    initialHidden,
  );
  const columnVisibility = useMemo<VisibilityState>(() => Object.fromEntries(hidden.map((id) => [id, false])), [hidden]);

  const allColumns = useMemo<ColumnDef<T, unknown>[]>(() => {
    if (!selectable) return columns;
    const select: ColumnDef<T, unknown> = {
      id: SELECT_COL,
      enableHiding: false,
      meta: { hideable: false, className: 'w-10 !pr-0', headerClassName: 'w-10 !pr-0' },
      header: ({ table }) => (
        <Checkbox
          aria-label={t('selectPage')}
          checked={table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? 'indeterminate' : false}
          onCheckedChange={(v) => {
            table.toggleAllPageRowsSelected(v === true);
            if (v !== true) setAllMatching(false);
          }}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label={t('selectRow')}
          checked={row.getIsSelected()}
          onClick={(e) => e.stopPropagation()}
          onCheckedChange={(v) => {
            row.toggleSelected(v === true);
            if (v !== true) setAllMatching(false);
          }}
        />
      ),
    };
    return [select, ...columns];
  }, [columns, selectable, t]);

  const table = useReactTable({
    data: data ?? [],
    columns: allColumns,
    getRowId: (row) => getRowId(row),
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualFiltering: true,
    manualSorting: true,
    enableRowSelection: selectable,
    state: { rowSelection, columnVisibility },
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: (updater) => {
      const next = typeof updater === 'function' ? updater(columnVisibility) : updater;
      setHidden(Object.entries(next).filter(([, v]) => v === false).map(([k]) => k));
    },
  });

  const selectedIds = Object.keys(rowSelection).filter((k) => rowSelection[k]);
  const clear = () => {
    setRowSelection({});
    setAllMatching(false);
  };
  // Leaving "select all matching" mode when the result set changes (filters/page size).
  const total = pagination?.total;
  useEffect(() => {
    setAllMatching(false);
  }, [total]);

  const leafColumns = table.getVisibleLeafColumns();
  const hasFilters = leafColumns.some((c) => c.columnDef.meta?.filter);
  const hideableColumns = table.getAllLeafColumns().filter((c) => c.id !== SELECT_COL && c.columnDef.meta?.hideable !== false && c.getCanHide());
  const rows = table.getRowModel().rows;
  const showSkeleton = isLoading && rows.length === 0;
  const showError = Boolean(error) && rows.length === 0 && !isLoading;
  const showEmpty = !isLoading && !error && rows.length === 0;
  const selectedCount = allMatching && total !== undefined ? total : selectedIds.length;

  const settingsMenu = hideableColumns.length > 0 && (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label={t('columns')}>
          <Settings2 />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>{t('columns')}</DropdownMenuLabel>
        {hideableColumns.map((c) => (
          <DropdownMenuCheckboxItem
            key={c.id}
            checked={c.getIsVisible()}
            onCheckedChange={(v) => c.toggleVisibility(v === true)}
            onSelect={(e) => e.preventDefault()}
          >
            {c.columnDef.meta?.label ?? c.id}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      {selectable && selectedCount > 0 ? (
        <div
          role="region"
          aria-label={t('bulkBar')}
          className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-primary/20 bg-primary-soft px-3 py-1.5 text-[13px]"
        >
          <span className="font-semibold text-fg tabular" aria-live="polite">
            {t('selected', { count: selectedCount })}
          </span>
          {allowSelectAllMatching && total !== undefined && !allMatching && total > selectedIds.length && (
            <button
              type="button"
              className="focus-ring rounded font-medium text-primary hover:underline"
              onClick={() => {
                table.toggleAllPageRowsSelected(true);
                setAllMatching(true);
              }}
            >
              {t('selectAll', { total })}
            </button>
          )}
          <span className="hidden h-4 w-px bg-primary/20 sm:block" aria-hidden />
          <div className="flex flex-wrap items-center gap-2">{bulkActions?.({ ids: selectedIds, allMatching }, clear)}</div>
          <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={clear} aria-label={t('clearSelection')}>
            <X />
          </Button>
        </div>
      ) : (
        (toolbar || toolbarRight || settingsMenu) && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{toolbar}</div>
            <div className="flex items-center gap-2">
              {toolbarRight}
              {settingsMenu}
            </div>
          </div>
        )
      )}

      <div className="relative overflow-hidden rounded-xl border border-border bg-surface shadow-card">
        {isFetching && !isLoading && (
          <div className="absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden" role="presentation">
            <div className="h-full w-1/3 animate-indeterminate bg-primary" />
          </div>
        )}
        <TableContainer style={{ maxHeight }}>
          <Table aria-label={label} aria-busy={isLoading || undefined}>
            <THead sticky>
              {table.getHeaderGroups().map((hg) => (
                <TR key={hg.id}>
                  {hg.headers.map((h) => (
                    <TH key={h.id} className={h.column.columnDef.meta?.headerClassName}>
                      {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                    </TH>
                  ))}
                </TR>
              ))}
              {hasFilters && (
                <TR>
                  {leafColumns.map((c) => (
                    <th
                      key={c.id}
                      className="border-b border-border bg-surface px-2 py-1.5 align-middle font-normal first:pl-3 last:pr-3"
                    >
                      {c.columnDef.meta?.filter ?? null}
                    </th>
                  ))}
                </TR>
              )}
            </THead>
            <TBody>
              {showSkeleton &&
                Array.from({ length: skeletonRows }, (_, i) => (
                  <TR key={`s${i}`}>
                    {leafColumns.map((c, j) => (
                      <TD key={c.id}>
                        <Skeleton className={cn('h-3.5', j === 0 && selectable ? 'w-4' : j % 3 === 0 ? 'w-3/4' : 'w-1/2')} />
                      </TD>
                    ))}
                  </TR>
                ))}
              {rows.map((row) => (
                <TR
                  key={row.id}
                  data-state={row.getIsSelected() ? 'selected' : undefined}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={cn(
                    'transition-colors hover:bg-surface-muted data-[state=selected]:bg-primary-soft/60',
                    onRowClick && 'cursor-pointer',
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TD key={cell.id} className={cell.column.columnDef.meta?.className}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TD>
                  ))}
                </TR>
              ))}
            </TBody>
          </Table>
          {showError && <ErrorState error={error} onRetry={onRetry} compact />}
          {showEmpty && (empty ?? <EmptyState title={t('empty')} description={t('emptyHint')} compact />)}
        </TableContainer>
      </div>

      {pagination && (pagination.total > 0 || pagination.page > 1) && (
        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          onPageChange={pagination.onPageChange}
          onPageSizeChange={pagination.onPageSizeChange}
        />
      )}
    </div>
  );
}
