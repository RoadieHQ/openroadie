import * as React from 'react';
import { cn } from '../lib/utils';

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  title: string;
  description?: string;
}

/**
 * Centered placeholder for a section with nothing to show (no results, no
 * items yet). Children render below the description — use them for a
 * call-to-action button.
 */
const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ className, icon, title, description, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex flex-col items-center justify-center gap-2 py-8 text-center text-muted-foreground',
        className,
      )}
      {...props}
    >
      {icon && <div className="mb-1 text-muted-foreground/60">{icon}</div>}
      <p className="text-base font-medium">{title}</p>
      {description && (
        <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
      )}
      {children}
    </div>
  ),
);
EmptyState.displayName = 'EmptyState';

export { EmptyState };
