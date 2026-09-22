import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ChevronsLeft,
  ChevronsRight,
  KeyRound,
  List,
  LogOut,
  Plus,
  ScrollText,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useLocation } from 'react-router';
import { Button } from '@roadiehq/ui/button';
import { Separator } from '@roadiehq/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@roadiehq/ui/tooltip';
import { cn } from '@roadiehq/ui/utils';
import { motionTransitions } from '@roadiehq/ui/motion';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { NavItem, NavSubItem } from '../../config/navigation';
import { PATHS } from '../../config/paths';
import { useAuth, useFeatureFlag } from '../../api';
import { useSavedGraphViews } from '../data-sources/objects/graph/saved-views';
import { CATEGORY_ICON, INTEGRATION_TYPE_META } from '../integrations/types';
import { NavigationIntentLink } from '../common/navigation-intent-link';
import { WorkspacePicker } from '../workspaces';
import { isSubItemActive } from './sidebar-expandable-nav-item';
import { useSidebarSubItems } from './use-sidebar-group-items';
import { useSidebarCounts } from './use-sidebar-counts';

const DEMO_CATEGORY_KEYS = Object.keys(INTEGRATION_TYPE_META).filter(
  key => key !== 'other',
);

type PrimaryItem = {
  path: string;
  label: string;
  icon: LucideIcon;
};

type PrimarySection = {
  id: string;
  label: string;
  items: PrimaryItem[];
};

export function matchesPendingPath(path: string, pendingPath?: string) {
  if (!pendingPath) {
    return false;
  }
  const pathname = path.split('?')[0];
  return pendingPath === pathname || pendingPath.startsWith(`${pathname}/`);
}

type SidebarProps = {
  navItems: NavItem[];
  bottomNavItems?: NavItem[];
  roadieUrl?: string;
  pendingPath?: string;
  pendingSearch?: string;
};

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'roadie.sidebar.collapsed';

function categoryItemsForPath(path: string): NavSubItem[] {
  return DEMO_CATEGORY_KEYS.map(key => ({
    // eslint-disable-next-line security/detect-object-injection -- key is constrained to known integration category keys
    label: INTEGRATION_TYPE_META[key]?.label ?? key,
    path: `${path}?group=${key}`,
    match: 'query',
    queryKey: 'group',
    queryValue: key,
    // eslint-disable-next-line security/detect-object-injection -- key is constrained to known integration category keys
    icon: CATEGORY_ICON[key],
  }));
}

function onlyCategoryGroupItems(items: NavSubItem[]): NavSubItem[] {
  return items.filter(
    item =>
      item.match === 'query' && item.queryKey === 'group' && item.queryValue,
  );
}

// "All" is the unfiltered listing, so it is only current when no category is
// selected - a `path` match would keep it lit alongside the active category.
function allGroupItem(path: string): NavSubItem {
  return {
    label: 'All',
    path,
    match: 'query',
    queryKey: 'group',
    queryValue: '',
    icon: List,
  };
}

const exactCountFormatter = new Intl.NumberFormat();
const compactCountFormatter = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Object counts run to five and six figures and the rail is 13.5rem wide, so
 *  past four digits the number gives way to a rounded form rather than pushing
 *  the label out of the row. */
function formatSidebarCount(count: number): string {
  return count < 10_000
    ? exactCountFormatter.format(count)
    : compactCountFormatter.format(count);
}

/** Id of a row's count description, so the row can point `aria-describedby` at
 *  it. Mirrors the `submenuId` convention below. */
function navCountId(path: string) {
  return `sidebar-count-${path.replace(/\W+/g, '-')}`;
}

/**
 * How many things a nav row leads to. Renders nothing until the count is known,
 * so a row never flashes a placeholder zero and then corrects itself.
 *
 * The number is a *description* of the row, never part of its accessible name:
 * the name identifies the destination, and "Capabilities" is what every locator
 * in the app and the e2e suite matches. Folding the count in renames every nav
 * link, which broke four e2e locators and would silently break any external
 * tooling keyed on them.
 *
 * So the visible number is `aria-hidden` — on a row with no submenu it sits
 * inside the anchor, where its text would otherwise join the name — and a
 * hidden twin carries the exact value for `aria-describedby`: a node
 * referenced directly by describedby has its text exposed even when it isn't
 * rendered, so the twin works from either side of the anchor. The visible form
 * rounds past four digits, so the exact value is also the hover title when
 * rounding bit.
 */
function SidebarCount({ count, path }: { count?: number; path: string }) {
  if (count == null) {
    return null;
  }
  const compact = formatSidebarCount(count);
  const exact = exactCountFormatter.format(count);
  return (
    <>
      <span
        aria-hidden
        className="ml-auto shrink-0 text-[11px] text-sidebar-foreground/50 tabular-nums"
        title={compact === exact ? undefined : exact}
      >
        {compact}
      </span>
      <span hidden id={navCountId(path)}>
        {exact}
      </span>
    </>
  );
}

export function Sidebar({
  navItems,
  bottomNavItems = [],
  roadieUrl,
  pendingPath,
  pendingSearch,
}: SidebarProps) {
  const location = useLocation();
  const prefersReducedMotion = useReducedMotion();
  const auth = useAuth();
  const { value: webhooksEnabled } = useFeatureFlag('webhooks', false);
  const { views: savedGraphViews } = useSavedGraphViews();
  const counts = useSidebarCounts();

  const navByPath = useMemo(
    () => new Map(navItems.map(item => [item.path, item])),
    [navItems],
  );
  const bottomByPath = useMemo(
    () => new Map(bottomNavItems.map(item => [item.path, item])),
    [bottomNavItems],
  );

  const sections = useMemo<PrimarySection[]>(() => {
    const datastoreIcon = navByPath.get(PATHS.DATASTORE)?.icon ?? ArrowLeft;
    const relationshipsIcon =
      navByPath.get(PATHS.RELATIONSHIPS)?.icon ?? datastoreIcon;
    return [
      {
        id: 'explore',
        label: 'Explore',
        items: [
          {
            path: PATHS.DATASTORE,
            label: 'Data Store',
            icon: navByPath.get(PATHS.DATASTORE)?.icon ?? datastoreIcon,
          },
          {
            path: PATHS.DATASTORE_GRAPH,
            label: 'Graph',
            icon:
              navByPath.get(PATHS.DATASTORE_GRAPH)?.icon ?? relationshipsIcon,
          },
        ],
      },
      {
        id: 'configure',
        label: 'Configure',
        items: [
          {
            path: PATHS.INTEGRATIONS,
            label: navByPath.get(PATHS.INTEGRATIONS)?.text ?? 'Integrations',
            icon: navByPath.get(PATHS.INTEGRATIONS)?.icon ?? datastoreIcon,
          },
          {
            path: PATHS.DATA_SOURCES,
            label: navByPath.get(PATHS.DATA_SOURCES)?.text ?? 'Data Sources',
            icon: navByPath.get(PATHS.DATA_SOURCES)?.icon ?? datastoreIcon,
          },
          {
            path: PATHS.RELATIONSHIPS,
            label: navByPath.get(PATHS.RELATIONSHIPS)?.text ?? 'Relationships',
            icon: navByPath.get(PATHS.RELATIONSHIPS)?.icon ?? relationshipsIcon,
          },
          {
            path: PATHS.CONTEXT_GROUPS,
            label: 'Context Groups',
            icon: navByPath.get(PATHS.CONTEXT_GROUPS)?.icon ?? datastoreIcon,
          },
        ],
      },
      {
        id: 'act',
        label: 'Act',
        items: [
          {
            path: PATHS.CAPABILITIES,
            label: navByPath.get(PATHS.CAPABILITIES)?.text ?? 'Capabilities',
            icon: navByPath.get(PATHS.CAPABILITIES)?.icon ?? datastoreIcon,
          },
          {
            path: PATHS.ACTIONS,
            label: navByPath.get(PATHS.ACTIONS)?.text ?? 'Actions',
            icon: navByPath.get(PATHS.ACTIONS)?.icon ?? datastoreIcon,
          },
        ],
      },
      {
        id: 'observe',
        label: 'Observe',
        items: [
          {
            path: PATHS.ADMIN_MCP_AUDIT_LOG,
            label: 'Agent Sessions',
            icon: navByPath.get(PATHS.ADMIN_MCP_AUDIT_LOG)?.icon ?? ScrollText,
          },
          ...(webhooksEnabled
            ? [
                {
                  path: PATHS.ADMIN_WEBHOOKS,
                  label: 'Service Tokens',
                  icon: navByPath.get(PATHS.ADMIN_WEBHOOKS)?.icon ?? KeyRound,
                },
              ]
            : []),
        ],
      },
    ];
  }, [navByPath, webhooksEnabled]);

  const primaryItems = useMemo(
    () => sections.flatMap(section => section.items),
    [sections],
  );

  const allItems = useMemo(() => {
    const primaryNavItems: NavItem[] = primaryItems.map(item => ({
      text: item.label,
      icon: item.icon,
      path: item.path,
    }));
    return [...primaryNavItems, ...bottomNavItems];
  }, [primaryItems, bottomNavItems]);

  const emptyNavItem = useMemo<NavItem>(
    () => ({ text: '', icon: ArrowLeft, path: PATHS.ROOT }),
    [],
  );

  const dataSourcesItem = navByPath.get(PATHS.DATA_SOURCES) ?? emptyNavItem;
  const integrationsItem = navByPath.get(PATHS.INTEGRATIONS) ?? emptyNavItem;
  const selectedItemForHook = useMemo(() => {
    const selected =
      navByPath.get(location.pathname) ??
      bottomByPath.get(location.pathname) ??
      null;
    return selected ?? emptyNavItem;
  }, [bottomByPath, emptyNavItem, location.pathname, navByPath]);

  const dataSourceCategories = useSidebarSubItems(dataSourcesItem);
  const integrationCategories = useSidebarSubItems(integrationsItem);
  const selectedItemSubmenu = useSidebarSubItems(selectedItemForHook);

  const dataSourceCategoryItems = onlyCategoryGroupItems(dataSourceCategories);
  const integrationCategoryItems = onlyCategoryGroupItems(
    integrationCategories,
  );

  const graphSubmenuItems = useMemo(
    () =>
      savedGraphViews.map(
        (view): NavSubItem => ({
          label: view.name,
          path: `${PATHS.DATASTORE_GRAPH}?${new URLSearchParams(view.params).toString()}`,
          match: 'path',
        }),
      ),
    [savedGraphViews],
  );

  function matchesPath(path: string) {
    return (
      location.pathname === path || location.pathname.startsWith(`${path}/`)
    );
  }

  function isActive(path: string) {
    if (path === PATHS.DATASTORE) {
      const onGraphRoute =
        location.pathname === PATHS.DATASTORE_GRAPH ||
        location.pathname.startsWith(`${PATHS.DATASTORE_GRAPH}/`);
      return (
        !onGraphRoute &&
        (location.pathname === PATHS.DATASTORE ||
          location.pathname.startsWith(`${PATHS.DATASTORE}/`))
      );
    }
    if (path === PATHS.DATASTORE_GRAPH) {
      return (
        location.pathname === PATHS.DATASTORE_GRAPH ||
        location.pathname.startsWith(`${PATHS.DATASTORE_GRAPH}/`)
      );
    }
    if (path === '/') {
      return !allItems
        .filter(item => item.path !== '/')
        .some(item => matchesPath(item.path));
    }
    return (
      matchesPath(path) &&
      !allItems.some(
        item => item.path.length > path.length && matchesPath(item.path),
      )
    );
  }

  function isPending(path: string) {
    return (
      matchesPendingPath(path, pendingPath) &&
      !allItems.some(
        item =>
          item.path.length > path.length &&
          matchesPendingPath(item.path, pendingPath),
      )
    );
  }

  function submenuItemsForPath(path: string): NavSubItem[] {
    if (path === PATHS.DATASTORE) {
      return [];
    }
    if (path === PATHS.DATASTORE_GRAPH) {
      return [
        {
          label: 'New',
          path: PATHS.DATASTORE_GRAPH,
          match: 'path',
          icon: Plus,
        },
        ...graphSubmenuItems,
      ];
    }
    if (path === PATHS.DATA_SOURCES) {
      return [allGroupItem(PATHS.DATA_SOURCES), ...dataSourceCategoryItems];
    }
    if (path === PATHS.INTEGRATIONS) {
      const categoryItems =
        integrationCategoryItems.length > 0
          ? integrationCategoryItems
          : categoryItemsForPath(PATHS.INTEGRATIONS);
      return [allGroupItem(PATHS.INTEGRATIONS), ...categoryItems];
    }
    if (path === PATHS.RELATIONSHIPS) {
      return [];
    }
    if (path === PATHS.CONTEXT_GROUPS) {
      return [];
    }
    if (path === PATHS.CAPABILITIES) {
      return [];
    }
    if (path === PATHS.ACTIONS) {
      return [];
    }
    if (path === PATHS.ADMIN_MCP_AUDIT_LOG) {
      return [];
    }
    if (path === PATHS.ADMIN_WEBHOOKS) {
      return [];
    }
    return selectedItemSubmenu;
  }

  const [expandedOverrides, setExpandedOverrides] = useState<
    Record<string, boolean | undefined>
  >({});
  const [sectionExpandedOverrides, setSectionExpandedOverrides] = useState<
    Record<string, boolean | undefined>
  >({});
  const [bottomExpandedOverrides, setBottomExpandedOverrides] = useState<
    Record<string, boolean | undefined>
  >({});
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
  });
  const [compactMode, setCompactMode] = useState(collapsed);

  useEffect(() => {
    window.localStorage.setItem(
      SIDEBAR_COLLAPSED_STORAGE_KEY,
      collapsed ? '1' : '0',
    );
  }, [collapsed]);

  useEffect(() => {
    if (!collapsed) {
      setCompactMode(false);
      return;
    }
    // Delay icon-only rendering so width collapse can finish first.
    const collapseTransitionMs = 180;
    const timeoutId = window.setTimeout(
      () => setCompactMode(true),
      collapseTransitionMs,
    );
    return () => window.clearTimeout(timeoutId);
  }, [collapsed]);

  useEffect(() => {
    setExpandedOverrides({});
    setBottomExpandedOverrides({});
  }, [location.pathname, location.search]);

  const bottomSubItemsByPath = useMemo(
    () =>
      new Map(
        bottomNavItems.map(item => [
          item.path,
          item.submenu ? [...item.submenu] : [],
        ]),
      ),
    [bottomNavItems],
  );

  function isSubmenuItemActive(item: NavSubItem): boolean {
    if (item.match === 'path' && item.path.includes('?')) {
      const [path, query = ''] = item.path.split('?');
      if (location.pathname !== path) return false;
      const expected = new URLSearchParams(query);
      const current = new URLSearchParams(location.search);
      for (const [key, value] of expected.entries()) {
        if (current.get(key) !== value) return false;
      }
      return true;
    }
    return isSubItemActive(item, location.pathname, location.search);
  }

  function isSubmenuItemPending(item: NavSubItem): boolean {
    if (!pendingPath) return false;
    if (item.match === 'path' && item.path.includes('?')) {
      const [path] = item.path.split('?');
      return pendingPath === path;
    }
    return isSubItemActive(item, pendingPath, pendingSearch ?? '');
  }

  function submenuIcon(
    icon?: React.ComponentType<{ className?: string }>,
    logoUrl?: string,
  ) {
    if (logoUrl) {
      return (
        <span
          aria-hidden
          className="size-4 shrink-0 bg-sidebar-foreground/70"
          style={{
            maskImage: `url("${logoUrl}")`,
            maskRepeat: 'no-repeat',
            maskPosition: 'center',
            maskSize: 'contain',
            WebkitMaskImage: `url("${logoUrl}")`,
            WebkitMaskRepeat: 'no-repeat',
            WebkitMaskPosition: 'center',
            WebkitMaskSize: 'contain',
          }}
        />
      );
    }
    if (icon) {
      const Icon = icon;
      return <Icon className="size-4 shrink-0 text-sidebar-foreground/70" />;
    }
    return <span aria-hidden className="size-4 shrink-0" />;
  }

  function iconOnlyNavItem(
    key: string,
    label: string,
    content: React.ReactNode,
  ) {
    return (
      <li key={key} className="list-none">
        <Tooltip>
          <TooltipTrigger asChild>{content}</TooltipTrigger>
          <TooltipContent side="right" className="font-medium">
            {label}
          </TooltipContent>
        </Tooltip>
      </li>
    );
  }

  return (
    <div className="relative z-20 flex h-screen shrink-0">
      <TooltipProvider>
        <aside
          className={cn(
            'motion-sidebar-shell relative flex h-screen flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground antialiased',
            collapsed ? 'w-16' : 'w-[13.5rem]',
          )}
        >
          <div
            data-testid="sidebar-logo-rail"
            className={cn(
              'flex h-[70px] shrink-0 items-center overflow-hidden',
              compactMode ? 'justify-center px-2' : 'px-4',
            )}
          >
            <WorkspacePicker collapsed={compactMode} />
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size={null}
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                onClick={() => setCollapsed(current => !current)}
                className="motion-colors absolute top-[70px] -right-4 z-20 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-sidebar-border bg-sidebar text-sidebar-foreground/70 shadow-sm outline-none hover:bg-sidebar-accent/100 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              >
                {collapsed ? (
                  <ChevronsRight className="size-4" />
                ) : (
                  <ChevronsLeft className="size-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" className="font-medium">
              {collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            </TooltipContent>
          </Tooltip>

          <nav
            // Named because it is no longer the page's only navigation
            // landmark — detail routes render a "Breadcrumb" nav too, and two
            // unnamed landmarks of the same type are indistinguishable to a
            // screen reader (axe `landmark-unique`).
            aria-label="Main"
            className={cn(
              'min-h-0 flex-1 overflow-x-hidden overflow-y-auto pt-1.5',
              compactMode ? 'px-2' : 'px-2.5',
            )}
          >
            <motion.div
              layout
              transition={
                prefersReducedMotion
                  ? motionTransitions.instant
                  : motionTransitions.sidebarDisclosure
              }
              className="flex min-h-full flex-col"
            >
              <motion.div
                layout
                transition={
                  prefersReducedMotion
                    ? motionTransitions.instant
                    : motionTransitions.sidebarDisclosure
                }
                className="space-y-3"
              >
                {sections.map(section => (
                  <motion.section
                    layout
                    key={section.id}
                    transition={
                      prefersReducedMotion
                        ? motionTransitions.instant
                        : motionTransitions.sidebarDisclosure
                    }
                    className="space-y-1"
                  >
                    {(() => {
                      const isSectionExpanded =
                        sectionExpandedOverrides[section.id] ?? true;

                      if (compactMode) {
                        return (
                          <ul className="space-y-0.5">
                            {section.items.map(item => {
                              const Icon = item.icon;
                              const itemIsActive = isActive(item.path);
                              return iconOnlyNavItem(
                                item.path,
                                item.label,
                                <NavigationIntentLink
                                  to={item.path}
                                  aria-label={item.label}
                                  aria-busy={isPending(item.path) || undefined}
                                  aria-current={
                                    itemIsActive ? 'page' : undefined
                                  }
                                  className={cn(
                                    'group motion-colors flex h-8 w-full items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                                    itemIsActive
                                      ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                                      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/65 hover:text-sidebar-foreground/95',
                                  )}
                                >
                                  <Icon
                                    className={cn(
                                      'motion-colors size-3.5 shrink-0',
                                      itemIsActive
                                        ? 'text-sidebar-primary'
                                        : 'text-sidebar-foreground/60 group-hover:text-sidebar-primary',
                                    )}
                                  />
                                </NavigationIntentLink>,
                              );
                            })}
                          </ul>
                        );
                      }

                      return (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size={null}
                            onClick={() =>
                              setSectionExpandedOverrides(prev => ({
                                ...prev,
                                [section.id]: !isSectionExpanded,
                              }))
                            }
                            aria-label={`${isSectionExpanded ? 'Collapse' : 'Expand'} ${section.label} section`}
                            className="motion-colors flex h-6 w-full items-center justify-start gap-1 rounded-sm px-1.5 text-[10px] font-semibold tracking-[0.08em] text-sidebar-foreground/55 uppercase outline-none hover:bg-sidebar-accent/45 hover:text-sidebar-foreground/80 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                          >
                            <span className="text-left">{section.label}</span>
                            <span
                              aria-hidden
                              className={cn(
                                'ml-1 block h-0 w-0 shrink-0 border-y-[3px] border-l-[4px] border-y-transparent border-l-current',
                                'motion-transform-standard-reduced',
                                isSectionExpanded ? 'rotate-90' : '',
                              )}
                            />
                          </Button>
                          <AnimatePresence initial={false}>
                            {isSectionExpanded ? (
                              <motion.div
                                key={`${section.id}-items`}
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
                                <ul className="space-y-0.5">
                                  {section.items.map(item => {
                                    const itemSubmenuItems =
                                      submenuItemsForPath(item.path);
                                    const itemIsActive = isActive(item.path);
                                    const override =
                                      expandedOverrides[item.path];
                                    const isExpanded = override ?? itemIsActive;
                                    const isExpandable =
                                      itemSubmenuItems.length > 0;
                                    const Icon = item.icon;
                                    // The parent row is a link to its first
                                    // sub-item ("All" for the category listings),
                                    // so clicking a section both reveals its
                                    // choices and lands on the default one. The
                                    // chevron beside it is the only control that
                                    // toggles without navigating.
                                    const submenuTarget =
                                      itemSubmenuItems[0]?.path ?? item.path;
                                    const submenuId = `sidebar-submenu-${item.path.replace(/\W+/g, '-')}`;
                                    // The parent and its first sub-item share a
                                    // destination, so only the more specific of
                                    // the two announces itself as the current
                                    // page.
                                    const submenuItemIsActive =
                                      itemSubmenuItems.some(
                                        isSubmenuItemActive,
                                      );

                                    return (
                                      <li key={item.path} className="list-none">
                                        {isExpandable ? (
                                          <>
                                            {/* Background and hover live on
                                            the wrapper, not the link, so one
                                            highlight covers the link, the
                                            chevron and the count. */}
                                            <div
                                              className={cn(
                                                'group motion-colors flex h-7 w-full items-center gap-1.5 rounded-sm pr-1.5 text-[13px] font-normal',
                                                itemIsActive
                                                  ? 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground shadow-sm'
                                                  : isExpanded
                                                    ? 'bg-sidebar-accent/50 text-sidebar-foreground hover:font-semibold'
                                                    : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/65 hover:font-semibold hover:text-sidebar-foreground/95',
                                              )}
                                            >
                                              <NavigationIntentLink
                                                to={submenuTarget}
                                                aria-describedby={
                                                  counts[`${item.path}`] == null
                                                    ? undefined
                                                    : navCountId(item.path)
                                                }
                                                aria-busy={
                                                  isPending(item.path) ||
                                                  undefined
                                                }
                                                aria-current={
                                                  itemIsActive &&
                                                  !submenuItemIsActive
                                                    ? 'page'
                                                    : undefined
                                                }
                                                className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-sm pl-1.5 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                                              >
                                                <Icon
                                                  className={cn(
                                                    'motion-colors size-3.5 shrink-0',
                                                    itemIsActive
                                                      ? 'text-sidebar-primary'
                                                      : 'text-sidebar-foreground/60 group-hover:text-sidebar-primary',
                                                  )}
                                                />
                                                <span className="max-w-[9rem] overflow-hidden text-left text-ellipsis whitespace-nowrap">
                                                  {item.label}
                                                </span>
                                              </NavigationIntentLink>
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size={null}
                                                onClick={() =>
                                                  setExpandedOverrides(
                                                    prev => ({
                                                      ...prev,
                                                      [item.path]: !(
                                                        prev[item.path] ??
                                                        itemIsActive
                                                      ),
                                                    }),
                                                  )
                                                }
                                                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${item.label}`}
                                                aria-expanded={isExpanded}
                                                aria-controls={submenuId}
                                                className="size-5 shrink-0 rounded-sm text-sidebar-foreground/75 outline-none hover:bg-transparent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-0"
                                              >
                                                <span
                                                  aria-hidden
                                                  className={cn(
                                                    'motion-transform-standard-reduced block h-0 w-0 shrink-0 border-y-[3px] border-l-[4px] border-y-transparent border-l-current',
                                                    isExpanded
                                                      ? 'rotate-90'
                                                      : '',
                                                  )}
                                                />
                                              </Button>
                                              <SidebarCount
                                                count={counts[`${item.path}`]}
                                                path={item.path}
                                              />
                                            </div>

                                            <AnimatePresence initial={false}>
                                              {isExpanded ? (
                                                <motion.div
                                                  id={submenuId}
                                                  key={`${item.path}-submenu`}
                                                  initial={{
                                                    height: 0,
                                                    opacity: 0,
                                                  }}
                                                  animate={{
                                                    height: 'auto',
                                                    opacity: 1,
                                                  }}
                                                  exit={{
                                                    height: 0,
                                                    opacity: 0,
                                                  }}
                                                  transition={
                                                    prefersReducedMotion
                                                      ? motionTransitions.instant
                                                      : motionTransitions.sidebarDisclosure
                                                  }
                                                  className="overflow-hidden"
                                                >
                                                  <ul className="mt-0.5 ml-3 space-y-0.5 border-l border-sidebar-border/60 pl-2.5">
                                                    {itemSubmenuItems.map(
                                                      subItem => (
                                                        <li
                                                          key={subItem.path}
                                                          className="list-none"
                                                        >
                                                          <NavigationIntentLink
                                                            to={subItem.path}
                                                            aria-busy={
                                                              isSubmenuItemPending(
                                                                subItem,
                                                              ) || undefined
                                                            }
                                                            aria-current={
                                                              isSubmenuItemActive(
                                                                subItem,
                                                              )
                                                                ? 'page'
                                                                : undefined
                                                            }
                                                            className={cn(
                                                              'motion-colors flex h-7 w-full items-center gap-1.5 rounded-sm px-1.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                                                              isSubmenuItemActive(
                                                                subItem,
                                                              )
                                                                ? 'bg-sidebar-accent/55 font-medium text-sidebar-foreground'
                                                                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
                                                            )}
                                                          >
                                                            {submenuIcon(
                                                              subItem.icon,
                                                              subItem.logoUrl,
                                                            )}
                                                            <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                                                              {subItem.label}
                                                            </span>
                                                          </NavigationIntentLink>
                                                        </li>
                                                      ),
                                                    )}
                                                  </ul>
                                                </motion.div>
                                              ) : null}
                                            </AnimatePresence>
                                          </>
                                        ) : (
                                          <NavigationIntentLink
                                            to={item.path}
                                            aria-describedby={
                                              counts[`${item.path}`] == null
                                                ? undefined
                                                : navCountId(item.path)
                                            }
                                            aria-busy={
                                              isPending(item.path) || undefined
                                            }
                                            aria-current={
                                              itemIsActive ? 'page' : undefined
                                            }
                                            className={cn(
                                              'group motion-colors flex h-7 w-full items-center gap-1.5 rounded-sm px-1.5 text-[13px] font-normal outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                                              itemIsActive
                                                ? 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground shadow-sm'
                                                : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/65 hover:font-semibold hover:text-sidebar-foreground/95',
                                            )}
                                          >
                                            <Icon
                                              className={cn(
                                                'motion-colors size-3.5 shrink-0',
                                                itemIsActive
                                                  ? 'text-sidebar-primary'
                                                  : 'text-sidebar-foreground/60 group-hover:text-sidebar-primary',
                                              )}
                                            />
                                            <span className="max-w-[9rem] overflow-hidden text-left text-ellipsis whitespace-nowrap">
                                              {item.label}
                                            </span>
                                            <SidebarCount
                                              count={counts[`${item.path}`]}
                                              path={item.path}
                                            />
                                          </NavigationIntentLink>
                                        )}
                                      </li>
                                    );
                                  })}
                                </ul>
                              </motion.div>
                            ) : null}
                          </AnimatePresence>
                        </>
                      );
                    })()}
                  </motion.section>
                ))}
              </motion.div>

              {(roadieUrl || auth || bottomNavItems.length > 0) && (
                <motion.div
                  layout
                  transition={
                    prefersReducedMotion
                      ? motionTransitions.instant
                      : motionTransitions.sidebarDisclosure
                  }
                  className="mt-auto pt-3 pb-3"
                >
                  <Separator className="my-2 bg-sidebar-border" />
                  <ul className="space-y-0.5">
                    {bottomNavItems.map(item => {
                      const Icon = item.icon;
                      const submenuItems =
                        bottomSubItemsByPath.get(item.path) ?? [];
                      const isExpandable = submenuItems.length > 0;
                      const itemIsActive = isActive(item.path);
                      const isExpanded =
                        bottomExpandedOverrides[item.path] ??
                        (itemIsActive ||
                          submenuItems.some(subItem =>
                            isSubmenuItemActive(subItem),
                          ));
                      if (compactMode) {
                        if (item.disclosureOnly && isExpandable) {
                          return iconOnlyNavItem(
                            `${item.path}-toggle`,
                            item.text,
                            <Button
                              type="button"
                              variant="ghost"
                              size={null}
                              aria-label={item.text}
                              onClick={() => {
                                setCollapsed(false);
                                setBottomExpandedOverrides(prev => ({
                                  ...prev,
                                  [item.path]: true,
                                }));
                              }}
                              className={cn(
                                'group motion-colors flex h-8 w-full items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                                itemIsActive
                                  ? 'bg-sidebar-accent/55 text-sidebar-foreground'
                                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/55 hover:text-sidebar-foreground',
                              )}
                            >
                              <Icon className="size-3.5 shrink-0 text-sidebar-foreground/60" />
                            </Button>,
                          );
                        }
                        return iconOnlyNavItem(
                          item.path,
                          item.text,
                          <NavigationIntentLink
                            to={item.path}
                            aria-label={item.text}
                            aria-busy={isPending(item.path) || undefined}
                            aria-current={itemIsActive ? 'page' : undefined}
                            className={cn(
                              'group motion-colors flex h-8 w-full items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                              itemIsActive
                                ? 'bg-sidebar-accent/55 text-sidebar-foreground'
                                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/55 hover:text-sidebar-foreground',
                            )}
                          >
                            <Icon className="size-3.5 shrink-0 text-sidebar-foreground/60" />
                          </NavigationIntentLink>,
                        );
                      }
                      return (
                        <li key={item.path} className="list-none">
                          {isExpandable ? (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                size={null}
                                onClick={() =>
                                  setBottomExpandedOverrides(prev => ({
                                    ...prev,
                                    [item.path]: !isExpanded,
                                  }))
                                }
                                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${item.text}`}
                                className={cn(
                                  'group motion-colors flex h-7 w-full items-center justify-start gap-1.5 rounded-sm px-1.5 text-[13px] font-normal outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                                  itemIsActive
                                    ? 'bg-sidebar-accent/55 font-medium text-sidebar-foreground'
                                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/55 hover:text-sidebar-foreground',
                                )}
                              >
                                <Icon className="size-3.5 shrink-0 text-sidebar-foreground/60" />
                                <span className="max-w-[9rem] overflow-hidden text-left text-ellipsis whitespace-nowrap">
                                  {item.text}
                                </span>
                                <span
                                  aria-hidden
                                  className={cn(
                                    'motion-transform-standard-reduced ml-1 block h-0 w-0 shrink-0 border-y-[3px] border-l-[4px] border-y-transparent border-l-current text-sidebar-foreground/75',
                                    isExpanded ? 'rotate-90' : '',
                                  )}
                                />
                              </Button>

                              <AnimatePresence initial={false}>
                                {isExpanded ? (
                                  <motion.div
                                    key={`${item.path}-bottom-submenu`}
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
                                    <ul className="mt-0.5 ml-3 space-y-0.5 border-l border-sidebar-border/60 pl-2.5">
                                      {submenuItems.map(subItem => (
                                        <li
                                          key={subItem.path}
                                          className="list-none"
                                        >
                                          <NavigationIntentLink
                                            to={subItem.path}
                                            aria-busy={
                                              isSubmenuItemPending(subItem) ||
                                              undefined
                                            }
                                            aria-current={
                                              isSubmenuItemActive(subItem)
                                                ? 'page'
                                                : undefined
                                            }
                                            className={cn(
                                              'motion-colors flex h-7 w-full items-center gap-1.5 rounded-sm px-1.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                                              isSubmenuItemActive(subItem)
                                                ? 'bg-sidebar-accent/55 font-medium text-sidebar-foreground'
                                                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
                                            )}
                                          >
                                            {submenuIcon(
                                              subItem.icon,
                                              subItem.logoUrl,
                                            )}
                                            <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                                              {subItem.label}
                                            </span>
                                          </NavigationIntentLink>
                                        </li>
                                      ))}
                                    </ul>
                                  </motion.div>
                                ) : null}
                              </AnimatePresence>
                            </>
                          ) : (
                            <NavigationIntentLink
                              to={item.path}
                              aria-busy={isPending(item.path) || undefined}
                              aria-current={itemIsActive ? 'page' : undefined}
                              className={cn(
                                'motion-colors flex h-7 w-full items-center gap-1.5 rounded-sm px-1.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                                itemIsActive
                                  ? 'bg-sidebar-accent/55 font-medium text-sidebar-foreground'
                                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/55 hover:text-sidebar-foreground',
                              )}
                            >
                              <Icon className="size-3.5 shrink-0 text-sidebar-foreground/60" />
                              <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                                {item.text}
                              </span>
                            </NavigationIntentLink>
                          )}
                        </li>
                      );
                    })}
                    {roadieUrl ? (
                      compactMode ? (
                        iconOnlyNavItem(
                          'back-to-app',
                          'Back to App',
                          <a
                            href={roadieUrl}
                            aria-label="Back to App"
                            className="motion-colors flex h-8 w-full items-center justify-center rounded-sm text-sidebar-foreground/70 outline-none hover:bg-sidebar-accent/55 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                          >
                            <ArrowLeft className="size-3.5 shrink-0 text-sidebar-foreground/60" />
                          </a>,
                        )
                      ) : (
                        <li className="list-none">
                          <a
                            href={roadieUrl}
                            className="motion-colors flex h-7 w-full items-center justify-start gap-1.5 rounded-sm px-1.5 text-[13px] text-sidebar-foreground/70 outline-none hover:bg-sidebar-accent/55 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                          >
                            <ArrowLeft className="size-3.5 shrink-0 text-sidebar-foreground/60" />
                            <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                              Back to App
                            </span>
                          </a>
                        </li>
                      )
                    ) : null}
                    {auth ? (
                      compactMode ? (
                        iconOnlyNavItem(
                          'logout',
                          'Log out',
                          <Button
                            type="button"
                            variant="ghost"
                            size={null}
                            aria-label="Log out"
                            onClick={() => auth.logout()}
                            className="motion-colors flex h-8 w-full items-center justify-center rounded-sm text-sidebar-foreground/70 outline-none hover:bg-sidebar-accent/55 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                          >
                            <LogOut className="size-3.5 shrink-0 text-sidebar-foreground/60" />
                          </Button>,
                        )
                      ) : (
                        <li className="list-none">
                          <Button
                            type="button"
                            variant="ghost"
                            size={null}
                            onClick={() => auth.logout()}
                            className="motion-colors flex h-7 w-full items-center justify-start gap-1.5 rounded-sm px-1.5 text-[13px] text-sidebar-foreground/70 outline-none hover:bg-sidebar-accent/55 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                          >
                            <LogOut className="size-3.5 shrink-0 text-sidebar-foreground/60" />
                            <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                              Log out
                            </span>
                          </Button>
                        </li>
                      )
                    ) : null}
                  </ul>
                </motion.div>
              )}
            </motion.div>
          </nav>
        </aside>
      </TooltipProvider>
    </div>
  );
}
