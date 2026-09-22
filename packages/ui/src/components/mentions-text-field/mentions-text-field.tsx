import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Popover, PopoverAnchor, PopoverContent } from '../popover';
import { Input } from '../input';
import { Textarea } from '../textarea';
import {
  type BaseSuggestionData,
  defaultDisplayTransform,
  DefaultMarkupTemplate,
  DefaultTrigger,
  type MentionData,
  type SuggestionData,
  type SuggestionDataSource,
  type SuggestionsQueryInfo,
} from './types';
import {
  applyChangeToValue,
  findStartOfMentionInPlainText,
  getDataProvider,
  getEndOfLastMention,
  getMentions,
  getPlainText,
  isNumber,
  makeMentionsMarkup,
  makeTriggerRegex,
  mapPlainTextIndex,
  spliceString,
} from './utils';

interface MentionsTextFieldProps<T extends BaseSuggestionData> {
  /** Markup value (mentions stored as `@[display](id)` tokens), not the plain text the user sees. */
  value?: string;
  defaultValue?: string;
  /** Receives the markup value, the rendered plain text, and the parsed mentions. */
  onChange?: (
    newValue: string,
    newPlainText: string,
    mentions: MentionData[],
  ) => void;
  /** One source per trigger character (default `@`); each provides suggestions and controls the mention markup/display. */
  dataSources: SuggestionDataSource<T>[];
  placeholder?: string;
  className?: string;
  size?: 'small' | 'medium';
  fullWidth?: boolean;
  multiline?: boolean;
  minRows?: number;
}

/**
 * Text field with trigger-character mention autocomplete (like an `@`-mention
 * box). Typing a data source's trigger opens a suggestions popover; picked
 * mentions are stored as markup in `value` while the input shows plain text.
 * Renders a single-line Input or a Textarea depending on `multiline`.
 */
export function MentionsTextField<T extends BaseSuggestionData>({
  value: controlledValue,
  defaultValue,
  onChange: onChangeProp,
  dataSources,
  placeholder,
  className,
  fullWidth,
  multiline,
  minRows,
}: MentionsTextFieldProps<T>) {
  const [stateValue, setStateValue] = useState(defaultValue || '');
  const [inputRef, setInputRef] = useState<
    HTMLInputElement | HTMLTextAreaElement | null
  >(null);
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<number | null>(null);

  const finalValue =
    controlledValue !== undefined ? controlledValue : stateValue;
  const onChange = onChangeProp || setStateValue;

  const listRef = useRef<HTMLUListElement>(null);
  const [suggestions, setSuggestions] = useState<
    Map<
      number,
      { results: SuggestionData<T>[]; queryInfo: SuggestionsQueryInfo }
    >
  >(() => new Map());
  const [focusIndex, setFocusIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  const allResults = useMemo(
    () =>
      Array.from(suggestions.values()).flatMap(({ results, queryInfo }) =>
        results.map(r => ({ result: r, queryInfo })),
      ),
    [suggestions],
  );

  const isOpen =
    selectionStart !== null &&
    selectionStart === selectionEnd &&
    (loading || allResults.length > 0);

  // Restore cursor position after re-render
  useEffect(() => {
    if (
      !inputRef ||
      (inputRef.selectionStart === selectionStart &&
        inputRef.selectionEnd === selectionEnd)
    ) {
      return;
    }
    inputRef.setSelectionRange(selectionStart, selectionEnd);
  }, [selectionStart, selectionEnd, inputRef]);

  const addMention = useCallback(
    (suggestion: SuggestionData<T>, queryInfo: SuggestionsQueryInfo) => {
      // queryInfo.childIndex is always >= 0 (set from forEach iteration
      // over dataSources), so .at() is safe here without a negative guard.
      const dataSource =
        queryInfo.childIndex >= 0
          ? dataSources.at(queryInfo.childIndex)
          : undefined;
      if (!dataSource) return;
      const { markup, displayTransform, appendSpaceOnAdd, onAdd } = dataSource;

      const start = mapPlainTextIndex(
        finalValue,
        dataSources,
        queryInfo.querySequenceStart,
        'START',
      );
      if (!isNumber(start)) return;

      const end =
        start + queryInfo.querySequenceEnd - queryInfo.querySequenceStart;

      let insert = makeMentionsMarkup(
        markup || DefaultMarkupTemplate,
        suggestion.id,
        suggestion.display,
      );
      let displayValue = (displayTransform || defaultDisplayTransform)(
        suggestion.id,
        suggestion.display,
      );

      if (appendSpaceOnAdd) {
        insert += ' ';
        displayValue += ' ';
      }

      const newCaretPosition =
        queryInfo.querySequenceStart + displayValue.length;
      setSelectionStart(newCaretPosition);
      setSelectionEnd(newCaretPosition);

      const newValue = spliceString(finalValue, start, end, insert);
      const mentions = getMentions(newValue, dataSources);
      const newPlainTextValue = spliceString(
        queryInfo.plainTextValue,
        queryInfo.querySequenceStart,
        queryInfo.querySequenceEnd,
        displayValue,
      );

      onChange(newValue, newPlainTextValue, mentions);
      onAdd?.(suggestion, start, end);
    },
    [finalValue, dataSources, onChange],
  );

  const handleChange = useCallback(
    (ev: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      let newPlainTextValue = ev.target.value;

      let selStartBefore = selectionStart;
      if (!isNumber(selStartBefore)) selStartBefore = ev.target.selectionStart;

      let selEndBefore = selectionEnd;
      if (!isNumber(selEndBefore)) selEndBefore = ev.target.selectionEnd;

      const newValue = applyChangeToValue(
        finalValue,
        newPlainTextValue,
        selStartBefore,
        selEndBefore,
        ev.target.selectionEnd || 0,
        dataSources,
        multiline,
      );

      newPlainTextValue = getPlainText(newValue, dataSources);

      let selStartAfter = ev.target.selectionStart;
      let selEndAfter = ev.target.selectionEnd;

      const startOfMention = findStartOfMentionInPlainText(
        finalValue,
        dataSources,
        ev.target.selectionStart || 0,
      );
      if (
        startOfMention !== undefined &&
        selEndAfter !== null &&
        selEndAfter > startOfMention
      ) {
        const data = (ev.nativeEvent as InputEvent).data;
        selStartAfter = startOfMention + (data ? data.length : 0);
        selEndAfter = selStartAfter;
      }

      setSelectionStart(selStartAfter);
      setSelectionEnd(selEndAfter);

      const mentions = getMentions(newValue, dataSources);
      onChange(newValue, newPlainTextValue, mentions);
    },
    [
      finalValue,
      dataSources,
      selectionStart,
      selectionEnd,
      onChange,
      multiline,
    ],
  );

  const handleSelect = useCallback(
    (ev: React.SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const target = ev.target as HTMLInputElement;
      setSelectionStart(target.selectionStart);
      setSelectionEnd(target.selectionEnd);
    },
    [],
  );

  const handleBlur = useCallback(() => {
    setSelectionStart(null);
    setSelectionEnd(null);
  }, []);

  useEffect(() => {
    setSuggestions(new Map());
    if (!selectionStart || selectionStart !== selectionEnd) return;

    const plainText = getPlainText(finalValue, dataSources);
    const positionInValue = mapPlainTextIndex(
      plainText,
      dataSources,
      selectionStart,
      'NULL',
    );
    if (!positionInValue) return;

    const substringStartIndex = getEndOfLastMention(
      plainText.substring(0, positionInValue),
      dataSources,
    );
    const substring = plainText.substring(substringStartIndex, selectionStart);

    dataSources.forEach((source, sourceIndex) => {
      const regex = makeTriggerRegex(
        source.trigger || DefaultTrigger,
        source.allowSpaceInQuery,
      );
      const match = substring.match(regex);
      if (match) {
        const querySequenceStart =
          substringStartIndex + substring.indexOf(match[1], match.index);
        const queryInfo: SuggestionsQueryInfo = {
          childIndex: sourceIndex,
          query: match[2],
          querySequenceStart,
          querySequenceEnd: querySequenceStart + match[1].length,
          plainTextValue: plainText,
        };

        const dataProvider = getDataProvider(source.data, source.ignoreAccents);
        setLoading(true);
        dataProvider(match[2])
          .then(results => {
            setSuggestions(prev => {
              const next = new Map(prev);
              next.set(sourceIndex, { results, queryInfo });
              return next;
            });
          })
          .finally(() => setLoading(false));
      }
    });
  }, [selectionStart, selectionEnd, dataSources, finalValue]);

  useEffect(() => {
    const total = allResults.length;
    if (total === 0) return;

    const handleKeyDown = (ev: KeyboardEvent) => {
      switch (ev.key) {
        case 'Escape':
          setSuggestions(new Map());
          setFocusIndex(0);
          ev.preventDefault();
          ev.stopPropagation();
          break;
        case 'ArrowDown':
          setFocusIndex(i => (i + 1) % total);
          ev.preventDefault();
          ev.stopPropagation();
          break;
        case 'ArrowUp':
          setFocusIndex(i => (total + i - 1) % total);
          ev.preventDefault();
          ev.stopPropagation();
          break;
        case 'Enter':
        case 'Tab': {
          // Guard against negative focusIndex: `.at(-1)` returns the last
          // element, but the original `allResults[focusIndex]` returned
          // undefined for negative indices.
          const item = focusIndex >= 0 ? allResults.at(focusIndex) : undefined;
          if (item) {
            addMention(item.result, item.queryInfo);
            setSuggestions(new Map());
            setFocusIndex(0);
          }
          ev.preventDefault();
          ev.stopPropagation();
          break;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [allResults, focusIndex, addMention]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const child = list.children.item(focusIndex);
    if (child instanceof HTMLElement) {
      child.scrollIntoView({ block: 'nearest' });
    }
  }, [focusIndex]);

  const plainText = getPlainText(finalValue, dataSources, multiline);

  const inputClasses = cn(
    'flex rounded-sm border border-input-border bg-transparent px-input-x py-input-y text-base shadow-sm motion-colors',
    'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring focus-visible:border-input-border-focus',
    'hover:border-input-border-hover disabled:cursor-not-allowed disabled:opacity-50',
    'h-9',
    fullWidth ? 'w-full' : '',
    className,
  );

  return (
    <Popover open={isOpen} modal={false}>
      <PopoverAnchor asChild>
        <div className={cn('relative', fullWidth && 'w-full')}>
          {multiline ? (
            <Textarea
              ref={setInputRef}
              value={plainText}
              onChange={handleChange}
              onSelect={handleSelect}
              onBlur={handleBlur}
              placeholder={placeholder}
              rows={minRows}
              className={cn(
                inputClasses,
                !minRows && 'min-h-[60px]',
                'resize-y',
              )}
            />
          ) : (
            <Input
              ref={setInputRef}
              value={plainText}
              onChange={handleChange}
              onSelect={handleSelect}
              onBlur={handleBlur}
              placeholder={placeholder}
              className={inputClasses}
            />
          )}
        </div>
      </PopoverAnchor>

      <PopoverContent
        className="w-[--radix-popover-trigger-width] max-w-[300px] p-0 py-2"
        side="bottom"
        sideOffset={4}
        align="start"
        onOpenAutoFocus={e => e.preventDefault()}
        onCloseAutoFocus={e => e.preventDefault()}
      >
        <ul ref={listRef} role="listbox" className="max-h-[40vh] overflow-auto">
          {allResults.length > 0
            ? allResults.map(({ result, queryInfo }, index) => (
                <li
                  key={result.id}
                  role="option"
                  aria-selected={index === focusIndex}
                  className={cn(
                    'cursor-pointer px-4 py-1.5 text-base select-none',
                    index === focusIndex
                      ? 'bg-accent text-accent-foreground'
                      : 'text-accent-foreground hover:bg-accent',
                  )}
                  onMouseDown={e => {
                    e.preventDefault();
                    addMention(result, queryInfo);
                    setSuggestions(new Map());
                    setFocusIndex(0);
                  }}
                  onMouseEnter={() => setFocusIndex(index)}
                >
                  {defaultDisplayTransform(result.id, result.display)}
                </li>
              ))
            : loading && (
                <li className="flex items-center justify-center py-4">
                  <Loader2 className="motion-icon-spin size-5 text-muted-foreground" />
                </li>
              )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
