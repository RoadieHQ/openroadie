import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TestQueryProvider } from '../../../test-utils';
import { RouterProvider, createMemoryRouter } from 'react-router';
import type {
  WorkflowDefinition,
  WorkflowExecution,
} from '../../../api/workflow/workflow-client';

const mockUseParams = vi.fn(
  () => ({ dataSourceId: 'ds-1' }) as { dataSourceId?: string },
);
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useParams: () => mockUseParams(),
  };
});

const mockSave = vi.fn().mockResolvedValue(undefined);
const mockExecute = vi.fn().mockResolvedValue(undefined);
const mockUseWorkflow = vi.fn();
vi.mock('../use-workflow', () => ({
  useWorkflow: (...args: unknown[]) => mockUseWorkflow(...args),
}));

const mockRefreshExecutionHistory = vi.fn();
const mockUseExecutionList = vi.fn(() => ({
  executions: [] as WorkflowExecution[],
  loading: false,
  retry: mockRefreshExecutionHistory,
}));
vi.mock('../use-execution-list', () => ({
  useExecutionList: () => mockUseExecutionList(),
}));

// Stand in for the inspector drawer so a test can invoke the props the editor
// wires into it (notably onRetry) without driving the live SSE execution hook.
const latestInspectorProps: {
  current: { onRetry?: () => void } | undefined;
} = { current: undefined };
vi.mock('./execution-inspector-drawer', () => ({
  ExecutionInspectorDrawer: (props: { onRetry?: () => void }) => {
    latestInspectorProps.current = props;
    return <div data-testid="execution-inspector-drawer" />;
  },
}));

const mockWorkflowApi = {
  workflows: {
    create: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
    get: vi.fn(),
    getScheduleInfo: vi.fn().mockResolvedValue({ nextRunAt: null }),
  },
  executions: {
    execute: vi.fn(),
    getLatest: vi.fn().mockResolvedValue(null),
  },
  integrations: {
    list: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    getLogoUrl: vi.fn().mockResolvedValue(''),
    listLogos: vi.fn().mockResolvedValue([]),
  },
  nodeTypes: { list: vi.fn().mockResolvedValue([]) },
  streaming: { streamExecutionAsync: vi.fn() },
  integrationSchemas: {
    listPathSuggestions: vi.fn().mockResolvedValue([]),
    listSchemas: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    getSchema: vi.fn().mockResolvedValue(undefined),
  },
  jsonataAssist: {
    generate: vi.fn(),
    validate: vi.fn(),
    stream: vi.fn(),
  },
};

const mockAlertApi = { post: vi.fn() };

const mockSecretsApi = {
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn(),
  delete: vi.fn(),
  getKeys: vi.fn().mockResolvedValue([]),
  getStorageMode: vi
    .fn()
    .mockResolvedValue({ mode: 'dotenv' as const, readOnly: false }),
};
const mockDatastoreApi = { deleteAllObjects: vi.fn() };
const mockAgentApi = {};

vi.mock('../../../api', () => ({
  useWorkflows: () => mockWorkflowApi,
  useAlert: () => mockAlertApi,
  useSecrets: () => mockSecretsApi,
  useDatastore: () => mockDatastoreApi,
  // `useIntegrations` now also scans action steps for integration usage.
  useActions: () => ({ list: async () => ({ items: [], total: 0 }) }),
  useAgent: () => mockAgentApi,
  // Reference-usage lookups (delete/rename warnings) read the capability list;
  // an empty list keeps them a no-op here.
  useCapabilities: () => ({
    list: async () => ({ items: [], total: 0 }),
  }),
  useApis: () => ({
    workflows: mockWorkflowApi,
    alert: mockAlertApi,
    secrets: mockSecretsApi,
    datastore: mockDatastoreApi,
    agent: mockAgentApi,
    config: {},
  }),
  useAppConfig: () => ({}),
}));

vi.mock('humanize-duration', () => ({
  default: () => '2 hours',
}));

vi.mock('react-json-view', () => ({
  default: () => <div data-testid="react-json-view" />,
  __esModule: true,
}));

const latestWorkflowNameHandler: {
  current: ((name: string) => void) | undefined;
} = { current: undefined };

const latestWorkflowDescriptionHandler: {
  current: ((description: string) => void) | undefined;
} = { current: undefined };

vi.mock('@roadiehq/ui/editor-header', () => ({
  EditorHeader: ({
    title,
    onTitleChange,
    description,
    onDescriptionChange,
    titleAdornment,
    actions,
    trailingActions,
    saveState,
    onSave,
    saveDisabled,
    saving,
  }: {
    title: string;
    onTitleChange?: (name: string) => void;
    description?: string;
    onDescriptionChange?: (description: string) => void;
    titleAdornment?: React.ReactNode;
    actions?: React.ReactNode;
    trailingActions?: React.ReactNode;
    saveState?: 'manual' | 'auto' | 'none';
    onSave?: () => void;
    saveDisabled?: boolean;
    saving?: boolean;
  }) => {
    latestWorkflowNameHandler.current = onTitleChange;
    latestWorkflowDescriptionHandler.current = onDescriptionChange;
    return (
      <div data-testid="editor-header">
        <span>{title}</span>
        <span data-testid="header-description">{description}</span>
        {titleAdornment}
        {actions}
        {saveState === 'manual' ? (
          // eslint-disable-next-line react/forbid-elements -- lightweight mock stand-in for EditorHeader's save button
          <button
            type="button"
            data-testid="pipeline-save-button"
            onClick={onSave}
            disabled={saveDisabled || saving}
          >
            Save
          </button>
        ) : null}
        {trailingActions}
      </div>
    );
  },
}));

// Import after mocks
import { DataSourceEditor } from './data-source-editor';

function makeWorkflow(
  overrides?: Partial<WorkflowDefinition>,
): WorkflowDefinition {
  return {
    id: 'ds-1',
    name: 'Test Data Source',
    slug: 'test-data-source',
    description: 'A test workflow',
    version: 1,
    workflowType: 'data-ingestion',
    nodes: [],
    edges: [],
    enabled: false,
    createdBy: 'user-1',
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-20T10:30:00Z',
    ...overrides,
  };
}

function setupLoading() {
  mockUseWorkflow.mockReturnValue({
    workflow: undefined,
    loading: true,
    error: undefined,
    save: mockSave,
    saving: false,
    execute: mockExecute,
  });
}

function setupError(message = 'Network error') {
  mockUseWorkflow.mockReturnValue({
    workflow: undefined,
    loading: false,
    error: new Error(message),
    save: mockSave,
    saving: false,
    execute: mockExecute,
  });
}

function setupLoaded(workflowOverrides?: Partial<WorkflowDefinition>) {
  mockUseWorkflow.mockReturnValue({
    workflow: makeWorkflow(workflowOverrides),
    loading: false,
    error: undefined,
    save: mockSave,
    saving: false,
    execute: mockExecute,
  });
}

function setupSaving(workflowOverrides?: Partial<WorkflowDefinition>) {
  mockUseWorkflow.mockReturnValue({
    workflow: makeWorkflow(workflowOverrides),
    loading: false,
    error: undefined,
    save: mockSave,
    saving: true,
    execute: mockExecute,
  });
}

function setupDraft() {
  mockUseWorkflow.mockReturnValue({
    workflow: undefined,
    loading: false,
    error: undefined,
    save: mockSave,
    saving: false,
    execute: mockExecute,
  });
}

function renderEditor(initialEntry = '/data-sources/ds-1') {
  const router = createMemoryRouter(
    [{ path: '*', element: <DataSourceEditor /> }],
    { initialEntries: [initialEntry] },
  );

  const view = render(
    <TestQueryProvider>
      <RouterProvider router={router} />
    </TestQueryProvider>,
  );

  return { ...view, router };
}

describe('DataSourceEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseParams.mockReturnValue({ dataSourceId: 'ds-1' });
    mockUseExecutionList.mockReturnValue({
      executions: [] as WorkflowExecution[],
      loading: false,
      retry: mockRefreshExecutionHistory,
    });
    latestInspectorProps.current = undefined;
  });

  describe('loading state', () => {
    it('renders progress indicator while loading', () => {
      setupLoading();
      renderEditor();
      expect(
        screen.getByTestId('data-source-editor-loading'),
      ).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('renders error panel when workflow fails to load', () => {
      setupError('Failed to fetch workflow');
      renderEditor();
      expect(
        screen.getByTestId('data-source-editor-error'),
      ).toBeInTheDocument();
      expect(screen.getByText('Failed to fetch workflow')).toBeInTheDocument();
    });
  });

  describe('loaded state', () => {
    it('renders loaded editor chrome: header with workflow name, save and dry-run buttons, disabled indicator', () => {
      setupLoaded();
      renderEditor();
      expect(screen.getByTestId('editor-header')).toBeInTheDocument();
      expect(screen.getByText('Test Data Source')).toBeInTheDocument();
      expect(screen.getByTestId('pipeline-save-button')).toBeInTheDocument();
      expect(screen.getByTestId('pipeline-test-button')).toBeInTheDocument();
      expect(
        screen.getByTestId('data-source-enabled-indicator'),
      ).toBeInTheDocument();
      expect(screen.getByText('Disabled')).toBeInTheDocument();
    });
  });

  describe('save interaction', () => {
    it('save button is disabled when no changes', () => {
      setupLoaded();
      renderEditor();
      const saveButton = screen.getByTestId('pipeline-save-button');
      expect(saveButton).toBeDisabled();
    });

    it('navigates to a created data source without showing a discard prompt', async () => {
      const user = userEvent.setup();
      mockUseParams.mockReturnValue({});
      setupDraft();
      mockSave.mockResolvedValueOnce(makeWorkflow({ id: 'created-ds' }));
      const { router } = renderEditor('/data-sources/new');

      fireEvent.change(screen.getByRole('spinbutton', { name: 'Value' }), {
        target: { value: '25' },
      });
      await user.click(screen.getByTestId('pipeline-save-button'));

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/data-sources/created-ds');
      });
      expect(screen.queryByText('Discard unsaved changes?')).toBeNull();
    });

    it('keeps navigation and unload guarded while saving', async () => {
      setupSaving();
      const { router } = renderEditor();

      fireEvent.change(screen.getByRole('spinbutton', { name: 'Value' }), {
        target: { value: '25' },
      });
      await act(async () => {
        await router.navigate('/capabilities');
      });

      expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/data-sources/ds-1');

      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe('draft mode', () => {
    it('mounts the editor without firing a workflow fetch and hides the enabled indicator', () => {
      mockUseParams.mockReturnValue({});
      setupDraft();
      renderEditor('/data-sources/new');
      expect(mockUseWorkflow).toHaveBeenCalledWith(undefined);
      expect(mockWorkflowApi.workflows.create).not.toHaveBeenCalled();
      expect(mockWorkflowApi.workflows.update).not.toHaveBeenCalled();
      expect(
        screen.queryByTestId('data-source-enabled-indicator'),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId('pipeline-save-button')).toBeInTheDocument();
    });
  });

  describe('workflow name', () => {
    it('auto-saves the name with a partial update on blur', async () => {
      setupLoaded({ name: 'Original' });
      mockWorkflowApi.workflows.update.mockResolvedValueOnce(undefined);
      renderEditor();

      await act(async () => {
        latestWorkflowNameHandler.current?.('Renamed');
      });

      await waitFor(() => {
        expect(mockWorkflowApi.workflows.update).toHaveBeenCalledWith('ds-1', {
          name: 'Renamed',
        });
      });
      expect(mockSave).not.toHaveBeenCalled();
      expect(mockAlertApi.post).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Name updated',
          severity: 'success',
        }),
      );
    });

    it('does not call update when the name is unchanged', async () => {
      setupLoaded({ name: 'Original' });
      renderEditor();

      await act(async () => {
        latestWorkflowNameHandler.current?.('Original');
      });

      expect(mockWorkflowApi.workflows.update).not.toHaveBeenCalled();
    });

    it('does not call update when the name is empty', async () => {
      setupLoaded({ name: 'Original' });
      renderEditor();

      await act(async () => {
        latestWorkflowNameHandler.current?.('   ');
      });

      expect(mockWorkflowApi.workflows.update).not.toHaveBeenCalled();
    });

    it('reverts the displayed name and alerts on save failure', async () => {
      setupLoaded({ name: 'Original' });
      mockWorkflowApi.workflows.update.mockRejectedValueOnce(
        new Error('network down'),
      );
      renderEditor();

      await act(async () => {
        await latestWorkflowNameHandler.current?.('Renamed');
      });

      await waitFor(() => {
        expect(mockAlertApi.post).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining('Failed to update name'),
            severity: 'error',
          }),
        );
      });
      expect(screen.getByText('Original')).toBeInTheDocument();
    });
  });

  describe('workflow description', () => {
    it('ignores a stale failed save that a newer commit superseded', async () => {
      setupLoaded({ description: 'orig' });
      let rejectFirst: ((e: Error) => void) | undefined;
      mockWorkflowApi.workflows.update
        .mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              rejectFirst = reject;
            }),
        )
        .mockResolvedValueOnce(undefined);
      renderEditor();

      await act(async () => {
        latestWorkflowDescriptionHandler.current?.('first');
      });
      await act(async () => {
        await latestWorkflowDescriptionHandler.current?.('second');
      });
      await act(async () => {
        rejectFirst?.(new Error('network down'));
      });

      // The stale failure must neither toast an error nor clobber the newer
      // value.
      expect(mockAlertApi.post).not.toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Failed to update description'),
        }),
      );
      expect(screen.getByTestId('header-description')).toHaveTextContent(
        'second',
      );
    });

    it('reverts a failed newest save to the last server-acknowledged value, not an unsaved predecessor', async () => {
      setupLoaded({ description: 'orig' });
      let rejectFirst: ((e: Error) => void) | undefined;
      let rejectSecond: ((e: Error) => void) | undefined;
      mockWorkflowApi.workflows.update
        .mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              rejectFirst = reject;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              rejectSecond = reject;
            }),
        );
      renderEditor();

      await act(async () => {
        latestWorkflowDescriptionHandler.current?.('first');
      });
      await act(async () => {
        latestWorkflowDescriptionHandler.current?.('second');
      });
      // The newest commit fails first: revert must land on 'orig' (the last
      // value the server acknowledged), not the never-persisted 'first'.
      await act(async () => {
        rejectSecond?.(new Error('network down'));
      });
      // The older commit's failure is then silent — it was superseded.
      await act(async () => {
        rejectFirst?.(new Error('network down'));
      });

      expect(screen.getByTestId('header-description')).toHaveTextContent(
        'orig',
      );
      const failureToasts = mockAlertApi.post.mock.calls.filter(
        ([arg]) =>
          typeof (arg as { message?: string }).message === 'string' &&
          (arg as { message: string }).message.includes(
            'Failed to update description',
          ),
      );
      expect(failureToasts).toHaveLength(1);
    });

    it('lands on the server-acknowledged value when a newer save fails before an older one succeeds', async () => {
      setupLoaded({ description: 'orig' });
      let resolveFirst: (() => void) | undefined;
      let rejectSecond: ((e: Error) => void) | undefined;
      mockWorkflowApi.workflows.update
        .mockImplementationOnce(
          () =>
            new Promise<void>(resolve => {
              resolveFirst = () => resolve();
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              rejectSecond = reject;
            }),
        );
      renderEditor();

      await act(async () => {
        latestWorkflowDescriptionHandler.current?.('first');
      });
      await act(async () => {
        latestWorkflowDescriptionHandler.current?.('second');
      });
      // The newer commit fails while the older is still in flight...
      await act(async () => {
        rejectSecond?.(new Error('network down'));
      });
      // ...then the older commit succeeds. The UI must settle on 'first' (what
      // the server actually kept), not stay stranded on the reverted 'orig'.
      await act(async () => {
        resolveFirst?.();
      });

      expect(screen.getByTestId('header-description')).toHaveTextContent(
        'first',
      );
      const failureToasts = mockAlertApi.post.mock.calls.filter(
        ([arg]) =>
          typeof (arg as { message?: string }).message === 'string' &&
          (arg as { message: string }).message.includes(
            'Failed to update description',
          ),
      );
      expect(failureToasts).toHaveLength(1);
    });
  });

  describe('slug popover', () => {
    it('only calls the API once when Enter is pressed repeatedly during a save', async () => {
      const user = userEvent.setup();
      setupLoaded({ slug: 'old-slug' });
      let resolveUpdate: (() => void) | undefined;
      mockWorkflowApi.workflows.update.mockImplementationOnce(
        () =>
          new Promise<void>(res => {
            resolveUpdate = res;
          }),
      );
      renderEditor();

      await user.click(screen.getByTestId('data-source-slug-trigger'));
      const input = await screen.findByLabelText('Slug');
      await user.clear(input);
      await user.type(input, 'new-slug');
      await user.keyboard('{Enter}');

      expect(input).toBeDisabled();
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(mockWorkflowApi.workflows.update).toHaveBeenCalledTimes(1);
      expect(mockWorkflowApi.workflows.update).toHaveBeenCalledWith('ds-1', {
        slug: 'new-slug',
      });

      await act(async () => {
        resolveUpdate?.();
      });
      expect(mockWorkflowApi.workflows.update).toHaveBeenCalledTimes(1);
    });

    it('discards an abandoned draft when the popover reopens', async () => {
      const user = userEvent.setup();
      setupLoaded({ slug: 'test-data-source' });
      renderEditor();

      const trigger = screen.getByTestId('data-source-slug-trigger');
      await user.click(trigger);
      const input = await screen.findByLabelText('Slug');
      await user.clear(input);
      await user.type(input, 'abandoned-draft');
      await user.keyboard('{Escape}');
      await waitFor(() => {
        expect(screen.queryByLabelText('Slug')).not.toBeInTheDocument();
      });

      await user.click(trigger);
      expect(await screen.findByLabelText('Slug')).toHaveValue(
        'test-data-source',
      );
      expect(mockWorkflowApi.workflows.update).not.toHaveBeenCalled();
    });
  });

  describe('execution inspector retry', () => {
    it('re-runs the data source when the inspector retry is invoked', async () => {
      const user = userEvent.setup();
      setupLoaded();
      mockUseExecutionList.mockReturnValue({
        executions: [{ id: 'exec-1' }] as unknown as WorkflowExecution[],
        loading: false,
        retry: mockRefreshExecutionHistory,
      });
      mockWorkflowApi.executions.execute.mockResolvedValueOnce({
        executionId: 'exec-2',
      });
      renderEditor();

      await user.click(screen.getByTestId('data-source-actions-button'));
      await user.click(screen.getByRole('menuitem', { name: 'Run history' }));
      expect(
        screen.getByTestId('execution-inspector-drawer'),
      ).toBeInTheDocument();

      await act(async () => {
        await latestInspectorProps.current?.onRetry?.();
      });

      // Retry must re-run the data source, not merely refetch the run list.
      expect(mockWorkflowApi.executions.execute).toHaveBeenCalledWith('ds-1');
      expect(mockRefreshExecutionHistory).not.toHaveBeenCalled();
    });
  });

  describe('delete confirmation', () => {
    it('disables confirm and cancel while the delete is pending', async () => {
      const user = userEvent.setup();
      setupLoaded();
      let resolveDelete: (() => void) | undefined;
      mockWorkflowApi.workflows.delete.mockImplementationOnce(
        () =>
          new Promise<void>(res => {
            resolveDelete = res;
          }),
      );
      const { router } = renderEditor();

      fireEvent.change(screen.getByRole('spinbutton', { name: 'Value' }), {
        target: { value: '25' },
      });

      await user.click(screen.getByTestId('data-source-actions-button'));
      await user.click(screen.getByRole('menuitem', { name: /delete/i }));
      const confirm = await screen.findByTestId(
        'delete-btn-confirmation-dialog',
      );
      await user.click(confirm);

      expect(confirm).toBeDisabled();
      expect(confirm).toHaveTextContent('Deleting…');
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
      expect(mockWorkflowApi.workflows.delete).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolveDelete?.();
      });

      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/data-sources');
      });
      expect(screen.queryByText('Discard unsaved changes?')).toBeNull();
      expect(mockDatastoreApi.deleteAllObjects).toHaveBeenCalledWith('ds-1');
    });
  });
});
