import type { ReactNode } from 'react';
import { cn } from '@roadiehq/ui/utils';

export interface DetailSectionProps {
  /** Section heading, rendered as a small uppercase label. */
  title?: ReactNode;
  /** Optional item count shown next to the title — use when the section wraps a
   * table/list so the count lives with the data instead of a separate field. */
  count?: number;
  /** Optional trailing controls aligned with the title (e.g. a "View all" link). */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * A titled group inside a {@link DetailDrawer} body. Sections are separated by
 * the body's own vertical spacing, so this only owns its heading + content.
 */
export function DetailSection({
  title,
  count,
  actions,
  children,
  className,
}: DetailSectionProps) {
  return (
    <section className={cn('space-y-3', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center gap-2">
          {title ? (
            <h3 className="mr-auto flex items-baseline gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              <span>{title}</span>
              {count !== undefined && (
                <span className="text-muted-foreground/60 tabular-nums">
                  {count.toLocaleString()}
                </span>
              )}
            </h3>
          ) : (
            <span />
          )}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
