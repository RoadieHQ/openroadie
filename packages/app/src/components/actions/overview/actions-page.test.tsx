import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  RouterProvider,
  createMemoryRouter,
  useLocation,
  type ActionFunctionArgs,
} from 'react-router';
import { TestQueryProvider } from '../../../test-utils';
import { ActionsPage } from './actions-page';
import { formatUpdated } from '../../overview';
import type { ActionWithSchema } from '../types';
import type { ActionsRouteActionResult } from '../actions-route-action';

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockAlertApi = { post: vi.fn() };
const mockListVersions = vi.fn();
vi.mock('../../../api', () => ({
  useAlert: () => mockAlertApi,
  useActions: () => ({ listVersions: mockListVersions }),
  // Reference-usage lookups (delete warnings) read the capability list.
  useCapabilities: () => ({
    list: async () => ({
      items: mockCapabilityItems,
      total: mockCapabilityItems.length,
    }),
  }),
}));

/** Capabilities the delete dialog scans for `@action:<slug>` tokens. */
let mockCapabilityItems: Array<{
  id: string;
  name: string;
  instructions: string;
}> = [];

const mockUseActions = vi.fn();
vi.mock('../use-actions', () => ({
  useActions: () => mockUseActions(),
}));

// The detail drawer resolves step integration ids to names on demand; the page
// tests don't exercise that path, so stub it with an empty integration list.
vi.mock('../../integrations/use-integrations', () => ({
  useIntegrations: () => ({
    integrations: [],
    logoDataUriBySlug: new Map(),
    loading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
}));

function makeAction(overrides?: Partial<ActionWithSchema>): ActionWithSchema {
  return {
    id: 'act-1',
    name: 'Create Issue',
    slug: 'create-issue',
    description: 'Creates a GitHub issue',
    parameters: [],
    steps: [
      {
        id: 'createIssue',
        integrationId: 'int-1',
        request: { method: 'POST', path: '/issues', headers: [], body: '' },
      },
    ],
    enabled: true,
    currentVersion: 1,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-20T00:00:00Z',
    ...overrides,
  };
}

function setupHook(
  actions: ActionWithSchema[] = [],
  loading = false,
  error?: Error,
) {
  mockUseActions.mockReturnValue({
    actions,
    total: actions.length,
    loading,
    error,
    retry: vi.fn(),
  });
}

/**
 * Renders path *and* query so a title-click test can prove the row handler did
 * not also fire — that would leave the drawer's `?detail=` param behind.
 */
function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">{`${location.pathname}${location.search}`}</div>
  );
}

let submittedActionMutation: Record<string, FormDataEntryValue> = {};
const mockRouteAction = vi.fn(
  async ({
    request,
  }: ActionFunctionArgs): Promise<ActionsRouteActionResult> => {
    submittedActionMutation = Object.fromEntries(await request.formData());
    return {
      intent: 'delete',
      actionId: String(submittedActionMutation.actionId),
      ok: true,
    };
  },
);

function renderPage(initialEntries: string[] = ['/actions']) {
  const router = createMemoryRouter(
    [
      {
        path: '/actions',
        element: (
          <>
            <ActionsPage />
            <LocationProbe />
          </>
        ),
        action: mockRouteAction,
      },
      // Navigating off the listing (following a row's title link) needs a
      // destination; the probe is all the assertions need from it.
      { path: '*', element: <LocationProbe /> },
    ],
    { initialEntries },
  );
  return render(
    <TestQueryProvider>
      <RouterProvider router={router} />
    </TestQueryProvider>,
  );
}

/** Open the trailing (⋯) row-actions menu for the given action name. */
async function openRowMenu(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  await user.click(screen.getByRole('button', { name: `Actions for ${name}` }));
  await waitFor(() => {
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  submittedActionMutation = {};
  mockCapabilityItems = [];
  mockListVersions.mockResolvedValue({ items: [], total: 0 });
  setupHook();
});

describe('ActionsPage', () => {
  describe('rendering', () => {
    it('renders the page header and description', () => {
      renderPage();
      expect(
        screen.getByRole('heading', { name: 'Actions' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Define reusable, parameterized HTTP operations/),
      ).toBeInTheDocument();
    });

    it('renders the empty state with a create CTA when there are no actions', () => {
      renderPage();
      expect(screen.getByText('No actions yet')).toBeInTheDocument();
      expect(
        screen.getByText(
          'An action is a deterministic operation callable via MCP. It captures a multi-step path, a proven, standardized way to get something done, as a single repeatable operation. Actions are exposed as MCP tools, so agents can trigger these golden paths directly rather than stitching together the individual steps themselves. Capabilities refer to actions to invoke this deterministic behavior.',
        ),
      ).toBeInTheDocument();
      expect(screen.getByText('Create a Jira ticket')).toBeInTheDocument();
      expect(screen.getByText('Trigger a deployment')).toBeInTheDocument();
      expect(screen.getByText('Post a message to Slack')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /New Action/ }),
      ).toBeInTheDocument();
    });

    it('shows the skeleton table while loading', () => {
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
      expect(screen.getByText('Failed to load actions')).toBeInTheDocument();
      expect(screen.queryByText('No actions yet')).not.toBeInTheDocument();
    });

    it('renders a table row per action with name, slug and method badge', () => {
      setupHook([
        makeAction(),
        makeAction({ id: 'act-2', name: 'Close Issue', slug: 'close-issue' }),
      ]);
      renderPage();
      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.getByTestId('action-name-act-1')).toBeInTheDocument();
      expect(screen.getByTestId('action-name-act-2')).toBeInTheDocument();
      expect(screen.getByText('create-issue')).toBeInTheDocument();
      expect(screen.getByText('close-issue')).toBeInTheDocument();
      expect(screen.getAllByText('POST')).toHaveLength(2);
    });

    it('formats the updated date', () => {
      setupHook([makeAction({ updatedAt: '2026-06-20T00:00:00Z' })]);
      renderPage();
      expect(
        screen.getByText(formatUpdated('2026-06-20T00:00:00Z')!),
      ).toBeInTheDocument();
    });

    it('offers persisted display options for secondary columns', async () => {
      const user = userEvent.setup();
      window.localStorage.clear();
      setupHook([makeAction()]);
      renderPage();

      await user.click(screen.getByRole('button', { name: 'Display columns' }));
      expect(
        screen.queryByRole('menuitemcheckbox', { name: 'Name' }),
      ).not.toBeInTheDocument();
      await user.click(screen.getByRole('menuitemcheckbox', { name: 'Steps' }));

      expect(
        screen.queryByRole('columnheader', { name: 'Steps' }),
      ).not.toBeInTheDocument();
      window.localStorage.clear();
    });
  });

  describe('status filter', () => {
    it('lists Enabled and Disabled in the status dropdown', async () => {
      const user = userEvent.setup();
      setupHook([
        makeAction({ enabled: true }),
        makeAction({ id: 'act-2', name: 'Close Issue', enabled: false }),
      ]);
      renderPage();
      await user.click(screen.getByRole('button', { name: 'Status' }));
      expect(
        await screen.findByRole('option', { name: /Enabled/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('option', { name: /Disabled/ }),
      ).toBeInTheDocument();
    });

    it('filters to disabled actions when Disabled is selected', async () => {
      const user = userEvent.setup();
      setupHook([
        makeAction({ id: 'act-1', name: 'Create Issue', enabled: true }),
        makeAction({ id: 'act-2', name: 'Close Issue', enabled: false }),
      ]);
      renderPage();

      await user.click(screen.getByRole('button', { name: 'Status' }));
      await user.click(await screen.findByRole('option', { name: /Disabled/ }));

      expect(screen.getByTestId('action-name-act-2')).toBeInTheDocument();
      expect(screen.queryByTestId('action-name-act-1')).not.toBeInTheDocument();
    });
  });

  describe('table filters', () => {
    it('filters actions by single-step or multi-step shape', async () => {
      const user = userEvent.setup();
      setupHook([
        makeAction({ id: 'act-1', name: 'Single step' }),
        makeAction({
          id: 'act-2',
          name: 'Multiple steps',
          steps: [
            ...makeAction().steps,
            {
              id: 'closeIssue',
              integrationId: 'int-1',
              request: {
                method: 'PATCH',
                path: '/issues/1',
                headers: [],
                body: '',
              },
            },
          ],
        }),
      ]);
      renderPage();

      await user.click(screen.getByRole('button', { name: 'Steps' }));
      await user.click(screen.getByRole('option', { name: 'Multiple steps' }));
      await user.keyboard('{Escape}');

      expect(screen.getByTestId('action-name-act-2')).toBeInTheDocument();
      expect(screen.queryByTestId('action-name-act-1')).not.toBeInTheDocument();
    });
  });

  describe('search', () => {
    it('filters by name and slug', async () => {
      const user = userEvent.setup();
      setupHook([
        makeAction({ id: 'act-1', name: 'Create Issue', slug: 'create-issue' }),
        makeAction({ id: 'act-2', name: 'Deploy App', slug: 'deploy-app' }),
      ]);
      renderPage();

      await user.type(
        screen.getByPlaceholderText('Search by name or slug...'),
        'deploy',
      );

      expect(screen.getByTestId('action-name-act-2')).toBeInTheDocument();
      expect(screen.queryByTestId('action-name-act-1')).not.toBeInTheDocument();
    });

    it('shows a no-match message when the search excludes everything', async () => {
      const user = userEvent.setup();
      setupHook([makeAction()]);
      renderPage();

      await user.type(
        screen.getByPlaceholderText('Search by name or slug...'),
        'zzzzz',
      );

      expect(screen.getByText('No matching actions')).toBeInTheDocument();
    });
  });

  describe('detail drawer', () => {
    it('opens the detail drawer on row click', async () => {
      const user = userEvent.setup();
      setupHook([makeAction({ id: 'act-1', name: 'Create Issue' })]);
      renderPage();

      await user.click(screen.getByTestId('action-name-act-1'));

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Create Issue')).toBeInTheDocument();
      expect(
        within(dialog).getByRole('link', { name: /open editor/i }),
      ).toHaveAttribute('href', '/actions/act-1');
    });

    // The other half of the listing-navigation contract: the title is a link,
    // and following it must not also open the drawer.
    it('navigates to the action when the title is clicked, without opening the drawer', async () => {
      const user = userEvent.setup();
      setupHook([makeAction({ id: 'act-1', name: 'Create Issue' })]);
      renderPage();

      const title = screen.getByRole('link', { name: 'Create Issue' });
      expect(title).toHaveAttribute('href', '/actions/act-1');

      await user.click(title);

      // Exact location, query included: the row handler would have added
      // `?detail=act-1`. Asserting only "no dialog" would pass vacuously here,
      // since navigating unmounts the listing that renders the drawer.
      expect(screen.getByTestId('location')).toHaveTextContent(
        /^\/actions\/act-1$/,
      );
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('closes the detail drawer when clicking outside a row', async () => {
      const user = userEvent.setup();
      setupHook([makeAction({ id: 'act-1', name: 'Create Issue' })]);
      renderPage();

      await user.click(screen.getByTestId('action-name-act-1'));
      expect(await screen.findByRole('dialog')).toBeInTheDocument();

      // Clicking a non-row element (the page heading) dismisses the drawer.
      await user.click(screen.getByRole('heading', { name: /actions/i }));
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('shows a not-found error for a stale detail URL', async () => {
      setupHook([makeAction()]);
      renderPage(['/actions?detail=missing-action']);

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Action not found.')).toBeInTheDocument();
      expect(
        within(dialog).queryByRole('link', { name: /open editor/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe('navigation', () => {
    it('navigates to the create form from the New button', async () => {
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole('button', { name: /New Action/ }));
      expect(mockNavigate).toHaveBeenCalledWith('/actions/new');
    });
  });

  describe('duplicate', () => {
    it('opens the create form prefilled from the action', async () => {
      const user = userEvent.setup();
      setupHook([makeAction({ name: 'Deploy App', slug: 'deploy-app' })]);
      renderPage();

      await openRowMenu(user, 'Deploy App');
      await user.click(screen.getByRole('menuitem', { name: /duplicate/i }));

      expect(mockNavigate).toHaveBeenCalledWith('/actions/new', {
        state: {
          duplicateFrom: expect.objectContaining({
            name: 'Deploy App (copy)',
            slug: '',
            steps: [
              expect.objectContaining({
                id: 'createIssue',
                integrationId: 'int-1',
                request: expect.objectContaining({ method: 'POST' }),
              }),
            ],
          }),
        },
      });
    });

    it('does not navigate to the editor', async () => {
      const user = userEvent.setup();
      setupHook([makeAction()]);
      renderPage();

      await openRowMenu(user, 'Create Issue');
      await user.click(screen.getByRole('menuitem', { name: /duplicate/i }));

      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).not.toHaveBeenCalledWith('/actions/act-1');
    });
  });

  describe('delete warning', () => {
    async function openDeleteDialog(action = makeAction()) {
      const user = userEvent.setup();
      setupHook([action]);
      renderPage();
      await openRowMenu(user, action.name);
      await user.click(screen.getByRole('menuitem', { name: /delete/i }));
      return user;
    }

    it('titles the dialog with the action name', async () => {
      await openDeleteDialog();
      expect(screen.getByText('Delete "Create Issue"?')).toBeInTheDocument();
    });

    it('advises about slug-pinned scopes without claiming a reference exists', async () => {
      await openDeleteDialog();
      expect(screen.getByText(/Service tokens scoped to/)).toBeInTheDocument();
      expect(
        screen.getByText('action:execute:create-issue'),
      ).toBeInTheDocument();
      // The old blanket claim asserted usage it never looked up.
      expect(
        screen.queryByText(/reference this action by its slug/),
      ).not.toBeInTheDocument();
    });

    it('omits the capability-reference warning when nothing references the slug', async () => {
      await openDeleteDialog();
      expect(screen.queryByText(/Referenced by/)).not.toBeInTheDocument();
    });

    it('names the capabilities that reference the slug', async () => {
      mockCapabilityItems = [
        {
          id: 'cap-1',
          name: 'Triage Bot',
          instructions: 'Run @action:create-issue when triaging.',
        },
        {
          id: 'cap-2',
          name: 'Unrelated',
          instructions: 'Uses @action:something-else.',
        },
      ];
      await openDeleteDialog();

      await waitFor(() => {
        expect(
          screen.getByText(/Referenced by 1 capability/),
        ).toBeInTheDocument();
      });
      expect(screen.getByText('Triage Bot')).toBeInTheDocument();
      expect(screen.queryByText('Unrelated')).not.toBeInTheDocument();
    });

    it('warns that an enabled action is exposed to MCP', async () => {
      await openDeleteDialog(makeAction({ enabled: true }));
      expect(screen.getByText(/currently exposed to MCP/)).toBeInTheDocument();
    });

    it('omits the enabled warning for a disabled action', async () => {
      await openDeleteDialog(makeAction({ enabled: false }));
      expect(
        screen.queryByText(/currently exposed to MCP/),
      ).not.toBeInTheDocument();
    });

    it('reports the number of versions that will be deleted', async () => {
      mockListVersions.mockResolvedValue({ items: [], total: 4 });
      await openDeleteDialog();
      await waitFor(() => {
        expect(
          screen.getByText(/All 4 saved versions will be permanently deleted/),
        ).toBeInTheDocument();
      });
    });

    it('uses the singular form for a single version', async () => {
      mockListVersions.mockResolvedValue({ items: [], total: 1 });
      await openDeleteDialog();
      await waitFor(() => {
        expect(
          screen.getByText(/All 1 saved version will be permanently deleted/),
        ).toBeInTheDocument();
      });
    });

    it('falls back to generic copy when the version count cannot be fetched', async () => {
      mockListVersions.mockRejectedValue(new Error('nope'));
      await openDeleteDialog();
      await waitFor(() => {
        expect(
          screen.getByText(
            /All saved version history will be permanently deleted/,
          ),
        ).toBeInTheDocument();
      });
    });
  });

  describe('delete action', () => {
    async function openDeleteDialog() {
      const user = userEvent.setup();
      setupHook([makeAction()]);
      renderPage();
      await openRowMenu(user, 'Create Issue');
      await user.click(screen.getByRole('menuitem', { name: /delete/i }));
      return user;
    }

    it('submits the delete through the route action and closes on success', async () => {
      const user = await openDeleteDialog();

      await user.click(screen.getByRole('button', { name: 'Delete' }));

      await waitFor(() => {
        expect(mockRouteAction).toHaveBeenCalledTimes(1);
      });
      expect(submittedActionMutation).toEqual({
        intent: 'delete',
        actionId: 'act-1',
      });
      await waitFor(() => {
        expect(
          screen.queryByText('Delete "Create Issue"?'),
        ).not.toBeInTheDocument();
      });
    });

    it('closes without deleting on cancel', async () => {
      const user = await openDeleteDialog();
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(mockRouteAction).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(
          screen.queryByText('Delete "Create Issue"?'),
        ).not.toBeInTheDocument();
      });
    });

    it('keeps the dialog open when Escape is pressed during deletion', async () => {
      let resolveDelete:
        | ((result: ActionsRouteActionResult) => void)
        | undefined;
      mockRouteAction.mockImplementationOnce(
        () =>
          new Promise<ActionsRouteActionResult>(resolve => {
            resolveDelete = resolve;
          }),
      );
      const user = await openDeleteDialog();

      await user.click(screen.getByRole('button', { name: 'Delete' }));
      expect(
        await screen.findByRole('button', { name: 'Deleting...' }),
      ).toBeDisabled();
      expect(screen.queryByTestId('action-name-act-1')).not.toBeInTheDocument();

      await user.keyboard('{Escape}');

      expect(screen.getByText('Delete "Create Issue"?')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Deleting...' }),
      ).toBeDisabled();

      await act(async () => {
        resolveDelete?.({
          intent: 'delete',
          actionId: 'act-1',
          ok: true,
        });
      });
      await waitFor(() => {
        expect(
          screen.queryByText('Delete "Create Issue"?'),
        ).not.toBeInTheDocument();
      });
    });

    it('keeps the dialog open with a recoverable action error', async () => {
      mockRouteAction.mockResolvedValueOnce({
        intent: 'delete',
        actionId: 'act-1',
        ok: false,
        error: 'Permission denied',
      });
      const user = await openDeleteDialog();

      await user.click(screen.getByRole('button', { name: 'Delete' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Permission denied',
      );
      expect(screen.getByText('Delete "Create Issue"?')).toBeInTheDocument();
      expect(screen.getByTestId('action-name-act-1')).toBeInTheDocument();
    });

    it('clears a recoverable action error before reopening', async () => {
      mockRouteAction.mockResolvedValueOnce({
        intent: 'delete',
        actionId: 'act-1',
        ok: false,
        error: 'Permission denied',
      });
      const user = await openDeleteDialog();

      await user.click(screen.getByRole('button', { name: 'Delete' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Permission denied',
      );

      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      await openRowMenu(user, 'Create Issue');
      await user.click(screen.getByRole('menuitem', { name: /delete/i }));

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});
