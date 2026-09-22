import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Outlet,
  RouterProvider,
  createMemoryRouter,
  useLocation,
} from 'react-router';
import { Button } from '@roadiehq/ui/button';
import { IntegrationEditor } from './integration-editor';
import type { IntegrationItem } from '../types';
import { TestQueryProvider } from '../../../test-utils';

const mockWorkflowApi = {
  integrations: { delete: vi.fn() },
  workflows: {
    listDataSourceSeeds: vi.fn(),
    activateDataSourceSeedsForIntegration: vi.fn(),
  },
};
const mockAlertApi = { post: vi.fn() };

vi.mock('../../../api', () => ({
  useWorkflows: () => mockWorkflowApi,
  useAlert: () => mockAlertApi,
}));

const mockUseIntegrations = vi.fn();
vi.mock('../use-integrations', () => ({
  useIntegrations: () => mockUseIntegrations(),
}));

// The heavy form internals are covered by the form's own tests; stub them so
// these tests exercise the editor's routing / branching / delete / duplicate.
vi.mock('@roadiehq/ui/form', () => ({
  Form: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Lets individual tests override the stubbed form's `formState` (e.g. to
// simulate a save failure landing on the root error).
let formStateOverride: Record<string, unknown> = {};
// Captures the editor's `onSaved` callback so tests can simulate a successful
// save without exercising the real (separately-tested) save flow.
let capturedOnSaved: ((integration: IntegrationItem) => void) | undefined;

vi.mock('../form', () => ({
  IntegrationFormFields: () => <div data-testid="integration-form-fields" />,
  GitHubIntegrationDialog: ({
    integration,
    onRequestDuplicate,
    variant,
  }: {
    integration: { name: string };
    onRequestDuplicate?: () => void;
    variant?: 'dialog' | 'page';
  }) => (
    <div data-testid="github-integration-dialog" data-variant={variant}>
      {integration.name}
      {onRequestDuplicate ? (
        <Button type="button" onClick={onRequestDuplicate}>
          Duplicate integration
        </Button>
      ) : null}
    </div>
  ),
  useIntegrationForm: ({
    integration,
    template,
    onSaved,
  }: {
    integration?: IntegrationItem;
    template?: IntegrationItem;
    onSaved?: (integration: IntegrationItem) => void;
  }) => {
    capturedOnSaved = onSaved;
    return {
      form: {
        formState: { isDirty: true, errors: {}, ...formStateOverride },
        getValues: () => ({}),
        setFocus: vi.fn(),
        watch: vi.fn(() => undefined),
      },
      saving: false,
      isEdit: !!integration,
      autoSlug: false,
      secretOptions: [],
      reservedSecretNames: [],
      handleSave: vi.fn(),
      refreshSecretList: vi.fn(),
      secretsListReadOnly: false,
      logoCatalog: [],
      // reference template so the stub signature mirrors the real hook
      _template: template,
    };
  },
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

function setupHook(integrations: IntegrationItem[] = [], loading = false) {
  mockUseIntegrations.mockReturnValue({
    integrations,
    loading,
    error: undefined,
    refetch: mockRefetch,
    logoDataUriBySlug: new Map<string, string>(),
  });
}

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">{`${location.pathname}${location.search}`}</div>
  );
}

function renderEditor(initialEntry: string) {
  const router = createMemoryRouter(
    [
      {
        element: (
          <>
            <Outlet />
            <LocationProbe />
          </>
        ),
        children: [
          { path: '/integrations', element: <div>overview</div> },
          {
            path: '/integrations/new',
            element: <IntegrationEditor />,
          },
          {
            path: '/integrations/:integrationId',
            element: <IntegrationEditor />,
          },
        ],
      },
    ],
    { initialEntries: [initialEntry] },
  );

  render(
    <TestQueryProvider>
      <RouterProvider router={router} />
    </TestQueryProvider>,
  );

  return router;
}

beforeEach(() => {
  vi.clearAllMocks();
  formStateOverride = {};
  capturedOnSaved = undefined;
  setupHook();
  mockWorkflowApi.workflows.listDataSourceSeeds.mockResolvedValue({
    data: [],
  });
  mockWorkflowApi.workflows.activateDataSourceSeedsForIntegration.mockResolvedValue(
    {
      data: {
        inserted: 0,
        enabled: 0,
        skipped: [],
        failed: [],
        relationships: { created: 0, skipped: 0 },
        contextGroups: { created: 0, skipped: 0, unresolved: 0 },
        notReady: false,
      },
    },
  );
});

describe('IntegrationEditor', () => {
  it('shows a loading state while an edited integration is still loading', () => {
    setupHook([], true);
    renderEditor('/integrations/int-1');
    expect(screen.queryByTestId('integration-form-fields')).toBeNull();
    expect(
      screen.getAllByRole('heading', { name: 'Integration' }).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('shows a not-found message for an unknown integration', () => {
    setupHook([makeItem()], false);
    renderEditor('/integrations/does-not-exist');
    expect(
      screen.getAllByRole('heading', { name: 'Integration not found' }).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('renders the full-page form in edit mode for a regular integration', () => {
    setupHook([makeItem()]);
    renderEditor('/integrations/int-1');
    // Title is the edited integration's entity name.
    expect(
      screen.getAllByRole('heading', { name: 'GitHub' }).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('link', { name: 'Integrations' })).toHaveAttribute(
      'href',
      '/integrations',
    );
    expect(screen.getByTestId('integration-form-fields')).toBeInTheDocument();
  });

  it('renders the create form on the new route', () => {
    renderEditor('/integrations/new');
    expect(
      screen.getAllByRole('heading', { name: 'New Integration' }).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('renders duplicate mode when seeded from ?from=', () => {
    setupHook([makeItem({ name: 'Seeded Integration' })]);
    renderEditor('/integrations/new?from=int-1');
    // Duplicate mode titles with the seeded integration's entity name.
    expect(
      screen.getAllByRole('heading', { name: 'Seeded Integration' }).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('renders the GitHub editor as a full page on-route for a GitHub App integration', () => {
    setupHook([
      makeItem({ id: 'gh-1', name: 'GitHub App', slug: 'github-app' }),
    ]);
    renderEditor('/integrations/gh-1');
    const editor = screen.getByTestId('github-integration-dialog');
    expect(editor).toHaveTextContent('GitHub App');
    // Routed GitHub editor renders as a page, not a modal.
    expect(editor).toHaveAttribute('data-variant', 'page');
    expect(screen.queryByTestId('integration-form-fields')).toBeNull();
  });

  it('deletes and navigates back on confirm', async () => {
    const user = userEvent.setup();
    mockWorkflowApi.integrations.delete.mockResolvedValue(undefined);
    setupHook([makeItem()]);
    renderEditor('/integrations/int-1');

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByTestId('delete-btn-confirmation-dialog'));

    await waitFor(() => {
      expect(mockWorkflowApi.integrations.delete).toHaveBeenCalledWith('int-1');
    });
    // Delete now refreshes via query invalidation (mutation onSuccess), not the
    // manual refetch(); navigating back on success is the observable outcome.
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/integrations');
    });
    expect(screen.queryByText('Discard unsaved changes?')).toBeNull();
  });

  it('keeps navigation guarded while the delete confirmation is open', async () => {
    const user = userEvent.setup();
    setupHook([makeItem()]);
    const router = renderEditor('/integrations/int-1');

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await act(async () => {
      await router.navigate('/integrations');
    });

    expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/integrations/int-1',
    );
  });

  it('keeps navigation guarded while saving', async () => {
    formStateOverride = { isSubmitting: true };
    setupHook([makeItem()]);
    const router = renderEditor('/integrations/int-1');

    await act(async () => {
      await router.navigate('/integrations');
    });

    expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/integrations/int-1',
    );
  });

  it('allows intentional navigation after a successful save', async () => {
    const item = makeItem();
    setupHook([item]);
    const router = renderEditor('/integrations/int-1');

    act(() => capturedOnSaved?.(item));
    await act(async () => {
      await router.navigate('/integrations');
    });

    expect(screen.getByTestId('location')).toHaveTextContent(
      /^\/integrations$/,
    );
    expect(screen.queryByText('Discard unsaved changes?')).toBeNull();
  });

  it('routes to a seeded new form when duplicating', async () => {
    const user = userEvent.setup();
    setupHook([makeItem()]);
    renderEditor('/integrations/int-1');

    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Discard' }));

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/integrations/new?from=int-1',
    );
  });

  it('guards the back link with a discard confirmation when the form is dirty', async () => {
    const user = userEvent.setup();
    setupHook([makeItem()]);
    renderEditor('/integrations/int-1');

    // The stubbed form hook reports isDirty: true, so back must be intercepted.
    // The icon back link is the first link in the header (breadcrumb is second).
    const [backLink] = screen.getAllByRole('link');
    await user.click(backLink);

    expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/integrations/int-1',
    );

    await user.click(screen.getByRole('button', { name: 'Discard' }));

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent(
        /^\/integrations$/,
      );
    });
  });

  it('surfaces a save failure as a root error on the page', () => {
    formStateOverride = {
      errors: { root: { message: 'Failed to save integration' } },
    };
    setupHook([makeItem()]);
    renderEditor('/integrations/int-1');

    expect(screen.getByText('Failed to save integration')).toBeInTheDocument();
  });

  it('disables delete when the integration is referenced by workflows', () => {
    setupHook([
      makeItem({ referencingWorkflows: [{ id: 'wf-1', name: 'My Workflow' }] }),
    ]);
    renderEditor('/integrations/int-1');
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });

  describe('auto-enable data sources toggle', () => {
    it('does not show the toggle for a non-system integration', async () => {
      mockWorkflowApi.workflows.listDataSourceSeeds.mockResolvedValue({
        data: [
          {
            name: 'PagerDuty incidents',
            description: '',
            integrationSlug: 'my-integration',
            integrationConfigured: true,
            created: false,
          },
        ],
      });
      setupHook([makeItem({ createdBy: 'user-1' })]);
      renderEditor('/integrations/int-1');

      await waitFor(() => expect(capturedOnSaved).toBeDefined());
      expect(screen.queryByRole('switch')).toBeNull();
    });

    it('does not show the toggle for a system integration with no matching seeds', async () => {
      setupHook([makeItem({ createdBy: 'system' })]);
      renderEditor('/integrations/int-1');

      await waitFor(() =>
        expect(
          mockWorkflowApi.workflows.listDataSourceSeeds,
        ).toHaveBeenCalled(),
      );
      expect(screen.queryByRole('switch')).toBeNull();
    });

    it('shows a default-on toggle for a system integration with matching seeds', async () => {
      mockWorkflowApi.workflows.listDataSourceSeeds.mockResolvedValue({
        data: [
          {
            name: 'PagerDuty incidents',
            description: '',
            integrationSlug: 'my-integration',
            integrationConfigured: true,
            created: false,
          },
        ],
      });
      setupHook([makeItem({ createdBy: 'system' })]);
      renderEditor('/integrations/int-1');

      const toggle = await screen.findByRole('switch', {
        name: 'Automatically enable data sources',
      });
      expect(toggle).toHaveAttribute('data-state', 'checked');
      expect(
        await screen.findByRole('button', { name: 'Show 1 data source' }),
      ).toBeInTheDocument();
    });

    it('activates data source seeds after a successful save when the toggle is on', async () => {
      mockWorkflowApi.workflows.listDataSourceSeeds.mockResolvedValue({
        data: [
          {
            name: 'PagerDuty incidents',
            description: '',
            integrationSlug: 'my-integration',
            integrationConfigured: true,
            created: false,
          },
        ],
      });
      const item = makeItem({ createdBy: 'system' });
      setupHook([item]);
      renderEditor('/integrations/int-1');

      await screen.findByRole('switch', {
        name: 'Automatically enable data sources',
      });

      act(() => capturedOnSaved?.(item));

      await waitFor(() =>
        expect(
          mockWorkflowApi.workflows.activateDataSourceSeedsForIntegration,
        ).toHaveBeenCalledWith('int-1'),
      );
    });

    it('skips activation after save once the toggle is switched off', async () => {
      const user = userEvent.setup();
      mockWorkflowApi.workflows.listDataSourceSeeds.mockResolvedValue({
        data: [
          {
            name: 'PagerDuty incidents',
            description: '',
            integrationSlug: 'my-integration',
            integrationConfigured: true,
            created: false,
          },
        ],
      });
      const item = makeItem({ createdBy: 'system' });
      setupHook([item]);
      renderEditor('/integrations/int-1');

      const toggle = await screen.findByRole('switch', {
        name: 'Automatically enable data sources',
      });
      await user.click(toggle);
      expect(toggle).toHaveAttribute('data-state', 'unchecked');

      act(() => capturedOnSaved?.(item));

      expect(
        mockWorkflowApi.workflows.activateDataSourceSeedsForIntegration,
      ).not.toHaveBeenCalled();
    });
  });
});
