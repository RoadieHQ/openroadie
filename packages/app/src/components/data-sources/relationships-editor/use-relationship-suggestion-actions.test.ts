import { act, renderHook } from '@testing-library/react';
import { TestQueryProvider } from '../../../test-utils';
import type { FieldMatchSuggestion } from '../../../api/datastore/datastore-client';
import { useRelationshipSuggestionActions } from './use-relationship-suggestion-actions';

const mockDatastore = {
  suggestRelationshipsBatch: vi.fn(),
};
const mockAgent = { call: vi.fn() };
const mockAlert = { post: vi.fn() };
let mockAppConfig: { relationships?: { suggestionProducer?: 'ai' | 'api' } } =
  {};

vi.mock('../../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../api')>();
  return {
    ...actual,
    useDatastore: () => mockDatastore,
    useAgent: () => mockAgent,
    useAlert: () => mockAlert,
    useAppConfig: () => mockAppConfig,
  };
});

function makeSuppressed(
  overrides: Partial<FieldMatchSuggestion>,
): FieldMatchSuggestion {
  return {
    sourceField: '$.handle',
    targetDatasourceId: 'ds-b',
    targetField: '$.login',
    matchCount: 0,
    sampleValues: [],
    suggestionKind: 'identity',
    score: 0,
    confidenceBand: 'low',
    evidenceSummary: {
      valueTypes: [],
      distinctMatchedValueCount: 0,
      sourceFieldStats: {
        distinctCount: 0,
        rowCoverage: 0,
        cardinalityRatio: 0,
        looksEnumLike: false,
        isIdentifierLike: false,
      },
      targetFieldStats: {
        distinctCount: 0,
        rowCoverage: 0,
        cardinalityRatio: 0,
        looksEnumLike: false,
        isIdentifierLike: false,
      },
      commonValuePenalty: 0,
      topMatchedValues: [],
      explanation: '',
    },
    suppressionReason: 'trivial-domain',
    ...overrides,
  };
}

const renderActions = () =>
  renderHook(() => useRelationshipSuggestionActions(), {
    wrapper: TestQueryProvider,
  });

describe('useRelationshipSuggestionActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppConfig = {};
  });

  it('starts with an empty suppressed list', () => {
    const { result } = renderActions();
    expect(result.current.lastRunSuppressed).toEqual([]);
  });

  it('exposes the flattened suppressed suggestions after a successful backend run', async () => {
    const suppressedA = makeSuppressed({ sourceField: '$.a' });
    const suppressedB = makeSuppressed({
      sourceField: '$.b',
      suppressionReason: 'score-below-threshold',
    });
    mockDatastore.suggestRelationshipsBatch.mockResolvedValue({
      createdRules: [],
      results: [
        {
          datasourceId: 'ds-1',
          total: 1,
          suggestions: [],
          suppressedSuggestions: [suppressedA],
        },
        {
          datasourceId: 'ds-2',
          total: 1,
          suggestions: [],
          suppressedSuggestions: [suppressedB],
        },
      ],
    });
    const { result } = renderActions();

    await act(async () => {
      await result.current.suggestForAllDatasourceIds(['ds-1', 'ds-2']);
    });

    // Flattened in response order across datasources.
    expect(result.current.lastRunSuppressed).toEqual([
      suppressedA,
      suppressedB,
    ]);
  });

  it('treats a missing suppressedSuggestions field as none for that datasource', async () => {
    mockDatastore.suggestRelationshipsBatch.mockResolvedValue({
      createdRules: [],
      results: [{ datasourceId: 'ds-1', total: 0, suggestions: [] }],
    });
    const { result } = renderActions();

    await act(async () => {
      await result.current.suggestForAllDatasourceIds(['ds-1']);
    });

    expect(result.current.lastRunSuppressed).toEqual([]);
  });

  it('leaves the suppressed list empty for the AI producer path', async () => {
    mockAppConfig = { relationships: { suggestionProducer: 'ai' } };
    mockAgent.call.mockResolvedValue({ success: true });
    const { result } = renderActions();

    await act(async () => {
      await result.current.suggestForAllDatasourceIds(['ds-1']);
    });

    expect(mockDatastore.suggestRelationshipsBatch).not.toHaveBeenCalled();
    expect(result.current.lastRunSuppressed).toEqual([]);
  });

  it("clears a prior backend run's suppressed list on a successful AI-producer run", async () => {
    // Not reachable mid-session today (the producer is boot-time config), but
    // the "AI leaves it empty" guarantee should hold by construction rather
    // than by the AI branch merely never writing to the state.
    mockDatastore.suggestRelationshipsBatch.mockResolvedValue({
      createdRules: [],
      results: [
        {
          datasourceId: 'ds-1',
          total: 1,
          suggestions: [],
          suppressedSuggestions: [makeSuppressed({})],
        },
      ],
    });
    const { result, rerender } = renderActions();

    await act(async () => {
      await result.current.suggestForAllDatasourceIds(['ds-1']);
    });
    expect(result.current.lastRunSuppressed).toHaveLength(1);

    mockAppConfig = { relationships: { suggestionProducer: 'ai' } };
    mockAgent.call.mockResolvedValue({ success: true });
    rerender();

    await act(async () => {
      await result.current.suggestForAllDatasourceIds(['ds-1']);
    });

    expect(result.current.lastRunSuppressed).toEqual([]);
  });

  it("clears a prior backend run's suppressed list when the next backend run fails", async () => {
    mockDatastore.suggestRelationshipsBatch.mockResolvedValueOnce({
      createdRules: [],
      results: [
        {
          datasourceId: 'ds-1',
          total: 1,
          suggestions: [],
          suppressedSuggestions: [makeSuppressed({})],
        },
      ],
    });
    const { result } = renderActions();

    await act(async () => {
      await result.current.suggestForAllDatasourceIds(['ds-1']);
    });
    expect(result.current.lastRunSuppressed).toHaveLength(1);

    mockDatastore.suggestRelationshipsBatch.mockRejectedValueOnce(
      new Error('boom'),
    );

    await act(async () => {
      await result.current.suggestForAllDatasourceIds(['ds-1']);
    });

    // A failed run must not leave the previous run's suppressed section
    // showing under this run's error state.
    expect(result.current.lastRunSuppressed).toEqual([]);
    expect(mockAlert.post).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error' }),
    );
  });

  it('clearLastRunSuppressed resets the list', async () => {
    mockDatastore.suggestRelationshipsBatch.mockResolvedValue({
      createdRules: [],
      results: [
        {
          datasourceId: 'ds-1',
          total: 1,
          suggestions: [],
          suppressedSuggestions: [makeSuppressed({})],
        },
      ],
    });
    const { result } = renderActions();

    await act(async () => {
      await result.current.suggestForAllDatasourceIds(['ds-1']);
    });
    expect(result.current.lastRunSuppressed).toHaveLength(1);

    act(() => {
      result.current.clearLastRunSuppressed();
    });
    expect(result.current.lastRunSuppressed).toEqual([]);
  });
});
