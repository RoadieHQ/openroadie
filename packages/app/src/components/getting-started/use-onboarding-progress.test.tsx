import { waitFor } from '@testing-library/react';
import { renderHookWithQuery } from '../../test-utils';
import { useOnboardingProgress } from './use-onboarding-progress';

const mockWorkflowApi = {
  integrations: { list: vi.fn() },
  workflows: { list: vi.fn() },
};
const mockDatastoreApi = {
  getObjectCountsByDatasource: vi.fn(),
  listRelationshipRules: vi.fn(),
  listContextGroupRules: vi.fn(),
};
const mockCapabilitiesApi = { list: vi.fn() };

let relationshipsFlag = true;
vi.mock('../../api', () => ({
  useWorkflows: () => mockWorkflowApi,
  useDatastore: () => mockDatastoreApi,
  useCapabilities: () => mockCapabilitiesApi,
  useFeatureFlag: () => ({ value: relationshipsFlag }),
}));

const mockSecretStatus = vi.fn();
vi.mock('../integrations/use-integration-secret-status', () => ({
  useIntegrationSecretStatus: () => mockSecretStatus(),
}));

const page = (count: number) => ({
  items: Array.from({ length: count }, (_, i) => ({ id: `id-${i}` })),
  total: count,
});

function setup(opts: {
  configured?: boolean;
  enabledWorkflow?: boolean;
  objectCount?: number;
  relationships?: number;
  contextGroups?: number;
  capabilities?: number;
}) {
  mockWorkflowApi.integrations.list.mockResolvedValue({
    data: [{ id: 'i1', slug: 'github-token' }],
    total: 1,
  });
  mockWorkflowApi.workflows.list.mockResolvedValue({
    data: opts.enabledWorkflow
      ? [{ id: 'w1', enabled: true }]
      : opts.objectCount != null
        ? [{ id: 'w1', enabled: false }]
        : [],
    total: opts.enabledWorkflow || opts.objectCount != null ? 1 : 0,
  });
  mockDatastoreApi.getObjectCountsByDatasource.mockResolvedValue(
    opts.objectCount != null
      ? [{ datasourceId: 'w1', count: opts.objectCount }]
      : [],
  );
  mockDatastoreApi.listRelationshipRules.mockResolvedValue({
    items: [],
    total: opts.relationships ?? 0,
  });
  // These two listings are fetched page-by-page, so their `total` reflects the
  // rows actually returned — the mock has to hand back real items, not a bare
  // count.
  mockDatastoreApi.listContextGroupRules.mockResolvedValue(
    page(opts.contextGroups ?? 0),
  );
  mockCapabilitiesApi.list.mockResolvedValue(page(opts.capabilities ?? 0));
  mockSecretStatus.mockReturnValue({
    summariesByIntegrationId: new Map([
      ['i1', { configured: opts.configured ?? false }],
    ]),
    loading: false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  relationshipsFlag = true;
});

describe('useOnboardingProgress', () => {
  it('reports every step undone for an empty workspace', async () => {
    setup({});
    const { result } = renderHookWithQuery(() => useOnboardingProgress());

    await waitFor(() => expect(result.current.loading).toBe(false));

    // relationships flag on → 6 steps incl. relationships + context groups.
    expect(result.current.totalCount).toBe(6);
    expect(result.current.completedCount).toBe(0);
    expect(result.current.complete).toBe(false);
    expect(result.current.steps.every(s => !s.done)).toBe(true);
  });

  it('marks each step done from live data', async () => {
    setup({
      configured: true,
      enabledWorkflow: true,
      objectCount: 5,
      relationships: 3,
      contextGroups: 2,
      capabilities: 1,
    });
    const { result } = renderHookWithQuery(() => useOnboardingProgress());

    await waitFor(() => expect(result.current.complete).toBe(true));

    expect(result.current.completedCount).toBe(6);
    const byId = Object.fromEntries(
      result.current.steps.map(s => [s.id, s.done]),
    );
    expect(byId).toEqual({
      integration: true,
      dataSource: true,
      ingest: true,
      relationship: true,
      contextGroup: true,
      capability: true,
    });
  });

  it('drops the relationships-gated steps when relationships are disabled', async () => {
    relationshipsFlag = false;
    setup({});
    const { result } = renderHookWithQuery(() => useOnboardingProgress());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const ids = result.current.steps.map(s => s.id);
    expect(ids).not.toContain('contextGroup');
    expect(ids).not.toContain('relationship');
    expect(result.current.totalCount).toBe(4);
  });
});
