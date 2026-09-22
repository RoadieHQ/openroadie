import type { ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../button';
import { DrawerBreadcrumb } from './drawer-breadcrumb';
import {
  DrawerPanelHeader,
  DrawerResizeHandle,
} from './resizable-drawer-header';
import { useResizableDrawerPanel } from './use-resizable-drawer-panel';

export interface DrawerStackView {
  /** Stable id; also the crumb key and the value passed to `onNavigate`. */
  id: string;
  /** Crumb text. */
  label: string;
  /** Muted suffix on the active crumb, e.g. "(95 total)". */
  countLabel?: string;
  /** Centered header content, e.g. a source → target summary. */
  center?: ReactNode;
  /** This view's header action cluster. */
  actions?: ReactNode;
  /** Pop-out-to-full-page link for this view. */
  standaloneHref?: string;
  standaloneTitle?: string;
  /**
   * Interposes on this view being unmounted (a crumb click past it, or close).
   * The view calls `proceed()` once it is happy to go — e.g. after confirming
   * that unsaved work may be discarded. Omit to leave immediately. When one
   * exit unmounts several views — a breadcrumb jump over an intermediate
   * level, or closing the whole drawer — each guard runs in turn, deepest
   * first, and any of them can abandon the exit by not proceeding.
   */
  onBeforeLeave?: (proceed: () => void) => void;
  render: () => ReactNode;
}

export interface DrawerStackProps {
  open: boolean;
  /** Portal target. Nothing renders until it exists. */
  container: HTMLElement | null;
  /** The PATH, root → active. The last entry is the active view. */
  views: DrawerStackView[];
  /** Fired with an ancestor crumb's id. Never fired for the active view. */
  onNavigate: (viewId: string) => void;
  onClose: () => void;
  /** Noun used in the resize affordance's accessible labels. */
  label?: string;
}

/**
 * One resizable bottom drawer that swaps its contents.
 *
 * Two drawers mounted at the same rect read as one drawer replacing another,
 * with no way back to the first. This owns the shell — portal, resize handle,
 * height, header — and switches only the body, so the path stays visible as a
 * breadcrumb and the drawer keeps its height across a swap.
 */
export function DrawerStack({
  open,
  container,
  views,
  onNavigate,
  onClose,
  label = 'drawer',
}: DrawerStackProps): ReactElement | null {
  const { panelHeight, isCollapsed, cyclePanelHeight, resizeHandleProps } =
    useResizableDrawerPanel({
      open,
      container,
      initialHeight: 'mid',
    });

  if (!open || !container || views.length === 0) {
    return null;
  }

  const active = views[views.length - 1];
  const expanded = !isCollapsed;

  // Every exit routes through the interceptors of ALL the views it would
  // unmount, deepest first — not just the active one. A breadcrumb jump to a
  // distant ancestor (or closing the drawer) also unmounts the levels in
  // between, and any of them may be sitting on unsaved work.
  const leaveViews = (leaving: DrawerStackView[], proceed: () => void) => {
    const [next, ...rest] = leaving;
    if (!next) {
      proceed();
      return;
    }
    const continueLeaving = () => leaveViews(rest, proceed);
    if (next.onBeforeLeave) {
      next.onBeforeLeave(continueLeaving);
      return;
    }
    continueLeaving();
  };

  const navigateTo = (viewId: string) => {
    const targetIndex = views.findIndex(view => view.id === viewId);
    if (targetIndex === -1) {
      return;
    }
    const leaving = views.slice(targetIndex + 1).reverse();
    leaveViews(leaving, () => onNavigate(viewId));
  };

  const close = () => leaveViews([...views].reverse(), onClose);

  const panel = (
    <div
      // A named landmark, matching the app's other drawer/inspector panels —
      // without it assistive tech has no way to discover or identify the
      // drawer when it opens. `aria-label` rather than `aria-labelledby`: the
      // header title swaps between plain text and interactive breadcrumbs, so
      // there is no stable title element to point at.
      role="region"
      aria-label={label}
      className={cn(
        'flex min-h-0 flex-col bg-background [--field-bg:var(--color-background)]',
        'absolute right-4 bottom-0 left-4 z-overlay rounded-t-lg border border-border shadow-lg lg:right-[100px] lg:left-[100px]',
      )}
      style={{ height: panelHeight }}
    >
      <DrawerResizeHandle
        isCollapsed={isCollapsed}
        label={label}
        props={resizeHandleProps}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <DrawerPanelHeader
          titleNode={
            views.length > 1 ? (
              <DrawerBreadcrumb views={views} onNavigate={navigateTo} />
            ) : undefined
          }
          title={views.length > 1 ? undefined : active.label}
          countLabel={views.length > 1 ? undefined : active.countLabel}
          center={active.center}
          expanded={expanded}
          onToggleExpanded={cyclePanelHeight}
          toggleDisabled={false}
          collapsedTitle={`Expand ${label}`}
          expandedTitle={`Collapse ${label}`}
          standaloneHref={active.standaloneHref}
          standaloneTitle={active.standaloneTitle ?? ''}
          actions={
            <>
              {active.actions}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label="Close drawer"
                title="Close drawer"
                onClick={close}
              >
                <X className="size-3.5" aria-hidden="true" />
              </Button>
            </>
          }
        />
        {/* Every view in the path stays mounted; only the last one shows.
            Unmounting an ancestor would throw away the state that makes the
            breadcrumb worth having — the reviewer's filters and their place in
            the list. A view removed from `views` does unmount, so state a view
            owns itself does not survive leaving it.
            `hidden` rather than a class: Tailwind's preflight styles [hidden],
            and jsdom honours the attribute, so tests can actually see it. */}
        <div hidden={!expanded} className="flex min-h-0 flex-1 flex-col">
          {views.map(entry => (
            <div
              key={entry.id}
              hidden={entry.id !== active.id}
              className="flex min-h-0 flex-1 scrollbar-thin flex-col overflow-auto"
            >
              {entry.render()}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  return createPortal(panel, container);
}
