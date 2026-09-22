import { useMemo, type ComponentType } from 'react';
import { Boxes, LayoutGrid, Star } from 'lucide-react';
import { OVERVIEW_ALL_GROUP, useOverviewGroups } from '../overview';
import { CATEGORY_ICON } from '../integrations/types';
import type { NavItem, NavSubItem } from '../../config/navigation';

const FAVORITES_GROUP_KEY = 'favorites';

/** Bundled lucide icon for a group key (All / Favorites / a fixed category). */
function iconForGroup(key: string): ComponentType<{ className?: string }> {
  if (key === OVERVIEW_ALL_GROUP) return LayoutGrid;
  if (key === FAVORITES_GROUP_KEY) return Star;
  // eslint-disable-next-line security/detect-object-injection -- key is a fixed category key
  return CATEGORY_ICON[key] ?? Boxes;
}

/**
 * Resolve the inline sub-items for a nav item. Static `submenu` (e.g. Admin)
 * takes precedence. For pages with a `dynamicGroupsRouteKey`, sub-items are the
 * **count-driven** groups the active page publishes (only non-empty categories,
 * plus All / Favorites) — retained per route, so they render instantly from
 * cache on return and only refresh when the page republishes. Icons are bundled
 * lucide glyphs, so no logo/network data is needed to render them.
 *
 * Before a route has published any snapshot this session there are no sub-items
 * (an empty list), so the nav item renders as a plain link and the disclosure
 * only mounts — and animates open once, with the full category set — when real
 * counts arrive. We deliberately avoid seeding an "All"-only placeholder: that
 * would mount the disclosure open with a single item and then grow it as the
 * categories land, which reads as a two-step flicker ("All" first, then the
 * rest).
 */
export function useSidebarSubItems(item: NavItem): NavSubItem[] {
  const snapshot = useOverviewGroups(item.dynamicGroupsRouteKey ?? '');

  return useMemo(() => {
    if (item.submenu?.length) {
      return [...item.submenu];
    }

    const routeKey = item.dynamicGroupsRouteKey;
    if (!routeKey) return [];

    const groups = snapshot?.groups ?? [];

    return groups.map((group): NavSubItem => {
      const isAll = group.key === OVERVIEW_ALL_GROUP;
      return {
        label: group.label,
        path: isAll ? item.path : `${item.path}?group=${group.key}`,
        match: 'query',
        queryKey: 'group',
        queryValue: isAll ? '' : group.key,
        count: group.count,
        icon: iconForGroup(group.key),
      };
    });
  }, [item.submenu, item.dynamicGroupsRouteKey, item.path, snapshot]);
}
