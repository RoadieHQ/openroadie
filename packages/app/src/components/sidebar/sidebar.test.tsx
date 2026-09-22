import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { Home } from 'lucide-react';
import { Sidebar, matchesPendingPath } from './sidebar';
import type { NavItem } from '../../config/navigation';

const mockUseAuth = vi.fn();
const mockUseFeatureFlag = vi.fn();
vi.mock('../../api', () => ({
  useAuth: () => mockUseAuth(),
  useFeatureFlag: (...args: unknown[]) => mockUseFeatureFlag(...args),
}));
// The rail's workspace picker pulls in the workspaces feature (API client,
// query provider, forms); this suite is about nav items, so it stands in for it.
vi.mock('../workspaces', () => ({
  WorkspacePicker: ({ collapsed }: { collapsed: boolean }) => (
    <div data-testid="workspace-picker" data-collapsed={collapsed} />
  ),
}));
vi.mock('../data-sources/use-data-sources', () => ({
  useDataSources: () => ({
    dataSources: [
      { id: 'ds-1', name: 'GitHub Source', objectCount: 10, logoUrl: '' },
      { id: 'ds-2', name: 'PagerDuty Source', objectCount: 4, logoUrl: '' },
    ],
  }),
}));
const mockUseSidebarCounts = vi.fn();
vi.mock('./use-sidebar-counts', () => ({
  useSidebarCounts: () => mockUseSidebarCounts(),
}));
vi.mock('../data-sources/objects/graph/saved-views', () => ({
  useSavedGraphViews: () => ({
    views: [
      {
        id: 'view-1',
        name: 'Critical Paths',
        params: { view: 'paths' },
        objectState: undefined,
        camera: null,
        createdAt: '2026-07-30T00:00:00Z',
      },
    ],
    saveView: vi.fn(),
    deleteView: vi.fn(),
  }),
}));

const navItems: NavItem[] = [
  { text: 'Datastore', path: '/datastore', icon: Home },
  { text: 'Data Sources', path: '/data-sources', icon: Home },
  { text: 'Integrations', path: '/integrations', icon: Home },
  { text: 'Relationships', path: '/relationships', icon: Home },
  { text: 'Context Groups', path: '/context-groups', icon: Home },
  { text: 'Capabilities', path: '/capabilities', icon: Home },
  { text: 'Actions', path: '/actions', icon: Home },
];
const bottomNavItems: NavItem[] = [
  { text: 'Administration', path: '/admin', icon: Home },
];
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'roadie.sidebar.collapsed';

function renderSidebar(
  props: {
    roadieUrl?: string;
    navItems?: NavItem[];
    route?: string;
    pendingPath?: string;
    pendingSearch?: string;
  } = {},
) {
  const {
    route = '/data-sources',
    navItems: items = navItems,
    ...rest
  } = props;
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Sidebar navItems={items} bottomNavItems={bottomNavItems} {...rest} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">{`${location.pathname}${location.search}`}</div>
  );
}

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.removeItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
    mockUseAuth.mockReturnValue(null);
    mockUseSidebarCounts.mockReturnValue({});
    mockUseFeatureFlag.mockImplementation((flagName: unknown) => {
      if (flagName === 'webhooks') {
        return { value: true };
      }
      return { value: false };
    });
  });

  it('renders section headers and expandable subsection rows', () => {
    renderSidebar();

    expect(screen.getByText('Explore')).toBeInTheDocument();
    expect(screen.getByText('Configure')).toBeInTheDocument();
    expect(screen.getByText('Act')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Data Sources/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Integrations/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All' })).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Datastore' }),
    ).not.toBeInTheDocument();
  });

  it('hides Back to App when roadieUrl is unset', () => {
    renderSidebar();

    expect(screen.queryByText('Back to App')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Performance' }),
    ).not.toBeInTheDocument();
  });

  it('renders table as a direct link in explore', () => {
    renderSidebar({ route: '/datastore' });

    expect(screen.getByRole('link', { name: 'Data Store' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      screen.queryByRole('button', { name: /Data Store/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'GitHub Source' }),
    ).not.toBeInTheDocument();
  });

  it('shows graph saved-search options in the single column', () => {
    renderSidebar({ route: '/datastore/graph' });

    expect(
      screen.getByRole('link', { name: 'Data Store' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Collapse Graph' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New' })).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Critical Paths' }),
    ).toBeInTheDocument();
  });

  it('shows category options for integrations', () => {
    renderSidebar({ route: '/integrations' });

    expect(
      screen.getByRole('link', { name: 'Source Control' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Monitoring' }),
    ).toBeInTheDocument();
  });

  it('renders relationships and concepts as direct links', () => {
    renderSidebar({ route: '/relationships' });

    expect(screen.getByRole('link', { name: 'Relationships' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      screen.getByRole('link', { name: 'Context Groups' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Relationships/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Context Groups/ }),
    ).not.toBeInTheDocument();
  });

  it('renders capabilities as a direct link without submenu', () => {
    renderSidebar({ route: '/capabilities' });

    expect(screen.getByRole('link', { name: 'Capabilities' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      screen.queryByRole('button', { name: /Capabilities/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'All' })).not.toBeInTheDocument();
  });

  it('renders actions as a direct link without submenu', () => {
    renderSidebar({ route: '/actions' });

    expect(screen.getByRole('link', { name: 'Actions' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      screen.queryByRole('button', { name: /Actions/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'All' })).not.toBeInTheDocument();
  });

  it('shows observe category with MCP audit log link', () => {
    renderSidebar({ route: '/admin/mcp-audit-log' });

    expect(screen.getByText('Observe')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Agent Sessions' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(
      screen.getByRole('link', { name: 'Service Tokens' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Agent Sessions/ }),
    ).not.toBeInTheDocument();
  });

  it('shows service tokens section in observe', () => {
    renderSidebar({ route: '/admin/webhooks' });

    expect(
      screen.getByRole('link', { name: 'Service Tokens' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(
      screen.getByRole('link', { name: 'Agent Sessions' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Service Tokens/ }),
    ).not.toBeInTheDocument();
  });

  it('hides service tokens when webhooks feature flag is disabled', () => {
    mockUseFeatureFlag.mockImplementation((flagName: unknown) => {
      if (flagName === 'webhooks') {
        return { value: false };
      }
      return { value: false };
    });

    renderSidebar({ route: '/admin/mcp-audit-log' });

    expect(
      screen.getByRole('link', { name: 'Agent Sessions' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Service Tokens' }),
    ).not.toBeInTheDocument();
  });

  it('keeps data-sources route in Configure section', () => {
    renderSidebar({ route: '/data-sources' });

    expect(screen.getByRole('link', { name: 'All' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      screen.queryByRole('link', { name: 'Source Control' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Integrations/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Collapse Explore section' }),
    ).toBeInTheDocument();
  });

  it('navigates to the first sub-item when an expandable row is clicked', async () => {
    const user = userEvent.setup();
    renderSidebar({ route: '/capabilities' });

    const integrations = screen.getByRole('link', { name: 'Integrations' });
    expect(integrations).toHaveAttribute('href', '/integrations');

    await user.click(integrations);

    expect(screen.getByTestId('location')).toHaveTextContent('/integrations');
    expect(screen.getByRole('link', { name: 'All' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('marks only the selected category as current, not All', async () => {
    renderSidebar({ route: '/integrations?group=scm' });

    expect(
      screen.getByRole('link', { name: 'Source Control' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'All' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('drops the group filter when the active section row is clicked', async () => {
    const user = userEvent.setup();
    renderSidebar({ route: '/integrations?group=scm' });

    await user.click(screen.getByRole('link', { name: 'Integrations' }));

    expect(screen.getByTestId('location')).toHaveTextContent('/integrations');
    expect(screen.getByTestId('location')).not.toHaveTextContent('group=scm');
  });

  it('toggles a section from the chevron without navigating', async () => {
    const user = userEvent.setup();
    renderSidebar({ route: '/capabilities' });

    await user.click(
      screen.getByRole('button', { name: 'Expand Integrations' }),
    );

    expect(screen.getByTestId('location')).toHaveTextContent('/capabilities');
    expect(screen.getByRole('link', { name: 'All' })).toBeInTheDocument();
  });

  it('keeps previous subsection expanded until navigation occurs', async () => {
    const user = userEvent.setup();
    renderSidebar({ route: '/data-sources' });

    expect(
      screen.getByRole('button', { name: 'Collapse Data Sources' }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Expand Integrations' }),
    );
    expect(
      screen.getByRole('button', { name: 'Collapse Data Sources' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Collapse Integrations' }),
    ).toBeInTheDocument();

    const integrationsSourceControl = screen
      .getAllByRole('link', { name: 'Source Control' })
      .find(link => link.getAttribute('href') === '/integrations?group=scm');
    expect(integrationsSourceControl).toBeTruthy();
    await user.click(integrationsSourceControl!);
    expect(
      screen.getByRole('button', { name: 'Expand Data Sources' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Collapse Integrations' }),
    ).toBeInTheDocument();
  });

  it('marks bottom destination as busy while pending', () => {
    renderSidebar({ pendingPath: '/admin/secrets' });
    expect(
      screen.getByRole('link', { name: 'Administration' }),
    ).toHaveAttribute('aria-busy', 'true');
  });

  it('shows admin submenu links when bottom item has submenu', () => {
    const adminBottomNav: NavItem[] = [
      {
        text: 'Administration',
        path: '/admin',
        icon: Home,
        disclosureOnly: true,
        submenu: [{ label: 'Secrets', path: '/admin/secrets', match: 'path' }],
      },
    ];

    render(
      <MemoryRouter initialEntries={['/admin/secrets']}>
        <Sidebar navItems={navItems} bottomNavItems={adminBottomNav} />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('button', { name: 'Collapse Administration' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Secrets' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('shows back-to-app link when configured', () => {
    renderSidebar({ roadieUrl: 'http://localhost:3000' });
    expect(screen.getByRole('link', { name: 'Back to App' })).toHaveAttribute(
      'href',
      'http://localhost:3000',
    );
  });

  it('shows a count beside each row it has one for', () => {
    mockUseSidebarCounts.mockReturnValue({
      '/datastore': 150,
      '/capabilities': 12,
      '/data-sources': 3,
    });
    renderSidebar();

    expect(screen.getByRole('link', { name: 'Data Store' })).toHaveTextContent(
      '150',
    );
    expect(
      screen.getByRole('link', { name: 'Capabilities' }),
    ).toHaveTextContent('12');
    // An expandable row keeps its count outside the link, immediately after the
    // chevron, so the numbers line up down the rail's right edge whether or not
    // a row expands.
    const chevron = screen.getByRole('button', {
      name: 'Collapse Data Sources',
    });
    expect(chevron.nextElementSibling).toHaveTextContent('3');
    // No count published for Actions - the row renders without one rather than
    // claiming zero.
    expect(screen.getByRole('link', { name: 'Actions' })).not.toHaveTextContent(
      /\d/,
    );
  });

  it('leaves the row named after its destination, not its count', () => {
    mockUseSidebarCounts.mockReturnValue({
      '/capabilities': 12,
      '/context-groups': 4,
    });
    renderSidebar();

    // The app and the e2e suite locate these rows by exact name; a count folded
    // into the name renames every one of them. A string `name` here matches the
    // whole accessible name, so these fail the moment the count joins it.
    expect(screen.getByRole('link', { name: 'Capabilities' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Context Groups' })).toBeVisible();
  });

  it('describes the row with the exact count while showing a rounded one', () => {
    mockUseSidebarCounts.mockReturnValue({ '/datastore': 124509 });
    const { container } = renderSidebar();

    const row = screen.getByRole('link', { name: 'Data Store' });
    expect(row).toHaveTextContent('124.5K');
    expect(row.querySelector('[title="124,509"]')).not.toBeNull();

    // Assistive tech gets the exact number as the row's description.
    const describedBy = row.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(container.querySelector(`#${describedBy}`)).toHaveTextContent(
      '124,509',
    );
  });

  it("shows a real zero rather than hiding the row's count", () => {
    mockUseSidebarCounts.mockReturnValue({ '/actions': 0 });
    renderSidebar();

    // Zero is a fact about an empty section; only an unknown count is omitted.
    const row = screen.getByRole('link', { name: 'Actions' });
    expect(row).toHaveTextContent('0');
    expect(row.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('leaves a row with no count undescribed', () => {
    mockUseSidebarCounts.mockReturnValue({});
    renderSidebar();

    expect(screen.getByRole('link', { name: 'Actions' })).not.toHaveAttribute(
      'aria-describedby',
    );
  });

  it('spells counts out up to four digits and rounds beyond', () => {
    mockUseSidebarCounts.mockReturnValue({
      '/capabilities': 9999,
      '/actions': 10000,
    });
    renderSidebar();

    // 9,999 still fits the rail; 10,000 is where rounding starts.
    const exact = screen.getByRole('link', { name: 'Capabilities' });
    expect(exact).toHaveTextContent('9,999');
    expect(exact.querySelector('[title]')).toBeNull();

    const rounded = screen.getByRole('link', { name: 'Actions' });
    expect(rounded).toHaveTextContent('10K');
    expect(rounded.querySelector('[title="10,000"]')).not.toBeNull();
  });

  it('keeps counts out of the icon-only rail', async () => {
    const user = userEvent.setup();
    mockUseSidebarCounts.mockReturnValue({ '/datastore': 150 });
    renderSidebar();

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    // The icon-only rail arrives on a timer after the width transition; the
    // section headers going away is what marks it, since the row's accessible
    // name is deliberately identical in both modes.
    await waitFor(() =>
      expect(screen.queryByText('Explore')).not.toBeInTheDocument(),
    );
    expect(screen.queryByText('150')).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Data Store' }),
    ).not.toHaveAttribute('aria-describedby');
  });

  it('collapses to an icon-only rail with hover labels', async () => {
    const user = userEvent.setup();
    renderSidebar({ route: '/data-sources' });

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    expect(
      screen.getByRole('button', { name: 'Expand sidebar' }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('Explore')).not.toBeInTheDocument();
      expect(screen.queryByText('Configure')).not.toBeInTheDocument();
      expect(screen.queryByText('Data Store')).not.toBeInTheDocument();
    });

    const dataStoreIconLink = screen.getByRole('link', { name: 'Data Store' });
    await user.hover(dataStoreIconLink);
    expect((await screen.findAllByText('Data Store')).length).toBeGreaterThan(
      0,
    );

    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(screen.getByText('Explore')).toBeInTheDocument();
  });
});

describe('matchesPendingPath', () => {
  it('matches both a route and its detail destinations', () => {
    expect(matchesPendingPath('/actions', '/actions')).toBe(true);
    expect(matchesPendingPath('/actions', '/actions/action-1')).toBe(true);
    expect(matchesPendingPath('/actions', '/capabilities')).toBe(false);
  });
});
