/*
 * Copyright 2025 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useEffect, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ListFilter } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { Input } from '@roadiehq/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@roadiehq/ui/popover';
import { cn } from '@roadiehq/ui/utils';
import { useDatastore } from '../../../../api';
import { workspaceQueryKey } from '../../../../api/workspace-scope';

const FILTER_SUGGESTION_LIMIT = 20;
const FILTER_QUERY_DEBOUNCE_MS = 200;
// Stable empty reference so the highlight/keydown logic doesn't churn while the
// suggestions query is idle or unresolved.
const EMPTY_SUGGESTIONS: string[] = [];

/**
 * Typeahead value filter opened from a column header. Candidate values come
 * from the backend `/indexes/:datasourceId/:key/values?q=…` endpoint so the
 * user can only pick a value that's guaranteed to match at least one record.
 *
 * Deliberately not `Autocomplete` or `Combobox`: both are free-text fields
 * whose `onChange` is the committed value, and both re-filter `options`
 * client-side. Here the set is closed (a half-typed string is not a filter) and
 * the matching is the server's, so client-side `includes()` would hide values
 * the backend legitimately returned. It follows the same ARIA combobox pattern
 * they do.
 */
export function ColumnFilterPopover({
  label,
  value,
  onChange,
  datasourceId,
  indexKey,
  useContextGroupSuggestions = false,
}: {
  label: string;
  value: string | undefined;
  onChange: (next: string) => void;
  datasourceId: string;
  indexKey: string;
  useContextGroupSuggestions?: boolean;
}) {
  const api = useDatastore();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [debouncedDraft, setDebouncedDraft] = useState('');
  const [highlight, setHighlight] = useState(0);
  const active = Boolean(value);
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;

  // Fresh draft (and highlight) each time the popover opens — the user comes
  // back to browse from the top of the candidate list rather than to keep
  // typing where they left off.
  useEffect(() => {
    if (open) {
      setDraft('');
      setDebouncedDraft('');
      setHighlight(0);
    }
  }, [open]);

  // Debounce the input so we don't hit the server on every keystroke.
  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedDraft(draft),
      FILTER_QUERY_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [draft]);

  // Candidate values for the current (debounced) query while the popover is
  // open. Keyed on every input, so a stale response lands on its own cache
  // entry and can't overwrite the active one — no request-id guard needed.
  const suggestionsQuery = useQuery({
    queryKey: workspaceQueryKey(
      'datastore',
      useContextGroupSuggestions ? 'contextGroupTitles' : 'indexValues',
      datasourceId,
      indexKey,
      debouncedDraft,
    ),
    queryFn: () =>
      useContextGroupSuggestions
        ? api.listContextGroupTitles(datasourceId, {
            q: debouncedDraft || undefined,
            limit: FILTER_SUGGESTION_LIMIT,
          })
        : api.listIndexValues(datasourceId, indexKey, {
            q: debouncedDraft || undefined,
            limit: FILTER_SUGGESTION_LIMIT,
          }),
    enabled: open,
  });
  const suggestions = suggestionsQuery.data ?? EMPTY_SUGGESTIONS;
  const hasSuggestions = suggestions.length > 0;
  const loading = suggestionsQuery.isFetching;

  // Reset the keyboard highlight to the top whenever the candidate set changes.
  useEffect(() => {
    setHighlight(0);
  }, [debouncedDraft]);

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  const clear = () => {
    onChange('');
    setOpen(false);
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight(h => Math.min(h + 1, Math.max(suggestions.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const selected = suggestions.at(highlight);
      if (selected) {
        pick(selected);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            'size-7',
            active
              ? 'text-primary opacity-100'
              : 'motion-opacity text-muted-foreground/60 opacity-0 group-hover/header:opacity-100 focus:opacity-100 data-[state=open]:opacity-100',
          )}
          aria-label={active ? `Filter ${label}: ${value}` : `Filter ${label}`}
          data-filter-active={active ? 'true' : undefined}
        >
          <ListFilter
            className={cn('size-3.5', active && 'fill-current/30')}
            aria-hidden
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-2 p-3">
        <div>
          <div className="text-xs font-medium text-foreground">
            Filter “{label}”
          </div>
          <div className="text-2xs text-muted-foreground">
            {active ? `Current: ${value}` : 'Pick a value'}
          </div>
        </div>
        <Input
          // Radix's PopoverContent auto-focuses the first focusable child on open.
          // The full ARIA 1.2 combobox wiring: focus never leaves this input, so
          // `aria-activedescendant` is what tells a screen reader which candidate
          // the arrow keys are on. Without it the highlight is purely visual.
          role="combobox"
          // The listbox only exists once there are candidates, so the expanded
          // state and `aria-controls` follow it. Claiming expanded while the
          // popup is a "Loading…"/"No matching values" message points
          // `aria-controls` at an id that isn't in the document.
          aria-expanded={hasSuggestions}
          aria-autocomplete="list"
          aria-controls={hasSuggestions ? listId : undefined}
          aria-activedescendant={
            hasSuggestions ? optionId(highlight) : undefined
          }
          autoComplete="off"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="Type to search…"
          className="h-8 text-sm"
        />
        <div className="max-h-56 overflow-auto rounded-md border border-border bg-background">
          {!hasSuggestions ? (
            // With no listbox to point at, this message is the only thing that
            // explains the collapsed combobox — announce it.
            <div
              role="status"
              className="px-2 py-1.5 text-xs text-muted-foreground"
            >
              {loading
                ? 'Loading…'
                : debouncedDraft
                  ? 'No matching values'
                  : 'No indexed values yet'}
            </div>
          ) : (
            // `role="listbox"` belongs on the element that owns the options —
            // an intervening `ul` between listbox and option breaks the required
            // parent/child relationship.
            <ul
              id={listId}
              role="listbox"
              aria-label={`Values for ${label}`}
              className="py-0.5"
            >
              {suggestions.map((suggestion, index) => {
                const isCurrent = suggestion === value;
                const isHighlighted = index === highlight;
                return (
                  // ARIA listbox pattern: focus stays on the input which owns
                  // ArrowUp/Down/Enter; each option is mouse/touch only here,
                  // so the click-events-have-key-events lint rule is N/A.
                  // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                  <li
                    key={suggestion}
                    id={optionId(index)}
                    role="option"
                    // `aria-selected` marks the applied filter; the arrow-key
                    // position is carried by aria-activedescendant above.
                    aria-selected={isCurrent}
                    className={cn(
                      'cursor-pointer truncate px-2 py-1 text-xs',
                      isHighlighted && 'bg-accent text-accent-foreground',
                      isCurrent && !isHighlighted && 'font-medium',
                    )}
                    // `mousedown.preventDefault` keeps focus on the input so
                    // keyboard nav stays usable after a click-hover-click.
                    onMouseDown={event => event.preventDefault()}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => pick(suggestion)}
                  >
                    {suggestion}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {active ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clear}
            className="w-full justify-center"
          >
            Clear filter
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
