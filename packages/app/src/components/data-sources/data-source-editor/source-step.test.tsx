import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { TooltipProvider } from '@roadiehq/ui/tooltip';
import { TestQueryProvider } from '../../../test-utils';
import { SourceStep } from './source-step';
import {
  DataSourceEditorContext,
  type DataSourceEditorContextValue,
} from './data-source-editor-context';

vi.mock('humanize-duration', () => ({
  default: () => '2 hours',
}));

vi.mock('../use-data-sources', () => ({
  useDataSources: () => ({
    dataSources: [
      { id: 'ds-1', name: 'Current Pipeline', logoUrl: '' },
      { id: 'ds-users', name: 'GitHub Users', logoUrl: '' },
    ],
    loading: false,
    error: undefined,
  }),
}));

const mockSecretsApi = vi.hoisted(() => ({
  getKeys: vi.fn().mockResolvedValue([]),
  getStorageMode: vi.fn().mockResolvedValue({
    mode: 'dotenv' as const,
    readOnly: false,
  }),
}));

vi.mock('../../../api', () => {
  const mockWorkflowApi = {
    integrations: {
      list: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      getLogoUrl: vi.fn().mockResolvedValue(''),
      listLogos: vi.fn().mockResolvedValue([]),
    },
    integrationSchemas: {
      listPathSuggestions: vi.fn().mockResolvedValue([]),
      listSchemas: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      getSchema: vi.fn().mockResolvedValue(undefined),
    },
  };
  const mockAlertApi = { post: vi.fn() };
  return {
    useWorkflows: () => mockWorkflowApi,
    useAlert: () => mockAlertApi,
    useSecrets: () => mockSecretsApi,
    useDatastore: () => ({}),
    // `useIntegrations` now also scans action steps for integration usage.
    useActions: () => ({ list: async () => ({ items: [], total: 0 }) }),
    useAgent: () => ({}),
    useApis: () => ({
      workflows: mockWorkflowApi,
      alert: mockAlertApi,
      secrets: mockSecretsApi,
      datastore: {},
      agent: {},
      config: {},
    }),
    useAppConfig: () => ({}),
  };
});

vi.mock('react-json-view', () => ({
  default: () => <div data-testid="react-json-view" />,
  __esModule: true,
}));

const mockWorkflowApi = {
  integrations: {
    list: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    get: vi.fn().mockResolvedValue({
      id: 'int-1',
      name: 'Test Integration',
      slug: 'test',
      host: 'https://api.test.com',
      backendType: 'http',
      logoUrl: '',
      config: {},
    }),
    getLogoUrl: vi.fn().mockResolvedValue(''),
    listLogos: vi.fn().mockResolvedValue([]),
  },
  integrationSchemas: {
    listPathSuggestions: vi.fn().mockResolvedValue([]),
    listSchemas: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    getSchema: vi.fn().mockResolvedValue(undefined),
  },
} as unknown as DataSourceEditorContextValue['workflowApi'];

function makeContext(
  overrides?: Partial<DataSourceEditorContextValue>,
): DataSourceEditorContextValue {
  return {
    triggerType: null as unknown as DataSourceEditorContextValue['triggerType'],
    setTriggerType: vi.fn(),
    triggerConfig: {},
    setTriggerConfig: vi.fn(),
    sourceType: null as unknown as DataSourceEditorContextValue['sourceType'],
    setSourceType: vi.fn(),
    sourceConfig: {},
    setSourceConfig: vi.fn(),
    transforms: [],
    setTransforms: vi.fn(),
    sinks: [],
    setSinks: vi.fn(),
    selectedSteps: [],
    setSelectedSteps: vi.fn(),
    expandedStep: null,
    setExpandedStep: vi.fn(),
    nodeOutputs: {},
    setNodeOutputs: vi.fn(),
    nodeErrors: {},
    setNodeErrors: vi.fn(),
    runningNodes: new Set<string>(),
    setRunningNodes: vi.fn(),
    searchQuery: '',
    setSearchQuery: vi.fn(),
    isSourceConfigured: false,
    sourceOutput: undefined,
    finalOutput: undefined,
    previewLoading: false,
    previewError: null,
    isPreviewRun: false,
    confirmedSinkSchema: {},
    setConfirmedSinkSchema: vi.fn(),
    workflowApi: mockWorkflowApi,
    handleAddTrigger: vi.fn(),
    handleTriggerConfigChange: vi.fn(),
    markChanged: vi.fn(),
    handleSourceConfigChange: vi.fn(),
    handleAddTransform: vi.fn(),
    handleAddChainedSource: vi.fn(),
    handleUpdateTransform: vi.fn(),
    handleDeleteTransform: vi.fn(),
    handleUpdateSink: vi.fn(),
    handleDeleteSink: vi.fn(),
    handleRun: vi.fn(),
    sourceSchemaVersion: 0,
    bumpSourceSchemaVersion: vi.fn(),
    accumulatedSchema: null,
    setAccumulatedSchema: vi.fn(),
    workflowId: 'ds-1',
    isEnabled: false,
    secretRefreshNonce: 0,
    bumpSecretRefresh: vi.fn(),
    scheduleRefreshNonce: 0,
    allStepIds: ['source'],
    handleStepClick: vi.fn(),
    ...overrides,
    // Spreading a Partial relaxes required fields; the fixture only sets what
    // the step under test reads.
  } as DataSourceEditorContextValue;
}

function renderWithContext(overrides?: Partial<DataSourceEditorContextValue>) {
  return render(
    <TestQueryProvider>
      <MemoryRouter>
        <TooltipProvider>
          <DataSourceEditorContext.Provider value={makeContext(overrides)}>
            <SourceStep />
          </DataSourceEditorContext.Provider>
        </TooltipProvider>
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

describe('SourceStep', () => {
  it('offers "From another data source" in the source picker and switches to the datastore source (sc-33950)', async () => {
    const setSourceType = vi.fn();
    const setSourceConfig = vi.fn();
    renderWithContext({
      expandedStep: 'source',
      setSourceType,
      setSourceConfig,
    });

    const combobox = await screen.findByRole('combobox', {
      name: 'Integration',
    });
    fireEvent.focus(combobox);

    const listbox = await screen.findByRole('listbox');
    const option = within(listbox).getByText('From another data source');
    fireEvent.mouseDown(option);

    expect(setSourceType).toHaveBeenCalledWith('datastore');
    expect(setSourceConfig).toHaveBeenCalledWith({});
  });

  it('renders the data source picker when the datastore source is selected, excluding the current workflow', async () => {
    renderWithContext({
      sourceType: 'datastore',
      sourceConfig: {},
      expandedStep: 'source',
    });

    const picker = await screen.findByRole('combobox', {
      name: 'Data source',
    });
    fireEvent.focus(picker);

    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByText('GitHub Users')).toBeInTheDocument();
    // workflowId in the test context is 'ds-1' — the workflow's own datasource.
    expect(within(listbox).queryByText('Current Pipeline')).toBeNull();
  });

  it('shows the selected data source name as the step subtitle', () => {
    renderWithContext({
      sourceType: 'datastore',
      sourceConfig: {
        datasourceId: 'ds-users',
        datasourceName: 'GitHub Users',
      },
      isSourceConfigured: true,
    });

    expect(screen.getByText('GitHub Users')).toBeInTheDocument();
  });
});
