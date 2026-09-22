import * as React from 'react';
import { Separator as SeparatorPrimitive } from 'radix-ui';
import { cn } from '../lib/utils';

/**
 * Thin divider line (Radix Separator). Decorative by default, so it is
 * hidden from the accessibility tree; the vertical orientation needs a
 * parent that constrains its height (it renders `h-full`).
 */
const Separator = React.forwardRef<
  React.ComponentRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(
  (
    { className, orientation = 'horizontal', decorative = true, ...props },
    ref,
  ) => (
    <SeparatorPrimitive.Root
      ref={ref}
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-[1px] w-full' : 'h-full w-[1px]',
        className,
      )}
      {...props}
    />
  ),
);
Separator.displayName = SeparatorPrimitive.Root.displayName;

export { Separator };
