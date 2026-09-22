import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestQueryProvider } from '../../../test-utils';
import type { RelationshipRuleEditorState } from './use-relationship-rule-editor';
import { useStepPreviewData } from './use-step-preview-data';

const apiMocks = vi.hoisted(() => ({
  getObject: vi.fn(),
  queryObjects: vi.fn(),
  proxyRequest: vi.fn(),
}));

vi.mock('../../../api', () => ({
  useDatastore: () => ({
    getObject: apiMocks.getObject,
    queryObjects: apiMocks.queryObjects,
  }),
  useWorkflows: () => ({
    integrations: { proxyRequest: apiMocks.proxyRequest },
  }),
}));

function makeEditor(
  responseSampleRunId: number,
  path = '/users/{value}',
): RelationshipRuleEditorState {
  return {
    sourceDatasourceId: 'source-ds',
    targetDatasourceId: 'target-ds',
    sourceFieldExpression: '$.id',
    targetFieldExpression: '$.name',
    integrationConfig: {
      integrationId: 'github',
      method: 'GET',
      path,
      responseMatchExpression: '$.name',
    },
    isIntegrationBacked: true,
    previewLoading: false,
    previewResult: {
      items: [
        {
          sourceObjectId: 'source-1',
          sourceValue: 'alice',
          relationshipType: 'memberOf',
          targetObjectIds: [],
        },
        {
          sourceObjectId: 'source-2',
          sourceValue: 'bob',
          relationshipType: 'memberOf',
          targetObjectIds: [],
        },
      ],
      total: 2,
      responseSample: {
        sourceObjectId: 'source-1',
        sourceValue: 'alice',
        path: path.replace('{value}', 'alice'),
        data: { name: 'sample' },
      },
    },
    previewSourceObjectId: null,
    setPreviewSourceObjectId: vi.fn(),
    lastPreviewSourceObjectId: null,
    responseSampleArmed: responseSampleRunId > 0,
    responseSampleRunId,
    setIntegrationConfig: vi.fn(),
  } as unknown as RelationshipRuleEditorState;
}

/** A field-matching rule whose source expression resolved to nothing: the
 * backend preview drops rows with no field value, so a source field that
 * matches nothing at all comes back with no items — not even unmatched ones. */
function makeFieldMatchingEditor(): RelationshipRuleEditorState {
  return {
    sourceDatasourceId: 'source-ds',
    targetDatasourceId: 'target-ds',
    sourceFieldExpression: '$.images',
    targetFieldExpression: '$.repository_uri',
    integrationConfig: null,
    isIntegrationBacked: false,
    previewLoading: false,
    previewStale: false,
    previewError: null,
    previewResult: { items: [], total: 0 },
    previewSourceObjectId: null,
    setPreviewSourceObjectId: vi.fn(),
    lastPreviewSourceObjectId: null,
    responseSampleArmed: false,
    responseSampleRunId: null,
    setIntegrationConfig: vi.fn(),
  } as unknown as RelationshipRuleEditorState;
}

describe('useStepPreviewData zero-match feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flags the empty source field when no sampled object resolved it', async () => {
    // The datasource has objects — it is the expression that produced no
    // values, which is exactly when the author needs to be told.
    apiMocks.getObject.mockResolvedValue(null);
    apiMocks.queryObjects.mockResolvedValue({
      items: [{ object: { deployment_name: 'backstage-frontend' } }],
      total: 1,
    });

    const { result } = renderHook(
      () => useStepPreviewData(makeFieldMatchingEditor()),
      { wrapper: TestQueryProvider },
    );

    await waitFor(() =>
      expect(result.current.sourceSample.object).toBeDefined(),
    );
    expect(result.current.sourceFieldLeaf).toBe('images');
    expect(result.current.sampleFieldEmpty).toBe(true);
  });

  // A filter/function/concat can't be evaluated in the browser, so a locally
  // unresolved value is no evidence that the field is empty — only a resolvable
  // accessor path or a settled preview can show that.
  it('does not flag an unevaluatable expression before a preview settles', async () => {
    apiMocks.getObject.mockResolvedValue(null);
    apiMocks.queryObjects.mockResolvedValue({
      items: [{ object: { deployment_name: 'backstage-frontend' } }],
      total: 1,
    });
    const editor = makeFieldMatchingEditor();
    editor.sourceFieldExpression = '$uppercase($.deployment_name)';
    editor.previewResult = null;

    const { result } = renderHook(() => useStepPreviewData(editor), {
      wrapper: TestQueryProvider,
    });

    await waitFor(() =>
      expect(result.current.sourceSample.object).toBeDefined(),
    );
    expect(result.current.sampleFieldEmpty).toBe(false);
  });

  it('flags an unevaluatable expression once a settled preview found no value', async () => {
    apiMocks.getObject.mockResolvedValue({
      object: { deployment_name: 'backstage-frontend' },
    });
    apiMocks.queryObjects.mockResolvedValue({ items: [], total: 0 });
    const editor = makeFieldMatchingEditor();
    editor.sourceFieldExpression = '$uppercase($.deployment_name)';
    editor.previewResult = {
      items: [
        {
          sourceObjectId: 'source-1',
          relationshipType: 'deployedFrom',
          targetObjectIds: [],
        },
      ],
      total: 1,
    };

    const { result } = renderHook(() => useStepPreviewData(editor), {
      wrapper: TestQueryProvider,
    });

    await waitFor(() =>
      expect(result.current.sourceSample.object).toBeDefined(),
    );
    expect(result.current.sampleFieldEmpty).toBe(true);
  });

  it('flags a wildcard path the browser can resolve', async () => {
    apiMocks.getObject.mockResolvedValue(null);
    apiMocks.queryObjects.mockResolvedValue({
      items: [{ object: { containers: [{ name: 'app' }] } }],
      total: 1,
    });
    const editor = makeFieldMatchingEditor();
    // Advanced (it selects a set), but still a resolvable accessor path — the
    // sample genuinely has no `image` under any element.
    editor.sourceFieldExpression = '$.containers[*].image';
    editor.previewResult = null;

    const { result } = renderHook(() => useStepPreviewData(editor), {
      wrapper: TestQueryProvider,
    });

    await waitFor(() =>
      expect(result.current.sourceSample.object).toBeDefined(),
    );
    expect(result.current.sampleFieldEmpty).toBe(true);
  });

  it('does not flag the source field when the sample resolves it', async () => {
    apiMocks.getObject.mockResolvedValue(null);
    apiMocks.queryObjects.mockResolvedValue({
      items: [{ object: { images: ['ecr.io/frontend:abc'] } }],
      total: 1,
    });

    const { result } = renderHook(
      () => useStepPreviewData(makeFieldMatchingEditor()),
      { wrapper: TestQueryProvider },
    );

    await waitFor(() =>
      expect(result.current.sourceSample.object).toBeDefined(),
    );
    expect(result.current.sampleFieldEmpty).toBe(false);
  });
});

describe('useStepPreviewData integration response sampling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reuses the configured preview response without proxying the integration', async () => {
    apiMocks.getObject.mockImplementation(
      async (_datasourceId: string, objectId: string) => ({
        object: { id: objectId },
      }),
    );
    apiMocks.queryObjects.mockResolvedValue({ items: [], total: 0 });
    const { result, rerender } = renderHook(
      ({ runId, path }) => useStepPreviewData(makeEditor(runId, path)),
      {
        initialProps: { runId: 1, path: '/users/{value}' },
        wrapper: TestQueryProvider,
      },
    );

    await waitFor(() => expect(result.current.responseSampleReady).toBe(true));
    expect(result.current.responseSample).toEqual({ name: 'sample' });
    expect(result.current.resolvedLookupPath).toBe('/users/alice');
    expect(apiMocks.proxyRequest).not.toHaveBeenCalled();

    act(() => result.current.stepSample(1));
    await waitFor(() => expect(result.current.candidatePosition).toBe(2));
    expect(apiMocks.proxyRequest).not.toHaveBeenCalled();

    rerender({ runId: 1, path: '/members/{value}' });
    expect(result.current.resolvedLookupPath).toBe('/members/alice');
    expect(apiMocks.proxyRequest).not.toHaveBeenCalled();

    rerender({ runId: 2, path: '/members/{value}' });
    expect(apiMocks.proxyRequest).not.toHaveBeenCalled();
  });

  it('makes one proxy request before a response field is configured', async () => {
    apiMocks.getObject.mockResolvedValue({ object: { id: 'source-1' } });
    apiMocks.queryObjects.mockResolvedValue({
      items: [{ object: { id: 'source-1' } }],
      total: 1,
    });
    apiMocks.proxyRequest.mockResolvedValue({ data: { name: 'sample' } });
    const editor = makeEditor(1);
    editor.integrationConfig = {
      ...editor.integrationConfig!,
      responseMatchExpression: '',
    };
    editor.previewResult = null;

    const { result } = renderHook(() => useStepPreviewData(editor), {
      wrapper: TestQueryProvider,
    });

    await waitFor(() => expect(apiMocks.proxyRequest).toHaveBeenCalledTimes(1));
    expect(apiMocks.proxyRequest).toHaveBeenLastCalledWith(
      'github',
      expect.objectContaining({ path: '/users/source-1' }),
    );
    expect(result.current.responseSample).toEqual({ name: 'sample' });
  });

  it('does not remain loading when an advanced expression has no sampled value', async () => {
    apiMocks.getObject.mockResolvedValue({ object: { id: 'source-1' } });
    apiMocks.queryObjects.mockResolvedValue({ items: [], total: 0 });
    const editor = makeEditor(1);
    editor.sourceFieldExpression = '$uppercase($.id)';
    editor.previewResult = {
      items: [
        {
          sourceObjectId: 'source-1',
          relationshipType: 'memberOf',
          targetObjectIds: [],
        },
      ],
      total: 1,
    };

    const { result } = renderHook(() => useStepPreviewData(editor), {
      wrapper: TestQueryProvider,
    });

    await waitFor(() =>
      expect(result.current.sourceSample.loading).toBe(false),
    );
    expect(apiMocks.proxyRequest).not.toHaveBeenCalled();
    expect(result.current.lookupLoading).toBe(false);
    expect(result.current.lookupUnavailableReason).toMatch(/source value/i);
  });

  it('does not proxy backend-resolved advanced request paths in the browser', async () => {
    apiMocks.getObject.mockResolvedValue({ object: { id: 'source-1' } });
    apiMocks.queryObjects.mockResolvedValue({ items: [], total: 0 });
    const editor = makeEditor(1);
    editor.integrationConfig = {
      ...editor.integrationConfig!,
      pathExpression: '"/users/" & sourceValue',
    };
    editor.previewResult = {
      ...editor.previewResult!,
      responseSample: {
        sourceObjectId: 'source-1',
        sourceValue: 'alice',
        path: '/users/alice',
        data: { name: 'sample' },
      },
    };

    const { result } = renderHook(() => useStepPreviewData(editor), {
      wrapper: TestQueryProvider,
    });

    await waitFor(() =>
      expect(result.current.sourceSample.loading).toBe(false),
    );
    expect(apiMocks.proxyRequest).not.toHaveBeenCalled();
    expect(result.current.resolvedLookupPath).toBe('/users/alice');
    expect(result.current.responseSample).toEqual({ name: 'sample' });
    expect(result.current.lookupUnavailableReason).toBeUndefined();
  });

  it('requests an exact rerun for a pinned source outside the current sample', async () => {
    apiMocks.getObject.mockResolvedValue({ object: { id: 'source-specific' } });
    apiMocks.queryObjects.mockImplementation(async (datasourceId: string) =>
      datasourceId === 'target-ds'
        ? { items: [{ object: { id: 'target-example' } }], total: 1 }
        : { items: [], total: 0 },
    );
    const initialEditor = makeEditor(0);

    const { result, rerender } = renderHook(
      ({ editor }) => useStepPreviewData(editor),
      {
        initialProps: { editor: initialEditor },
        wrapper: TestQueryProvider,
      },
    );

    act(() => result.current.selectSourceObject('source-specific'));
    expect(initialEditor.setPreviewSourceObjectId).toHaveBeenCalledWith(
      'source-specific',
    );

    const pinnedEditor = makeEditor(0);
    pinnedEditor.previewSourceObjectId = 'source-specific';
    rerender({ editor: pinnedEditor });
    await waitFor(() =>
      expect(result.current.targetSample.object).toEqual({
        id: 'target-example',
      }),
    );
    expect(result.current.sourceEvaluationState).toBe('needs-preview');
    expect(result.current.targetShowingExample).toBe(true);
    expect(result.current.targetEmptyText).toBeUndefined();
    expect(result.current.matchEmptyText).toMatch(/run preview/i);

    const evaluatedEditor = makeEditor(0);
    evaluatedEditor.previewSourceObjectId = 'source-specific';
    evaluatedEditor.lastPreviewSourceObjectId = 'source-specific';
    evaluatedEditor.previewResult = { items: [], total: 2 };
    rerender({ editor: evaluatedEditor });
    expect(result.current.sourceEvaluationState).toBe('unmatched');
    expect(result.current.targetSample.object).toBeUndefined();
    expect(result.current.targetEmptyText).toBe(
      'No match for this source object.',
    );
  });

  it('shows the matched target after evaluating a pinned source', async () => {
    apiMocks.getObject.mockImplementation(
      async (_datasourceId: string, objectId: string) => ({
        object: { id: objectId },
      }),
    );
    apiMocks.queryObjects.mockResolvedValue({ items: [], total: 0 });
    const editor = makeEditor(0);
    editor.previewSourceObjectId = 'source-specific';
    editor.lastPreviewSourceObjectId = 'source-specific';
    editor.previewResult = {
      items: [
        {
          sourceObjectId: 'source-specific',
          sourceValue: 'alice',
          relationshipType: 'memberOf',
          targetObjectIds: ['target-match'],
          targetValue: 'alice',
        },
      ],
      total: 1,
    };

    const { result } = renderHook(() => useStepPreviewData(editor), {
      wrapper: TestQueryProvider,
    });

    await waitFor(() =>
      expect(result.current.targetSample.object).toEqual({
        id: 'target-match',
      }),
    );
    expect(result.current.sourceEvaluationState).toBe('matched');
    expect(result.current.targetShowingExample).toBe(false);
    expect(result.current.targetEmptyText).toBeUndefined();
  });

  it('keeps unpinned preview rows in evaluated sample mode', async () => {
    apiMocks.getObject.mockResolvedValue({ object: { id: 'source-1' } });
    apiMocks.queryObjects.mockResolvedValue({
      items: [{ object: { id: 'target-example' } }],
      total: 1,
    });

    const { result } = renderHook(() => useStepPreviewData(makeEditor(0)), {
      wrapper: TestQueryProvider,
    });

    await waitFor(() =>
      expect(result.current.sourceSample.object).toEqual({ id: 'source-1' }),
    );
    expect(result.current.sourceEvaluationState).toBe('unmatched');
    expect(result.current.targetSample.object).toBeUndefined();
    expect(result.current.targetEmptyText).toBe(
      'No match for this source object.',
    );
  });

  it('keeps the empty evaluated target when a sample filter has no candidates', async () => {
    apiMocks.getObject.mockResolvedValue({ object: { id: 'source-1' } });
    apiMocks.queryObjects.mockImplementation(async (datasourceId: string) =>
      datasourceId === 'target-ds'
        ? { items: [{ object: { id: 'target-example' } }], total: 1 }
        : { items: [], total: 0 },
    );

    const { result } = renderHook(() => useStepPreviewData(makeEditor(0)), {
      wrapper: TestQueryProvider,
    });

    await waitFor(() =>
      expect(result.current.sourceSample.object).toEqual({ id: 'source-1' }),
    );

    act(() => result.current.selectSampleFilter('matched'));

    await waitFor(() => expect(result.current.candidateTotal).toBe(0));
    expect(result.current.sourceEvaluationState).toBe('matched');
    expect(result.current.targetShowingExample).toBe(false);
    expect(result.current.targetSample.object).toBeUndefined();
    expect(result.current.targetEmptyText).toBe('No matched samples.');
    expect(result.current.matchEmptyText).toBe('No matched samples.');
  });

  it('keeps the empty evaluated target when every sample matched', async () => {
    apiMocks.getObject.mockImplementation(
      async (_datasourceId: string, objectId: string) => ({
        object: { id: objectId },
      }),
    );
    apiMocks.queryObjects.mockImplementation(async (datasourceId: string) =>
      datasourceId === 'target-ds'
        ? { items: [{ object: { id: 'target-example' } }], total: 1 }
        : { items: [], total: 0 },
    );
    const editor = makeEditor(0);
    editor.previewResult = {
      items: [
        {
          sourceObjectId: 'source-1',
          sourceValue: 'alice',
          relationshipType: 'memberOf',
          targetObjectIds: ['target-match'],
          targetValue: 'alice',
        },
      ],
      total: 1,
    };

    const { result } = renderHook(() => useStepPreviewData(editor), {
      wrapper: TestQueryProvider,
    });

    await waitFor(() =>
      expect(result.current.sourceEvaluationState).toBe('matched'),
    );

    act(() => result.current.selectSampleFilter('unmatched'));

    await waitFor(() => expect(result.current.candidateTotal).toBe(0));
    expect(result.current.sourceEvaluationState).toBe('unmatched');
    expect(result.current.targetShowingExample).toBe(false);
    expect(result.current.targetSample.object).toBeUndefined();
    expect(result.current.targetEmptyText).toBe('No unmatched samples.');
    expect(result.current.matchEmptyText).toBe('No unmatched samples.');
  });

  it('does not proxy while a configured backend preview is resolving', async () => {
    apiMocks.getObject.mockResolvedValue({ object: { id: 'source-1' } });
    apiMocks.queryObjects.mockResolvedValue({ items: [], total: 0 });
    const staleEditor = makeEditor(1);
    staleEditor.sourceFieldExpression = '$uppercase($.id)';
    staleEditor.previewLoading = true;
    staleEditor.previewStale = true;

    const { result, rerender } = renderHook(
      ({ editor }) => useStepPreviewData(editor),
      {
        initialProps: { editor: staleEditor },
        wrapper: TestQueryProvider,
      },
    );

    expect(apiMocks.proxyRequest).not.toHaveBeenCalled();

    const currentEditor = makeEditor(1);
    currentEditor.sourceFieldExpression = '$uppercase($.id)';
    currentEditor.previewStale = false;
    currentEditor.previewResult = {
      items: [
        {
          sourceObjectId: 'source-1',
          sourceValue: 'ALICE',
          relationshipType: 'memberOf',
          targetObjectIds: [],
        },
      ],
      total: 1,
      responseSample: {
        sourceObjectId: 'source-1',
        sourceValue: 'ALICE',
        path: '/users/ALICE',
        data: { name: 'current' },
      },
    };
    rerender({ editor: currentEditor });

    await waitFor(() =>
      expect(result.current.responseSample).toEqual({ name: 'current' }),
    );
    expect(result.current.resolvedLookupPath).toBe('/users/ALICE');
    expect(apiMocks.proxyRequest).not.toHaveBeenCalled();

    const navigatedEditor = makeEditor(1);
    navigatedEditor.sourceFieldExpression = '$uppercase($.id)';
    navigatedEditor.previewStale = false;
    navigatedEditor.previewResult = {
      items: [
        {
          sourceObjectId: 'source-2',
          sourceValue: 'BOB',
          relationshipType: 'memberOf',
          targetObjectIds: [],
        },
      ],
      total: 1,
    };
    rerender({ editor: navigatedEditor });

    expect(apiMocks.proxyRequest).not.toHaveBeenCalled();
  });
});
