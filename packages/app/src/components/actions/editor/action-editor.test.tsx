import {
  render,
  screen,
  waitFor,
  type RenderResult,
} from '@testing-library/react';
import type { ComponentProps } from 'react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Button } from '@roadiehq/ui/button';
import { ActionEditor } from './action-editor';
import type { ActionWithSchema } from '../types';
import { createTestQueryClient } from '../../../test-utils';
import { queryKeys } from '../../../api/queries';

const { mockStepListRender } = vi.hoisted(() => ({
  mockStepListRender: vi.fn(),
}));

vi.mock('./step-list', async importOriginal => {
  const actual = await importOriginal<typeof import('./step-list')>();
  const ActualStepList = actual.StepList;

  return {
    ...actual,
    StepList: (props: ComponentProps<typeof ActualStepList>) => {
      mockStepListRender(props);
      return <ActualStepList {...props} />;
    },
  };
});

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockAlertApi = { post: vi.fn() };
const mockActionsApi = {
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  listVersions: vi.fn(),
  restoreVersion: vi.fn(),
  executeDraft: vi.fn(),
};
vi.mock('../../../api', () => ({
  useActions: () => mockActionsApi,
  useAlert: () => mockAlertApi,
  // Reference-usage lookups (delete warnings) read the capability list; an
  // empty list keeps them a no-op here.
  useCapabilities: () => ({
    list: async () => ({ items: [], total: 0 }),
  }),
}));

const mockUseIntegrations = vi.fn();
vi.mock('../../integrations/use-integrations', () => ({
  useIntegrations: () => mockUseIntegrations(),
}));

// The step list resolves integration logos through the workflows API; stub it
// so these tests stay off the network/query layer.
vi.mock('../../data-sources/use-resolved-logo', () => ({
  useLogoResolver: () => () => '',
}));

// The unified IntegrationSelector consults secret status and can open the
// integration form; both reach for the app-wide API context, so stub them.
vi.mock('../../integrations/use-integration-secret-status', () => ({
  useIntegrationSecretStatus: () => ({
    summariesByIntegrationId: new Map(),
    loading: false,
  }),
  useInvalidateIntegrationSecretStatus: () => vi.fn(),
}));
vi.mock('../../integrations/form', () => ({
  IntegrationFormDialog: () => null,
}));

// Sub-components are exercised by their own tests; stub them so these tests
// stay focused on the editor's draft / save / duplicate behaviour.
vi.mock('./parameter-builder', () => ({
  ParameterBuilder: () => <div data-testid="parameter-builder" />,
}));
vi.mock('./version-history', () => ({
  VersionHistory: ({
    show,
    versions,
    onView,
  }: {
    show: boolean;
    versions: Array<{ version: number; name: string }>;
    onView: (v: unknown) => void;
  }) =>
    show ? (
      <div data-testid="version-history">
        {versions.map(v => (
          <Button
            key={v.version}
            type="button"
            onClick={() => onView(v)}
          >{`View v${v.version}`}</Button>
        ))}
      </div>
    ) : null,
}));

interface DraftFields {
  name: string;
  slug: string;
  description: string;
  enabled: boolean;
  parameters: unknown[];
  steps: Array<{
    id: string;
    integrationId: string;
    request: {
      method: string;
      path: string;
      headers: unknown[];
      body: string;
    };
  }>;
}

function makeDraft(overrides?: Partial<DraftFields>): DraftFields {
  return {
    name: 'Seeded',
    slug: 'seeded',
    description: 'desc',
    enabled: true,
    parameters: [],
    steps: [
      {
        id: 'createIssue',
        integrationId: 'int-1',
        request: { method: 'POST', path: '/issues', headers: [], body: '' },
      },
    ],
    ...overrides,
  };
}

function makeAction(overrides?: Partial<ActionWithSchema>): ActionWithSchema {
  return {
    id: 'act-1',
    name: 'Create Issue',
    slug: 'create-issue',
    description: 'desc',
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

function makeVersion(over: { version: number; name: string }) {
  return {
    id: `v-${over.version}`,
    actionId: 'act-1',
    version: over.version,
    name: over.name,
    slug: `slug-${over.version}`,
    description: 'desc',
    parameters: [],
    steps: [
      {
        id: 'fetch',
        integrationId: 'int-1',
        request: { method: 'GET', path: '/x', headers: [], body: '' },
      },
    ],
    enabled: true,
    createdAt: '2026-06-01T00:00:00Z',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

type Entry = string | { pathname: string; state?: unknown };

function renderEditor(
  entry: Entry,
  queryClient = createTestQueryClient(),
): RenderResult {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/actions/:actionId" element={<ActionEditor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const NEW_KEY = 'actions:editor-draft:new';
const existingKey = (id: string) => `actions:editor-draft:${id}`;

// The action name is the editable header title: a button (editable) or an <h1>
// (read-only, e.g. version view). Empty shows the "Untitled action" placeholder.
function nameText(): string {
  const trigger = screen.queryByTestId('editable-title-trigger');
  return (
    (trigger ?? screen.getByRole('heading', { level: 1 })).textContent ?? ''
  );
}

async function setName(
  user: ReturnType<typeof userEvent.setup>,
  value: string,
) {
  await user.click(screen.getByTestId('editable-title-trigger'));
  const input = screen.getByLabelText('Edit title');
  await user.clear(input);
  await user.type(input, `${value}{Enter}`);
}

// History / Duplicate / Enable-Disable / Delete now live in the header "⋯" menu.
async function clickMenuItem(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  await user.click(screen.getByTestId('action-actions-button'));
  await user.click(await screen.findByRole('menuitem', { name }));
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mockActionsApi.get.mockResolvedValue(undefined);
  mockActionsApi.listVersions.mockResolvedValue({ items: [], total: 0 });
  mockUseIntegrations.mockReturnValue({
    integrations: [{ id: 'int-1', name: 'GitHub', backendType: 'http' }],
  });
});

describe('ActionEditor', () => {
  describe('rendering / load', () => {
    it('renders the create form for a new action', () => {
      renderEditor('/actions/new');
      expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
      expect(nameText()).toBe('Untitled action');
      expect(
        screen.getByRole('button', { name: 'Step 2: step1' }),
      ).toHaveAttribute('aria-current', 'true');
    });

    it('loads and populates an existing action', async () => {
      mockActionsApi.get.mockResolvedValue(makeAction());
      renderEditor('/actions/act-1');
      await waitFor(() => {
        expect(nameText()).toBe('Create Issue');
      });
    });

    it('opens on the first request step instead of the Inputs parameter list', async () => {
      mockActionsApi.get.mockResolvedValue(makeAction());
      renderEditor('/actions/act-1');

      await waitFor(() => {
        expect(nameText()).toBe('Create Issue');
      });

      expect(
        mockStepListRender.mock.calls.some(
          ([props]) => props.autoExpandFirstStep === true,
        ),
      ).toBe(true);

      const inputsNode = screen.getByTestId('action-inputs-node');
      expect(inputsNode.querySelector('[aria-expanded="false"]')).toBeTruthy();

      const firstStep = screen.getByTestId('action-step-0');
      expect(firstStep.querySelector('[aria-expanded="true"]')).toBeTruthy();

      expect(
        screen.getByRole('button', { name: 'Step 2: createIssue' }),
      ).toHaveAttribute('aria-current', 'true');
      expect(
        screen.getByText('Run the action to see per-step responses here.'),
      ).toBeInTheDocument();
      expect(screen.queryByText('Test inputs (JSON)')).not.toBeInTheDocument();
    });

    it('preserves unsaved edits when the action query refetches in the background', async () => {
      mockActionsApi.get.mockResolvedValue(makeAction({ name: 'Server Name' }));
      const queryClient = createTestQueryClient();
      const user = userEvent.setup();
      renderEditor('/actions/act-1', queryClient);

      await waitFor(() => {
        expect(nameText()).toBe('Server Name');
      });

      await setName(user, 'Edited Name');

      mockActionsApi.get.mockResolvedValue(
        makeAction({ name: 'Server Name', updatedAt: '2026-06-21T00:00:00Z' }),
      );
      await queryClient.invalidateQueries({
        queryKey: queryKeys.actionDetail('act-1'),
      });

      await waitFor(() => {
        expect(mockActionsApi.get.mock.calls.length).toBeGreaterThan(1);
      });

      expect(nameText()).toBe('Edited Name');
      expect(
        document.querySelector('.motion-icon-spin'),
      ).not.toBeInTheDocument();
    });

    it('does not render the placeholder step before seeding an existing action', async () => {
      mockActionsApi.get.mockResolvedValue(makeAction());
      renderEditor('/actions/act-1');

      await screen.findByText('Create Issue');

      expect(mockStepListRender).toHaveBeenCalled();
      expect(
        mockStepListRender.mock.calls.some(
          ([props]) => props.steps[0]?.integrationId === '',
        ),
      ).toBe(false);
    });

    it('shows an error state when loading fails', async () => {
      mockActionsApi.get.mockRejectedValue(new Error('load failed'));
      renderEditor('/actions/act-1');
      await waitFor(() => {
        expect(screen.getByText('load failed')).toBeInTheDocument();
      });
    });

    it('shows not-found when the action is missing', async () => {
      mockActionsApi.get.mockResolvedValue(undefined);
      renderEditor('/actions/act-1');
      await waitFor(() => {
        expect(screen.getByText('Action not found')).toBeInTheDocument();
      });
    });
  });

  describe('save + redirect', () => {
    it('creates a new action and navigates to the list', async () => {
      sessionStorage.setItem(
        NEW_KEY,
        JSON.stringify({ draft: makeDraft(), slugEdited: true }),
      );
      mockActionsApi.create.mockResolvedValue(makeAction({ id: 'new-1' }));
      const queryClient = createTestQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const user = userEvent.setup();
      renderEditor('/actions/new', queryClient);

      await user.click(screen.getByRole('button', { name: 'Create' }));

      await waitFor(() => {
        expect(mockActionsApi.create).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Seeded',
            steps: [
              expect.objectContaining({
                id: 'createIssue',
                integrationId: 'int-1',
                request: expect.objectContaining({ path: '/issues' }),
              }),
            ],
          }),
        );
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.actionsList,
      });
      expect(mockNavigate).toHaveBeenCalledWith('/actions', { replace: true });
      expect(mockAlertApi.post).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'success' }),
      );
      expect(sessionStorage.getItem(NEW_KEY)).toBeNull();
    });

    it('shows a save failure as a toast and stays on the page', async () => {
      sessionStorage.setItem(
        NEW_KEY,
        JSON.stringify({ draft: makeDraft(), slugEdited: true }),
      );
      mockActionsApi.create.mockRejectedValue(new Error('backend rejected it'));
      const user = userEvent.setup();
      renderEditor('/actions/new');

      await user.click(screen.getByRole('button', { name: 'Create' }));

      await waitFor(() => {
        expect(mockAlertApi.post).toHaveBeenCalledWith({
          message: 'backend rejected it',
          severity: 'error',
        });
      });
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('updates an existing action and navigates to the list', async () => {
      mockActionsApi.get.mockResolvedValue(makeAction());
      mockActionsApi.update.mockResolvedValue(makeAction());
      const queryClient = createTestQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const user = userEvent.setup();
      renderEditor('/actions/act-1', queryClient);

      await waitFor(() => {
        expect(nameText()).toBe('Create Issue');
      });
      await clickMenuItem(user, 'Disable');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(mockActionsApi.update).toHaveBeenCalledWith(
          'act-1',
          expect.objectContaining({ name: 'Create Issue' }),
        );
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.actionsList,
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.actionDetail('act-1'),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.actionVersions('act-1'),
      });
      expect(mockNavigate).toHaveBeenCalledWith('/actions', { replace: true });
    });

    it('shows the saved values when the editor is reopened within staleTime', async () => {
      // Prod-like client: a fresh cache entry is served without a refetch on
      // remount, so a reopen right after saving must find the entry invalidated.
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
      });
      mockActionsApi.get.mockResolvedValue(makeAction({ name: 'Server Name' }));
      mockActionsApi.update.mockResolvedValue(
        makeAction({ name: 'Renamed Action' }),
      );
      const user = userEvent.setup();
      const { unmount } = renderEditor('/actions/act-1', queryClient);

      await waitFor(() => {
        expect(nameText()).toBe('Server Name');
      });
      await setName(user, 'Renamed Action');
      mockActionsApi.get.mockResolvedValue(
        makeAction({ name: 'Renamed Action' }),
      );
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => {
        expect(mockActionsApi.update).toHaveBeenCalled();
      });
      unmount();

      renderEditor('/actions/act-1', queryClient);
      await waitFor(() => {
        expect(nameText()).toBe('Renamed Action');
      });
    });

    it('blocks save and toasts an error when the name is missing', async () => {
      const user = userEvent.setup();
      renderEditor('/actions/new');

      await user.click(screen.getByRole('button', { name: 'Create' }));

      expect(mockAlertApi.post).toHaveBeenCalledWith({
        message: 'Name is required',
        severity: 'error',
      });
      expect(mockActionsApi.create).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe('steps', () => {
    it('adds and removes steps in the editor', async () => {
      const user = userEvent.setup();
      renderEditor('/actions/new');

      expect(screen.getByTestId('action-step-0')).toBeInTheDocument();
      expect(screen.queryByTestId('action-step-1')).not.toBeInTheDocument();

      // Insert-anywhere "+" connectors; the trailing one appends a step.
      await user.click(screen.getByTestId('insert-step-1'));
      expect(screen.getByTestId('action-step-1')).toBeInTheDocument();

      // Delete lives in the step header (shared StepNode), labelled per step.
      await user.click(screen.getByRole('button', { name: 'Remove step 2' }));
      expect(screen.queryByTestId('action-step-1')).not.toBeInTheDocument();
      // The only remaining step has no delete affordance (like the DS editor).
      expect(
        screen.queryByRole('button', { name: 'Remove step 1' }),
      ).not.toBeInTheDocument();
    });

    it('blocks save and toasts an error when a step id is invalid', async () => {
      sessionStorage.setItem(
        NEW_KEY,
        JSON.stringify({
          draft: makeDraft({
            steps: [
              {
                id: 'not-an-identifier',
                integrationId: 'int-1',
                request: {
                  method: 'POST',
                  path: '/issues',
                  headers: [],
                  body: '',
                },
              },
            ],
          }),
          slugEdited: true,
        }),
      );
      const user = userEvent.setup();
      renderEditor('/actions/new');

      await user.click(screen.getByRole('button', { name: 'Create' }));

      expect(mockAlertApi.post).toHaveBeenCalledWith({
        message: 'Fix step ids (invalid or duplicate)',
        severity: 'error',
      });
      expect(mockActionsApi.create).not.toHaveBeenCalled();
    });

    it('blocks save when a step is missing an integration', async () => {
      sessionStorage.setItem(
        NEW_KEY,
        JSON.stringify({
          draft: makeDraft({
            steps: [
              {
                id: 'createIssue',
                integrationId: '',
                request: {
                  method: 'POST',
                  path: '/issues',
                  headers: [],
                  body: '',
                },
              },
            ],
          }),
          slugEdited: true,
        }),
      );
      const user = userEvent.setup();
      renderEditor('/actions/new');

      await user.click(screen.getByRole('button', { name: 'Create' }));

      expect(mockAlertApi.post).toHaveBeenCalledWith({
        message: 'Every step needs an integration',
        severity: 'error',
      });
      expect(mockActionsApi.create).not.toHaveBeenCalled();
    });

    it('toasts a missing request path without requiring graph scroll', async () => {
      sessionStorage.setItem(
        NEW_KEY,
        JSON.stringify({
          draft: makeDraft({
            steps: [
              {
                id: 'createIssue',
                integrationId: 'int-1',
                request: {
                  method: 'POST',
                  path: '',
                  headers: [],
                  body: '',
                },
              },
            ],
          }),
          slugEdited: true,
        }),
      );
      const user = userEvent.setup();
      renderEditor('/actions/new');

      await user.click(screen.getByRole('button', { name: 'Create' }));

      expect(mockAlertApi.post).toHaveBeenCalledWith({
        message: 'Every step needs a request path',
        severity: 'error',
      });
      expect(mockActionsApi.create).not.toHaveBeenCalled();
    });

    it('converts sessionStorage drafts from the pre-multi-step shape', () => {
      sessionStorage.setItem(
        NEW_KEY,
        JSON.stringify({
          draft: {
            name: 'Old shape',
            slug: 'old-shape',
            description: '',
            integrationId: 'int-1',
            enabled: true,
            parameters: [],
            request: { method: 'GET', path: '/x', headers: [], body: '' },
          },
          slugEdited: true,
        }),
      );
      renderEditor('/actions/new');
      // In-flight edits survive the shape change as a single-step draft.
      expect(nameText()).toBe('Old shape');
      expect(screen.getByTestId('action-step-0')).toHaveTextContent('GET /x');
    });
  });

  describe('draft persistence', () => {
    it('persists edits for a new action to sessionStorage', async () => {
      const user = userEvent.setup();
      renderEditor('/actions/new');

      await setName(user, 'My Action');

      await waitFor(() => {
        const raw = sessionStorage.getItem(NEW_KEY);
        expect(raw).toBeTruthy();
        expect(JSON.parse(raw as string).draft.name).toBe('My Action');
      });
    });

    it('restores a persisted new-action draft on mount', () => {
      sessionStorage.setItem(
        NEW_KEY,
        JSON.stringify({
          draft: makeDraft({ name: 'Restored', slug: 'restored' }),
          slugEdited: true,
        }),
      );
      renderEditor('/actions/new');
      expect(nameText()).toBe('Restored');
    });

    it('restores an unsaved draft over server data for an existing action', async () => {
      mockActionsApi.get.mockResolvedValue(makeAction({ name: 'Server Name' }));
      sessionStorage.setItem(
        existingKey('act-1'),
        JSON.stringify({
          draft: makeDraft({ name: 'Draft Name' }),
          slugEdited: false,
        }),
      );
      renderEditor('/actions/act-1');

      await waitFor(() => {
        expect(nameText()).toBe('Draft Name');
      });
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    });

    it('does not persist a pristine existing action', async () => {
      mockActionsApi.get.mockResolvedValue(makeAction());
      renderEditor('/actions/act-1');
      await waitFor(() => {
        expect(nameText()).toBe('Create Issue');
      });
      expect(sessionStorage.getItem(existingKey('act-1'))).toBeNull();
    });

    it('clears a stale draft when an existing action is reverted to its saved value', async () => {
      const user = userEvent.setup();
      mockActionsApi.get.mockResolvedValue(
        makeAction({ name: 'Create Issue' }),
      );
      renderEditor('/actions/act-1');
      await waitFor(() => {
        expect(nameText()).toBe('Create Issue');
      });

      // Dirty the form → an unsaved draft is persisted.
      await setName(user, 'Create Issue Updated');
      await waitFor(() => {
        expect(sessionStorage.getItem(existingKey('act-1'))).toBeTruthy();
      });

      // Undo the edit back to the saved value → the stale draft must be cleared,
      // not left behind to resurrect the abandoned edit on the next visit.
      await setName(user, 'Create Issue');
      await waitFor(() => {
        expect(sessionStorage.getItem(existingKey('act-1'))).toBeNull();
      });
    });

    it('ignores a non-meaningful stored draft for an existing action', async () => {
      mockActionsApi.get.mockResolvedValue(makeAction({ name: 'Server Name' }));
      sessionStorage.setItem(
        existingKey('act-1'),
        JSON.stringify({
          draft: makeDraft({
            name: '',
            slug: '',
            description: '',
            steps: [
              {
                id: 'step1',
                integrationId: '',
                request: { method: 'GET', path: '', headers: [], body: '' },
              },
            ],
          }),
          slugEdited: false,
        }),
      );
      renderEditor('/actions/act-1');

      await waitFor(() => {
        expect(nameText()).toBe('Server Name');
      });
      expect(sessionStorage.getItem(existingKey('act-1'))).toBeNull();
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });

    it('clears sessionStorage when a restored draft is edited to non-meaningful', async () => {
      mockActionsApi.get.mockResolvedValue(makeAction({ name: 'Server Name' }));
      sessionStorage.setItem(
        existingKey('act-1'),
        JSON.stringify({
          draft: makeDraft({
            name: 'Draft Name',
            slug: '',
            description: '',
            steps: [
              {
                id: 'step1',
                integrationId: '',
                request: { method: 'GET', path: '', headers: [], body: '' },
              },
            ],
          }),
          slugEdited: false,
        }),
      );
      const user = userEvent.setup();
      renderEditor('/actions/act-1');

      await waitFor(() => {
        expect(nameText()).toBe('Draft Name');
      });
      expect(sessionStorage.getItem(existingKey('act-1'))).toBeTruthy();

      await setName(user, '');

      await waitFor(() => {
        expect(sessionStorage.getItem(existingKey('act-1'))).toBeNull();
      });
    });
  });

  describe('duplicate', () => {
    it('prefills the create form from a duplicate source', () => {
      renderEditor({
        pathname: '/actions/new',
        state: {
          duplicateFrom: makeDraft({ name: 'Deploy (copy)', slug: '' }),
        },
      });
      expect(nameText()).toBe('Deploy (copy)');
      // Duplicating clears the slug — the header slug pill shows its placeholder.
      expect(screen.getByTestId('action-slug-trigger')).toHaveTextContent(
        'slug',
      );
      expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
    });

    it('asks before replacing an in-progress new action draft with a duplicate', () => {
      sessionStorage.setItem(
        NEW_KEY,
        JSON.stringify({
          draft: makeDraft({ name: 'My draft' }),
          slugEdited: true,
        }),
      );
      renderEditor({
        pathname: '/actions/new',
        state: {
          duplicateFrom: makeDraft({ name: 'Deploy (copy)', slug: '' }),
        },
      });
      expect(nameText()).toBe('My draft');
      expect(screen.getByTestId('confirmation-dialog')).toBeInTheDocument();
      expect(
        screen.getByText('Replace in-progress draft?'),
      ).toBeInTheDocument();
    });

    it('replaces the stored draft when duplicate overwrite is confirmed', async () => {
      sessionStorage.setItem(
        NEW_KEY,
        JSON.stringify({
          draft: makeDraft({ name: 'My draft' }),
          slugEdited: true,
        }),
      );
      const user = userEvent.setup();
      renderEditor({
        pathname: '/actions/new',
        state: {
          duplicateFrom: makeDraft({ name: 'Deploy (copy)', slug: '' }),
        },
      });

      await user.click(screen.getByRole('button', { name: 'Replace draft' }));

      expect(nameText()).toBe('Deploy (copy)');
      expect(
        screen.queryByTestId('confirmation-dialog'),
      ).not.toBeInTheDocument();
    });

    it('keeps the stored draft when duplicate overwrite is cancelled', async () => {
      sessionStorage.setItem(
        NEW_KEY,
        JSON.stringify({
          draft: makeDraft({ name: 'My draft' }),
          slugEdited: true,
        }),
      );
      const user = userEvent.setup();
      renderEditor({
        pathname: '/actions/new',
        state: {
          duplicateFrom: makeDraft({ name: 'Deploy (copy)', slug: '' }),
        },
      });

      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(nameText()).toBe('My draft');
      expect(
        screen.queryByTestId('confirmation-dialog'),
      ).not.toBeInTheDocument();
    });

    it('navigates to a prefilled create form from the editor header', async () => {
      mockActionsApi.get.mockResolvedValue(makeAction());
      const user = userEvent.setup();
      renderEditor('/actions/act-1');

      await waitFor(() => {
        expect(nameText()).toBe('Create Issue');
      });
      await clickMenuItem(user, 'Duplicate');

      expect(mockNavigate).toHaveBeenCalledWith('/actions/new', {
        state: {
          duplicateFrom: expect.objectContaining({
            name: 'Create Issue (copy)',
            slug: '',
          }),
        },
      });
    });
  });

  describe('version restore', () => {
    function setupRestore() {
      mockActionsApi.get.mockResolvedValueOnce(
        makeAction({ name: 'Current Name', currentVersion: 2 }),
      );
      mockActionsApi.listVersions.mockResolvedValue({
        items: [makeVersion({ version: 1, name: 'Old Name' })],
        total: 2,
      });
      mockActionsApi.restoreVersion.mockResolvedValue(
        makeAction({ name: 'Old Name', slug: 'slug-1', currentVersion: 3 }),
      );
    }

    async function viewV1(user: ReturnType<typeof userEvent.setup>) {
      await waitFor(() => {
        expect(nameText()).toBe('Current Name');
      });
      await clickMenuItem(user, 'History');
      await user.click(screen.getByRole('button', { name: 'View v1' }));
      expect(nameText()).toBe('Old Name');
    }

    it('shows the restored content after a successful restore', async () => {
      setupRestore();
      mockActionsApi.get.mockResolvedValue(
        makeAction({ name: 'Old Name', slug: 'slug-1', currentVersion: 3 }),
      );
      const user = userEvent.setup();
      renderEditor('/actions/act-1');
      await viewV1(user);

      await user.click(screen.getByRole('button', { name: /Restore/ }));

      await waitFor(() => {
        expect(nameText()).toBe('Old Name');
      });
      expect(
        screen.queryByDisplayValue('Current Name'),
      ).not.toBeInTheDocument();
    });

    it('preserves unsaved edits (and matches storage) when exiting a version view', async () => {
      mockActionsApi.get.mockResolvedValue(
        makeAction({ name: 'Server Name', currentVersion: 2 }),
      );
      mockActionsApi.listVersions.mockResolvedValue({
        items: [makeVersion({ version: 1, name: 'Old Name' })],
        total: 2,
      });
      const user = userEvent.setup();
      renderEditor('/actions/act-1');
      await waitFor(() => {
        expect(nameText()).toBe('Server Name');
      });

      await setName(user, 'Edited Name');
      await clickMenuItem(user, 'History');
      await user.click(screen.getByRole('button', { name: 'View v1' }));
      expect(nameText()).toBe('Old Name');

      await user.click(screen.getByRole('button', { name: /Exit/ }));

      expect(nameText()).toBe('Edited Name');
      const stored = sessionStorage.getItem(existingKey('act-1'));
      expect(JSON.parse(stored as string).draft.name).toBe('Edited Name');
    });

    it('shows the restored definition immediately, without a spinner, while the background refetch is in flight', async () => {
      setupRestore();
      const pending = deferred<unknown>();
      // The post-restore cache refetch hangs — assert what the user sees while
      // it is still in flight.
      mockActionsApi.get.mockReturnValueOnce(pending.promise);
      const user = userEvent.setup();
      renderEditor('/actions/act-1');
      await viewV1(user);

      await user.click(screen.getByRole('button', { name: /Restore/ }));

      // Restore returns the new definition, so the form is seeded from it
      // immediately and version view is exited. The cache refetch it triggers
      // is a background one (stale-while-revalidate): the form stays mounted
      // — no spinner replaces it — and the pre-restore definition is never
      // surfaced, even while that refetch is unresolved.
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: /Restore/ }),
        ).not.toBeInTheDocument();
      });
      expect(nameText()).toBe('Old Name');
      expect(
        document.querySelector('.motion-icon-spin'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByDisplayValue('Current Name'),
      ).not.toBeInTheDocument();
    });
  });

  describe('version view', () => {
    it('resets request body sizing when switching modes on the current version', async () => {
      mockActionsApi.get.mockResolvedValue(
        makeAction({ name: 'Current', currentVersion: 2 }),
      );
      mockActionsApi.listVersions.mockResolvedValue({
        items: [makeVersion({ version: 2, name: 'Current' })],
        total: 1,
      });
      const user = userEvent.setup();
      renderEditor('/actions/act-1');

      await waitFor(() => {
        expect(
          mockStepListRender.mock.calls.some(
            ([props]) => props.editorResetKey === 'edit:2',
          ),
        ).toBe(true);
      });

      await clickMenuItem(user, 'History');
      await user.click(screen.getByRole('button', { name: 'View v2' }));

      expect(
        mockStepListRender.mock.calls.some(
          ([props]) => props.editorResetKey === 'view:2',
        ),
      ).toBe(true);
    });

    it('does not paint draft test-run results onto a historical version', async () => {
      mockActionsApi.get.mockResolvedValue(
        makeAction({ name: 'Current', currentVersion: 2 }),
      );
      mockActionsApi.listVersions.mockResolvedValue({
        items: [makeVersion({ version: 1, name: 'Old' })],
        total: 1,
      });
      const user = userEvent.setup();
      renderEditor('/actions/act-1');
      await waitFor(() => {
        expect(nameText()).toBe('Current');
      });

      await clickMenuItem(user, 'History');
      await user.click(screen.getByRole('button', { name: 'View v1' }));

      // The version's steps render, and the Test control is hidden (no
      // running a historical definition).
      expect(screen.getByTestId('action-step-0')).toBeInTheDocument();
      expect(
        screen.queryByTestId('action-test-button'),
      ).not.toBeInTheDocument();
    });
  });
});
