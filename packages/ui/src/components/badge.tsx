import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold motion-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80',
        outline: 'text-foreground',
        success:
          'border-transparent bg-success text-success-foreground shadow hover:bg-success/80',
        warning:
          'border-transparent bg-warning text-warning-foreground shadow hover:bg-warning/80',
        warningSubtle:
          'border-transparent bg-warning/10 font-medium text-foreground shadow-none dark:bg-warning/15',
        successOutline:
          'border-transparent bg-success/10 font-medium text-success shadow-none dark:bg-success/10',
        outlineMuted:
          'border-transparent bg-muted/40 font-normal text-muted-foreground shadow-none dark:bg-muted/50',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

const INTERACTIVE_HOVER_BORDER = new Map<string, string>([
  ['warningSubtle', 'hover:border-warning/40 dark:hover:border-warning/25'],
  ['successOutline', 'hover:border-success/40 dark:hover:border-success/35'],
  ['outlineMuted', 'hover:border-border/70 dark:hover:border-border'],
]);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  /** Leading icon slot; SVG children are sized to 12px automatically. */
  icon?: React.ReactNode;
  /** Shows pointer cursor and hover border; use when the badge is clickable. */
  interactive?: boolean;
}

/**
 * Small status/category label. Solid variants (`default`, `secondary`,
 * `destructive`, `success`, `warning`) are for emphasis; `outline` and the
 * subtle tints (`warningSubtle`, `successOutline`, `outlineMuted`) are quieter
 * and suit dense listings such as table cells.
 */
const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, icon, interactive, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          badgeVariants({ variant }),
          interactive && 'cursor-pointer',
          interactive && variant && INTERACTIVE_HOVER_BORDER.get(variant),
          className,
        )}
        {...props}
      >
        {icon ? (
          <span className="inline-flex shrink-0 items-center justify-center [&>svg]:size-3">
            {icon}
          </span>
        ) : null}
        {children}
      </div>
    );
  },
);
Badge.displayName = 'Badge';

export { Badge, badgeVariants };
