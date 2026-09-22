import * as React from 'react';
import { cn } from '../lib/utils';

/**
 * Inline `<code>` chip for identifiers, paths, and short snippets within
 * prose. Not for multi-line code blocks.
 */
const InlineCode = React.forwardRef<
  HTMLElement,
  React.HTMLAttributes<HTMLElement>
>(({ className, ...props }, ref) => (
  <code
    ref={ref}
    className={cn(
      'rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground',
      className,
    )}
    {...props}
  />
));
InlineCode.displayName = 'InlineCode';

export { InlineCode };
