import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { Button } from '@roadiehq/ui/button';
import { TestQueryProvider } from '../../../test-utils';
import { OverviewDataProvider, useOverviewGroups } from '../../overview';
import { PATHS } from '../../../config/paths';
import { IntegrationOverview } from './integration-overview';
import type { IntegrationItem } from '../types';
import { isGitHubAppIntegration } from '../types';
import { SecretStatusType } from '../../../api/secrets';

const mockWorkflowApi = {
  integrations: {
    delete: vi.fn(),
    listLogos: vi.fn().mockResolvedValue([]),
  },
};

const mockAlertApi = { post: vi.fn() };
const mockSecretsApi = {
  getStorageMode: vi.fn(),
  getSecret: vi.fn().mockRejectedValue(new Error('missing')),
  getKeys: vi.fn().mockResolvedValue([]),
};
const mockPostMessage = vi.fn();

class MockBroadcastChannel {
  postMessage = mockPostMessage;
  close = vi.fn();
}

vi.stubGlobal(
  'BroadcastChannel',
  MockBroadcastChannel as unknown as typeof BroadcastChannel,
);

vi.mock('../../../api', () => ({
  useWorkflows: () => mockWorkflowApi,
  useAlert: () => mockAlertApi,
  useSecrets: () => mockSecretsApi,
}));

const mockUseIntegrations = vi.fn();
vi.mock('../use-integrations', () => ({
  useIntegrations: (...args: unknown[]) => mockUseIntegrations(...args),
}));

vi.mock('../form', () => ({
  IntegrationFormDialog: ({
    open,
    onClose,
    readOnly,
    integration,
    template,
    onSecretsChanged,
    onRequestDelete,
    onRequestDuplicate,
    deleteDisabledReason,
  }: {
    open: boolean;
    onClose: () => void;
    readOnly?: boolean;
    integration?: IntegrationItem;
    template?: IntegrationItem;
    onSecretsChanged?: () => void;
    onRequestDelete?: () => void;
    onRequestDuplicate?: () => void;
    deleteDisabledReason?: string | null;
  }) =>
    open ? (
      <div data-testid="integration-form-dialog">
        <div data-testid="integration-form-mode">
          {readOnly ? 'read-only' : 'editable'}
        </div>
        <div data-testid="integration-form-kind">
          {integration ? 'edit' : template ? 'duplicate' : 'create'}
        </div>
        <Button type="button" variant="ghost" onClick={onClose}>
          Close Form
        </Button>
        {onSecretsChanged ? (
          <Button type="button" onClick={onSecretsChanged}>
            Secret changed
          </Button>
        ) : null}
        {onRequestDuplicate ? (
          <Button type="button" onClick={onRequestDuplicate}>
            Duplicate integration
          </Button>
        ) : null}
        {onRequestDelete ? (
          <Button
            type="button"
            disabled={!!deleteDisabledReason}
            onClick={onRequestDelete}
          >
            Delete integration
          </Button>
        ) : null}
      </div>
    ) : null,
  GitHubIntegrationDialog: ({
    open,
    onRequestDelete,
    onRequestDuplicate,
    deleteDisabledReason,
  }: {
    open: boolean;
    onRequestDelete?: () => void;
    onRequestDuplicate?: () => void;
    deleteDisabledReason?: string | null;
  }) =>
    open ? (
      <div data-testid="github-integration-dialog">
        {onRequestDuplicate ? (
          <Button type="button" onClick={onRequestDuplicate}>
            Duplicate integration
          </Button>
        ) : null}
        {onRequestDelete ? (
          <Button
            type="button"
            disabled={!!deleteDisabledReason}
            onClick={onRequestDelete}
          >
            Delete integration
          </Button>
        ) : null}
      </div>
    ) : null,
}));

function makeItem(overrides?: Partial<IntegrationItem>): IntegrationItem {
  return {
    id: 'int-1',
    name: 'GitHub',
    description: 'api.github.com',
    slug: 'my-integration',
    type: 'scm',
    host: 'https://api.example.com',
    backendType: 'http',
    authType: 'bearer-token',
    config: {},
    readyForCurrentScope: true,
    createdBy: 'user-1',
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-20T10:30:00Z',
    icon: 'data',
    color: '#8b5cf6',
    logoUrl: '',
    referencingWorkflows: [],
    referencingActions: [],
    referencingRelationshipRules: [],
    ...overrides,
  };
}

const mockRefetch = vi.fn();

function setupHook(
  integrations: IntegrationItem[] = [],
  loading = false,
  error?: Error,
) {
  mockUseIntegrations.mockReturnValue({
    integrations,
    loading,
    error,
    refetch: mockRefetch,
    logoDataUriBySlug: new Map<string, string>(),
  });
}

function SearchParamProbe() {
  const location = useLocation();
  return (
    <>
      <div data-testid="current-search">{location.search}</div>
      <div data-testid="current-path">{location.pathname}</div>
    </>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderPage(
  initialEntry = '/integrations',
  props?: React.ComponentProps<typeof IntegrationOverview>,
) {
  return render(
    <TestQueryProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <IntegrationOverview {...props} />
        <SearchParamProbe />
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

/**
 * The standalone page navigates to a routed editor; the dialog wiring exercised
 * by these flows now only lives in the admin embed, so those tests render it.
 */
function renderAdminPage(initialEntry = '/integrations') {
  return renderPage(initialEntry, { embeddedInAdmin: true });
}

async function openIntegrationEditorFromTable(id: string) {
  act(() => {
    fireEvent.click(screen.getByTestId(`integration-name-${id}`));
  });
  await waitFor(() => {
    expect(screen.getByTestId('integration-form-dialog')).toBeInTheDocument();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.history.pushState({}, '', '/integrations');
  mockSecretsApi.getStorageMode.mockResolvedValue({
    mode: 'dotenv',
    readOnly: false,
  });
  mockSecretsApi.getSecret.mockRejectedValue(new Error('missing'));
  mockSecretsApi.getKeys.mockResolvedValue([]);
  setupHook();
});

describe('IntegrationOverview', () => {
  it('makeItem() is not treated as a GitHub App integration', () => {
    expect(isGitHubAppIntegration(makeItem())).toBe(false);
  });

  describe('rendering', () => {
    it('renders page header with title "Integrations"', () => {
      renderPage();
      expect(
        screen.getAllByRole('heading', { name: 'Integrations' }).length,
      ).toBeGreaterThanOrEqual(1);
    });

    it('omits the page header when embedded in admin', () => {
      setupHook([makeItem()]);
      renderPage('/admin/integrations', { embeddedInAdmin: true });
      expect(
        screen.queryByRole('heading', { name: 'Integrations' }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /New/ })).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText('Search by name, host, or category...'),
      ).toBeInTheDocument();
    });

    it('shows loading indicator when data is loading', () => {
      vi.useFakeTimers();
      try {
        setupHook([], true);
        const { container } = renderPage();
        // Skeleton is delay-gated (anti-flicker) — appears shortly after mount.
        act(() => {
          vi.advanceTimersByTime(200);
        });
        expect(container.querySelector('.motion-skeleton')).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('renders empty state when no integrations exist', () => {
      renderPage();
      expect(screen.getByText('No integrations yet')).toBeInTheDocument();
      expect(
        screen.getByText(
          'Integrations connect your external systems. Create your first one to get started.',
        ),
      ).toBeInTheDocument();
    });

    it('shows a load error state instead of the empty state', () => {
      setupHook([], false, new Error('Boom'));
      renderPage();
      expect(
        screen.getByText('Failed to load integrations'),
      ).toBeInTheDocument();
      expect(screen.getByText('Boom')).toBeInTheDocument();
      expect(screen.queryByText('No integrations yet')).not.toBeInTheDocument();
    });

    it('renders integration items when data is available', () => {
      setupHook([makeItem(), makeItem({ id: 'int-2', name: 'PagerDuty' })]);
      renderPage();
      // Standalone renders plain-text names (row click opens the detail drawer),
      // so assert on the cell text rather than a button.
      expect(screen.getByText('GitHub')).toBeInTheDocument();
      expect(screen.getByText('PagerDuty')).toBeInTheDocument();
    });

    it('shows source and configuration badges for a pre-built integration', async () => {
      setupHook([makeItem({ createdBy: 'system' })]);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Pre-built')).toBeInTheDocument();
        expect(screen.getByText('Ready')).toBeInTheDocument();
      });
    });

    it('does not show a transient loading badge before secret summaries are ready', async () => {
      const storageMode = deferred<{ mode: 'dotenv'; readOnly: false }>();
      mockSecretsApi.getStorageMode.mockReturnValue(storageMode.promise);

      setupHook([makeItem({ createdBy: 'system' })]);
      renderPage();

      expect(
        screen.getByTestId('integration-status-loading-skeleton'),
      ).toBeInTheDocument();
      expect(screen.getByText('Pre-built')).toBeInTheDocument();
      expect(
        screen.queryByText('Checking configuration...'),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('Ready')).not.toBeInTheDocument();

      storageMode.resolve({
        mode: 'dotenv',
        readOnly: false,
      });

      await waitFor(() => {
        expect(screen.getByText('Pre-built')).toBeInTheDocument();
        expect(screen.getByText('Ready')).toBeInTheDocument();
      });
    });

    it('shows configuration required for an AWS integration with no profiles', async () => {
      setupHook([
        makeItem({
          name: 'AWS',
          slug: 'aws',
          type: 'infrastructure',
          host: '',
          backendType: 'aws',
          authType: 'none',
          createdBy: 'system',
          config: {},
        }),
      ]);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Needs setup')).toBeInTheDocument();
      });
      expect(screen.queryByText('Ready')).not.toBeInTheDocument();
      // The item now surfaces via the "Needs setup" status filter option (the
      // old "Missing configuration" section header no longer exists).
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Setup' }));
      expect(
        await screen.findByRole('option', { name: /Needs setup/ }),
      ).toBeInTheDocument();
    });

    it('shows missing secret status when required secrets are unset', async () => {
      mockSecretsApi.getKeys.mockResolvedValueOnce([
        {
          name: 'ROOTLY_API_KEY',
          value: '',
          description: '',
          status: SecretStatusType.Not_Set,
        },
      ]);
      setupHook([
        makeItem({
          authConfig: {
            headers: {
              Authorization: 'Bearer ${ROOTLY_API_KEY}',
            },
          },
        }),
      ]);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Needs setup')).toBeInTheDocument();
      });
    });

    it('shows a pending approval alert for GitHub App install requests', async () => {
      renderPage('/integrations?github-app-install-requested=true');

      await waitFor(() => {
        expect(mockAlertApi.post).toHaveBeenCalledWith({
          message:
            'An org admin must approve this installation request. You can close this tab; the installation will appear in Roadie once approved.',
          severity: 'info',
        });
      });

      expect(mockRefetch).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('current-search')).toHaveTextContent('');
    });

    it('does not restore GitHub app install params after later filter changes', async () => {
      const user = userEvent.setup();
      setupHook([makeItem()]);
      renderPage('/integrations?github-app-install-requested=true');

      await waitFor(() => {
        expect(mockAlertApi.post).toHaveBeenCalledWith({
          message:
            'An org admin must approve this installation request. You can close this tab; the installation will appear in Roadie once approved.',
          severity: 'info',
        });
      });

      expect(screen.getByTestId('current-search')).toHaveTextContent('');

      await user.type(
        screen.getByPlaceholderText('Search by name, host, or category...'),
        'git',
      );

      expect(screen.getByTestId('current-search')).toHaveTextContent(
        '?search=git',
      );
      expect(screen.getByTestId('current-search')).not.toHaveTextContent(
        'github-app-install-requested',
      );
      expect(screen.getByTestId('current-search')).not.toHaveTextContent(
        'github-app-installed',
      );
      expect(screen.getByTestId('current-search')).not.toHaveTextContent(
        'close-after',
      );
    });

    it('reads category and search from URL on first load', () => {
      setupHook([
        makeItem({ id: 'int-1', name: 'GitHub', type: 'scm' }),
        makeItem({ id: 'int-2', name: 'Datadog', type: 'monitoring' }),
      ]);

      renderPage('/integrations?group=scm&search=git');

      expect(screen.getByText('GitHub')).toBeInTheDocument();
      expect(screen.queryByText('Datadog')).not.toBeInTheDocument();
    });

    it('writes search filter changes to URL params', async () => {
      const user = userEvent.setup();
      setupHook([
        makeItem({ id: 'int-1', name: 'GitHub', type: 'scm' }),
        makeItem({ id: 'int-2', name: 'Datadog', type: 'monitoring' }),
      ]);
      renderPage('/integrations');

      await user.type(
        screen.getByPlaceholderText('Search by name, host, or category...'),
        'git',
      );

      expect(screen.getByTestId('current-search')).toHaveTextContent(
        '?search=git',
      );
    });

    it('filters audited built-in integration categories from URL params', () => {
      setupHook([
        makeItem({ id: 'int-1', name: 'Snyk', type: 'security' }),
        makeItem({
          id: 'int-2',
          name: 'Shortcut',
          type: 'project-management',
        }),
        makeItem({ id: 'int-3', name: 'Datadog', type: 'monitoring' }),
      ]);

      renderPage('/integrations?group=security&search=snyk');

      expect(screen.getByText('Snyk')).toBeInTheDocument();
      expect(screen.queryByText('Shortcut')).not.toBeInTheDocument();
      expect(screen.queryByText('Datadog')).not.toBeInTheDocument();
    });
  });

  describe('table listing', () => {
    it('shows category for each integration row', () => {
      setupHook([
        makeItem({ id: 'int-1', name: 'GitHub', type: 'scm' }),
        makeItem({
          id: 'int-2',
          name: 'Datadog',
          type: 'monitoring',
        }),
      ]);
      renderPage();
      expect(
        screen.getByRole('columnheader', { name: 'Category' }),
      ).toBeInTheDocument();
      expect(screen.getByText('Source Control')).toBeInTheDocument();
      expect(screen.getByText('Monitoring')).toBeInTheDocument();
    });

    it('shows audited built-in integration category labels', () => {
      setupHook([
        makeItem({ id: 'int-1', name: 'Snyk', type: 'security' }),
        makeItem({ id: 'int-2', name: 'SonarCloud', type: 'security' }),
        makeItem({
          id: 'int-3',
          name: 'Shortcut',
          type: 'project-management',
        }),
        makeItem({ id: 'int-4', name: 'Harness', type: 'ci-cd' }),
      ]);
      renderPage();
      expect(screen.getAllByText('Security')).toHaveLength(2);
      expect(screen.getByText('Project Management')).toBeInTheDocument();
      expect(screen.getByText('CI / CD')).toBeInTheDocument();
    });

    it('assigns "Other" category label to integrations with unknown type', () => {
      setupHook([makeItem({ type: 'unknown-type' })]);
      renderPage();
      expect(screen.getByText('Other')).toBeInTheDocument();
    });

    it('offers category facets from Category and readiness facets from Setup', async () => {
      const user = userEvent.setup();
      setupHook([makeItem()]);
      renderPage();

      await user.click(screen.getByRole('button', { name: 'Category' }));
      expect(
        screen.getByRole('option', { name: 'Source Control' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('option', { name: 'Ready' }),
      ).not.toBeInTheDocument();
      await user.keyboard('{Escape}');

      await user.click(screen.getByRole('button', { name: 'Setup' }));
      expect(
        screen.getByRole('option', { name: 'Needs setup' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Ready' })).toBeInTheDocument();
      expect(
        screen.queryByRole('option', { name: 'Source Control' }),
      ).not.toBeInTheDocument();
    });

    it('filters integrations by source and stores the filter in the URL', async () => {
      const user = userEvent.setup();
      setupHook([
        makeItem({ id: 'int-1', name: 'Custom API', createdBy: 'user-1' }),
        makeItem({ id: 'int-2', name: 'GitHub', createdBy: 'system' }),
      ]);
      renderPage();

      await user.click(screen.getByRole('button', { name: 'Source' }));
      await user.click(screen.getByRole('option', { name: 'Pre-built' }));
      await user.keyboard('{Escape}');

      await waitFor(() => {
        expect(screen.getByTestId('current-search')).toHaveTextContent(
          '?filter.source=system',
        );
        // Standalone page renders the name as plain text (row opens a drawer),
        // not a button.
        expect(screen.getByText('GitHub')).toBeInTheDocument();
        expect(screen.queryByText('Custom API')).not.toBeInTheDocument();
      });
    });
  });

  describe('status filtering', () => {
    it('filters to ready integrations when the Ready chip is selected', async () => {
      const user = userEvent.setup();
      setupHook([
        makeItem({ id: 'int-1', name: 'GitHub', createdBy: 'system' }),
        makeItem({ id: 'int-2', name: 'Broken', readyForCurrentScope: false }),
      ]);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Ready')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'Setup' }));
      await user.click(await screen.findByRole('option', { name: /Ready/ }));

      expect(screen.getByText('GitHub')).toBeInTheDocument();
      expect(screen.queryByText('Broken')).not.toBeInTheDocument();
    });

    it('filters to needs-setup integrations when the Needs setup chip is selected', async () => {
      const user = userEvent.setup();
      setupHook([
        makeItem({ id: 'int-1', name: 'GitHub', createdBy: 'system' }),
        makeItem({ id: 'int-2', name: 'Broken', readyForCurrentScope: false }),
      ]);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Ready')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'Setup' }));
      await user.click(
        await screen.findByRole('option', { name: /Needs setup/ }),
      );

      expect(screen.getByText('Broken')).toBeInTheDocument();
      expect(screen.queryByText('GitHub')).not.toBeInTheDocument();
    });
  });

  describe('create', () => {
    it('navigates to the new-integration route when New is clicked', async () => {
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole('button', { name: /New/ }));
      expect(screen.getByTestId('current-path')).toHaveTextContent(
        '/integrations/new',
      );
    });

    it('opens and closes the form dialog in the admin embed', async () => {
      const user = userEvent.setup();
      setupHook([makeItem()]);
      renderAdminPage();
      await user.click(screen.getByRole('button', { name: /New/ }));
      expect(screen.getByTestId('integration-form-dialog')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Close Form' }));
      expect(
        screen.queryByTestId('integration-form-dialog'),
      ).not.toBeInTheDocument();
    });
  });

  describe('detail drawer (standalone)', () => {
    /**
     * Clicking the row *body* opens the drawer; clicking the title navigates
     * instead (see `.claude/rules/listing-navigation.md`), so these tests must
     * target the row rather than the name text.
     */
    async function clickRowBody(
      user: ReturnType<typeof userEvent.setup>,
      name: string,
    ) {
      const row = screen.getByText(name).closest('tr');
      expect(row).not.toBeNull();
      await user.click(row!);
    }

    it('opens the detail drawer on row click', async () => {
      const user = userEvent.setup();
      setupHook([makeItem()]);
      renderPage();
      // Let the async secret-status settle first, otherwise a mid-click
      // re-render swallows the row click.
      await waitFor(() => {
        expect(screen.getByText('Ready')).toBeInTheDocument();
      });

      await clickRowBody(user, 'GitHub');

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('GitHub')).toBeInTheDocument();
      // The drawer is read-first; editing is an explicit routed escape hatch.
      expect(
        within(dialog).getByRole('link', { name: /open editor/i }),
      ).toHaveAttribute('href', '/integrations/int-1');
      // No navigation happened — the standalone page stays put and opens a drawer.
      expect(screen.getByTestId('current-path')).toHaveTextContent(
        '/integrations',
      );
    });

    it('lists each required secret and its state in the drawer', async () => {
      const user = userEvent.setup();
      mockSecretsApi.getKeys.mockResolvedValue([
        {
          name: 'GITHUB_TOKEN',
          value: '',
          description: '',
          status: SecretStatusType.Available,
        },
        {
          name: 'GITHUB_WEBHOOK_SECRET',
          value: '',
          description: '',
          status: SecretStatusType.Not_Set,
        },
      ]);
      // The inline RequiredSecretsPanel resolves each ref via `getSecret`
      // (the summary/banner uses `getKeys`); mirror the two secrets here.
      mockSecretsApi.getSecret.mockImplementation((ref: string) =>
        ref === 'GITHUB_TOKEN'
          ? Promise.resolve({
              name: 'GITHUB_TOKEN',
              value: '',
              description: '',
              status: SecretStatusType.Available,
            })
          : Promise.reject(new Error('missing')),
      );
      setupHook([
        makeItem({
          authConfig: {
            headers: {
              Authorization: 'Bearer ${GITHUB_TOKEN}',
              'X-Hook-Secret': '${GITHUB_WEBHOOK_SECRET}',
            },
          },
        }),
      ]);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Needs setup')).toBeInTheDocument();
      });

      await clickRowBody(user, 'GitHub');

      const dialog = await screen.findByRole('dialog');
      // A warning banner at the top surfaces the setup reason (not a stat tile).
      expect(
        within(dialog).getByText('1 required secret missing'),
      ).toBeInTheDocument();
      // The "Required secrets" section lists each secret; the refs + state
      // badges below are the list itself.
      expect(within(dialog).getByText('Required secrets')).toBeInTheDocument();
      expect(within(dialog).getByText('GITHUB_TOKEN')).toBeInTheDocument();
      expect(
        within(dialog).getByText('GITHUB_WEBHOOK_SECRET'),
      ).toBeInTheDocument();
      // Each ref carries its own inline status control (accessible label),
      // and the missing one can be set right here in the drawer.
      expect(within(dialog).getByLabelText('Configured')).toBeInTheDocument();
      expect(within(dialog).getByLabelText('Not set')).toBeInTheDocument();
      // The unset secret exposes a value field so it can be set inline.
      expect(
        within(dialog).getByPlaceholderText('Click to set secret value'),
      ).toBeInTheDocument();
    });

    it('closes the detail drawer when clicking outside a row', async () => {
      const user = userEvent.setup();
      setupHook([makeItem()]);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Ready')).toBeInTheDocument();
      });
      await clickRowBody(user, 'GitHub');
      expect(await screen.findByRole('dialog')).toBeInTheDocument();

      // Clicking a non-row element (the page description) dismisses the drawer.
      await user.click(
        screen.getByText('Connect external systems and APIs to your catalog.'),
      );
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('navigates to the integration when the title is clicked, without opening the drawer', async () => {
      const user = userEvent.setup();
      setupHook([makeItem()]);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Ready')).toBeInTheDocument();
      });

      const title = screen.getByRole('link', { name: 'GitHub' });
      expect(title).toHaveAttribute('href', '/integrations/int-1');

      await user.click(title);

      expect(screen.getByTestId('current-path')).toHaveTextContent(
        '/integrations/int-1',
      );
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('does not render the detail drawer in the admin embed', async () => {
      setupHook([makeItem()]);
      renderAdminPage();
      // The admin embed opens its edit dialog from the name, not a detail drawer.
      await openIntegrationEditorFromTable('int-1');
      expect(screen.getByTestId('integration-form-dialog')).toBeInTheDocument();
      // The read-only detail drawer (a Radix sheet, role="dialog") is never mounted.
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('editing', () => {
    it('duplicates an integration into create mode', async () => {
      const user = userEvent.setup();
      setupHook([makeItem()]);
      renderAdminPage();
      await openIntegrationEditorFromTable('int-1');
      expect(screen.getByTestId('integration-form-kind')).toHaveTextContent(
        'edit',
      );
      await user.click(
        screen.getByRole('button', { name: 'Duplicate integration' }),
      );
      expect(screen.getByTestId('integration-form-kind')).toHaveTextContent(
        'duplicate',
      );
    });

    it('opens a pre-built HTTP integration in editable mode', async () => {
      setupHook([makeItem({ createdBy: 'system' })]);
      renderAdminPage();
      await openIntegrationEditorFromTable('int-1');
      expect(screen.getByTestId('integration-form-mode')).toHaveTextContent(
        'editable',
      );
    });

    it('opens the seeded AWS integration in editable mode', async () => {
      setupHook([
        makeItem({
          name: 'AWS',
          slug: 'aws',
          type: 'infrastructure',
          host: '',
          backendType: 'aws',
          authType: 'none',
          createdBy: 'system',
          config: {},
        }),
      ]);
      renderAdminPage();
      await openIntegrationEditorFromTable('int-1');
      expect(screen.getByTestId('integration-form-mode')).toHaveTextContent(
        'editable',
      );
    });

    it('refetches integrations when secrets change from the edit dialog', async () => {
      const user = userEvent.setup();
      setupHook([
        makeItem({
          authConfig: {
            headers: {
              Authorization: 'Bearer ${ROOTLY_API_KEY}',
            },
          },
          readyForCurrentScope: false,
        }),
      ]);
      renderAdminPage();
      await openIntegrationEditorFromTable('int-1');
      await user.click(screen.getByRole('button', { name: 'Secret changed' }));
      expect(mockRefetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('delete', () => {
    it('opens confirmation dialog from table row actions without opening edit form', async () => {
      const user = userEvent.setup();
      setupHook([makeItem()]);
      renderPage();
      await waitFor(() => {
        expect(screen.getByRole('table')).toBeInTheDocument();
      });
      // Let the async secret-status settle so the row columns stop re-rendering,
      // otherwise a mid-click re-render can close the freshly opened menu.
      await waitFor(() => {
        expect(screen.getByText('Ready')).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: /actions/i }));
      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument();
      });
      await user.click(screen.getByRole('menuitem', { name: /delete/i }));
      expect(
        screen.getByText(
          'Are you sure you want to delete "GitHub"? This cannot be undone.',
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId('integration-form-dialog'),
      ).not.toBeInTheDocument();
    });

    it('opens confirmation dialog when delete is triggered', async () => {
      const user = userEvent.setup();
      setupHook([makeItem()]);
      renderAdminPage();
      await openIntegrationEditorFromTable('int-1');
      await user.click(
        screen.getByRole('button', { name: 'Delete integration' }),
      );
      expect(
        screen.getByText(/Are you sure you want to delete/),
      ).toBeInTheDocument();
    });

    it('shows integration name in confirmation dialog', async () => {
      const user = userEvent.setup();
      setupHook([makeItem()]);
      renderAdminPage();
      await openIntegrationEditorFromTable('int-1');
      await user.click(
        screen.getByRole('button', { name: 'Delete integration' }),
      );
      expect(
        screen.getByText(
          'Are you sure you want to delete "GitHub"? This cannot be undone.',
        ),
      ).toBeInTheDocument();
    });

    it('deletes and reports success on confirm', async () => {
      const user = userEvent.setup();
      mockWorkflowApi.integrations.delete.mockResolvedValue(undefined);
      setupHook([makeItem()]);
      renderAdminPage();
      await openIntegrationEditorFromTable('int-1');
      await user.click(
        screen.getByRole('button', { name: 'Delete integration' }),
      );
      await user.click(screen.getByTestId('delete-btn-confirmation-dialog'));
      await waitFor(() => {
        expect(mockWorkflowApi.integrations.delete).toHaveBeenCalledWith(
          'int-1',
        );
      });
      // Delete now refreshes the list via cache invalidation (not the hook's
      // refetch); assert the user-visible success outcome instead.
      await waitFor(() => {
        expect(mockAlertApi.post).toHaveBeenCalledWith(
          expect.objectContaining({ message: 'Integration deleted' }),
        );
      });
    });

    it('closes dialog without deleting on cancel', async () => {
      const user = userEvent.setup();
      setupHook([makeItem()]);
      renderAdminPage();
      await openIntegrationEditorFromTable('int-1');
      await user.click(
        screen.getByRole('button', { name: 'Delete integration' }),
      );
      expect(
        screen.getByText(/Are you sure you want to delete/),
      ).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(
        screen.queryByText(/Are you sure you want to delete/),
      ).not.toBeInTheDocument();
      expect(mockWorkflowApi.integrations.delete).not.toHaveBeenCalled();
    });

    it('shows error alert when delete fails', async () => {
      const user = userEvent.setup();
      mockWorkflowApi.integrations.delete.mockRejectedValue(
        new Error('Permission denied'),
      );
      setupHook([makeItem()]);
      renderAdminPage();
      await openIntegrationEditorFromTable('int-1');
      await user.click(
        screen.getByRole('button', { name: 'Delete integration' }),
      );
      await user.click(screen.getByTestId('delete-btn-confirmation-dialog'));
      await waitFor(() => {
        expect(mockAlertApi.post).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining('Permission denied'),
            severity: 'error',
          }),
        );
      });
    });

    it('shows delete in the form for system integrations', async () => {
      setupHook([makeItem({ createdBy: 'system' })]);
      renderAdminPage();
      await openIntegrationEditorFromTable('int-1');
      expect(
        screen.getByRole('button', { name: 'Delete integration' }),
      ).toBeInTheDocument();
    });

    it('shows Delete in table row actions for pre-built integrations', async () => {
      const user = userEvent.setup();
      setupHook([makeItem({ createdBy: 'system' })]);
      renderPage();
      await waitFor(() => {
        expect(screen.getByRole('table')).toBeInTheDocument();
      });
      await waitFor(() => {
        expect(screen.getByText('Ready')).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: /actions/i }));
      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument();
      });
      expect(
        screen.getByRole('menuitem', { name: /delete/i }),
      ).toBeInTheDocument();
    });

    it('disables Delete in table row actions when a pre-built integration is referenced by workflows', async () => {
      const user = userEvent.setup();
      setupHook([
        makeItem({
          createdBy: 'system',
          referencingWorkflows: [{ id: 'wf-1', name: 'My Workflow' }],
        }),
      ]);
      renderPage();
      await waitFor(() => {
        expect(screen.getByRole('table')).toBeInTheDocument();
      });
      await waitFor(() => {
        expect(screen.getByText('Ready')).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: /actions/i }));
      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument();
      });
      expect(screen.getByRole('menuitem', { name: /delete/i })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    });

    it('disables delete in the form when integration is referenced by workflows', async () => {
      setupHook([
        makeItem({
          referencingWorkflows: [{ id: 'wf-1', name: 'My Workflow' }],
        }),
      ]);
      renderAdminPage();
      await openIntegrationEditorFromTable('int-1');
      expect(
        screen.getByRole('button', { name: 'Delete integration' }),
      ).toBeDisabled();
    });
  });

  describe('sidebar group publishing', () => {
    function GroupsProbe() {
      const snapshot = useOverviewGroups(PATHS.INTEGRATIONS);
      return (
        <div data-testid="published-groups">
          {snapshot ? snapshot.groups.map(g => g.key).join(',') : 'none'}
        </div>
      );
    }

    function renderWithSidebar(
      props?: React.ComponentProps<typeof IntegrationOverview>,
    ) {
      return render(
        <TestQueryProvider>
          <OverviewDataProvider>
            <MemoryRouter initialEntries={['/integrations']}>
              <IntegrationOverview {...props} />
            </MemoryRouter>
            <GroupsProbe />
          </OverviewDataProvider>
        </TestQueryProvider>,
      );
    }

    it('does not publish the empty snapshot while loading', async () => {
      setupHook([], true);
      renderWithSidebar();
      // No snapshot published yet: the sidebar keeps its baseline rather than
      // flickering an All-only snapshot before real counts arrive.
      expect(screen.getByTestId('published-groups')).toHaveTextContent('none');
    });

    it('publishes the groups once data has loaded', async () => {
      setupHook([makeItem()], false);
      renderWithSidebar();
      await waitFor(() => {
        expect(screen.getByTestId('published-groups')).toHaveTextContent('all');
      });
    });

    it('does not publish when embedded in admin', async () => {
      setupHook([makeItem()], false);
      renderWithSidebar({ embeddedInAdmin: true });
      // Give any publish effect a chance to run before asserting it didn't.
      await waitFor(() => {
        expect(
          screen.getByTestId('integration-name-int-1'),
        ).toBeInTheDocument();
      });
      expect(screen.getByTestId('published-groups')).toHaveTextContent('none');
    });
  });
});
