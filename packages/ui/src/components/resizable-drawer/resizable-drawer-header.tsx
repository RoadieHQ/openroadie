import type { HTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router';
import { ExternalLink } from 'lucide-react';
import { Button } from '../button';

/**
 * Slim grab bar at the top of a resizable drawer panel. Pass
 * `resizeHandleProps` from `useResizableDrawerPanel` as `props` — that wires
 * up drag resizing, the click-to-cycle heights, and keyboard/ARIA slider
 * behavior.
 */
export function DrawerResizeHandle({
  isCollapsed,
  label,
  props,
}: {
  isCollapsed: boolean;
  /** Used only for the accessible name ("Expand {label}" / "Resize {label}"). */
  label: string;
  /** Spread of `useResizableDrawerPanel().resizeHandleProps`. */
  props: HTMLAttributes<HTMLDivElement>;
}) {
  return (
    <div
      {...props}
      aria-label={isCollapsed ? `Expand ${label}` : `Resize ${label}`}
      className="motion-colors mx-auto mt-2 mb-1 h-1 w-12 shrink-0 cursor-ns-resize touch-none rounded-full bg-border hover:bg-muted-foreground/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    />
  );
}

/**
 * Header row for a resizable drawer panel: a `title` that doubles as the
 * expand/collapse toggle — or a `titleNode` that does not, for titles which
 * are themselves interactive — with an optional count, open-in-full-page link,
 * centered summary, and right-aligned actions. Pair with DrawerResizeHandle
 * and `useResizableDrawerPanel`.
 */
export function DrawerPanelHeader({
  title,
  titleNode,
  titleId,
  countLabel,
  center,
  expanded,
  onToggleExpanded,
  toggleDisabled,
  collapsedTitle,
  expandedTitle,
  standaloneHref,
  standaloneTitle,
  actions,
}: {
  title?: ReactNode;
  /** Rendered in place of `title`, OUTSIDE the expand-toggle button. For a
   *  title that is itself interactive (a breadcrumb) — nesting buttons would
   *  be invalid and unreachable by keyboard. The resize handle still cycles
   *  the height, so no affordance is lost. */
  titleNode?: ReactNode;
  titleId?: string;
  countLabel?: string;
  /** Centered content between the title and the actions (e.g. a source→target summary). */
  center?: ReactNode;
  expanded: boolean;
  onToggleExpanded: () => void;
  toggleDisabled: boolean;
  /** Tooltip on the title toggle while collapsed (e.g. "Expand results"). */
  collapsedTitle: string;
  /** Tooltip on the title toggle while expanded (e.g. "Collapse results"). */
  expandedTitle: string;
  /** When set, shows a button beside the title that opens this route as a full page in a new tab. */
  standaloneHref?: string;
  standaloneTitle: string;
  actions?: ReactNode;
}) {
  return (
    <div className="shrink-0 border-b border-border px-3 pb-2">
      <div className="relative flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          {titleNode ? (
            <div id={titleId} className="flex min-w-0 items-center">
              {titleNode}
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="h-auto min-w-0 gap-2 rounded p-0 text-sm font-normal hover:bg-transparent hover:text-primary"
              onClick={onToggleExpanded}
              aria-expanded={expanded}
              title={expanded ? expandedTitle : collapsedTitle}
              disabled={toggleDisabled}
            >
              <span
                id={titleId}
                className="truncate font-semibold text-foreground"
              >
                {title}
              </span>
              {countLabel && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {countLabel}
                </span>
              )}
            </Button>
          )}
          {/* Open-in-full-page sits right beside the title. */}
          {standaloneHref && (
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="size-7"
              title={standaloneTitle}
              aria-label={standaloneTitle}
            >
              <Link
                to={standaloneHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </Link>
            </Button>
          )}
        </div>
        {/* Absolutely centered on the header's true midpoint (not the gap
            between title and actions), so it doesn't drift with the width of
            either side. Hidden below lg where the two sides would crowd it. */}
        {center && (
          <div className="pointer-events-none absolute inset-0 hidden items-center justify-center lg:flex">
            <div className="pointer-events-auto flex max-w-[50%] min-w-0 items-center">
              {center}
            </div>
          </div>
        )}
        <div className="flex shrink-0 items-center justify-end gap-1">
          {actions}
        </div>
      </div>
    </div>
  );
}
