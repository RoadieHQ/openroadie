import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { TooltipProvider } from '@roadiehq/ui/tooltip';
import { Settings } from 'lucide-react';
import type { NavItem } from '../../config/navigation';
import { OverviewDataProvider, usePublishOverviewData } from '../overview';
import type { OverviewGroupsSnapshot } from '../overview';
import {
  SidebarExpandableNavItem,
  activeSubItem,
  isSubItemActive,
} from './sidebar-expandable-nav-item';

const adminItem: NavItem = {
  text: 'Administration',
  icon: Settings,
  path: '/admin',
  submenu: [
    { label: 'Secrets', path: '/admin/secrets', match: 'path' },
    { label: 'Webhooks', path: '/admin/webhooks', match: 'path' },
  ],
};

const dataSourcesItem: NavItem = {
  text: 'Data Sources',
  icon: Settings,
  path: '/data-sources',
  dynamicGroupsRouteKey: '/data-sources',
};

const dataSourcesSnapshot: OverviewGroupsSnapshot = {
  routeKey: '/data-sources',
  activeGroup: 'all',
  groups: [
    { key: 'all', label: 'All', count: 2 },
    { key: 'github', label: 'GitHub', count: 1 },
  ],
};

function Publisher({ snapshot }: { snapshot: OverviewGroupsSnapshot }) {
  usePublishOverviewData(snapshot);
  return null;
}

function renderItem(
  props: Partial<React.ComponentProps<typeof SidebarExpandableNavItem>> = {},
  initialEntries: string[] = ['/'],
) {
  const merged: React.ComponentProps<typeof SidebarExpandableNavItem> = {
    item: adminItem,
    icon: Settings,
    label: 'Administration',
    to: '/admin',
    collapsed: false,
    parentActive: false,
    pathname: '/',
    search: '',
    ...props,
  };
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <TooltipProvider>
        <ul>
          <SidebarExpandableNavItem {...merged} />
        </ul>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

function renderDynamicItem({
  snapshot,
  pendingPath,
  pendingSearch,
}: {
  snapshot?: OverviewGroupsSnapshot;
  pendingPath?: string;
  pendingSearch?: string;
} = {}) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <TooltipProvider>
        <OverviewDataProvider>
          {snapshot ? <Publisher snapshot={snapshot} /> : null}
          <ul>
            <SidebarExpandableNavItem
              item={dataSourcesItem}
              icon={Settings}
              label="Data Sources"
              to="/data-sources"
              collapsed={false}
              parentActive={false}
              pathname="/"
              search=""
              pendingPath={pendingPath}
              pendingSearch={pendingSearch}
            />
          </ul>
        </OverviewDataProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe('isSubItemActive', () => {
  it('matches path sub-items by exact path and nested paths', () => {
    const sub = {
      label: 'Secrets',
      path: '/admin/secrets',
      match: 'path' as const,
    };
    expect(isSubItemActive(sub, '/admin/secrets', '')).toBe(true);
    expect(isSubItemActive(sub, '/admin/secrets/new', '')).toBe(true);
    expect(isSubItemActive(sub, '/admin/webhooks', '')).toBe(false);
  });

  it('matches query sub-items by route + query value', () => {
    const github = {
      label: 'GitHub',
      path: '/data-sources?group=github',
      match: 'query' as const,
      queryKey: 'group',
      queryValue: 'github',
    };
    expect(isSubItemActive(github, '/data-sources', '?group=github')).toBe(
      true,
    );
    expect(isSubItemActive(github, '/data-sources', '?group=gitlab')).toBe(
      false,
    );
    expect(isSubItemActive(github, '/integrations', '?group=github')).toBe(
      false,
    );
    expect(
      isSubItemActive(github, '/data-sources/github-source', '?group=github'),
    ).toBe(false);
  });

  it('treats empty queryValue as the default (no param) — the All sub-item', () => {
    const all = {
      label: 'All',
      path: '/data-sources',
      match: 'query' as const,
      queryKey: 'group',
      queryValue: '',
    };
    expect(isSubItemActive(all, '/data-sources', '')).toBe(true);
    expect(isSubItemActive(all, '/data-sources', '?group=github')).toBe(false);
    expect(isSubItemActive(all, '/data-sources/ds-1', '')).toBe(false);
    expect(isSubItemActive(all, '/integrations/new', '')).toBe(false);
  });
});

describe('activeSubItem', () => {
  // Datastore's sub-items: the Table path is a prefix of the Graph path.
  const table = {
    label: 'Table',
    path: '/datastore',
    match: 'path' as const,
  };
  const graph = {
    label: 'Graph',
    path: '/datastore/graph',
    match: 'path' as const,
  };

  it('picks only the most specific match among nested sibling paths', () => {
    expect(activeSubItem([table, graph], '/datastore/graph', '')) //
      .toBe(graph);
    expect(activeSubItem([table, graph], '/datastore', '')).toBe(table);
    expect(activeSubItem([table, graph], '/datastore/ds-1/obj-1', '')).toBe(
      table,
    );
  });

  it('returns null when nothing matches', () => {
    expect(activeSubItem([table, graph], '/integrations', '')).toBeNull();
  });
});

describe('SidebarExpandableNavItem', () => {
  it('shows inline children when the parent route is active', () => {
    renderItem({ parentActive: true });
    expect(screen.getByText('Secrets')).toBeInTheDocument();
    expect(screen.getByText('Webhooks')).toBeInTheDocument();
  });

  it('is collapsed by default when inactive, and toggles expansion via the chevron', async () => {
    const user = userEvent.setup();
    renderItem({ parentActive: false });

    // Sub-items stay mounted (so the height transition can animate); the toggle
    // signals collapsed/expanded via aria-expanded rather than mount/unmount.
    expect(
      screen.getByRole('button', { name: /expand administration/i }),
    ).toHaveAttribute('aria-expanded', 'false');

    await user.click(
      screen.getByRole('button', { name: /expand administration/i }),
    );
    expect(
      screen.getByRole('button', { name: /collapse administration/i }),
    ).toHaveAttribute('aria-expanded', 'true');

    await user.click(
      screen.getByRole('button', { name: /collapse administration/i }),
    );
    expect(
      screen.getByRole('button', { name: /expand administration/i }),
    ).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows the chevron for dynamic items before overview groups have loaded', () => {
    renderDynamicItem();
    expect(
      screen.getByRole('button', { name: /expand data sources/i }),
    ).toBeInTheDocument();
  });

  it('expands dynamic sub-items after overview groups load', async () => {
    const user = userEvent.setup();
    renderDynamicItem({ snapshot: dataSourcesSnapshot });

    const toggle = await screen.findByRole('button', {
      name: /expand data sources/i,
    });
    await user.click(toggle);

    expect(screen.getByRole('link', { name: /all/i })).toHaveAttribute(
      'href',
      '/data-sources',
    );
    expect(screen.getByRole('link', { name: /github/i })).toHaveAttribute(
      'href',
      '/data-sources?group=github',
    );
  });

  it('marks only the matching query sub-item as busy', async () => {
    const user = userEvent.setup();
    renderDynamicItem({
      snapshot: dataSourcesSnapshot,
      pendingPath: '/data-sources',
      pendingSearch: '?group=github',
    });

    await user.click(
      await screen.findByRole('button', { name: /expand data sources/i }),
    );

    expect(screen.getByRole('link', { name: /github/i })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByRole('link', { name: /all/i })).not.toHaveAttribute(
      'aria-busy',
    );
  });

  it('keeps a manually collapsed section closed when groups finish loading', async () => {
    const user = userEvent.setup();
    const tree = (snapshot?: OverviewGroupsSnapshot) => (
      <MemoryRouter initialEntries={['/data-sources']}>
        <TooltipProvider>
          <OverviewDataProvider>
            {snapshot ? <Publisher snapshot={snapshot} /> : null}
            <ul>
              <SidebarExpandableNavItem
                item={dataSourcesItem}
                icon={Settings}
                label="Data Sources"
                to="/data-sources"
                collapsed={false}
                parentActive
                pathname="/data-sources"
                search=""
              />
            </ul>
          </OverviewDataProvider>
        </TooltipProvider>
      </MemoryRouter>
    );

    const { rerender } = render(tree());

    const toggle = screen.getByRole('button', { name: /expand data sources/i });
    await user.click(toggle);
    await user.click(toggle);

    rerender(tree(dataSourcesSnapshot));

    expect(
      screen.getByRole('button', { name: /expand data sources/i }),
    ).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByRole('link', { name: /github/i }),
    ).not.toBeInTheDocument();
  });

  it('marks the active sub-item with aria-current', () => {
    renderItem({ parentActive: true, pathname: '/admin/secrets' });
    const active = screen.getByText('Secrets').closest('a');
    expect(active).toHaveAttribute('aria-current', 'page');
    const inactive = screen.getByText('Webhooks').closest('a');
    expect(inactive).not.toHaveAttribute('aria-current');
  });

  it('when collapsed, hides inline children and expands the sidebar on parent click', async () => {
    const user = userEvent.setup();
    const onExpandSidebar = vi.fn();
    renderItem({ collapsed: true, parentActive: true, onExpandSidebar });
    expect(screen.queryByText('Secrets')).not.toBeInTheDocument();

    // Collapsed parent renders icon-only (no text label), so target the sole link.
    await user.click(screen.getByRole('link'));
    expect(onExpandSidebar).toHaveBeenCalledTimes(1);
  });

  describe('disclosureOnly items', () => {
    const disclosureItem: NavItem = { ...adminItem, disclosureOnly: true };

    it('renders the parent as a button, not a navigating link', () => {
      renderItem({ item: disclosureItem });
      expect(
        screen.getByRole('button', { name: 'Administration' }),
      ).toBeInTheDocument();
      // No parent link to a landing route (only the sub-item links remain).
      expect(
        screen.queryByRole('link', { name: 'Administration' }),
      ).not.toBeInTheDocument();
    });

    it('toggles the disclosure when the parent row is clicked', async () => {
      const user = userEvent.setup();
      renderItem({ item: disclosureItem, parentActive: false });

      const parent = screen.getByRole('button', { name: 'Administration' });
      expect(parent).toHaveAttribute('aria-expanded', 'false');

      await user.click(parent);
      expect(parent).toHaveAttribute('aria-expanded', 'true');

      await user.click(parent);
      expect(parent).toHaveAttribute('aria-expanded', 'false');
    });

    it('does not render a separate chevron toggle button', () => {
      renderItem({ item: disclosureItem, parentActive: true });
      // The row itself is the toggle, so there is no distinct expand/collapse
      // control — only the parent button carries the disclosure semantics.
      expect(
        screen.queryByRole('button', { name: /administration/i }),
      ).toHaveAttribute('aria-controls');
      expect(screen.getAllByRole('button')).toHaveLength(1);
    });

    it('keeps sub-items navigable as links', () => {
      renderItem({ item: disclosureItem, parentActive: true });
      expect(screen.getByRole('link', { name: 'Secrets' })).toHaveAttribute(
        'href',
        '/admin/secrets',
      );
    });

    it('when collapsed, expands the sidebar on parent click', async () => {
      const user = userEvent.setup();
      const onExpandSidebar = vi.fn();
      renderItem({
        item: disclosureItem,
        collapsed: true,
        parentActive: true,
        onExpandSidebar,
      });
      await user.click(screen.getByRole('button', { name: 'Administration' }));
      expect(onExpandSidebar).toHaveBeenCalledTimes(1);
    });
  });
});
