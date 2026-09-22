import React from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { Button } from '@roadiehq/ui/button';
import { createTestQueryClient } from '../../../test-utils';

// Owned by the test so specs can spy on `invalidateQueries` — the writes now
// refresh the list via cache invalidation rather than the hook's `refetch`.
let queryClient: QueryClient;
import { DataSourceOverview } from './data-source-overview';
import type { DataSourceItem, IntegrationInfo } from '../types';
import type { WorkflowExecution } from '../../../api/workflow/workflow-client';
import { queryKeys } from '../../../api/queries';

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockWorkflowApi = {
  workflows: {
    create: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
    get: vi.fn(),
    getScheduleInfo: vi.fn(),
  },
  executions: {
    execute: vi.fn(),
    get: vi.fn(),
    getLogs: vi.fn(),
    getRequestLogs: vi.fn(),
    listAll: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  },
};

const mockAlertApi = { post: vi.fn() };

const mockDatastoreApi = {
  deleteAllObjects: vi.fn(),
  queryAllObjects: vi.fn().mockResolvedValue({ total: 0, items: [] }),
  queryObjects: vi.fn().mockResolvedValue({ total: 0, items: [] }),
  listRelationshipRules: vi.fn().mockResolvedValue({ total: 0, items: [] }),
  listContextGroupRules: vi.fn().mockResolvedValue({ total: 0, items: [] }),
  listRelationshipTypes: vi.fn().mockResolvedValue([]),
  queryAllRelationships: vi.fn().mockResolvedValue({ total: 0, items: [] }),
};

vi.mock('../../../api', () => ({
  useWorkflows: () => mockWorkflowApi,
  useAlert: () => mockAlertApi,
  useDatastore: () => mockDatastoreApi,
}));

const mockUseDataSources = vi.fn();
vi.mock('../use-data-sources', () => ({
  useDataSources: (...args: unknown[]) => mockUseDataSources(...args),
}));

// The overview cross-references capabilities to warn before deleting a data
// source that one still points at; drive it via a mock so tests can supply
// capabilities without wiring up the capabilities API.
const mockUseCapabilities = vi.fn();
vi.mock('../../capabilities/use-capabilities', () => ({
  useCapabilities: () => mockUseCapabilities(),
}));

function setupCapabilities(
  capabilities: Array<{ id: string; name: string; instructions: string }> = [],
) {
  mockUseCapabilities.mockReturnValue({
    capabilities,
    total: capabilities.length,
    loading: false,
    error: undefined,
    retry: vi.fn(),
    deleteCapability: vi.fn(),
  });
}

// The delete dialog also warns about context groups that draw from the source.
const mockUseContextGroups = vi.fn();
vi.mock('../../context-groups/use-context-groups', () => ({
  useContextGroups: () => mockUseContextGroups(),
}));

function setupContextGroups(rules: unknown[] = []) {
  mockUseContextGroups.mockReturnValue({
    rules,
    total: rules.length,
    loading: false,
    error: undefined,
    retry: vi.fn(),
    deleteRule: vi.fn(),
    isDeleting: false,
    materializeRule: vi.fn(),
  });
}

const mockUseIntegrationSecretStatus = vi.fn();
vi.mock('../../integrations/use-integration-secret-status', () => ({
  useIntegrationSecretStatus: (...args: unknown[]) =>
    mockUseIntegrationSecretStatus(...args),
  useInvalidateIntegrationSecretStatus: () => vi.fn(),
}));

const mockUseIntegrations = vi.fn(() => ({
  integrations: [],
  logoDataUriBySlug: new Map(),
  loading: false,
  error: undefined,
  refetch: vi.fn(),
}));

vi.mock('../../integrations/use-integrations', () => ({
  useIntegrations: (...args: Parameters<typeof mockUseIntegrations>) =>
    mockUseIntegrations(...args),
}));

vi.mock('../../integrations/types', async importOriginal => ({
  ...(await importOriginal<typeof import('../../integrations/types')>()),
  isGitHubAppIntegration: () => false,
}));

vi.mock('../../integrations/form', () => ({
  IntegrationFormDialog: ({
    open,
    integration,
    onClose,
    onSaved,
  }: {
    open: boolean;
    integration?: { id?: string };
    onClose: () => void;
    onSaved: () => void;
  }) =>
    open ? (
      <div
        role="dialog"
        aria-label={integration ? 'Edit Integration' : 'New Integration'}
      >
        <Button type="button" onClick={onClose}>
          Close integration form
        </Button>
        <Button type="button" onClick={onSaved}>
          Save integration form
        </Button>
      </div>
    ) : null,
  GitHubIntegrationDialog: () => null,
}));

vi.mock('./data-source-seed-picker', async () => {
  const { useState } = await import('react');
  return {
    DataSourceSeedPicker: ({
      onCreateCustom,
      onCreateIntegration,
      onApplyingChange,
    }: any) => {
      const [dirty, setDirty] = useState(false);
      return (
        <div data-testid="seed-picker" data-dirty={dirty}>
          {onCreateCustom && (
            <div
              role="button"
              tabIndex={0}
              onClick={() => onCreateCustom()}
              onKeyDown={() => onCreateCustom()}
            >
              New custom data source
            </div>
          )}
          {onCreateCustom && (
            <div
              role="button"
              tabIndex={0}
              onClick={() => onCreateCustom('int-gh')}
              onKeyDown={() => onCreateCustom('int-gh')}
            >
              New GitHub custom data source
            </div>
          )}
          {onCreateIntegration && (
            <div
              role="button"
              tabIndex={0}
              onClick={() => onCreateIntegration()}
              onKeyDown={() => onCreateIntegration()}
            >
              Add new integration
            </div>
          )}
          <div
            role="button"
            tabIndex={0}
            onClick={() => setDirty(true)}
            onKeyDown={() => setDirty(true)}
          >
            select seed
          </div>
          {onApplyingChange && (
            <>
              <div
                role="button"
                tabIndex={0}
                onClick={() => onApplyingChange(true)}
                onKeyDown={() => onApplyingChange(true)}
              >
                start applying
              </div>
              <div
                role="button"
                tabIndex={0}
                onClick={() => onApplyingChange(false)}
                onKeyDown={() => onApplyingChange(false)}
              >
                stop applying
              </div>
            </>
          )}
        </div>
      );
    },
  };
});

vi.mock('humanize-duration', () => ({
  default: () => '2 hours',
}));

function makeIntegration(
  overrides?: Partial<IntegrationInfo>,
): IntegrationInfo {
  return {
    id: 'int-1',
    slug: 'example',
    type: 'other',
    label: 'Example',
    icon: 'plug',
    color: '#888',
    logoUrl: '',
    ...overrides,
  };
}

function makeItem(overrides?: Partial<DataSourceItem>): DataSourceItem {
  return {
    id: 'ds-1',
    name: 'GitHub Repositories',
    slug: 'github-repositories',
    description: 'Ingests repository metadata',
    version: 1,
    workflowType: 'data-ingestion',
    nodes: [],
    edges: [],
    enabled: true,
    createdBy: 'user-1',
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-20T10:30:00Z',
    logoUrl: '',
    sourceType: 'source-integration',
    isSourceConfigured: true,
    integrationId: 'int-1',
    integration: makeIntegration(),
    ...overrides,
  };
}

const mockRefetch = vi.fn();
const mockNoteRunStarted = vi.fn();
const FAVORITES_STORAGE_KEY = 'roadie.data-sources.favorites';

function setupHook(
  dataSources: DataSourceItem[] = [],
  loading = false,
  error?: Error,
) {
  mockUseDataSources.mockReturnValue({
    dataSources,
    loading,
    error,
    refetch: mockRefetch,
    noteRunStarted: mockNoteRunStarted,
    logoDataUriBySlug: new Map<string, string>(),
  });
}

function renderPage(initialEntries: string[] = ['/']) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <DataSourceOverview />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  queryClient = createTestQueryClient();
  setupHook();
  setupCapabilities();
  setupContextGroups();
  mockWorkflowApi.workflows.getScheduleInfo.mockResolvedValue({
    nextRunAt: null,
  });
  mockDatastoreApi.queryAllObjects.mockResolvedValue({ total: 0, items: [] });
  mockWorkflowApi.executions.listAll.mockResolvedValue({ data: [], total: 0 });
  mockWorkflowApi.executions.getLogs.mockResolvedValue({ data: [] });
  mockWorkflowApi.executions.getRequestLogs.mockResolvedValue([]);
  mockUseIntegrationSecretStatus.mockReturnValue({
    summariesByIntegrationId: new Map(),
    loading: false,
  });
});

async function openActionsMenu(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => {
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
  const actionsButton = screen.getByRole('button', { name: /actions/i });
  await user.click(actionsButton);
  await waitFor(() => {
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
}

function storedFavoriteIds(): string[] {
  return JSON.parse(localStorage.getItem(FAVORITES_STORAGE_KEY) ?? '[]');
}

describe('DataSourceOverview', () => {
  describe('rendering', () => {
    it('renders page header with title "Data Sources"', () => {
      renderPage();
      expect(
        screen.getByRole('heading', { name: 'Data Sources' }),
      ).toBeInTheDocument();
    });

    it('shows name, description, and integration search in the toolbar', () => {
      setupHook([makeItem()]);
      renderPage();
      expect(
        screen.getByRole('searchbox', {
          name: /filter by name, description, or integration/i,
        }),
      ).toBeInTheDocument();
    });

    it('filters rows by search text', async () => {
      const user = userEvent.setup();
      setupHook([
        makeItem({
          id: 'ds-ok',
          name: 'Healthy source',
          enabled: true,
          integration: makeIntegration({ id: 'int-ok' }),
        }),
        makeItem({
          id: 'ds-paused',
          name: 'Paused source',
          enabled: false,
          integration: makeIntegration({ id: 'int-ok' }),
        }),
      ]);
      renderPage();
      const search = screen.getByRole('searchbox', {
        name: /filter by name, description, or integration/i,
      });
      await user.type(search, 'paused');
      await waitFor(() => {
        expect(screen.queryByText('Healthy source')).not.toBeInTheDocument();
      });
      expect(screen.getByText('Paused source')).toBeInTheDocument();

      await user.clear(search);
      await user.type(search, 'healthy');
      await waitFor(() => {
        expect(screen.queryByText('Paused source')).not.toBeInTheDocument();
      });
      expect(screen.getByText('Healthy source')).toBeInTheDocument();
    });

    it('filters configured sources by enabled or disabled status', async () => {
      const user = userEvent.setup();
      setupHook([
        makeItem({ id: 'ds-enabled', name: 'Enabled source', enabled: true }),
        makeItem({
          id: 'ds-disabled',
          name: 'Disabled source',
          enabled: false,
        }),
      ]);

      renderPage();
      await user.click(screen.getByRole('button', { name: 'Status' }));
      await user.click(await screen.findByRole('option', { name: 'Disabled' }));
      await user.keyboard('{Escape}');

      await waitFor(() => {
        expect(screen.queryByText('Enabled source')).not.toBeInTheDocument();
      });
      expect(screen.getByText('Disabled source')).toBeInTheDocument();
    });

    it('keeps legacy status=ready links scoped to configured sources', async () => {
      setupHook([
        makeItem({ id: 'ds-ready', name: 'Configured source' }),
        makeItem({
          id: 'ds-needs-setup',
          name: 'Unconfigured source',
          integration: makeIntegration({ readyForCurrentScope: false }),
        }),
      ]);

      renderPage(['/?status=ready']);

      await waitFor(() => {
        expect(
          screen.queryByText('Unconfigured source'),
        ).not.toBeInTheDocument();
      });
      expect(screen.getByText('Configured source')).toBeInTheDocument();
    });

    it('restores legacy status=failed links as a Run filter', async () => {
      setupHook([
        makeItem({
          id: 'ds-failed',
          name: 'Failed source',
          enabled: true,
          execution: {
            status: 'failed',
            lastRunAt: '2026-07-12T12:00:00Z',
          },
          integration: makeIntegration({ id: 'int-failed' }),
        }),
        makeItem({
          id: 'ds-ok',
          name: 'Healthy source',
          enabled: true,
          execution: {
            status: 'completed',
            lastRunAt: '2026-07-12T12:00:00Z',
          },
          integration: makeIntegration({ id: 'int-ok' }),
        }),
      ]);

      renderPage(['/?status=failed']);

      await waitFor(() => {
        expect(screen.queryByText('Healthy source')).not.toBeInTheDocument();
      });
      expect(screen.getByText('Failed source')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Run' })).toHaveAttribute(
        'data-active',
        'true',
      );
    });

    it('shows "Running…" in the Run column for an in-flight run, not a completed last-run time', async () => {
      setupHook([
        makeItem({
          id: 'ds-running',
          name: 'Running source',
          enabled: true,
          // A retriggered run keeps a lastRunAt (its start) while executing; it
          // must not read as a green "completed" last-run.
          execution: {
            status: 'running',
            lastRunAt: '2026-07-12T12:00:00Z',
          },
        }),
      ]);

      renderPage();

      expect(await screen.findByText('Running…')).toBeInTheDocument();
    });

    it('shows "Running…" in the Run column for a running source with no last-run time yet', async () => {
      // A run triggered elsewhere (schedule / another user) can be running or
      // pending before a start time is recorded — it must still read as running,
      // not fall through to the empty "—"/next-run cell.
      setupHook([
        makeItem({
          id: 'ds-running-nolast',
          name: 'Pending source',
          enabled: true,
          execution: { status: 'running' },
        }),
      ]);

      renderPage();

      expect(await screen.findByText('Running…')).toBeInTheDocument();
    });

    it('keeps execution results out of Status and filters them from Run', async () => {
      const user = userEvent.setup();
      setupHook([
        makeItem({
          id: 'ds-failed',
          name: 'Failed source',
          enabled: true,
          execution: {
            status: 'failed',
            lastRunAt: '2026-07-12T12:00:00Z',
          },
          integration: makeIntegration({ id: 'int-failed' }),
        }),
        makeItem({
          id: 'ds-ok',
          name: 'Healthy source',
          enabled: true,
          execution: {
            status: 'completed',
            lastRunAt: '2026-07-12T12:00:00Z',
          },
          integration: makeIntegration({ id: 'int-ok' }),
        }),
      ]);

      renderPage();
      await user.click(screen.getByRole('button', { name: 'Status' }));
      expect(
        screen.queryByRole('option', { name: 'Failed' }),
      ).not.toBeInTheDocument();
      await user.keyboard('{Escape}');

      await user.click(screen.getByRole('button', { name: 'Run' }));
      await user.click(await screen.findByRole('option', { name: /Failed/ }));
      await user.keyboard('{Escape}');

      await waitFor(() => {
        expect(screen.queryByText('Healthy source')).not.toBeInTheDocument();
      });
      expect(screen.getByText('Failed source')).toBeInTheDocument();
    });

    it('excludes an in-flight run from the "Never" run filter', async () => {
      const user = userEvent.setup();
      setupHook([
        makeItem({
          id: 'ds-running',
          name: 'Running source',
          enabled: true,
          // Running with no lastRunAt: the cell says "Running…", so it must not
          // also be classified as "Never run" by the filter.
          execution: { status: 'running' },
        }),
        makeItem({ id: 'ds-never', name: 'Never source', enabled: true }),
      ]);

      renderPage();
      await user.click(screen.getByRole('button', { name: 'Run' }));
      await user.click(await screen.findByRole('option', { name: 'Never' }));
      await user.keyboard('{Escape}');

      await waitFor(() => {
        expect(screen.queryByText('Running source')).not.toBeInTheDocument();
      });
      expect(screen.getByText('Never source')).toBeInTheDocument();
    });

    it('filters rows by integration label, slug, or type', async () => {
      const user = userEvent.setup();
      setupHook([
        makeItem({
          id: 'ds-a',
          name: 'Repos sync',
          description: 'sync',
          integration: makeIntegration({
            id: 'i-gh',
            label: 'GitHub',
            slug: 'github',
            type: 'scm',
          }),
        }),
        makeItem({
          id: 'ds-b',
          name: 'Alerts feed',
          description: 'incidents',
          integration: makeIntegration({
            id: 'i-pd',
            label: 'PagerDuty',
            slug: 'pagerduty',
            type: 'aws',
          }),
        }),
      ]);
      renderPage();
      const search = screen.getByRole('searchbox', {
        name: /filter by name, description, or integration/i,
      });
      await user.type(search, 'pagerduty');
      await waitFor(() => {
        expect(screen.queryByText('Repos sync')).not.toBeInTheDocument();
      });
      expect(screen.getByText('Alerts feed')).toBeInTheDocument();

      await user.clear(search);
      await user.type(search, 'scm');
      await waitFor(() => {
        expect(screen.queryByText('Alerts feed')).not.toBeInTheDocument();
      });
      expect(screen.getByText('Repos sync')).toBeInTheDocument();
    });

    it('keeps the filter menu open across multiple integration selections', async () => {
      const user = userEvent.setup();
      setupHook([
        makeItem({
          id: 'ds-gh',
          name: 'GitHub source',
          integration: makeIntegration({ id: 'i-gh', label: 'GitHub' }),
        }),
        makeItem({
          id: 'ds-pd',
          name: 'PagerDuty source',
          integration: makeIntegration({ id: 'i-pd', label: 'PagerDuty' }),
        }),
        makeItem({
          id: 'ds-jr',
          name: 'Jira source',
          integration: makeIntegration({ id: 'i-jr', label: 'Jira' }),
        }),
      ]);
      renderPage();

      await user.click(screen.getByRole('button', { name: 'Integrations' }));
      await user.click(screen.getByRole('option', { name: 'GitHub' }));
      // After the first selection the menu must remain open so a second value
      // can be picked without reopening.
      expect(
        screen.getByRole('option', { name: 'PagerDuty' }),
      ).toBeInTheDocument();
      await user.click(screen.getByRole('option', { name: 'PagerDuty' }));
      await user.keyboard('{Escape}');

      expect(screen.getByText('GitHub source')).toBeInTheDocument();
      expect(screen.getByText('PagerDuty source')).toBeInTheDocument();
      expect(screen.queryByText('Jira source')).not.toBeInTheDocument();
    });

    it('offers exact integration values as a column facet', async () => {
      const user = userEvent.setup();
      setupHook([
        makeItem({
          id: 'ds-gh',
          name: 'GitHub source',
          integration: makeIntegration({
            id: 'i-gh',
            label: 'GitHub',
            logoUrl: 'https://example.com/github.svg',
          }),
        }),
        makeItem({
          id: 'ds-pd',
          name: 'PagerDuty source',
          integration: makeIntegration({ id: 'i-pd', label: 'PagerDuty' }),
        }),
      ]);
      renderPage();

      await user.click(screen.getByRole('button', { name: 'Integrations' }));
      const githubFacet = screen.getByRole('option', {
        name: 'GitHub',
      });
      expect(githubFacet.querySelector('img')).toHaveAttribute(
        'src',
        'https://example.com/github.svg',
      );
      expect(
        githubFacet.querySelector('img')?.parentElement?.parentElement,
      ).toHaveClass('bg-integration-icon-well', 'size-5');
      await user.click(screen.getByRole('option', { name: 'PagerDuty' }));
      await user.keyboard('{Escape}');

      expect(screen.getByText('PagerDuty source')).toBeInTheDocument();
      expect(screen.queryByText('GitHub source')).not.toBeInTheDocument();
    });

    it('shows a count for a data source with chained integrations', () => {
      setupHook([
        makeItem({
          id: 'ds-multi',
          name: 'Enriched source',
          integration: makeIntegration({ id: 'i-gh', label: 'GitHub' }),
          integrations: [
            makeIntegration({ id: 'i-gh', label: 'GitHub' }),
            makeIntegration({ id: 'i-pd', label: 'PagerDuty' }),
          ],
        }),
      ]);
      renderPage();

      // The single label is replaced by a count; the labels move to a tooltip.
      expect(screen.getByText('2 integrations')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Edit GitHub integration' }),
      ).not.toBeInTheDocument();
    });

    it('filters by a chained integration the primary source does not use', async () => {
      const user = userEvent.setup();
      setupHook([
        makeItem({
          id: 'ds-multi',
          name: 'Enriched source',
          integration: makeIntegration({ id: 'i-gh', label: 'GitHub' }),
          integrations: [
            makeIntegration({ id: 'i-gh', label: 'GitHub' }),
            makeIntegration({ id: 'i-pd', label: 'PagerDuty' }),
          ],
        }),
        makeItem({
          id: 'ds-plain',
          name: 'Repo source',
          integration: makeIntegration({ id: 'i-gh', label: 'GitHub' }),
          integrations: [makeIntegration({ id: 'i-gh', label: 'GitHub' })],
        }),
      ]);
      renderPage();

      await user.click(screen.getByRole('button', { name: 'Integrations' }));
      // PagerDuty is only a chained source, yet it is offered as a facet value.
      await user.click(screen.getByRole('option', { name: 'PagerDuty' }));
      await user.keyboard('{Escape}');

      expect(screen.getByText('Enriched source')).toBeInTheDocument();
      expect(screen.queryByText('Repo source')).not.toBeInTheDocument();
    });

    it('ignores legacy category query param in the URL', () => {
      setupHook([
        makeItem({
          id: 'ds-mon',
          name: 'Monitoring DS',
          integration: makeIntegration({
            id: 'i-mon',
            type: 'monitoring',
            label: 'PagerDuty',
            slug: 'pagerduty',
          }),
        }),
        makeItem({
          id: 'ds-scm',
          name: 'SCM DS',
          integration: makeIntegration({
            id: 'i-scm',
            type: 'scm',
            label: 'GitHub',
            slug: 'github',
          }),
        }),
      ]);
      renderPage(['/?category=monitoring']);
      expect(screen.getByText('SCM DS')).toBeInTheDocument();
      expect(screen.getByText('Monitoring DS')).toBeInTheDocument();
    });

    it('shows loading indicator when data is loading and no rows exist yet', () => {
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

    it('surfaces the error via a toast', () => {
      setupHook([], false, new Error('Boom'));
      renderPage();
      expect(mockAlertApi.post).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Boom', severity: 'error' }),
      );
    });

    it('shows a load error state instead of the empty state', () => {
      setupHook([], false, new Error('Boom'));
      renderPage();
      expect(
        screen.getByText('Failed to load data sources'),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('seed-picker')).not.toBeInTheDocument();
    });

    it('renders seed picker when no data sources exist', () => {
      renderPage();
      expect(screen.getByTestId('seed-picker')).toBeInTheDocument();
    });

    it('paginates integrated data sources and resets page when search narrows', async () => {
      const user = userEvent.setup();
      const many = Array.from({ length: 55 }, (_, i) =>
        makeItem({
          id: `ds-${i}`,
          name: `Source ${i}`,
          enabled: false,
          integration: makeIntegration({ id: `int-${i}`, label: `Int ${i}` }),
        }),
      );
      setupHook(many);
      renderPage();
      await waitFor(() => {
        expect(screen.getByRole('table')).toBeInTheDocument();
      });
      const tbody = screen.getByRole('table').querySelector('tbody');
      const paginationEl = screen.getByTestId('data-sources-table-pagination');
      const showingLine =
        paginationEl.querySelector(':scope > p')?.textContent ?? '';
      const firstPageShowing = showingLine.match(
        /Showing\s+1[–-](\d+)\s+of\s+55/,
      );
      expect(firstPageShowing).toBeTruthy();
      const pageSize = Number(firstPageShowing![1]);

      expect(tbody?.querySelectorAll('tr').length).toBe(pageSize);
      const normalizedPagination = showingLine.replace(/\s+/g, ' ').trim();
      expect(
        normalizedPagination === `Showing 1–${pageSize} of 55` ||
          normalizedPagination === `Showing 1-${pageSize} of 55`,
      ).toBe(true);

      await user.click(screen.getByRole('button', { name: 'Next page' }));
      const secondPageRows = Math.min(pageSize, 55 - pageSize);
      expect(tbody?.querySelectorAll('tr').length).toBe(secondPageRows);
      expect(screen.getByText(`Source ${pageSize}`)).toBeInTheDocument();

      const search = screen.getByRole('searchbox', {
        name: /filter by name, description, or integration/i,
      });
      await user.type(search, 'Source 52');
      await waitFor(() => {
        expect(screen.getByText('Source 52')).toBeInTheDocument();
      });
      expect(tbody?.querySelectorAll('tr').length).toBe(1);
      expect(
        screen.getByTestId('data-sources-table-pagination'),
      ).toHaveTextContent(/Showing 1[–-]1 of 1/);
    });

    it('renders data source items in a table when data is available', () => {
      setupHook([
        makeItem(),
        makeItem({ id: 'ds-2', name: 'PagerDuty Services' }),
      ]);
      renderPage();
      expect(screen.getByText('GitHub Repositories')).toBeInTheDocument();
      expect(screen.getByText('PagerDuty Services')).toBeInTheDocument();
    });

    it('opens the detail drawer when a row is clicked', async () => {
      const user = userEvent.setup();
      setupHook([makeItem({ id: 'ds-nav', name: 'Clickable source' })]);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Clickable source')).toBeInTheDocument();
      });
      expect(
        screen.getByRole('link', { name: 'Clickable source' }),
      ).toHaveAttribute('href', '/data-sources/ds-nav');
      await user.click(screen.getByText('Clickable source').closest('tr')!);
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Clickable source')).toBeInTheDocument();
      expect(
        within(dialog).getByRole('link', { name: /open editor/i }),
      ).toHaveAttribute('href', '/data-sources/ds-nav');
      expect(within(dialog).getByText('Relationships')).toBeInTheDocument();
    });

    it('opens the latest run details from the Run column', async () => {
      const user = userEvent.setup();
      const dataSource = makeItem({
        id: 'ds-failed',
        name: 'Failed source',
        execution: {
          executionId: 'exec-failed',
          status: 'failed',
          lastRunAt: '2026-07-12T12:00:00Z',
          error: 'GitHub token expired',
        },
      });
      const execution: WorkflowExecution = {
        id: 'exec-failed',
        workflowId: dataSource.id,
        workflowVersion: dataSource.version,
        status: 'failed',
        triggerType: 'manual',
        createdAt: '2026-07-12T12:00:00Z',
        completedAt: '2026-07-12T12:01:00Z',
        error: 'GitHub token expired',
        nodeExecutions: [],
        workflowSnapshot: dataSource,
      };
      setupHook([dataSource]);
      mockWorkflowApi.executions.get.mockResolvedValue(execution);
      renderPage();

      await user.click(
        await screen.findByRole('button', {
          name: 'View latest run for Failed source',
        }),
      );

      const dialog = await screen.findByRole('dialog');
      expect(
        within(dialog).getByRole('heading', { name: 'Run details' }),
      ).toBeInTheDocument();
      expect(
        await within(dialog).findByText('GitHub token expired'),
      ).toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('does not offer dry runs as the latest run', async () => {
      const user = userEvent.setup();
      setupHook([
        makeItem({
          execution: {
            executionId: 'dry-run-1',
            status: 'completed',
            isDryRun: true,
          },
        }),
      ]);
      renderPage();

      await openActionsMenu(user);

      expect(
        screen.getByRole('menuitem', { name: 'View latest run' }),
      ).toHaveAttribute('aria-disabled', 'true');
      expect(
        screen.queryByRole('button', {
          name: 'View latest run for GitHub Repositories',
        }),
      ).not.toBeInTheDocument();
    });

    it('shows a needs-setup banner in the drawer when the source is unconfigured', async () => {
      const user = userEvent.setup();
      mockUseIntegrationSecretStatus.mockReturnValue({
        summariesByIntegrationId: new Map([
          [
            'int-gh',
            {
              requiredSecretRefs: ['GITHUB_TOKEN'],
              missingSecretRefs: ['GITHUB_TOKEN'],
              hasRequiredConfig: true,
              configured: false,
            },
          ],
        ]),
        loading: false,
      });
      setupHook([
        makeItem({
          id: 'ds-setup',
          name: 'Unconfigured source',
          enabled: true,
          integrationId: 'int-gh',
          integration: {
            id: 'int-gh',
            slug: 'github',
            type: 'github',
            label: 'GitHub',
            icon: 'Github',
            color: '#333',
            logoUrl: '',
            backendType: 'http',
            authConfig: null,
            config: {},
            readyForCurrentScope: true,
          },
        }),
      ]);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Unconfigured source')).toBeInTheDocument();
      });
      await user.click(screen.getByText('2 hours ago'));
      const dialog = await screen.findByRole('dialog');
      // A warning banner at the top surfaces the setup reason, matching integrations.
      expect(
        within(dialog).getByText('1 required secret missing'),
      ).toBeInTheDocument();
    });

    it('closes the detail drawer when clicking outside a row', async () => {
      const user = userEvent.setup();
      setupHook([makeItem({ id: 'ds-nav', name: 'Clickable source' })]);
      renderPage();
      await waitFor(() => {
        expect(screen.getByText('Clickable source')).toBeInTheDocument();
      });
      await user.click(screen.getByText('2 hours ago'));
      expect(await screen.findByRole('dialog')).toBeInTheDocument();

      // Clicking a non-row element (the page heading) dismisses the drawer.
      await user.click(screen.getByRole('heading', { name: /data sources/i }));
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('shows a loading state for a deep link while the overview list is loading', async () => {
      setupHook([], true);

      renderPage(['/?detail=ds-deep-link']);

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Data source')).toBeInTheDocument();
      expect(
        within(dialog).queryByRole('link', { name: /open editor/i }),
      ).not.toBeInTheDocument();
    });

    it('shows a not-found state for a stale directly linked detail id', async () => {
      setupHook([], false);

      renderPage(['/?detail=missing-source']);

      const dialog = await screen.findByRole('dialog');
      expect(
        await within(dialog).findByText("Couldn't load details"),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByText('Data source not found.'),
      ).toBeInTheDocument();
    });

    it('shows "Running…" for the Last run of an in-flight source', async () => {
      setupHook([
        makeItem({
          id: 'ds-running',
          name: 'Running source',
          enabled: true,
          execution: {
            status: 'running',
            lastRunAt: '2026-07-12T12:00:00Z',
          },
        }),
      ]);

      renderPage(['/?detail=ds-running']);

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Running…')).toBeInTheDocument();
    });

    it('shows "Running…" for the Last run of a running source with no last-run time', async () => {
      setupHook([
        makeItem({
          id: 'ds-running-nolast',
          name: 'Pending source',
          enabled: true,
          execution: { status: 'running' },
        }),
      ]);

      renderPage(['/?detail=ds-running-nolast']);

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Running…')).toBeInTheDocument();
    });
  });

  describe('table', () => {
    it('shows a neutral linked integration in the table', async () => {
      const user = userEvent.setup();
      mockUseIntegrationSecretStatus.mockReturnValue({
        summariesByIntegrationId: new Map([
          [
            'int-gh',
            {
              requiredSecretRefs: ['GITHUB_TOKEN'],
              missingSecretRefs: ['GITHUB_TOKEN'],
              hasRequiredConfig: true,
              configured: false,
            },
          ],
        ]),
        loading: false,
      });
      setupHook([
        makeItem({
          id: 'ds-1',
          name: 'Needs Setup Source',
          enabled: false,
          integrationId: 'int-gh',
          integration: {
            id: 'int-gh',
            slug: 'github',
            type: 'github',
            label: 'GitHub',
            icon: 'Github',
            color: '#333',
            logoUrl: '',
            backendType: 'http',
            authConfig: null,
            config: {},
            readyForCurrentScope: true,
          },
        }),
        makeItem({
          id: 'ds-2',
          name: 'Active Source',
          enabled: true,
          integrationId: undefined,
          integration: undefined,
        }),
      ]);

      renderPage();

      const integrationBadge = screen.getByText('GitHub');
      expect(integrationBadge).toHaveClass('text-muted-foreground');
      expect(integrationBadge.closest('button')).toHaveAccessibleName(
        'Edit GitHub integration',
      );
      expect(screen.getByText('None')).toBeInTheDocument();

      await user.click(
        screen.getByRole('button', { name: 'Edit GitHub integration' }),
      );
      await waitFor(() =>
        expect(mockUseIntegrations).toHaveBeenCalledWith({ skip: false }),
      );
    });

    it('renders next-run tooltip trigger for enabled data sources without a last run', async () => {
      mockWorkflowApi.workflows.getScheduleInfo.mockResolvedValue({
        nextRunAt: '2026-05-01T08:00:00.000Z',
      });
      setupHook([
        makeItem({ id: 'ds-2', name: 'Operational Source', enabled: true }),
      ]);

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('table')).toBeInTheDocument();
      });

      const dashes = screen.getAllByText('—');
      const tooltipTrigger = dashes.find(el =>
        el.className.includes('cursor-default'),
      );
      expect(tooltipTrigger).toBeDefined();
      expect(tooltipTrigger).toHaveAttribute('data-state', 'closed');
    });
  });

  describe('create', () => {
    it('opens seed picker dialog and creates a custom workflow', async () => {
      const user = userEvent.setup();
      mockWorkflowApi.workflows.create.mockResolvedValueOnce({
        id: 'new-ds',
        name: 'Data Source',
        description: '',
        workflowType: 'data-ingestion',
        nodes: [],
        edges: [],
        enabled: false,
        version: 1,
        createdBy: 'user-1',
        createdAt: '',
        updatedAt: '',
        logoUrl: '',
      });
      setupHook([makeItem()]);
      renderPage();
      await user.click(screen.getByRole('button', { name: /New/ }));
      await user.click(
        screen.getByRole('button', { name: /New custom data source/ }),
      );
      await waitFor(() => {
        expect(mockWorkflowApi.workflows.create).toHaveBeenCalledTimes(1);
      });
      expect(mockNavigate).toHaveBeenCalledWith('/data-sources/new-ds');
    });

    it('prefills custom workflow creation with the selected integration', async () => {
      const user = userEvent.setup();
      mockWorkflowApi.workflows.create.mockResolvedValueOnce({
        id: 'new-ds',
        name: 'Data Source',
        description: '',
        workflowType: 'data-ingestion',
        nodes: [],
        edges: [],
        enabled: false,
        version: 1,
        createdBy: 'user-1',
        createdAt: '',
        updatedAt: '',
        logoUrl: '',
      });
      setupHook([makeItem()]);
      renderPage();

      await user.click(screen.getByRole('button', { name: /New/ }));
      await user.click(
        screen.getByRole('button', {
          name: /New GitHub custom data source/,
        }),
      );

      await waitFor(() => {
        expect(mockWorkflowApi.workflows.create).toHaveBeenCalledWith(
          expect.objectContaining({
            nodes: [
              expect.objectContaining({
                type: 'source-integration',
                data: expect.objectContaining({
                  config: { integrationId: 'int-gh', path: '' },
                }),
              }),
            ],
          }),
        );
      });
      expect(mockNavigate).toHaveBeenCalledWith('/data-sources/new-ds');
    });

    it('opens integration creation from the seed picker and returns to the picker after save', async () => {
      const user = userEvent.setup();
      setupHook([makeItem()]);
      renderPage();

      await user.click(screen.getByRole('button', { name: /New/ }));
      await user.click(
        screen.getByRole('button', { name: 'Add new integration' }),
      );

      await waitFor(() => {
        expect(screen.queryByTestId('seed-picker')).toBeNull();
      });
      expect(
        screen.getByRole('dialog', { name: 'New Integration' }),
      ).toBeTruthy();

      await user.click(
        screen.getByRole('button', { name: 'Save integration form' }),
      );

      await waitFor(() => {
        expect(screen.getByTestId('seed-picker')).toBeTruthy();
      });
    });
  });

  describe('seed picker dialog', () => {
    it('opens from a ?new=1 deep link and consumes the param', async () => {
      setupHook([makeItem()]);
      function SearchProbe() {
        return <div data-testid="search">{useLocation().search}</div>;
      }
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/?new=1']}>
            <DataSourceOverview />
            <SearchProbe />
          </MemoryRouter>
        </QueryClientProvider>,
      );

      expect(await screen.findByTestId('seed-picker')).toBeInTheDocument();
      await waitFor(() => {
        expect(screen.getByTestId('search')).toHaveTextContent(/^$/);
      });
    });

    it('remounts the picker with fresh state on each open', async () => {
      const user = userEvent.setup();
      setupHook([makeItem()]);
      renderPage();

      await user.click(screen.getByRole('button', { name: /New/ }));
      await user.click(screen.getByRole('button', { name: 'select seed' }));
      expect(screen.getByTestId('seed-picker')).toHaveAttribute(
        'data-dirty',
        'true',
      );

      await user.keyboard('{Escape}');
      await waitFor(() => {
        expect(screen.queryByTestId('seed-picker')).not.toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /New/ }));
      expect(screen.getByTestId('seed-picker')).toHaveAttribute(
        'data-dirty',
        'false',
      );
    });

    it('ignores close requests while seeds are applying', async () => {
      const user = userEvent.setup();
      setupHook([makeItem()]);
      renderPage();

      await user.click(screen.getByRole('button', { name: /New/ }));
      await user.click(screen.getByRole('button', { name: 'start applying' }));

      await user.keyboard('{Escape}');
      expect(screen.getByTestId('seed-picker')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'stop applying' }));
      await user.keyboard('{Escape}');
      await waitFor(() => {
        expect(screen.queryByTestId('seed-picker')).not.toBeInTheDocument();
      });
    });
  });

  describe('delete', () => {
    it('opens confirmation dialog when delete is triggered', async () => {
      const user = userEvent.setup();
      setupHook([makeItem()]);
      renderPage();
      await openActionsMenu(user);
      await user.click(screen.getByRole('menuitem', { name: /delete/i }));
      expect(screen.getByText('Delete data source')).toBeInTheDocument();
    });

    it('shows data source name in confirmation dialog', async () => {
      const user = userEvent.setup();
      setupHook([makeItem()]);
      renderPage();
      await openActionsMenu(user);
      await user.click(screen.getByRole('menuitem', { name: /delete/i }));
      expect(
        screen.getByText(
          'Are you sure you want to delete "GitHub Repositories"? The datastore objects it created will also be deleted. This cannot be undone.',
        ),
      ).toBeInTheDocument();
    });

    it('warns when the data source is referenced by a capability', async () => {
      const user = userEvent.setup();
      setupHook([makeItem({ slug: 'github-repos' })]);
      setupCapabilities([
        {
          id: 'cap-1',
          name: 'Repo Summary',
          instructions: 'Read from @datasource:github-repos and summarize.',
        },
      ]);
      renderPage();
      await openActionsMenu(user);
      await user.click(screen.getByRole('menuitem', { name: /delete/i }));

      expect(
        screen.getByText(/referenced by capabilities/i),
      ).toBeInTheDocument();
      expect(screen.getByText(/Repo Summary/)).toBeInTheDocument();
    });

    it('does not warn when no capability references the data source', async () => {
      const user = userEvent.setup();
      setupHook([makeItem({ slug: 'github-repos' })]);
      setupCapabilities([
        {
          id: 'cap-1',
          name: 'Unrelated',
          instructions: 'Uses @datasource:something-else only.',
        },
      ]);
      renderPage();
      await openActionsMenu(user);
      await user.click(screen.getByRole('menuitem', { name: /delete/i }));

      expect(
        screen.queryByText(/referenced by capabilities/i),
      ).not.toBeInTheDocument();
    });

    it('warns when a context group draws from the data source', async () => {
      const user = userEvent.setup();
      setupHook([makeItem({ id: 'ds-1', slug: 'github-repos' })]);
      setupContextGroups([
        {
          id: 'rule-1',
          name: 'Repo Owners',
          datasources: [{ datasourceId: 'ds-1' }],
        },
      ]);
      renderPage();
      await openActionsMenu(user);
      await user.click(screen.getByRole('menuitem', { name: /delete/i }));

      expect(
        screen.getByText(/context group draws from this data source/i),
      ).toBeInTheDocument();
      expect(screen.getByText('Repo Owners')).toBeInTheDocument();
    });

    it('warns about a seed-backed context group through its resolved id', async () => {
      // A seeded rule names its source by `seedName`; only `status.datasourceId`
      // ties it back to this data source.
      const user = userEvent.setup();
      setupHook([makeItem({ id: 'ds-1', slug: 'github-repos' })]);
      setupContextGroups([
        {
          id: 'rule-1',
          name: 'Seeded Group',
          datasources: [
            {
              seedName: 'GitHub',
              status: { live: true, datasourceId: 'ds-1' },
            },
          ],
        },
      ]);
      renderPage();
      await openActionsMenu(user);
      await user.click(screen.getByRole('menuitem', { name: /delete/i }));

      expect(screen.getByText('Seeded Group')).toBeInTheDocument();
    });

    it('does not warn when no context group draws from the data source', async () => {
      const user = userEvent.setup();
      setupHook([makeItem({ id: 'ds-1', slug: 'github-repos' })]);
      setupContextGroups([
        {
          id: 'rule-1',
          name: 'Elsewhere',
          datasources: [{ datasourceId: 'ds-other' }],
        },
      ]);
      renderPage();
      await openActionsMenu(user);
      await user.click(screen.getByRole('menuitem', { name: /delete/i }));

      expect(
        screen.queryByText(/draws from this data source/i),
      ).not.toBeInTheDocument();
    });

    it('deletes and refreshes the list on confirm', async () => {
      const user = userEvent.setup();
      mockWorkflowApi.workflows.delete.mockResolvedValue(undefined);
      setupHook([makeItem()]);
      renderPage();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      await openActionsMenu(user);
      await user.click(screen.getByRole('menuitem', { name: /delete/i }));
      await user.click(screen.getByTestId('delete-btn-confirmation-dialog'));
      await waitFor(() => {
        expect(mockWorkflowApi.workflows.delete).toHaveBeenCalledWith('ds-1');
      });
      await waitFor(() => {
        expect(invalidateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            queryKey: queryKeys.dataIngestionWorkflows,
          }),
        );
      });
    });

    it('also deletes the datastore objects the data source created', async () => {
      const user = userEvent.setup();
      mockWorkflowApi.workflows.delete.mockResolvedValue(undefined);
      mockDatastoreApi.deleteAllObjects.mockResolvedValue(undefined);
      setupHook([makeItem()]);
      renderPage();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      await openActionsMenu(user);
      await user.click(screen.getByRole('menuitem', { name: /delete/i }));
      await user.click(screen.getByTestId('delete-btn-confirmation-dialog'));
      await waitFor(() => {
        expect(mockDatastoreApi.deleteAllObjects).toHaveBeenCalledWith('ds-1');
      });
      await waitFor(() => {
        expect(mockWorkflowApi.workflows.delete).toHaveBeenCalledWith('ds-1');
      });
      await waitFor(() => {
        expect(invalidateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            queryKey: queryKeys.objectCountsPrefix,
          }),
        );
      });
    });

    it('keeps the data source when deleting its objects fails', async () => {
      const user = userEvent.setup();
      mockDatastoreApi.deleteAllObjects.mockRejectedValueOnce(
        new Error('Datastore unavailable'),
      );
      setupHook([makeItem()]);
      renderPage();
      await openActionsMenu(user);
      await user.click(screen.getByRole('menuitem', { name: /delete/i }));
      await user.click(screen.getByTestId('delete-btn-confirmation-dialog'));
      await waitFor(() => {
        expect(mockAlertApi.post).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining('Datastore unavailable'),
            severity: 'error',
          }),
        );
      });
      expect(mockWorkflowApi.workflows.delete).not.toHaveBeenCalled();
      expect(screen.getByText('Delete data source')).toBeInTheDocument();
    });

    it('closes dialog without deleting on cancel', async () => {
      const user = userEvent.setup();
      setupHook([makeItem()]);
      renderPage();
      await openActionsMenu(user);
      await user.click(screen.getByRole('menuitem', { name: /delete/i }));
      expect(screen.getByText('Delete data source')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(mockWorkflowApi.workflows.delete).not.toHaveBeenCalled();
    });

    it('shows error alert when delete fails', async () => {
      const user = userEvent.setup();
      mockWorkflowApi.workflows.delete.mockRejectedValue(
        new Error('Permission denied'),
      );
      setupHook([makeItem()]);
      renderPage();
      await openActionsMenu(user);
      await user.click(screen.getByRole('menuitem', { name: /delete/i }));
      await user.click(screen.getByTestId('delete-btn-confirmation-dialog'));
      await waitFor(() => {
        expect(mockAlertApi.post).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining('Permission denied'),
            severity: 'error',
          }),
        );
      });
      expect(screen.getByText('Delete data source')).toBeInTheDocument();
    });

    it('disables confirm and cancel while deletion is pending and only deletes once', async () => {
      const user = userEvent.setup();
      let resolveDelete!: (value?: unknown) => void;
      mockWorkflowApi.workflows.delete.mockImplementation(
        () =>
          new Promise(resolve => {
            resolveDelete = resolve;
          }),
      );
      setupHook([makeItem()]);
      renderPage();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      await openActionsMenu(user);
      await user.click(screen.getByRole('menuitem', { name: /delete/i }));

      const confirmButton = screen.getByTestId(
        'delete-btn-confirmation-dialog',
      );
      await user.click(confirmButton);

      await waitFor(() => {
        expect(confirmButton).toBeDisabled();
      });
      expect(confirmButton).toHaveTextContent('Deleting…');
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

      await user.click(confirmButton);
      await user.click(confirmButton);
      expect(mockWorkflowApi.workflows.delete).toHaveBeenCalledTimes(1);

      resolveDelete();
      await waitFor(() => {
        expect(
          screen.queryByText('Delete data source'),
        ).not.toBeInTheDocument();
      });
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: queryKeys.dataIngestionWorkflows,
        }),
      );
    });
  });

  describe('run', () => {
    it('calls execute API and shows success alert', async () => {
      const user = userEvent.setup();
      mockWorkflowApi.executions.execute.mockResolvedValue(undefined);
      setupHook([makeItem()]);
      renderPage();
      await openActionsMenu(user);
      await user.click(screen.getByRole('menuitem', { name: 'Run' }));
      await waitFor(() => {
        expect(mockWorkflowApi.executions.execute).toHaveBeenCalledWith('ds-1');
      });
      expect(mockAlertApi.post).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Data source run scheduled',
          severity: 'success',
        }),
      );
      expect(mockNoteRunStarted).toHaveBeenCalledWith('ds-1');
    });

    it('does not note a run start when execute fails', async () => {
      const user = userEvent.setup();
      mockWorkflowApi.executions.execute.mockRejectedValue(
        new Error('Timeout'),
      );
      setupHook([makeItem()]);
      renderPage();
      await openActionsMenu(user);
      await user.click(screen.getByRole('menuitem', { name: 'Run' }));
      await waitFor(() => {
        expect(mockAlertApi.post).toHaveBeenCalledWith(
          expect.objectContaining({
            severity: 'error',
          }),
        );
      });
      expect(mockNoteRunStarted).not.toHaveBeenCalled();
    });

    it('shows error alert when run fails', async () => {
      const user = userEvent.setup();
      mockWorkflowApi.executions.execute.mockRejectedValue(
        new Error('Timeout'),
      );
      setupHook([makeItem()]);
      renderPage();
      await openActionsMenu(user);
      await user.click(screen.getByRole('menuitem', { name: 'Run' }));
      await waitFor(() => {
        expect(mockAlertApi.post).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining('Timeout'),
            severity: 'error',
          }),
        );
      });
      expect(mockNoteRunStarted).not.toHaveBeenCalled();
    });

    it('refreshes execution data after a successful run', async () => {
      const user = userEvent.setup();
      mockWorkflowApi.executions.execute.mockResolvedValue(undefined);
      setupHook([makeItem()]);
      renderPage();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      await openActionsMenu(user);
      await user.click(screen.getByRole('menuitem', { name: 'Run' }));
      await waitFor(() => {
        expect(invalidateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            queryKey: queryKeys.executionSummariesPrefix,
          }),
        );
      });
    });
  });

  describe('readiness gating', () => {
    it('shows needs integration setup for data sources with missing secrets', () => {
      mockUseIntegrationSecretStatus.mockReturnValue({
        summariesByIntegrationId: new Map([
          [
            'int-gh',
            {
              requiredSecretRefs: ['GITHUB_TOKEN'],
              missingSecretRefs: ['GITHUB_TOKEN'],
              hasRequiredConfig: true,
              configured: false,
            },
          ],
        ]),
        loading: false,
      });
      setupHook([
        makeItem({
          enabled: false,
          integrationId: 'int-gh',
          integration: {
            id: 'int-gh',
            slug: 'github',
            type: 'github',
            label: 'GitHub',
            icon: 'Github',
            color: '#333',
            logoUrl: '',
            backendType: 'http',
            authConfig: null,
            config: {},
            readyForCurrentScope: true,
          },
        }),
      ]);

      renderPage();

      expect(screen.getByText('Needs integration setup')).toBeInTheDocument();
    });

    it('shows needs integration setup instead of ready for enabled sources with incomplete integration', () => {
      mockUseIntegrationSecretStatus.mockReturnValue({
        summariesByIntegrationId: new Map([
          [
            'int-gh',
            {
              requiredSecretRefs: ['GITHUB_TOKEN'],
              missingSecretRefs: ['GITHUB_TOKEN'],
              hasRequiredConfig: true,
              configured: false,
            },
          ],
        ]),
        loading: false,
      });
      setupHook([
        makeItem({
          enabled: true,
          integrationId: 'int-gh',
          integration: {
            id: 'int-gh',
            slug: 'github',
            type: 'github',
            label: 'GitHub',
            icon: 'Github',
            color: '#333',
            logoUrl: '',
            backendType: 'http',
            authConfig: null,
            config: {},
            readyForCurrentScope: true,
          },
        }),
      ]);

      renderPage();

      expect(screen.getByText('Needs integration setup')).toBeInTheDocument();
      expect(screen.queryByText('Enabled')).not.toBeInTheDocument();
    });

    it('shows needs setup (not needs integration setup) for a source with no integration', () => {
      setupHook([
        makeItem({
          integrationId: undefined,
          integration: undefined,
          integrations: [],
          isSourceConfigured: false,
        }),
      ]);

      renderPage();

      expect(screen.getByText('Needs setup')).toBeInTheDocument();
      expect(
        screen.queryByText('Needs integration setup'),
      ).not.toBeInTheDocument();
    });

    it('shows needs setup when the integration is ready but source configuration is incomplete', () => {
      setupHook([
        makeItem({
          isSourceConfigured: false,
          integration: makeIntegration({ readyForCurrentScope: true }),
        }),
      ]);

      renderPage();

      expect(screen.getByText('Needs setup')).toBeInTheDocument();
      expect(
        screen.queryByText('Needs integration setup'),
      ).not.toBeInTheDocument();
    });

    it('shows needs integration setup when a chained integration has missing secrets', () => {
      mockUseIntegrationSecretStatus.mockReturnValue({
        summariesByIntegrationId: new Map([
          [
            'int-1',
            {
              requiredSecretRefs: [],
              missingSecretRefs: [],
              hasRequiredConfig: true,
              configured: true,
            },
          ],
          [
            'int-pd',
            {
              requiredSecretRefs: ['PD_TOKEN'],
              missingSecretRefs: ['PD_TOKEN'],
              hasRequiredConfig: true,
              configured: false,
            },
          ],
        ]),
        loading: false,
      });
      setupHook([
        makeItem({
          integration: makeIntegration({
            id: 'int-1',
            readyForCurrentScope: true,
          }),
          integrations: [
            makeIntegration({ id: 'int-1', readyForCurrentScope: true }),
            makeIntegration({
              id: 'int-pd',
              label: 'PagerDuty',
              readyForCurrentScope: true,
            }),
          ],
        }),
      ]);

      renderPage();

      expect(screen.getByText('Needs integration setup')).toBeInTheDocument();
      expect(screen.queryByText('Enabled')).not.toBeInTheDocument();
    });

    it('shows enabled in the status column when configuration is healthy even if the last run failed', () => {
      mockUseIntegrationSecretStatus.mockReturnValue({
        summariesByIntegrationId: new Map([
          [
            'int-1',
            {
              requiredSecretRefs: [],
              missingSecretRefs: [],
              hasRequiredConfig: true,
              configured: true,
            },
          ],
        ]),
        loading: false,
      });
      setupHook([
        makeItem({
          enabled: true,
          execution: { status: 'failed', lastRunAt: '2024-01-01T00:00:00Z' },
        }),
      ]);

      renderPage();

      expect(screen.getByText('Enabled')).toBeInTheDocument();
      expect(screen.queryByText('Failed')).not.toBeInTheDocument();
    });

    it('shows disabled for configured sources that are not scheduled', () => {
      setupHook([makeItem({ enabled: false })]);

      renderPage();

      expect(screen.getByText('Disabled')).toBeInTheDocument();
      expect(screen.queryByText('Enabled')).not.toBeInTheDocument();
    });

    it('disables enable when integration setup is incomplete', async () => {
      const user = userEvent.setup();
      mockUseIntegrationSecretStatus.mockReturnValue({
        summariesByIntegrationId: new Map([
          [
            'int-gh',
            {
              requiredSecretRefs: ['GITHUB_TOKEN'],
              missingSecretRefs: ['GITHUB_TOKEN'],
              hasRequiredConfig: true,
              configured: false,
            },
          ],
        ]),
        loading: false,
      });
      setupHook([
        makeItem({
          enabled: false,
          integrationId: 'int-gh',
          integration: {
            id: 'int-gh',
            slug: 'github',
            type: 'github',
            label: 'GitHub',
            icon: 'Github',
            color: '#333',
            logoUrl: '',
            backendType: 'http',
            authConfig: null,
            config: {},
            readyForCurrentScope: true,
          },
        }),
      ]);

      renderPage();
      await openActionsMenu(user);

      expect(screen.getByRole('menuitem', { name: 'Enable' })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      expect(mockWorkflowApi.workflows.update).not.toHaveBeenCalled();
    });

    it('disables run once for enabled sources with incomplete integration setup', async () => {
      const user = userEvent.setup();
      mockUseIntegrationSecretStatus.mockReturnValue({
        summariesByIntegrationId: new Map([
          [
            'int-gh',
            {
              requiredSecretRefs: ['GITHUB_TOKEN'],
              missingSecretRefs: ['GITHUB_TOKEN'],
              hasRequiredConfig: true,
              configured: false,
            },
          ],
        ]),
        loading: false,
      });
      setupHook([
        makeItem({
          enabled: true,
          integrationId: 'int-gh',
          integration: {
            id: 'int-gh',
            slug: 'github',
            type: 'github',
            label: 'GitHub',
            icon: 'Github',
            color: '#333',
            logoUrl: '',
            backendType: 'http',
            authConfig: null,
            config: {},
            readyForCurrentScope: true,
          },
        }),
      ]);

      renderPage();
      await openActionsMenu(user);

      expect(screen.getByRole('menuitem', { name: 'Run' })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      expect(mockWorkflowApi.executions.execute).not.toHaveBeenCalled();
    });
  });

  describe('toggle enabled', () => {
    it('calls update API with toggled enabled state', async () => {
      const user = userEvent.setup();
      mockWorkflowApi.workflows.update.mockResolvedValue(undefined);
      setupHook([makeItem({ enabled: true })]);
      renderPage();
      await openActionsMenu(user);
      await user.click(screen.getByRole('menuitem', { name: /disable/i }));
      await waitFor(() => {
        expect(mockWorkflowApi.workflows.update).toHaveBeenCalledWith('ds-1', {
          enabled: false,
        });
      });
    });

    it('shows appropriate alert for activation vs deactivation', async () => {
      const user = userEvent.setup();
      mockWorkflowApi.workflows.update.mockResolvedValue(undefined);
      setupHook([makeItem({ enabled: false })]);
      renderPage();
      await openActionsMenu(user);
      await user.click(screen.getByRole('menuitem', { name: 'Enable' }));
      await waitFor(() => {
        expect(mockAlertApi.post).toHaveBeenCalledWith(
          expect.objectContaining({
            message: 'Data source enabled',
            severity: 'success',
          }),
        );
      });
    });

    it('shows error alert when toggle fails', async () => {
      const user = userEvent.setup();
      mockWorkflowApi.workflows.update.mockRejectedValue(
        new Error('Server error'),
      );
      setupHook([makeItem()]);
      renderPage();
      await openActionsMenu(user);
      await user.click(screen.getByRole('menuitem', { name: /disable/i }));
      await waitFor(() => {
        expect(mockAlertApi.post).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining('Server error'),
            severity: 'error',
          }),
        );
      });
    });
  });

  describe('favorites', () => {
    it('shows a favourite action in the row menu and toggles the row favorite', async () => {
      const user = userEvent.setup();
      setupHook([makeItem()]);
      renderPage();

      await openActionsMenu(user);
      await user.click(
        screen.getByRole('menuitem', { name: /add to favourites/i }),
      );

      expect(storedFavoriteIds()).toEqual(['ds-1']);

      await openActionsMenu(user);
      await user.click(
        screen.getByRole('menuitem', { name: /remove from favourites/i }),
      );

      expect(storedFavoriteIds()).toEqual([]);
    });

    it('adds and removes selected rows from favourites through the bulk menu', async () => {
      const user = userEvent.setup();
      setupHook([
        makeItem({ id: 'ds-1', name: 'GitHub Repositories' }),
        makeItem({ id: 'ds-2', name: 'Buildkite Pipelines' }),
      ]);
      renderPage();

      const checkboxes = await screen.findAllByRole('checkbox', {
        name: /select row/i,
      });
      await user.click(checkboxes[0]!);
      await user.click(checkboxes[1]!);

      await user.click(
        await screen.findByRole('button', { name: /2 selected/i }),
      );
      await user.click(
        screen.getByRole('menuitem', { name: /add to favourites/i }),
      );

      expect(storedFavoriteIds().sort()).toEqual(['ds-1', 'ds-2']);

      await user.click(screen.getByRole('button', { name: /2 selected/i }));
      await user.click(
        screen.getByRole('menuitem', { name: /remove from favourites/i }),
      );

      expect(storedFavoriteIds()).toEqual([]);
    });
  });
});
