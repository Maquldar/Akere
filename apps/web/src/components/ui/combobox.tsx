'use client';

import { Check, ChevronDown, Loader2, Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { forwardRef, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useDebounced } from '@/lib/hooks/use-debounced';
import { cn } from '@/lib/utils';
import { Popover, PopoverAnchor, PopoverContent } from './popover';

export type ComboOption = { value: string; label: string; description?: string; disabled?: boolean };

type SharedProps = {
  /** Static options (filtered client-side by label/description). */
  options?: ComboOption[];
  /** Async options; called with the (debounced) search text. */
  loadOptions?: (q: string, signal: AbortSignal) => Promise<ComboOption[]>;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  size?: 'sm' | 'md';
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  'aria-required'?: boolean;
};

export type ComboboxProps = SharedProps & {
  value: string | null | undefined;
  onChange: (value: string | null, option: ComboOption | null) => void;
  /** Label of the current value when it is not among the loaded options (async). */
  selectedOption?: ComboOption | null;
  clearable?: boolean;
};

export type MultiSelectProps = SharedProps & {
  value: string[];
  onChange: (values: string[], options: ComboOption[]) => void;
  selectedOptions?: ComboOption[];
  maxChips?: number;
};

function useOptionSource(
  open: boolean,
  query: string,
  options: ComboOption[] | undefined,
  loadOptions: SharedProps['loadOptions'],
) {
  const debounced = useDebounced(query, 250);
  const [remote, setRemote] = useState<ComboOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!loadOptions || !open) return;
    const ctrl = new AbortController();
    setLoading(true);
    setFailed(false);
    loadOptions(debounced, ctrl.signal)
      .then((res) => setRemote(res))
      .catch((e: unknown) => {
        if ((e as { name?: string })?.name !== 'AbortError') setFailed(true);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [debounced, loadOptions, open]);

  const list = useMemo(() => {
    if (loadOptions) return remote;
    const q = query.trim().toLocaleLowerCase();
    if (!q) return options ?? [];
    return (options ?? []).filter(
      (o) => o.label.toLocaleLowerCase().includes(q) || o.description?.toLocaleLowerCase().includes(q),
    );
  }, [loadOptions, remote, options, query]);

  return { list, loading, failed };
}

function OptionList({
  listId,
  list,
  active,
  setActive,
  isSelected,
  onPick,
  loading,
  failed,
  emptyText,
  multi,
}: {
  multi?: boolean;
  listId: string;
  list: ComboOption[];
  active: number;
  setActive: (i: number) => void;
  isSelected: (v: string) => boolean;
  onPick: (o: ComboOption) => void;
  loading: boolean;
  failed: boolean;
  emptyText?: string;
}) {
  const t = useTranslations('common');
  const refs = useRef<(HTMLLIElement | null)[]>([]);
  useEffect(() => {
    refs.current[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <ul id={listId} role="listbox" aria-multiselectable={multi || undefined} className="max-h-64 overflow-y-auto p-1">
      {loading && list.length === 0 && (
        <li className="flex items-center gap-2 px-2 py-2 text-sm text-fg-subtle" role="presentation">
          <Loader2 className="size-4 animate-spin" aria-hidden /> {t('loading')}
        </li>
      )}
      {failed && (
        <li className="px-2 py-2 text-sm text-red-fg" role="presentation">
          {t('loadFailed')}
        </li>
      )}
      {!loading && !failed && list.length === 0 && (
        <li className="px-2 py-2 text-sm text-fg-subtle" role="presentation">
          {emptyText ?? t('nothingFound')}
        </li>
      )}
      {list.map((o, i) => {
        const selected = isSelected(o.value);
        return (
          <li
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={selected}
            aria-disabled={o.disabled || undefined}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => !o.disabled && onPick(o)}
            className={cn(
              'flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm',
              i === active && 'bg-surface-hover',
              o.disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center">
              {selected && <Check className="size-4 text-primary" aria-hidden />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-fg">{o.label}</span>
              {o.description && <span className="block truncate text-xs text-fg-subtle">{o.description}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function useListKeyboard(list: ComboOption[], onPick: (o: ComboOption) => void, close: () => void) {
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [list]);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(list.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Home') {
      setActive(0);
    } else if (e.key === 'End') {
      setActive(Math.max(0, list.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = list[active];
      if (o && !o.disabled) onPick(o);
    } else if (e.key === 'Escape') {
      close();
    }
  };
  return { active, setActive, onKeyDown };
}

const triggerBase =
  'focus-ring flex w-full min-w-0 items-center gap-2 rounded-md border border-border bg-surface px-3 text-left text-sm text-fg transition-colors hover:border-border-strong disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-fg-subtle aria-[invalid=true]:border-red-solid';

function SearchBox({
  inputRef,
  value,
  onChange,
  onKeyDown,
  listId,
  activeId,
  placeholder,
  loading,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  listId: string;
  activeId?: string;
  placeholder?: string;
  loading?: boolean;
}) {
  const t = useTranslations('common');
  return (
    <div className="flex items-center gap-2 border-b border-border px-2.5">
      <Search className="size-4 shrink-0 text-fg-subtle" aria-hidden />
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-label={placeholder ?? t('search')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder ?? t('search')}
        className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-subtle"
      />
      {loading && <Loader2 className="size-4 animate-spin text-fg-subtle" aria-hidden />}
    </div>
  );
}

/** Searchable single select (static or async options). */
export const Combobox = forwardRef<HTMLButtonElement, ComboboxProps>(function Combobox(
  {
    value, onChange, options, loadOptions, selectedOption, placeholder, searchPlaceholder, emptyText,
    disabled, id, className, size = 'md', clearable = true, ...aria
  },
  ref,
) {
  const t = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [known, setKnown] = useState<Record<string, ComboOption>>({});
  const { list, loading, failed } = useOptionSource(open, query, options, loadOptions);

  useEffect(() => {
    if (list.length) setKnown((k) => ({ ...k, ...Object.fromEntries(list.map((o) => [o.value, o])) }));
  }, [list]);

  const current = value
    ? (options?.find((o) => o.value === value) ?? known[value] ?? (selectedOption?.value === value ? selectedOption : null))
    : null;

  const pick = (o: ComboOption) => {
    onChange(o.value, o);
    setOpen(false);
    setQuery('');
  };
  const kb = useListKeyboard(list, pick, () => setOpen(false));

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery('');
      }}
    >
      <PopoverAnchor asChild>
        <div className={cn('relative min-w-0', className)}>
          <button
            ref={ref}
            id={id}
            type="button"
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={open}
            {...aria}
            onClick={() => setOpen((o) => !o)}
            className={cn(triggerBase, size === 'sm' ? 'h-8' : 'h-9', clearable && current ? 'pr-14' : 'pr-8')}
          >
            <span className={cn('min-w-0 flex-1 truncate', !current && 'text-fg-subtle')}>
              {current ? current.label : (placeholder ?? t('select'))}
            </span>
          </button>
          <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center">
            <ChevronDown className="size-4 text-fg-subtle" aria-hidden />
          </span>
          {clearable && current && !disabled && (
            <button
              type="button"
              onClick={() => onChange(null, null)}
              aria-label={t('clear')}
              className="focus-ring absolute inset-y-0 right-7 my-auto inline-flex size-5 items-center justify-center rounded text-fg-subtle hover:text-fg"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] min-w-[240px] p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <SearchBox
          inputRef={inputRef}
          value={query}
          onChange={setQuery}
          onKeyDown={kb.onKeyDown}
          listId={listId}
          activeId={list[kb.active] ? `${listId}-${kb.active}` : undefined}
          placeholder={searchPlaceholder}
          loading={loading && list.length > 0}
        />
        <OptionList
          listId={listId}
          list={list}
          active={kb.active}
          setActive={kb.setActive}
          isSelected={(v) => v === value}
          onPick={pick}
          loading={loading}
          failed={failed}
          emptyText={emptyText}
        />
      </PopoverContent>
    </Popover>
  );
});

/** Searchable multi select with removable chips (M1 p8 "Кандидат" picker). */
export const MultiSelect = forwardRef<HTMLDivElement, MultiSelectProps>(function MultiSelect(
  {
    value, onChange, options, loadOptions, selectedOptions, placeholder, searchPlaceholder, emptyText,
    disabled, id, className, size = 'md', maxChips = 20, ...aria
  },
  ref,
) {
  const t = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [known, setKnown] = useState<Record<string, ComboOption>>(() =>
    Object.fromEntries((selectedOptions ?? []).map((o) => [o.value, o])),
  );
  const { list, loading, failed } = useOptionSource(open, query, options, loadOptions);

  useEffect(() => {
    if (list.length) setKnown((k) => ({ ...k, ...Object.fromEntries(list.map((o) => [o.value, o])) }));
  }, [list]);

  const resolve = (v: string): ComboOption =>
    options?.find((o) => o.value === v) ?? known[v] ?? selectedOptions?.find((o) => o.value === v) ?? { value: v, label: v };

  const selected = value.map(resolve);

  const toggle = (o: ComboOption) => {
    const next = value.includes(o.value) ? value.filter((v) => v !== o.value) : [...value, o.value];
    onChange(next, next.map(resolve));
  };
  const remove = (v: string) => {
    const next = value.filter((x) => x !== v);
    onChange(next, next.map(resolve));
  };
  const kb = useListKeyboard(list, toggle, () => setOpen(false));
  const shown = selected.slice(0, maxChips);
  const hidden = selected.length - shown.length;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery('');
      }}
    >
      <PopoverAnchor asChild>
        <div
          ref={ref}
          className={cn(
            triggerBase,
            'relative flex-wrap py-1 pr-9',
            size === 'sm' ? 'min-h-8' : 'min-h-9',
            disabled && 'pointer-events-none bg-surface-muted',
            className,
          )}
          aria-invalid={aria['aria-invalid']}
        >
          {shown.map((o) => (
            <span
              key={o.value}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-surface-hover py-0.5 pl-2 pr-0.5 text-xs font-medium text-fg"
            >
              <span className="truncate">{o.label}</span>
              <button
                type="button"
                onClick={() => remove(o.value)}
                disabled={disabled}
                aria-label={t('removeItem', { name: o.label })}
                className="focus-ring inline-flex size-4 items-center justify-center rounded text-fg-subtle hover:bg-surface-active hover:text-fg"
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}
          {hidden > 0 && <span className="text-xs text-fg-subtle">+{hidden}</span>}
          <button
            id={id}
            type="button"
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={open}
            {...aria}
            onClick={() => setOpen((o) => !o)}
            className="min-w-[80px] flex-1 self-stretch bg-transparent text-left text-sm text-fg-subtle outline-none focus-visible:outline-none"
          >
            {selected.length === 0 ? (placeholder ?? t('select')) : <span className="sr-only">{t('addMore')}</span>}
          </button>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
        </div>
      </PopoverAnchor>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] min-w-[260px] p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <SearchBox
          inputRef={inputRef}
          value={query}
          onChange={setQuery}
          onKeyDown={kb.onKeyDown}
          listId={listId}
          activeId={list[kb.active] ? `${listId}-${kb.active}` : undefined}
          placeholder={searchPlaceholder}
          loading={loading && list.length > 0}
        />
        <OptionList
          listId={listId}
          list={list}
          active={kb.active}
          setActive={kb.setActive}
          multi
          isSelected={(v) => value.includes(v)}
          onPick={toggle}
          loading={loading}
          failed={failed}
          emptyText={emptyText}
        />
      </PopoverContent>
    </Popover>
  );
});
