import type { HTMLAttributes, Ref } from 'react';
import { cn } from '@roadiehq/ui/utils';
import { NavigationIntentLink } from '../common/navigation-intent-link';

export interface OverviewTitleCellProps extends HTMLAttributes<HTMLElement> {
  /**
   * Full-page route for this row's entity. Omit for a listing whose rows have
   * no route of their own (the title then renders as plain text).
   */
  to?: string;
  /**
   * Forwarded to the rendered element so the cell can be an `asChild` trigger
   * (e.g. wrapped in a tooltip). Remaining props are spread onto the element for
   * the same reason — a trigger supplies its own handlers and aria wiring.
   */
  ref?: Ref<HTMLAnchorElement & HTMLSpanElement>;
  'data-testid'?: string;
}

/**
 * The title text of an overview-listing row.
 *
 * Listing navigation is split in two: clicking the row opens the detail drawer,
 * clicking the title navigates to the entity's own page. This renders the
 * second half. `OverviewTable`'s `ROW_CLICK_IGNORE_SELECTOR` already ignores
 * clicks on `a`, so the anchor suppresses the row's drawer handler on its own —
 * callers must not add `stopPropagation`.
 *
 * A leaf, not a layout: it owns only the title's typography and focus ring. The
 * surrounding row (icon frame, logo glyph, favorite star, badges) stays in each
 * feature's `cell`. See `.claude/rules/listing-navigation.md`.
 */
export function OverviewTitleCell({
  to,
  className,
  ref,
  children,
  ...props
}: OverviewTitleCellProps): JSX.Element {
  const classes = cn(
    'block min-w-0 truncate rounded-sm font-medium text-foreground',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    className,
  );

  if (!to) {
    return (
      <span {...props} ref={ref} className={classes}>
        {children}
      </span>
    );
  }

  return (
    <NavigationIntentLink
      {...props}
      ref={ref}
      to={to}
      className={cn(classes, 'hover:underline')}
    >
      {children}
    </NavigationIntentLink>
  );
}
