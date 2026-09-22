import { useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  EyeOff,
  ListFilter,
  MoreHorizontal,
  X,
} from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@roadiehq/ui/popover';
import { cn } from '@roadiehq/ui/utils';
import { LISTING_TABLE_SORT_BUTTON } from '../table-style';

export interface TableColumnHeaderMenuProps {
  title: ReactNode;
  /** Accessible name for the trigger — needed when `title` is icon-only. */
  label?: string;
  sorted?: false | 'asc' | 'desc';
  onSort?: (descending: boolean) => void;
  onClearSort?: () => void;
  filtered?: boolean;
  /** Filter facet, rendered inline in the popover; it manages its own state. */
  filterContent?: ReactNode;
  onHide?: () => void;
  align?: 'left' | 'center' | 'right';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  contentClassName?: string;
}

const ROW_CLASS =
  'h-auto w-full justify-start gap-2 px-2 py-1.5 font-normal text-foreground';

/**
 * The one column-header control: a single Popover holding sort, an inline filter
 * facet, and hide — combined in one surface. A Popover (not a DropdownMenu) so
 * the facet's search box works without a menu swallowing keystrokes. Sort/hide
 * rows close the popover; the facet stays open across selections.
 */
export function TableColumnHeaderMenu({
  title,
  label,
  sorted = false,
  onSort,
  onClearSort,
  filtered = false,
  filterContent,
  onHide,
  align,
  open: controlledOpen,
  onOpenChange,
  className,
  contentClassName,
}: TableColumnHeaderMenuProps): JSX.Element {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  const sortable = onSort !== undefined;
  const filterable = filterContent !== undefined;
  const hideable = onHide !== undefined;

  const closeAfter = (action: () => void) => () => {
    action();
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={label}
          data-active={filtered || undefined}
          className={cn(
            LISTING_TABLE_SORT_BUTTON,
            'data-[active=true]:bg-accent data-[active=true]:text-accent-foreground',
            align === 'right' && 'ml-auto',
            align === 'center' &&
              'relative mx-0 w-full justify-center px-1 sm:mx-0',
            className,
          )}
        >
          {title}
          {sorted === 'asc' ? (
            <ArrowUp data-icon="inline-end" />
          ) : sorted === 'desc' ? (
            <ArrowDown data-icon="inline-end" />
          ) : sortable ? (
            <ChevronsUpDown data-icon="inline-end" />
          ) : filterable ? (
            <ListFilter data-icon="inline-end" />
          ) : (
            <MoreHorizontal data-icon="inline-end" />
          )}
          {filtered && sortable ? (
            <ListFilter data-icon="inline-end" className="text-primary" />
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn('w-56 p-1', contentClassName)}
        onOpenAutoFocus={e => e.preventDefault()}
      >
        {sortable ? (
          <div className="flex flex-col">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={ROW_CLASS}
              onClick={closeAfter(() => onSort(false))}
            >
              <ArrowUp />
              Sort ascending
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={ROW_CLASS}
              onClick={closeAfter(() => onSort(true))}
            >
              <ArrowDown />
              Sort descending
            </Button>
            {sorted && onClearSort ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={ROW_CLASS}
                onClick={closeAfter(onClearSort)}
              >
                <X />
                Clear sorting
              </Button>
            ) : null}
          </div>
        ) : null}
        {sortable && filterable ? (
          <div className="my-1 h-px bg-border" aria-hidden />
        ) : null}
        {filterContent}
        {(sortable || filterable) && hideable ? (
          <div className="my-1 h-px bg-border" aria-hidden />
        ) : null}
        {hideable ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={ROW_CLASS}
            onClick={closeAfter(onHide)}
          >
            <EyeOff />
            Hide column
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
