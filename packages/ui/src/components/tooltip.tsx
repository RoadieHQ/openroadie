import * as React from 'react';
import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils';

const TooltipProvider = TooltipPrimitive.Provider;

/**
 * Radix tooltip for short hover/focus hints — it only opens on hover or
 * focus, so the trigger must be focusable (wrap non-interactive content or
 * give it tabIndex). Requires a TooltipProvider ancestor; use Popover for
 * click-opened interactive content.
 */
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const tooltipContentVariants = cva(
  'motion-radix-tooltip z-tooltip overflow-hidden rounded-md px-3 py-1.5 text-xs shadow-md',
  {
    variants: {
      variant: {
        default: 'border border-border bg-tooltip text-tooltip-foreground',
        rich: 'border border-divider bg-surface text-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface TooltipContentProps
  extends
    React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>,
    VariantProps<typeof tooltipContentVariants> {}

/**
 * `default` is the compact dark label tooltip. Use `rich` for multi-line
 * explanatory content — it sits on the light surface colour so a paragraph
 * stays readable; pair it with a `max-w-*` class.
 */
const TooltipContent = React.forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Content>,
  TooltipContentProps
>(({ className, variant, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(tooltipContentVariants({ variant }), className)}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  tooltipContentVariants,
  TooltipProvider,
};
