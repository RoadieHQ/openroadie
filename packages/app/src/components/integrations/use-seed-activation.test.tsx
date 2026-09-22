import type { ReactNode } from 'react';
import {
  act,
  renderHook as rtlRenderHook,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ActivateDataSourceSeedsResult } from '../../api/workflow/workflow-client';
import {
  useHasMatchingDataSourceSeeds,
  useSeedActivation,
} from './use-seed-activation';

let queryClient: QueryClient;
const renderHook: typeof rtlRenderHook = (cb, options) =>
  rtlRenderHook(cb, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
    ...options,
  });

const mockAlertApi = { post: vi.fn() };
const mockWorkflowApi = {
  workflows: {
    listDataSourceSeeds: vi.fn(),
    activateDataSourceSeedsForIntegration: vi.fn(),
  },
};

vi.mock('../../api', () => ({
  useWorkflows: () => mockWorkflowApi,
  useAlert: () => mockAlertApi,
}));

function makeResult(
  overrides: Partial<ActivateDataSourceSeedsResult> = {},
): ActivateDataSourceSeedsResult {
  return {
    inserted: 0,
    enabled: 0,
    skipped: [],
    failed: [],
    relationships: { created: 0, skipped: 0 },
    notReady: false,
    ...overrides,
  };
}

describe('useHasMatchingDataSourceSeeds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    mockWorkflowApi.workflows.listDataSourceSeeds.mockResolvedValue({
      data: [
        {
          name: 'PagerDuty incidents',
          description: '',
          integrationSlug: 'pagerduty',
          integrationConfigured: true,
          created: false,
        },
      ],
    });
  });

  it('returns false without querying when no slug is given', () => {
    const { result } = renderHook(() =>
      useHasMatchingDataSourceSeeds(undefined),
    );
    expect(result.current).toEqual({
      hasMatchingSeeds: false,
      matchingSeedNames: [],
      loading: false,
    });
    expect(
      mockWorkflowApi.workflows.listDataSourceSeeds,
    ).not.toHaveBeenCalled();
  });

  it('reports a match once seeds referencing the slug load', async () => {
    const { result } = renderHook(() =>
      useHasMatchingDataSourceSeeds('pagerduty'),
    );

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasMatchingSeeds).toBe(true);
    expect(result.current.matchingSeedNames).toEqual(['PagerDuty incidents']);
  });

  it('reports no match for a slug with no seed templates', async () => {
    const { result } = renderHook(() =>
      useHasMatchingDataSourceSeeds('some-other-integration'),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasMatchingSeeds).toBe(false);
    expect(result.current.matchingSeedNames).toEqual([]);
  });
});

describe('useSeedActivation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
  });

  it('posts a success alert summarizing inserted and enabled seeds', async () => {
    mockWorkflowApi.workflows.activateDataSourceSeedsForIntegration.mockResolvedValue(
      { data: makeResult({ inserted: 2, enabled: 1 }) },
    );

    const { result } = renderHook(() => useSeedActivation());
    const data = await act(() => result.current.activate('int-1'));

    expect(
      mockWorkflowApi.workflows.activateDataSourceSeedsForIntegration,
    ).toHaveBeenCalledWith('int-1');
    expect(data?.inserted).toBe(2);
    expect(mockAlertApi.post).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'success', display: 'transient' }),
    );
  });

  it('posts an info alert and does not throw when the integration is not ready', async () => {
    mockWorkflowApi.workflows.activateDataSourceSeedsForIntegration.mockResolvedValue(
      { data: makeResult({ notReady: true }) },
    );

    const { result } = renderHook(() => useSeedActivation());
    await act(() => result.current.activate('int-1'));

    expect(mockAlertApi.post).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'info' }),
    );
  });

  it('surfaces failed seeds in the summary message', async () => {
    mockWorkflowApi.workflows.activateDataSourceSeedsForIntegration.mockResolvedValue(
      {
        data: makeResult({
          enabled: 1,
          failed: [{ name: 'Broken seed', reason: 'dry-run failed' }],
        }),
      },
    );

    const { result } = renderHook(() => useSeedActivation());
    await act(() => result.current.activate('int-1'));

    expect(mockAlertApi.post).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Enabled 1 data source. 1 data source failed its dry-run and was left disabled: Broken seed',
      }),
    );
  });

  it('posts an error alert and returns undefined when the request fails', async () => {
    mockWorkflowApi.workflows.activateDataSourceSeedsForIntegration.mockRejectedValue(
      new Error('boom'),
    );

    const { result } = renderHook(() => useSeedActivation());
    const data = await act(() => result.current.activate('int-1'));

    expect(data).toBeUndefined();
    expect(mockAlertApi.post).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('boom'),
      }),
    );
  });

  it('tracks in-flight activation via isActivating', async () => {
    let resolveActivation!: (value: {
      data: ActivateDataSourceSeedsResult;
    }) => void;
    mockWorkflowApi.workflows.activateDataSourceSeedsForIntegration.mockReturnValue(
      new Promise(resolve => {
        resolveActivation = resolve;
      }),
    );

    const { result } = renderHook(() => useSeedActivation());
    expect(result.current.isActivating('int-1')).toBe(false);

    let pending!: Promise<ActivateDataSourceSeedsResult | undefined>;
    act(() => {
      pending = result.current.activate('int-1');
    });
    await waitFor(() =>
      expect(result.current.isActivating('int-1')).toBe(true),
    );

    await act(async () => {
      resolveActivation({ data: makeResult() });
      await pending;
    });

    await waitFor(() =>
      expect(result.current.isActivating('int-1')).toBe(false),
    );
  });
});
