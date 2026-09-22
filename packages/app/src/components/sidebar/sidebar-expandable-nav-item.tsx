import React, { useEffect, useState } from 'react';
import { ChevronDown, LoaderCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@roadiehq/ui/utils';
import { Button } from '@roadiehq/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@roadiehq/ui/tooltip';
import { motionTransitions } from '@roadiehq/ui/motion';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { NavItem, NavSubItem } from '../../config/navigation';
import { PATHS } from '../../config/paths';
import { NavigationIntentLink } from '../common/navigation-intent-link';
import { sidebarNavItemVariants } from './sidebar-nav-item';
import { useSidebarSubItems } from './use-sidebar-group-items';

/**
 * Whether a sub-item matches the current location. For `path` matches the
 * pathname must equal (or be nested under) the sub-item path. For `query`
 * matches the location must be on the sub-item's route and the relevant query
 * param must equal `queryValue` (with `''` meaning the default/no-param).
 */
export function isSubItemActive(
  sub: NavSubItem,
  pathname: string,
  search: string,
): boolean {
  const subPath = sub.path.split('?')[0];

  if (sub.match === 'path') {
    return pathname === subPath || pathname.startsWith(`${subPath}/`);
  }

  const onRoute = pathname === subPath;
  const current = new URLSearchParams(search).get(sub.queryKey ?? '') ?? '';
  return onRoute && current === (sub.queryValue ?? '');
}

/**
 * Sibling sub-item paths can nest (e.g. Datastore's `/datastore`
 * and `/datastore/graph`), where a prefix match alone would light
 * up both rows. Among the sub-items that match, only the most specific
 * (longest path) one is active — mirroring the top-level nav's
 * longest-match-wins rule.
 */
export function activeSubItem(
  subItems: readonly NavSubItem[],
  pathname: string,
  search: string,
): NavSubItem | null {
  let best: NavSubItem | null = null;
  let bestLength = -1;
  for (const sub of subItems) {
    if (!isSubItemActive(sub, pathname, search)) {
      continue;
    }
    const length = sub.path.split('?')[0].length;
    if (length > bestLength) {
      best = sub;
      bestLength = length;
    }
  }
  return best;
}

type SidebarExpandableNavItemProps = {
  item: NavItem;
  icon: LucideIcon;
  label: string;
  to: string;
  collapsed: boolean;
  parentActive: boolean;
  pathname: string;
  search: string;
  pendingPath?: string;
  pendingSearch?: string;
  onExpandSidebar?: () => void;
};

export function SidebarExpandableNavItem({
  item,
  icon: Icon,
  label,
  to,
  collapsed,
  parentActive,
  pathname,
  search,
  pendingPath,
  pendingSearch = '',
  onExpandSidebar,
}: SidebarExpandableNavItemProps) {
  const DATASTORE_VIEW_PATHS = new Set<string>([
    PATHS.DATASTORE,
    PATHS.DATASTORE_GRAPH,
  ]);
  const DATASTORE_CONFIGURE_PATHS = new Set<string>([
    PATHS.DATA_SOURCES,
    PATHS.INTEGRATIONS,
    PATHS.RELATIONSHIPS,
    PATHS.CONTEXT_GROUPS,
  ]);
  const DATASTORE_ACT_PATHS = new Set<string>([
    PATHS.CAPABILITIES,
    PATHS.ACTIONS,
  ]);
  const subItems = useSidebarSubItems(item);
  const pendingSubItem = pendingPath
    ? activeSubItem(subItems, pendingPath, pendingSearch)
    : null;
  const currentActiveSubItem = activeSubItem(subItems, pathname, search);
  const hasSubItems = subItems.length > 0;
  const isExpandable =
    item.dynamicGroupsRouteKey != null || (item.submenu?.length ?? 0) > 0;
  // Start closed so the disclosure mounts closed and *animates* open via the
  // effect below — including the data-driven case where sub-items only arrive
  // (and the Collapsible first mounts) after the route becomes active. Seeding
  // this from `parentActive` would mount already-open and skip the animation.
  const [expanded, setExpanded] = useState(false);

  // Manual toggle wins over route-sync until the next navigation — otherwise
  // a collapse during loading is reverted when the snapshot publishes.
  const userToggledRef = React.useRef(false);
  useEffect(() => {
    userToggledRef.current = false;
  }, [parentActive]);

  // Track the active route: open when active with sub-items, closed otherwise.
  // Resetting to closed on navigate-away matters because this component never
  // unmounts — without it, a section visited once stays `expanded`, so on the
  // next visit the disclosure remounts already-open and skips the animation.
  // Keyed on `hasSubItems` too so the open is applied on the commit *after* the
  // Collapsible mounts closed, letting Radix run the open animation.
  useEffect(() => {
    if (userToggledRef.current) {
      return;
    }
    setExpanded(parentActive && hasSubItems);
  }, [parentActive, hasSubItems]);

  // Whether the chevron + sub-item region should be available. Icon-only rail
  // never shows children inline (it uses the tooltip + expands the rail on click).
  const canExpand = !collapsed && isExpandable;

  const prefersReducedMotion = useReducedMotion();
  // Stable id linking the chevron trigger to its sub-item region (aria-controls).
  const contentId = `sidebar-sub-${to.replace(/\W+/g, '-')}`;

  const parentClassName = sidebarNavItemVariants({
    active: parentActive,
    collapsed,
  });

  const parentInner = (
    <>
      {parentActive && !collapsed ? (
        <span
          aria-hidden
          className="absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-sidebar-primary"
        />
      ) : null}
      {pendingPath === to || pendingPath?.startsWith(`${to}/`) ? (
        <LoaderCircle className="motion-icon-spin size-[18px] shrink-0 text-sidebar-primary" />
      ) : (
        <Icon
          className={cn(
            'motion-colors size-[18px] shrink-0',
            parentActive
              ? 'text-sidebar-primary'
              : 'text-sidebar-foreground/55',
          )}
        />
      )}
      {!collapsed ? (
        <span className="overflow-hidden leading-none text-ellipsis whitespace-nowrap">
          {label}
        </span>
      ) : null}
    </>
  );

  // Items without a landing page of their own (`disclosureOnly`) render the
  // parent as a toggle button rather than a link, so clicking the row expands
  // the disclosure instead of navigating to a route that doesn't exist. When the
  // rail is collapsed the click expands the sidebar (there are no inline
  // children to reveal in place).
  const parentLink = item.disclosureOnly ? (
    <Button
      type="button"
      variant="sidebar"
      size={null}
      aria-label={label}
      aria-current={parentActive ? 'page' : undefined}
      aria-expanded={canExpand ? expanded && hasSubItems : undefined}
      aria-controls={canExpand && hasSubItems ? contentId : undefined}
      className={cn(parentClassName, canExpand && 'pr-8')}
      onClick={() => {
        if (collapsed) {
          onExpandSidebar?.();
          return;
        }
        if (hasSubItems) {
          userToggledRef.current = true;
          setExpanded(current => !current);
        }
      }}
    >
      {parentInner}
    </Button>
  ) : (
    <NavigationIntentLink
      to={to}
      aria-busy={
        pendingPath === to || pendingPath?.startsWith(`${to}/`) || undefined
      }
      aria-current={parentActive ? 'page' : undefined}
      className={cn(parentClassName, canExpand && 'pr-8')}
      onClick={() => {
        if (collapsed) {
          onExpandSidebar?.();
        }
      }}
    >
      {parentInner}
    </NavigationIntentLink>
  );

  function renderSubLink(sub: NavSubItem) {
    const active = sub === currentActiveSubItem;
    return (
      <li key={sub.path} className="list-none">
        <NavigationIntentLink
          to={sub.path}
          aria-busy={pendingSubItem === sub || undefined}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'motion-colors flex h-7 w-full items-center gap-2 rounded-md px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
            active
              ? 'bg-sidebar-accent/60 font-medium text-sidebar-accent-foreground'
              : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground',
          )}
        >
          {sub.logoUrl ? (
            <span
              aria-hidden
              className="size-4 shrink-0 bg-sidebar-foreground/70"
              style={{
                maskImage: `url("${sub.logoUrl}")`,
                maskRepeat: 'no-repeat',
                maskPosition: 'center',
                maskSize: 'contain',
                WebkitMaskImage: `url("${sub.logoUrl}")`,
                WebkitMaskRepeat: 'no-repeat',
                WebkitMaskPosition: 'center',
                WebkitMaskSize: 'contain',
              }}
            />
          ) : sub.icon ? (
            <sub.icon className="size-4 shrink-0 text-sidebar-foreground/70" />
          ) : (
            <span aria-hidden className="size-4 shrink-0" />
          )}
          <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
            {sub.label}
          </span>
          {sub.count != null ? (
            <span className="shrink-0 text-xs text-sidebar-foreground/50 tabular-nums">
              {sub.count}
            </span>
          ) : null}
        </NavigationIntentLink>
      </li>
    );
  }

  const isDatastore = item.path === PATHS.DATASTORE;
  const groupedSubList = isDatastore
    ? [
        {
          label: 'Explore',
          items: subItems.filter(sub => DATASTORE_VIEW_PATHS.has(sub.path)),
        },
        {
          label: 'Configure',
          items: subItems.filter(sub =>
            DATASTORE_CONFIGURE_PATHS.has(sub.path),
          ),
        },
        {
          label: 'Act',
          items: subItems.filter(sub => DATASTORE_ACT_PATHS.has(sub.path)),
        },
      ].filter(section => section.items.length > 0)
    : [];
  const hideDatastoreParent = isDatastore && !collapsed;

  const subList = isDatastore ? (
    <ul
      className={cn(
        'space-y-3',
        hideDatastoreParent
          ? 'mt-0 mb-1'
          : 'mt-1 mb-1 ml-[10px] border-l border-sidebar-border/70 pl-2.5',
      )}
    >
      {groupedSubList.map((section, index) => (
        <li key={section.label} className="list-none">
          <p
            className={cn(
              'px-1 pb-1 text-[11px] font-medium tracking-wide text-sidebar-foreground/60 uppercase',
              index > 0 && 'pt-1',
            )}
          >
            {section.label}
          </p>
          <ul className="ml-0.5 space-y-0.5 border-l border-sidebar-border/65 pl-1.5">
            {section.items.map(renderSubLink)}
          </ul>
        </li>
      ))}
    </ul>
  ) : (
    // Indented under the parent label with a vertical tree rail, so the nesting
    // reads at a glance and sub-items are clearly subordinate to root items.
    <ul className="mt-1 mb-1 ml-[10px] space-y-0.5 border-l border-sidebar-border/70 pl-2.5">
      {subItems.map(renderSubLink)}
    </ul>
  );

  // Icon-only rail: tooltip on the parent, no inline children.
  if (collapsed) {
    return (
      <li className="list-none">
        <Tooltip>
          <TooltipTrigger asChild>{parentLink}</TooltipTrigger>
          <TooltipContent side="right" className="font-medium">
            {label}
          </TooltipContent>
        </Tooltip>
      </li>
    );
  }

  if (!isExpandable) {
    return <li className="list-none">{parentLink}</li>;
  }

  if (hideDatastoreParent) {
    return <li className="list-none">{subList}</li>;
  }

  // Expanded rail with sub-items. The chevron is a real toggle button overlaid on
  // the row (so the whole row still navigates), and the sub-item region animates
  // its height via `motion`. `height: 'auto'` is measured at animation time, so it
  // animates correctly even though our sub-items load asynchronously and change
  // height per route (which Radix's single-shot height measurement mishandles).
  return (
    <li className="list-none">
      <div className="relative">
        {parentLink}
        {item.disclosureOnly ? (
          // The row itself is the toggle button, so the chevron is a decorative
          // indicator only (no nested/duplicate control).
          <span
            aria-hidden
            className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center text-sidebar-foreground/55"
          >
            <ChevronDown
              className={cn(
                'motion-transform-standard-reduced size-3.5',
                expanded ? '' : '-rotate-90',
              )}
            />
          </span>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size={null}
            aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
            aria-expanded={expanded && hasSubItems}
            aria-controls={hasSubItems ? contentId : undefined}
            onClick={() => {
              userToggledRef.current = true;
              setExpanded(current => !current);
            }}
            className="absolute top-1/2 right-1.5 size-5 -translate-y-1/2 rounded-sm text-sidebar-foreground/55 outline-none hover:bg-transparent hover:text-sidebar-foreground focus-visible:ring-sidebar-ring focus-visible:ring-offset-0"
          >
            <ChevronDown
              className={cn(
                'motion-transform-standard-reduced size-3.5',
                expanded ? '' : '-rotate-90',
              )}
            />
          </Button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {expanded && hasSubItems ? (
          <motion.div
            id={contentId}
            key="sub"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={
              prefersReducedMotion
                ? motionTransitions.instant
                : motionTransitions.sidebarDisclosure
            }
            className="overflow-hidden"
          >
            {subList}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </li>
  );
}
