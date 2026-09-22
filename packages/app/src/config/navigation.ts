import { useMemo, type ComponentType } from 'react';
import {
  Blocks,
  Database,
  Network,
  Rocket,
  Settings,
  Share2,
  Sparkles,
  Table,
  Users,
  Waypoints,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PATHS } from './paths';
import { useAppConfig, useFeatureFlag } from '../api';
import { useAdminSections } from './admin-sections';

export type NavSubItem = {
  label: string;
  /** Full href; query form e.g. '/data-sources?group=github'. */
  path: string;
  match: 'path' | 'query';
  /** For query match, e.g. 'group'. */
  queryKey?: string;
  /** '' means the default/no-param (All). */
  queryValue?: string;
  count?: number;
  logoUrl?: string;
  /** Optional icon component, rendered when {@link logoUrl} is absent. */
  icon?: ComponentType<{ className?: string }>;
};

export type NavItem = {
  text: string;
  icon: LucideIcon;
  path: string;
  /** Static sub-items (e.g. Admin). */
  submenu?: readonly NavSubItem[];
  /** Sub-items come from the OverviewData context, keyed by route (e.g. PATHS.DATA_SOURCES). */
  dynamicGroupsRouteKey?: string;
  /**
   * The parent row has no landing page of its own — clicking it toggles the
   * disclosure rather than navigating (e.g. Administration, which would
   * otherwise fall through to its first section). Only meaningful for items
   * with sub-items.
   */
  disclosureOnly?: boolean;
  /** Render a group separator immediately above this item (never as the first row). */
  separatorBefore?: boolean;
};

const topNavItems: NavItem[] = [
  { text: 'Getting started', icon: Rocket, path: PATHS.GETTING_STARTED },
  {
    text: 'Capabilities',
    icon: Sparkles,
    path: PATHS.CAPABILITIES,
    separatorBefore: true,
  },
  { text: 'Actions', icon: Zap, path: PATHS.ACTIONS },
  {
    text: 'Datastore',
    icon: Database,
    path: PATHS.DATASTORE,
    separatorBefore: true,
    submenu: [
      {
        label: 'Table',
        path: PATHS.DATASTORE,
        match: 'path',
        icon: Table,
      },
      {
        label: 'Graph',
        path: PATHS.DATASTORE_GRAPH,
        match: 'path',
        icon: Network,
      },
    ],
  },
  {
    text: 'Context Groups',
    icon: Users,
    path: PATHS.CONTEXT_GROUPS,
    separatorBefore: true,
  },
  { text: 'Relationships', icon: Waypoints, path: PATHS.RELATIONSHIPS },
  {
    text: 'Data Sources',
    icon: Share2,
    path: PATHS.DATA_SOURCES,
    dynamicGroupsRouteKey: PATHS.DATA_SOURCES,
  },
  {
    text: 'Integrations',
    icon: Blocks,
    path: PATHS.INTEGRATIONS,
    dynamicGroupsRouteKey: PATHS.INTEGRATIONS,
    separatorBefore: true,
  },
];

export const navItems = topNavItems;

export function useNavItems(): NavItem[] {
  const { value: relationshipsEnabled } = useFeatureFlag('relationships', true);

  return useMemo(
    () =>
      topNavItems.filter(item => {
        // Relationships and Context Groups are part of the relationships feature.
        if (
          (item.path === PATHS.RELATIONSHIPS ||
            item.path === PATHS.CONTEXT_GROUPS) &&
          !relationshipsEnabled
        ) {
          return false;
        }
        return true;
      }),
    [relationshipsEnabled],
  );
}

export function useBottomNavItems(): NavItem[] {
  const adminEnabled = useAppConfig().features?.admin ?? false;
  const adminSections = useAdminSections();

  return useMemo(() => {
    if (!adminEnabled) return [];
    return [
      {
        text: 'Administration',
        icon: Settings,
        path: PATHS.ADMIN,
        disclosureOnly: true,
        submenu: adminSections
          .filter(section => section.path !== PATHS.ADMIN_MCP_AUDIT_LOG)
          .map(
            ({ label, path, icon }): NavSubItem => ({
              label,
              path,
              match: 'path',
              icon,
            }),
          ),
      },
    ];
  }, [adminEnabled, adminSections]);
}
