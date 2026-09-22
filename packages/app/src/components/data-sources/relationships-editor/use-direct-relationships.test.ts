import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Relationship } from '../../../api/datastore/datastore-client';
import { queryKeys } from '../../../api/queries';
import { useDirectRelationships } from './use-direct-relationships';

const mockApi = {
  queryRelationships: vi.fn(),
  createRelationship: vi.fn(),
  deleteRelationship: vi.fn(),
  materializeContextGroupsForDatasource: vi.fn(),
};
const mockAlert = { post: vi.fn() };

vi.mock('../../../api', () => ({
  useDatastore: () => mockApi,
  useAlert: () => mockAlert,
}));

function makeEdge(overrides: Partial<Relationship> = {}): Relationship {
  return {
    id: 'edge-1',
    sourceDatasourceId: 'ds-1',
    sourceObjectId: 'src-1',
    destinationDatasourceId: 'ds-2',
    destinationObjectId: 'tgt-1',
    relationshipType: 'memberOf',
    updatedBy: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    origin: 'manual',
    ...overrides,
  };
}

let queryClient: QueryClient;
let invalidateSpy: ReturnType<typeof vi.spyOn>;
let wrapper: (props: { children: ReactNode }) => ReactNode;

const defaultOptions = {
  sourceDatasourceId: 'ds-1',
  targetDatasourceId: 'ds-2',
  relationshipType: 'memberOf',
  reciprocalRelationshipType: 'hasMember',
  resetKey: 'rule-1',
};

function setup(options = defaultOptions) {
  return renderHook(props => useDirectRelationships(props), {
    wrapper,
    initialProps: options,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  wrapper = ({ children }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  mockApi.queryRelationships.mockResolvedValue({ items: [], total: 0 });
  mockApi.materializeContextGroupsForDatasource.mockResolvedValue(undefined);
});

describe('useDirectRelationships — fetching', () => {
  it('keys pair-scoped persisted edges by source as drafts', async () => {
    mockApi.queryRelationships.mockResolvedValue({
      items: [
        makeEdge(),
        // Different pair — filtered out.
        makeEdge({ id: 'edge-3', sourceDatasourceId: 'ds-other' }),
        makeEdge({ id: 'edge-4', destinationDatasourceId: 'ds-other' }),
      ],
      total: 3,
    });

    const { result } = setup();

    await waitFor(() =>
      expect(result.current.directBySourceObjectId.size).toBe(1),
    );
    expect(mockApi.queryRelationships).toHaveBeenCalledWith({
      relationshipType: 'memberOf',
      direct: true,
      limit: 500,
    });
    expect(result.current.directBySourceObjectId.get('src-1')).toEqual([
      { key: 'edge-1', targetObjectId: 'tgt-1', status: 'persisted' },
    ]);
  });

  it('does not fetch until a relationship type is set', () => {
    setup({ ...defaultOptions, relationshipType: '' });
    expect(mockApi.queryRelationships).not.toHaveBeenCalled();
  });
});

describe('useDirectRelationships — relationship type change', () => {
  it('keeps persisted edges visible and buffers intact when the editor type changes', async () => {
    mockApi.queryRelationships.mockResolvedValue({
      items: [makeEdge()],
      total: 1,
    });
    const { result, rerender } = renderHook(
      props => useDirectRelationships(props),
      {
        wrapper,
        initialProps: {
          ...defaultOptions,
          persistedRelationshipType: 'memberOf',
        },
      },
    );
    await waitFor(() =>
      expect(result.current.directBySourceObjectId.size).toBe(1),
    );
    act(() => result.current.addDirect('src-2', 'tgt-2'));
    expect(result.current.hasPendingChanges).toBe(true);

    rerender({
      ...defaultOptions,
      relationshipType: 'sameIdentityAs',
      persistedRelationshipType: 'memberOf',
    });

    // Persisted edges (fetched under the saved rule's type) stay listed and
    // the staged addition survives — only the flush applies the new type.
    await waitFor(() =>
      expect(result.current.directBySourceObjectId.get('src-1')).toEqual([
        { key: 'edge-1', targetObjectId: 'tgt-1', status: 'persisted' },
      ]),
    );
    expect(result.current.hasPendingChanges).toBe(true);
    expect(result.current.directBySourceObjectId.get('src-2')).toEqual([
      { key: 'add|src-2|tgt-2', targetObjectId: 'tgt-2', status: 'added' },
    ]);
  });

  it('re-types persisted edges on flush when the type changed', async () => {
    mockApi.queryRelationships.mockResolvedValue({
      items: [makeEdge({ metadata: { createdFromRuleId: 'rule-1' } })],
      total: 1,
    });
    mockApi.createRelationship.mockResolvedValue({ id: 'edge-new' });
    mockApi.deleteRelationship.mockResolvedValue(undefined);
    const { result } = renderHook(props => useDirectRelationships(props), {
      wrapper,
      initialProps: {
        ...defaultOptions,
        relationshipType: 'sameIdentityAs',
        reciprocalRelationshipType: 'sameIdentityAs',
        persistedRelationshipType: 'memberOf',
      },
    });
    await waitFor(() =>
      expect(result.current.directBySourceObjectId.size).toBe(1),
    );

    await act(async () => {
      const { failed } = await result.current.flush('rule-1');
      expect(failed).toBe(0);
    });

    // Old-type edge recreated under the new type (metadata preserved), then
    // the old row deleted.
    expect(mockApi.createRelationship).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceDatasourceId: 'ds-1',
        sourceObjectId: 'src-1',
        destinationDatasourceId: 'ds-2',
        destinationObjectId: 'tgt-1',
        relationshipType: 'sameIdentityAs',
        reciprocalRelationshipType: 'sameIdentityAs',
        origin: 'manual',
        metadata: { createdFromRuleId: 'rule-1' },
      }),
    );
    expect(mockApi.deleteRelationship).toHaveBeenCalledWith('edge-1');
  });

  it('does not re-type edges buffered for removal', async () => {
    mockApi.queryRelationships.mockResolvedValue({
      items: [makeEdge()],
      total: 1,
    });
    mockApi.deleteRelationship.mockResolvedValue(undefined);
    const { result } = renderHook(props => useDirectRelationships(props), {
      wrapper,
      initialProps: {
        ...defaultOptions,
        relationshipType: 'sameIdentityAs',
        persistedRelationshipType: 'memberOf',
      },
    });
    await waitFor(() =>
      expect(result.current.directBySourceObjectId.size).toBe(1),
    );
    act(() => result.current.markRemoval('edge-1'));

    await act(async () => {
      await result.current.flush('rule-1');
    });

    expect(mockApi.createRelationship).not.toHaveBeenCalled();
    expect(mockApi.deleteRelationship).toHaveBeenCalledWith('edge-1');
    expect(mockApi.deleteRelationship).toHaveBeenCalledTimes(1);
  });

  it('keeps re-typed edges visible when a later flush op fails', async () => {
    // Rule type changed and flush retypes succeed, but a buffered addition
    // fails — the editor stays open for retry. The fetch anchor must advance
    // so successfully moved edges do not vanish under the old-type query.
    const oldEdge = makeEdge();
    const movedEdge = makeEdge({
      id: 'edge-moved',
      relationshipType: 'sameIdentityAs',
    });
    mockApi.queryRelationships.mockImplementation(
      async (opts: { relationshipType?: string }) => {
        if (opts.relationshipType === 'memberOf') {
          return { items: [oldEdge], total: 1 };
        }
        if (opts.relationshipType === 'sameIdentityAs') {
          return { items: [movedEdge], total: 1 };
        }
        return { items: [], total: 0 };
      },
    );
    mockApi.createRelationship
      .mockRejectedValueOnce(new Error('add failed')) // additions flush first
      .mockResolvedValueOnce(movedEdge); // then retype create
    mockApi.deleteRelationship.mockResolvedValue(undefined);

    const { result } = renderHook(props => useDirectRelationships(props), {
      wrapper,
      initialProps: {
        ...defaultOptions,
        relationshipType: 'sameIdentityAs',
        reciprocalRelationshipType: 'sameIdentityAs',
        persistedRelationshipType: 'memberOf',
      },
    });
    await waitFor(() =>
      expect(result.current.directBySourceObjectId.size).toBe(1),
    );
    act(() => result.current.addDirect('src-2', 'tgt-2'));

    let flushResult: { failed: number } | undefined;
    await act(async () => {
      flushResult = await result.current.flush('rule-1');
    });

    expect(flushResult).toEqual({ failed: 1 });
    // Moved edge stays listed (now fetched under the new type); failed add
    // remains buffered for retry.
    await waitFor(() =>
      expect(result.current.directBySourceObjectId.get('src-1')).toEqual([
        {
          key: 'edge-moved',
          targetObjectId: 'tgt-1',
          status: 'persisted',
        },
      ]),
    );
    expect(result.current.directBySourceObjectId.get('src-2')).toEqual([
      { key: 'add|src-2|tgt-2', targetObjectId: 'tgt-2', status: 'added' },
    ]);
    expect(mockApi.queryRelationships).toHaveBeenCalledWith(
      expect.objectContaining({ relationshipType: 'sameIdentityAs' }),
    );
  });

  it('keeps failed retypes listed and retries them on the next flush', async () => {
    const oldEdge = makeEdge();
    mockApi.queryRelationships.mockImplementation(
      async (opts: { relationshipType?: string }) => {
        if (opts.relationshipType === 'memberOf') {
          return { items: [oldEdge], total: 1 };
        }
        return { items: [], total: 0 };
      },
    );
    mockApi.createRelationship.mockRejectedValueOnce(
      new Error('retype failed'),
    );

    const { result } = renderHook(props => useDirectRelationships(props), {
      wrapper,
      initialProps: {
        ...defaultOptions,
        relationshipType: 'sameIdentityAs',
        persistedRelationshipType: 'memberOf',
      },
    });
    await waitFor(() =>
      expect(result.current.directBySourceObjectId.size).toBe(1),
    );

    await act(async () => {
      const { failed } = await result.current.flush('rule-1');
      expect(failed).toBe(1);
    });

    // Anchor advanced; edge kept via the pending-retype buffer.
    expect(result.current.directBySourceObjectId.get('src-1')).toEqual([
      { key: 'edge-1', targetObjectId: 'tgt-1', status: 'persisted' },
    ]);
    expect(result.current.hasPendingChanges).toBe(true);

    mockApi.createRelationship.mockResolvedValueOnce(
      makeEdge({ id: 'edge-moved', relationshipType: 'sameIdentityAs' }),
    );
    mockApi.deleteRelationship.mockResolvedValue(undefined);

    await act(async () => {
      const { failed } = await result.current.flush('rule-1');
      expect(failed).toBe(0);
    });

    expect(mockApi.createRelationship).toHaveBeenLastCalledWith(
      expect.objectContaining({
        relationshipType: 'sameIdentityAs',
        sourceObjectId: 'src-1',
        destinationObjectId: 'tgt-1',
      }),
    );
    expect(mockApi.deleteRelationship).toHaveBeenCalledWith('edge-1');
    expect(result.current.hasPendingChanges).toBe(false);
  });

  it('reports an add that merged into a rule-materialized edge instead of claiming success', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));

    // The upsert collides with a rule edge for the same tuple: the returned
    // row keeps its ruleId, so no DIRECT edge exists after the flush.
    mockApi.createRelationship.mockResolvedValueOnce(
      makeEdge({ id: 'rule-edge', ruleId: 'rule-9' }),
    );
    act(() => result.current.addDirect('src-1', 'tgt-1'));

    await act(async () => {
      const { failed } = await result.current.flush('rule-1');
      expect(failed).toBe(0);
    });

    // Not a success toast — a warning naming the conflict.
    expect(mockAlert.post).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'warning' }),
    );
    expect(mockAlert.post).not.toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'success' }),
    );
    // The add leaves the buffer (retrying would collide again).
    expect(result.current.hasPendingChanges).toBe(false);
  });

  it('does not delete an edge when retrying with the type set back to its own', async () => {
    const oldEdge = makeEdge();
    mockApi.queryRelationships.mockImplementation(
      async (opts: { relationshipType?: string }) =>
        opts.relationshipType === 'memberOf'
          ? { items: [oldEdge], total: 1 }
          : { items: [], total: 0 },
    );
    // First flush: the retype to the new verb fails outright, so the edge
    // stays under its old type while the fetch anchor advances.
    mockApi.createRelationship.mockRejectedValueOnce(
      new Error('retype failed'),
    );

    const { result, rerender } = renderHook(
      props => useDirectRelationships(props),
      {
        wrapper,
        initialProps: {
          ...defaultOptions,
          relationshipType: 'sameIdentityAs',
          persistedRelationshipType: 'memberOf',
        },
      },
    );
    await waitFor(() =>
      expect(result.current.directBySourceObjectId.size).toBe(1),
    );
    await act(async () => {
      const { failed } = await result.current.flush('rule-1');
      expect(failed).toBe(1);
    });

    // The user undoes the type edit and saves again. The edge already carries
    // the right type — an upsert-then-delete "retype" would upsert onto the
    // SAME row and then delete it, permanently losing the edge.
    rerender({
      ...defaultOptions,
      relationshipType: 'memberOf',
      persistedRelationshipType: 'memberOf',
    });
    mockApi.createRelationship.mockClear();
    mockApi.deleteRelationship.mockClear();
    await act(async () => {
      const { failed } = await result.current.flush('rule-1');
      expect(failed).toBe(0);
    });

    expect(mockApi.createRelationship).not.toHaveBeenCalled();
    expect(mockApi.deleteRelationship).not.toHaveBeenCalled();
    expect(result.current.hasPendingChanges).toBe(false);
    await waitFor(() =>
      expect(result.current.directBySourceObjectId.get('src-1')).toEqual([
        { key: 'edge-1', targetObjectId: 'tgt-1', status: 'persisted' },
      ]),
    );
  });

  it('refreshes caches when a retype lands its create but fails the delete', async () => {
    const oldEdge = makeEdge();
    mockApi.queryRelationships.mockImplementation(
      async (opts: { relationshipType?: string }) =>
        opts.relationshipType === 'memberOf'
          ? { items: [oldEdge], total: 1 }
          : { items: [], total: 0 },
    );
    mockApi.createRelationship.mockResolvedValue(undefined);
    mockApi.deleteRelationship.mockRejectedValueOnce(
      new Error('delete failed'),
    );

    const { result } = renderHook(props => useDirectRelationships(props), {
      wrapper,
      initialProps: {
        ...defaultOptions,
        relationshipType: 'sameIdentityAs',
        persistedRelationshipType: 'memberOf',
      },
    });
    await waitFor(() =>
      expect(result.current.directBySourceObjectId.size).toBe(1),
    );

    invalidateSpy.mockClear();
    await act(async () => {
      const { failed } = await result.current.flush('rule-1');
      expect(failed).toBe(1);
    });

    // The new-type row exists server-side even though the op failed, so the
    // caches must refresh; the edge itself stays pending for retry.
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.directRelationshipsPrefix,
    });
    expect(result.current.hasPendingChanges).toBe(true);
  });

  it('re-types anchor edges AND failed retries together when the type changes again', async () => {
    // First flush moves edge-2 to the intermediate type but edge-1's retype
    // fails; the user then edits the type once more before retrying. The
    // retry must move BOTH the edge under the advanced anchor and the failed
    // retry — either alone would orphan the other under a superseded type.
    const edgeA = makeEdge();
    const edgeB = makeEdge({
      id: 'edge-2',
      sourceObjectId: 'src-2',
      destinationObjectId: 'tgt-2',
    });
    const movedB = makeEdge({
      id: 'edge-moved',
      sourceObjectId: 'src-2',
      destinationObjectId: 'tgt-2',
      relationshipType: 'sameIdentityAs',
    });
    mockApi.queryRelationships.mockImplementation(
      async (opts: { relationshipType?: string }) => {
        if (opts.relationshipType === 'memberOf') {
          return { items: [edgeA, edgeB], total: 2 };
        }
        if (opts.relationshipType === 'sameIdentityAs') {
          return { items: [movedB], total: 1 };
        }
        return { items: [], total: 0 };
      },
    );
    mockApi.createRelationship
      .mockRejectedValueOnce(new Error('retype failed')) // edge-1
      .mockResolvedValue(undefined);
    mockApi.deleteRelationship.mockResolvedValue(undefined);

    const { result, rerender } = renderHook(
      props => useDirectRelationships(props),
      {
        wrapper,
        initialProps: {
          ...defaultOptions,
          relationshipType: 'sameIdentityAs',
          persistedRelationshipType: 'memberOf',
        },
      },
    );
    await waitFor(() =>
      expect(result.current.directBySourceObjectId.size).toBe(2),
    );

    await act(async () => {
      const { failed } = await result.current.flush('rule-1');
      expect(failed).toBe(1);
    });

    rerender({
      ...defaultOptions,
      relationshipType: 'ownedBy',
      persistedRelationshipType: 'memberOf',
    });
    // Anchor advanced to the intermediate type: the moved edge is fetched
    // there, the failed retry overlays from the pending-retype buffer.
    await waitFor(() =>
      expect(result.current.directBySourceObjectId.size).toBe(2),
    );

    mockApi.createRelationship.mockClear();
    mockApi.deleteRelationship.mockClear();
    await act(async () => {
      const { failed } = await result.current.flush('rule-1');
      expect(failed).toBe(0);
    });

    expect(mockApi.createRelationship).toHaveBeenCalledTimes(2);
    expect(mockApi.createRelationship).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceObjectId: 'src-1',
        relationshipType: 'ownedBy',
      }),
    );
    expect(mockApi.createRelationship).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceObjectId: 'src-2',
        relationshipType: 'ownedBy',
      }),
    );
    expect(mockApi.deleteRelationship).toHaveBeenCalledWith('edge-1');
    expect(mockApi.deleteRelationship).toHaveBeenCalledWith('edge-moved');
    expect(result.current.hasPendingChanges).toBe(false);
  });
});

describe('useDirectRelationships — buffering', () => {
  it('buffers an addition without writing until flush', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.addDirect('src-1', 'tgt-1'));

    expect(mockApi.createRelationship).not.toHaveBeenCalled();
    expect(result.current.hasPendingChanges).toBe(true);
    expect(result.current.directBySourceObjectId.get('src-1')).toEqual([
      { key: 'add|src-1|tgt-1', targetObjectId: 'tgt-1', status: 'added' },
    ]);
  });

  it('undoes a buffered addition', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.addDirect('src-1', 'tgt-1'));
    act(() => result.current.undoDirect('add|src-1|tgt-1'));

    expect(result.current.hasPendingChanges).toBe(false);
    expect(result.current.directBySourceObjectId.size).toBe(0);
  });

  it('marks a persisted edge for removal, then can restore it', async () => {
    mockApi.queryRelationships.mockResolvedValue({
      items: [makeEdge()],
      total: 1,
    });
    const { result } = setup();
    await waitFor(() =>
      expect(result.current.directBySourceObjectId.size).toBe(1),
    );

    act(() => result.current.markRemoval('edge-1'));
    expect(result.current.directBySourceObjectId.get('src-1')).toEqual([
      { key: 'edge-1', targetObjectId: 'tgt-1', status: 'removed' },
    ]);
    expect(result.current.hasPendingChanges).toBe(true);

    act(() => result.current.undoDirect('edge-1'));
    expect(result.current.directBySourceObjectId.get('src-1')).toEqual([
      { key: 'edge-1', targetObjectId: 'tgt-1', status: 'persisted' },
    ]);
    expect(result.current.hasPendingChanges).toBe(false);
  });

  it('does not duplicate an already-persisted pair', async () => {
    mockApi.queryRelationships.mockResolvedValue({
      items: [makeEdge()],
      total: 1,
    });
    const { result } = setup();
    await waitFor(() =>
      expect(result.current.directBySourceObjectId.size).toBe(1),
    );

    act(() => result.current.addDirect('src-1', 'tgt-1'));
    expect(result.current.hasPendingChanges).toBe(false);
    expect(result.current.directBySourceObjectId.get('src-1')).toHaveLength(1);
  });

  it('clears the buffer when the editing session (resetKey) changes', async () => {
    const { result, rerender } = renderHook(
      props => useDirectRelationships(props),
      { wrapper, initialProps: { ...defaultOptions, resetKey: 'rule-a' } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.addDirect('src-1', 'tgt-1'));
    expect(result.current.hasPendingChanges).toBe(true);

    // Switching to another rule/pair (or closing) must not carry the buffer.
    rerender({ ...defaultOptions, resetKey: 'rule-b' });
    expect(result.current.hasPendingChanges).toBe(false);
    expect(result.current.directBySourceObjectId.size).toBe(0);
  });

  it('clears the buffer when the editing session (resetKey) changes', async () => {
    mockApi.queryRelationships.mockResolvedValue({
      items: [makeEdge()],
      total: 1,
    });
    const { result, rerender } = renderHook(
      props => useDirectRelationships(props),
      { wrapper, initialProps: defaultOptions },
    );
    await waitFor(() =>
      expect(result.current.directBySourceObjectId.size).toBe(1),
    );

    act(() => result.current.markRemoval('edge-1'));
    act(() => result.current.addDirect('src-2', 'tgt-2'));
    expect(result.current.hasPendingChanges).toBe(true);

    // A different rule's session must not inherit staged ops.
    rerender({ ...defaultOptions, resetKey: 'rule-2' });
    expect(result.current.hasPendingChanges).toBe(false);
  });

  it('re-linking a removed pair cancels the removal', async () => {
    mockApi.queryRelationships.mockResolvedValue({
      items: [makeEdge()],
      total: 1,
    });
    const { result } = setup();
    await waitFor(() =>
      expect(result.current.directBySourceObjectId.size).toBe(1),
    );

    act(() => result.current.markRemoval('edge-1'));
    act(() => result.current.addDirect('src-1', 'tgt-1'));

    expect(result.current.hasPendingChanges).toBe(false);
    expect(result.current.directBySourceObjectId.get('src-1')?.[0].status).toBe(
      'persisted',
    );
  });
});

describe('useDirectRelationships — flush', () => {
  it('is a no-op with an empty buffer', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.flush('rule-1');
    });

    expect(mockApi.createRelationship).not.toHaveBeenCalled();
    expect(mockApi.deleteRelationship).not.toHaveBeenCalled();
    expect(mockAlert.post).not.toHaveBeenCalled();
  });

  it('never flips the flushing flag for a no-op flush', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));

    const seen: boolean[] = [];
    await act(async () => {
      const done = result.current.flush('rule-1');
      seen.push(result.current.flushing);
      await done;
    });

    expect(seen).toEqual([false]);
    expect(result.current.flushing).toBe(false);
  });

  it('writes additions with reciprocal + provenance and invalidates', async () => {
    mockApi.createRelationship.mockResolvedValue(makeEdge());
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.addDirect('src-1', 'tgt-1'));
    await act(async () => {
      await result.current.flush('rule-1');
    });

    expect(mockApi.createRelationship).toHaveBeenCalledWith({
      sourceDatasourceId: 'ds-1',
      sourceObjectId: 'src-1',
      destinationDatasourceId: 'ds-2',
      destinationObjectId: 'tgt-1',
      relationshipType: 'memberOf',
      origin: 'manual',
      reciprocalRelationshipType: 'hasMember',
      metadata: { createdFromRuleId: 'rule-1' },
    });
    expect(result.current.hasPendingChanges).toBe(false);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.directRelationshipsPrefix,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.objectDetail('ds-1', 'src-1'),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.objectDetail('ds-2', 'tgt-1'),
    });
    // Context groups merge across direct edges: the flush asks the backend to
    // rebuild them (source datasource only — a merging rule contains both
    // endpoints) and refetches the group surfaces.
    expect(mockApi.materializeContextGroupsForDatasource).toHaveBeenCalledWith(
      'ds-1',
    );
    expect(mockApi.materializeContextGroupsForDatasource).toHaveBeenCalledTimes(
      1,
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.contextGroupsPrefix,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.objectContextGroupsPrefix,
    });
    expect(mockAlert.post).toHaveBeenCalledWith({
      message: 'Direct relationships: 1 added.',
      severity: 'success',
    });
  });

  it('omits reciprocal and provenance when absent', async () => {
    mockApi.createRelationship.mockResolvedValue(makeEdge());
    const { result } = setup({
      ...defaultOptions,
      reciprocalRelationshipType: '  ',
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.addDirect('src-1', 'tgt-1'));
    await act(async () => {
      await result.current.flush(null);
    });

    expect(mockApi.createRelationship).toHaveBeenCalledWith({
      sourceDatasourceId: 'ds-1',
      sourceObjectId: 'src-1',
      destinationDatasourceId: 'ds-2',
      destinationObjectId: 'tgt-1',
      relationshipType: 'memberOf',
      origin: 'manual',
    });
  });

  it('deletes buffered removals and reports the summary', async () => {
    mockApi.queryRelationships.mockResolvedValue({
      items: [makeEdge()],
      total: 1,
    });
    mockApi.deleteRelationship.mockResolvedValue(undefined);
    const { result } = setup();
    await waitFor(() =>
      expect(result.current.directBySourceObjectId.size).toBe(1),
    );

    act(() => result.current.markRemoval('edge-1'));
    await act(async () => {
      await result.current.flush('rule-1');
    });

    expect(mockApi.deleteRelationship).toHaveBeenCalledWith('edge-1');
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.objectDetail('ds-1', 'src-1'),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.objectDetail('ds-2', 'tgt-1'),
    });
    expect(mockAlert.post).toHaveBeenCalledWith({
      message: 'Direct relationships: 1 removed.',
      severity: 'success',
    });
  });

  it('keeps failed ops in the buffer and reports without throwing', async () => {
    mockApi.createRelationship.mockRejectedValue(new Error('nope'));
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.addDirect('src-1', 'tgt-1'));
    let flushResult: { failed: number } | undefined;
    await act(async () => {
      flushResult = await result.current.flush('rule-1');
    });

    expect(flushResult).toEqual({ failed: 1 });
    expect(result.current.hasPendingChanges).toBe(true);
    expect(result.current.directBySourceObjectId.get('src-1')).toEqual([
      { key: 'add|src-1|tgt-1', targetObjectId: 'tgt-1', status: 'added' },
    ]);
    expect(mockAlert.post).toHaveBeenCalledWith({
      message: '1 direct relationship failed to save.',
      severity: 'error',
    });
    // Nothing landed, so no context-group rebuild or refetch.
    expect(
      mockApi.materializeContextGroupsForDatasource,
    ).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: queryKeys.contextGroupsPrefix,
    });
  });

  it('clears only the successful ops on a partial flush', async () => {
    mockApi.createRelationship
      .mockResolvedValueOnce(makeEdge({ id: 'edge-ok' }))
      .mockRejectedValueOnce(new Error('nope'));
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.addDirect('src-1', 'tgt-1'));
    act(() => result.current.addDirect('src-2', 'tgt-2'));
    let flushResult: { failed: number } | undefined;
    await act(async () => {
      flushResult = await result.current.flush('rule-1');
    });

    expect(flushResult).toEqual({ failed: 1 });
    expect(result.current.directBySourceObjectId.get('src-1')).toBeUndefined();
    expect(result.current.directBySourceObjectId.get('src-2')).toEqual([
      { key: 'add|src-2|tgt-2', targetObjectId: 'tgt-2', status: 'added' },
    ]);
  });
});

describe('useDirectRelationships — load gate', () => {
  it('ignores addDirect until persisted edges have loaded', async () => {
    let resolveQuery: (value: {
      items: Relationship[];
      total: number;
    }) => void = () => {};
    mockApi.queryRelationships.mockReturnValue(
      new Promise(resolve => {
        resolveQuery = resolve;
      }),
    );

    const { result } = setup();
    expect(result.current.loading).toBe(true);

    act(() => result.current.addDirect('src-1', 'tgt-1'));
    expect(result.current.hasPendingChanges).toBe(false);

    await act(async () => {
      resolveQuery({ items: [makeEdge()], total: 1 });
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Once loaded, the existing pair is known — linking is a no-op.
    act(() => result.current.addDirect('src-1', 'tgt-1'));
    expect(result.current.hasPendingChanges).toBe(false);
    expect(result.current.directBySourceObjectId.get('src-1')).toHaveLength(1);
  });
});
