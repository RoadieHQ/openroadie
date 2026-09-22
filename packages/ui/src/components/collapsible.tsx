import * as React from 'react';
import { Collapsible as CollapsiblePrimitive } from 'radix-ui';
import { cn } from '../lib/utils';

/**
 * Bare show/hide region (Radix Collapsible) — a single toggle with no borders,
 * chevron, or item semantics. For stacked sections with built-in trigger
 * styling use Accordion instead.
 */
const Collapsible = CollapsiblePrimitive.Root;

/** Element that toggles the Collapsible; pass `asChild` to use your own button. */
const CollapsibleTrigger = CollapsiblePrimitive.Trigger;

/** Collapsible body with the standard expand/collapse motion. */
const CollapsibleContent = React.forwardRef<
  React.ComponentRef<typeof CollapsiblePrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <CollapsiblePrimitive.Content
    ref={ref}
    className={cn(
      'data-[state=closed]:motion-collapsible-up data-[state=open]:motion-collapsible-down overflow-hidden',
      className,
    )}
    {...props}
  >
    {children}
  </CollapsiblePrimitive.Content>
));
CollapsibleContent.displayName = CollapsiblePrimitive.Content.displayName;

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
