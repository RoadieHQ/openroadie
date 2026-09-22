import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { Input } from '@roadiehq/ui/input';
import { Button } from '@roadiehq/ui/button';
import { IntegrationLogo } from '@roadiehq/ui/item-list';
import { Popover, PopoverAnchor, PopoverContent } from '@roadiehq/ui/popover';
import { Spinner } from '@roadiehq/ui/spinner';
import { cn } from '@roadiehq/ui/utils';
import { useDatastore } from '../../../../api';
import { workspaceQueryKey } from '../../../../api/workspace-scope';
import type { DataSourceItem } from '../../types';
import { resolveObjectDisplayName } from '../resolve-object-display-name';
import { objectGraphNodeId, type ObjectGraphFocus } from './object-graph-focus';

const SEARCH_DEBOUNCE_MS = 250;
const RESULT_LIMIT = 20;

export interface ObjectSearchPickerProps {
  value: ObjectGraphFocus | null;
  onChange: (focus: ObjectGraphFocus | null) => void;
  onIntent?: (focus: ObjectGraphFocus) => void;
  /** Datasource scope for the search; empty = all. */
  datasourceIds: readonly string[];
  dataSources: DataSourceItem[];
  placeholder?: string;
  /** Display label for a value that arrived via URL (no selection event). */
  valueLabel?: string;
  clearable?: boolean;
  focusOnMount?: boolean;
  className?: string;
  'aria-label': string;
}

/**
 * Async cross-datasource object typeahead: an input over the full-text
 * `/search` endpoint, rows showing datasource logo + display name +
 * object id. Selecting emits an {@link ObjectGraphFocus}.
 */
export function ObjectSearchPicker({
  value,
  onChange,
  onIntent,
  datasourceIds,
  dataSources,
  placeholder = 'Find an object…',
  valueLabel,
  clearable = true,
  focusOnMount = false,
  className,
  'aria-label': ariaLabel,
}: ObjectSearchPickerProps) {
  const api = useDatastore();
  const [input, setInput] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  // Label of the last picked object, shown while a value is selected.
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(input), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  // Imperative focus instead of the focusOnMount attribute (house pattern —
  // see facet-list.tsx; jsx-a11y/no-autofocus).
  useEffect(() => {
    if (focusOnMount) {
      inputRef.current?.focus();
    }
  }, [focusOnMount]);

  const scopeKey = useMemo(() => [...datasourceIds].sort(), [datasourceIds]);
  const query = useQuery({
    queryKey: workspaceQueryKey('objects', 'searchPicker', debounced, scopeKey),
    queryFn: () =>
      api.searchObjects({
        q: debounced,
        datasourceIds: scopeKey.length > 0 ? scopeKey : undefined,
        limit: RESULT_LIMIT,
      }),
    enabled: debounced.trim().length > 0,
    placeholderData: keepPreviousData,
  });

  const results = useMemo(() => {
    const items = query.data?.items ?? [];
    return items.map(item => ({
      key: objectGraphNodeId(item.datasourceId, item.objectId),
      datasourceId: item.datasourceId,
      objectId: item.objectId,
      label: resolveObjectDisplayName(
        item.object,
        item.objectId,
        item.presentation,
      ),
    }));
  }, [query.data]);

  useEffect(() => {
    setActiveIndex(0);
  }, [results]);

  const dataSourceById = useMemo(
    () => new Map(dataSources.map(ds => [ds.id, ds])),
    [dataSources],
  );

  const select = useCallback(
    (result: { datasourceId: string; objectId: string; label: string }) => {
      setSelectedLabel(result.label);
      setInput('');
      setDebounced('');
      setOpen(false);
      onChange({
        datasourceId: result.datasourceId,
        objectId: result.objectId,
      });
    },
    [onChange],
  );

  const clear = useCallback(() => {
    setSelectedLabel(null);
    setInput('');
    setDebounced('');
    onChange(null);
    inputRef.current?.focus();
  }, [onChange]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (!open || results.length === 0) {
        if (event.key === 'Escape') {
          setOpen(false);
        }
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const nextIndex = Math.min(activeIndex + 1, results.length - 1);
        setActiveIndex(nextIndex);
        const result = results[Number(nextIndex)];
        if (result) {
          onIntent?.(result);
        }
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        const nextIndex = Math.max(activeIndex - 1, 0);
        setActiveIndex(nextIndex);
        const result = results[Number(nextIndex)];
        if (result) {
          onIntent?.(result);
        }
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const active = results[Number(activeIndex)];
        if (active) {
          select(active);
        }
      } else if (event.key === 'Escape') {
        setOpen(false);
      }
    },
    [open, results, activeIndex, select, onIntent],
  );

  const showSelected = value !== null;
  const displayValue = showSelected
    ? (selectedLabel ?? valueLabel ?? value.objectId)
    : input;

  return (
    <Popover open={open && !showSelected} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className={cn('relative', className)}>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={displayValue}
            readOnly={showSelected}
            aria-label={ariaLabel}
            placeholder={placeholder}
            className={cn('h-9 pl-8', showSelected && clearable && 'pr-8')}
            onChange={event => {
              setInput(event.target.value);
              setOpen(event.target.value.trim().length > 0);
            }}
            onFocus={() => {
              if (!showSelected && input.trim().length > 0) {
                setOpen(true);
              }
            }}
            onKeyDown={handleKeyDown}
          />
          {showSelected && clearable && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute top-1/2 right-1 size-6 -translate-y-1/2 p-0 text-muted-foreground"
              aria-label="Clear selected object"
              onClick={clear}
            >
              <X className="size-3.5" />
            </Button>
          )}
          {query.isFetching && !showSelected && (
            <Spinner className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2" />
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[340px] p-1"
        onOpenAutoFocus={event => event.preventDefault()}
      >
        {query.isPending && debounced.trim().length > 0 ? (
          <div className="flex items-center gap-2 px-2.5 py-2 text-sm text-muted-foreground">
            <Spinner className="size-3.5" /> Searching…
          </div>
        ) : query.error ? (
          <div className="px-2.5 py-2 text-sm text-destructive">
            Search failed:{' '}
            {query.error instanceof Error
              ? query.error.message
              : String(query.error)}
          </div>
        ) : results.length === 0 ? (
          <div className="px-2.5 py-2 text-sm text-muted-foreground">
            No matching objects
          </div>
        ) : (
          <ul
            role="listbox"
            aria-label={ariaLabel}
            className="max-h-72 overflow-y-auto"
          >
            {results.map((result, index) => {
              const dataSource = dataSourceById.get(result.datasourceId);
              return (
                <li
                  key={result.key}
                  role="option"
                  aria-selected={index === activeIndex}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    className={cn(
                      'flex h-auto w-full items-center justify-start gap-2 rounded-sm px-2.5 py-1.5 text-left text-sm font-normal shadow-none',
                      index === activeIndex
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-accent/60',
                    )}
                    onFocus={() => onIntent?.(result)}
                    onMouseEnter={() => {
                      setActiveIndex(index);
                      onIntent?.(result);
                    }}
                    onClick={() => select(result)}
                  >
                    <IntegrationLogo
                      src={dataSource?.logoUrl ?? ''}
                      size={18}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{result.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {dataSource?.name ?? result.datasourceId.slice(0, 8)}
                        {' · '}
                        {result.objectId}
                      </span>
                    </span>
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
