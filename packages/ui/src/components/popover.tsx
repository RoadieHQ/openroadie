import * as React from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { cn } from '../lib/utils';

/**
 * Radix popover root. Use for click-triggered floating panels with arbitrary
 * interactive content; for hover-only hints use Tooltip, and for command
 * menus/selects use the dedicated components.
 */
const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

type PopoverContentProps = React.ComponentPropsWithoutRef<
  typeof PopoverPrimitive.Content
> & {
  /** Portal into this node (e.g. dialog surface) so nested scroll/wheel works inside modals */
  container?: HTMLElement | null;
};

/**
 * Portalled popover panel. Declares `--field-bg` for its surface, so outlined
 * (floating-label) fields rendered inside notch their labels correctly.
 */
const PopoverContent = React.forwardRef<
  React.ComponentRef<typeof PopoverPrimitive.Content>,
  PopoverContentProps
>(
  (
    { className, align = 'center', sideOffset = 4, container, ...props },
    ref,
  ) => (
    <PopoverPrimitive.Portal container={container ?? undefined}>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'motion-radix-popover z-dropdown w-72 rounded-lg border border-divider bg-surface p-4 text-surface-foreground shadow-md outline-none [--field-bg:var(--color-surface)]',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  ),
);
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
