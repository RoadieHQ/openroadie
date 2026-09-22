import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './tooltip';

const toggleGroupVariants = cva('flex items-center', {
  variants: {
    size: {
      default: 'h-9',
      sm: 'h-8',
      lg: 'h-10',
    },
    orientation: {
      horizontal: '',
      vertical: 'h-auto flex-col',
    },
    appearance: {
      segmented: '',
      pills: 'h-auto gap-1',
    },
  },
  defaultVariants: {
    size: 'sm',
    orientation: 'horizontal',
    appearance: 'segmented',
  },
});

const toggleGroupItemVariants = cva(
  'inline-flex items-center justify-center motion-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      active: {
        true: '',
        false: 'text-muted-foreground',
      },
      variant: {
        icon: '',
        text: 'px-2.5 text-xs font-medium',
      },
      appearance: {
        segmented: 'h-full border border-border/50',
        pills: 'rounded-lg',
      },
    },
    compoundVariants: [
      {
        appearance: 'segmented',
        active: true,
        className: 'bg-accent text-accent-foreground',
      },
      {
        appearance: 'segmented',
        active: false,
        className: 'hover:bg-accent/50 hover:text-accent-foreground',
      },
      {
        appearance: 'pills',
        active: true,
        className: 'bg-primary/15 text-primary',
      },
      {
        appearance: 'pills',
        active: false,
        className: 'hover:bg-accent hover:text-accent-foreground',
      },
      { appearance: 'segmented', variant: 'icon', className: 'w-8' },
      { appearance: 'pills', variant: 'icon', className: 'size-8' },
    ],
    defaultVariants: {
      active: false,
      variant: 'text',
      appearance: 'segmented',
    },
  },
);

interface ToggleGroupProps<T extends string>
  extends
    VariantProps<typeof toggleGroupVariants>,
    React.HTMLAttributes<HTMLDivElement> {
  value: T;
  onValueChange: (value: T) => void;
  /** One button per item; when `icon` is set the button is icon-only and `label` becomes its accessible name. */
  items: {
    value: T;
    label: string;
    icon?: React.ComponentType<{ className?: string }>;
    tooltip?: React.ReactNode;
  }[];
  className?: string;
}

/**
 * Single-select button group (rendered as a radiogroup) for compact mode
 * switches — view toggles, filters — not for tab-panel navigation (use
 * Tabs). `appearance="segmented"` (default) joins the buttons into one
 * bordered control; `"pills"` spaces them as individual rounded buttons with
 * a primary tint on the active item. `orientation="vertical"` stacks the
 * segmented control.
 */
function ToggleGroup<T extends string>({
  value,
  onValueChange,
  items,
  size,
  orientation,
  appearance,
  className,
  ...props
}: ToggleGroupProps<T>) {
  const segmented = appearance !== 'pills';
  const vertical = orientation === 'vertical';
  const groupRef = React.useRef<HTMLDivElement>(null);

  // ARIA radiogroup: the group is a single tab stop, so only the selected item
  // (or the first, when nothing is selected) is reachable with Tab.
  const selectedIndex = items.findIndex(item => item.value === value);
  const tabStopIndex = selectedIndex === -1 ? 0 : selectedIndex;

  // Arrow/Home/End move selection *and* focus, per the radiogroup pattern.
  const focusItem = (index: number) => {
    const buttons =
      groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    buttons?.[Number(index)]?.focus();
  };

  // Keep focus on the checked radio when `value` changes externally while the
  // group still owns focus — otherwise arrow keys move from a stale index.
  React.useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !group.contains(active)) return;
    const buttons = group.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    const target = buttons[Number(tabStopIndex)];
    if (target && target !== active) target.focus();
  }, [tabStopIndex]);

  const moveTo = (index: number) => {
    const next = items[Number(index)];
    if (!next) return;
    focusItem(index);
    // Only report an actual change. Consumers may treat a repeat of the current
    // value as a deliberate re-select (the relationships editor reads it as
    // "toggle back to the default mode"), so Home/End landing on the already
    // selected item must move focus without firing that.
    if (next.value !== value) onValueChange(next.value);
  };

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    from: number,
  ) => {
    const next = vertical ? 'ArrowDown' : 'ArrowRight';
    const prev = vertical ? 'ArrowUp' : 'ArrowLeft';

    switch (event.key) {
      case next:
        event.preventDefault();
        moveTo((from + 1) % items.length);
        break;
      case prev:
        event.preventDefault();
        moveTo((from - 1 + items.length) % items.length);
        break;
      case 'Home':
        event.preventDefault();
        moveTo(0);
        break;
      case 'End':
        event.preventDefault();
        moveTo(items.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      {...(vertical ? { 'aria-orientation': 'vertical' as const } : {})}
      className={cn(
        toggleGroupVariants({ size, orientation, appearance }),
        className,
      )}
      {...props}
    >
      <TooltipProvider>
        {items.map((item, i) => {
          const isFirst = i === 0;
          const isLast = i === items.length - 1;
          const btn = (
            <button
              type="button"
              role="radio"
              aria-checked={value === item.value}
              aria-label={item.label}
              tabIndex={i === tabStopIndex ? 0 : -1}
              onKeyDown={event => handleKeyDown(event, i)}
              onClick={() => onValueChange(item.value)}
              className={cn(
                toggleGroupItemVariants({
                  active: value === item.value,
                  variant: item.icon ? 'icon' : 'text',
                  appearance,
                }),
                segmented && [
                  isFirst && (vertical ? 'rounded-t' : 'rounded-l'),
                  isLast && (vertical ? 'rounded-b' : 'rounded-r'),
                  !isFirst && (vertical ? '-mt-px' : '-ml-px'),
                ],
              )}
            >
              {item.icon ? (
                <item.icon className={segmented ? 'size-3.5' : 'size-icon'} />
              ) : (
                item.label
              )}
            </button>
          );
          if (!item.tooltip)
            return <React.Fragment key={item.value}>{btn}</React.Fragment>;
          return (
            <Tooltip key={item.value}>
              <TooltipTrigger asChild>{btn}</TooltipTrigger>
              <TooltipContent className="max-w-56">
                {item.tooltip}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </TooltipProvider>
    </div>
  );
}

export {
  ToggleGroup,
  toggleGroupVariants,
  toggleGroupItemVariants,
  type ToggleGroupProps,
};
