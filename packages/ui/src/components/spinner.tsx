import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

export interface SpinnerProps extends React.SVGAttributes<SVGSVGElement> {
  size?: number;
}

/**
 * Spinning loader icon for inline, indeterminate waits only — a busy button,
 * a refresh control, a dialog submit. Never use it as a page or section
 * loader: content with a known shape gets a Skeleton composition instead.
 */
const Spinner = React.forwardRef<SVGSVGElement, SpinnerProps>(
  ({ className, size = 24, ...props }, ref) => (
    <Loader2
      ref={ref}
      className={cn('motion-icon-spin text-muted-foreground', className)}
      size={size}
      {...props}
    />
  ),
);
Spinner.displayName = 'Spinner';

export { Spinner };
