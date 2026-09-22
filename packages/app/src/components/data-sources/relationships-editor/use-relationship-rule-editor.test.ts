import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { TestQueryProvider } from '../../../test-utils';
import {
  deriveReciprocal,
  useRelationshipRuleEditor,
  type RelationshipRuleInspectorProps,
} from './use-relationship-rule-editor';
import type { RelationshipRule } from '../../../api/datastore/datastore-client';

/**
 * Mocks typed as the callbacks they stand in for, taken from the inspector's
 * own props so these tests fail if a signature changes rather than silently
 * passing a mock the hook would reject.
 */
type MockPreview = Mock<
  NonNullable<RelationshipRuleInspectorProps['onPreview']>
>;
type MockClose = Mock<RelationshipRuleInspectorProps['onClose']>;
type MockSave = Mock<RelationshipRuleInspectorProps['onSave']>;
type MockApprove = Mock<
  NonNullable<RelationshipRuleInspectorProps['onApprove']>
>;

// The editor now composes useDirectRelationships, which reads the datastore and
// alert contexts. The tests wrap only in TestQueryProvider (no ApiProvider), so
// override those two hooks; everything else stays real. Hoisted so individual
// tests can drive the direct-edge flush (e.g. make createRelationship reject).
const datastoreMock = vi.hoisted(() => ({
  queryRelationships: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  createRelationship: vi.fn().mockResolvedValue(undefined),
  deleteRelationship: vi.fn().mockResolvedValue(undefined),
  materializeContextGroupsForDatasource: vi.fn().mockResolvedValue(undefined),
}));
const alertMock = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../api')>();
  return {
    ...actual,
    useDatastore: () => datastoreMock,
    useAlert: () => alertMock,
  };
});

function makeRule(overrides: Partial<RelationshipRule> = {}): RelationshipRule {
  return {
    id: 'r1',
    name: 'Rule',
    description: null,
    sourceDatasourceId: 'src-ds',
    targetDatasourceId: 'tgt-ds',
    sourceFieldExpression: '$.spec.id',
    targetFieldExpression: '$.metadata.name',
    sourceFilterExpression: null,
    targetFilterExpression: null,
    relationshipType: 'dependsOn',
    reciprocalRelationshipType: 'hasDependency',
    strategy: 'field-matching',
    matchStrategy: 'exact',
    origin: 'manual',
    state: 'active',
    suggestionKind: null,
    score: null,
    confidenceBand: null,
    evidenceSummary: null,
    reviewReason: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const previewResult = {
  items: [
    {
      sourceObjectId: 'obj-1',
      relationshipType: 'dependsOn',
      targetObjectIds: [] as string[],
    },
  ],
  total: 1,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

// Stable references: the editor's reset-on-open effect keys on `existingRule`
// and the field arrays, so fresh objects per render would reset our input edits
// on every render. Create them once.
const RULE = makeRule();
const NO_FIELDS: never[] = [];

function renderEditor(onPreview: MockPreview) {
  const onClose = vi.fn();
  const onSave = vi.fn().mockResolvedValue(undefined);
  return renderHook(
    () =>
      useRelationshipRuleEditor({
        open: true,
        sourceDatasourceId: 'src-ds',
        targetDatasourceId: 'tgt-ds',
        sourceLabel: 'Source',
        targetLabel: 'Target',
        sourceFields: NO_FIELDS,
        targetFields: NO_FIELDS,
        existingRule: RULE,
        onClose,
        onSave,
        onPreview,
      }),
    { wrapper: TestQueryProvider },
  );
}

describe('useRelationshipRuleEditor preview gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks Save until a preview for the current inputs settles', async () => {
    const onPreview = vi.fn().mockResolvedValue(previewResult);
    const { result } = renderEditor(onPreview);

    // The existing rule seeds valid inputs on open, so Save is gated only until
    // the debounced preview settles. The rule is unchanged, so no "run a
    // preview" hint shows — that hint is reserved for actual edits.
    expect(result.current.canSave).toBe(false);

    // Even once the preview lands, an untouched rule stays unsavable: there is
    // nothing to save.
    await waitFor(() => expect(result.current.previewResult).toBeTruthy());
    expect(result.current.canSave).toBe(false);
    expect(result.current.saveBlockedReason).toBe('No changes to save.');

    // An edit (and its settled preview) is what unlocks Save.
    act(() => result.current.setSourceFilterExpression('$.active = true'));
    await waitFor(() => expect(result.current.canSave).toBe(true));
    expect(result.current.saveBlockedReason).toBeNull();
    expect(result.current.previewStale).toBe(false);
    expect(result.current.previewLoading).toBe(false);
    expect(onPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceDatasourceId: 'src-ds',
        targetDatasourceId: 'tgt-ds',
        sourceFieldExpression: '$.spec.id',
        targetFieldExpression: '$.metadata.name',
        relationshipType: 'dependsOn',
      }),
      expect.objectContaining({ limit: expect.any(Number) }),
    );
  });

  it('re-blocks Save when an input changes, until the new preview settles', async () => {
    // The preview for the changed inputs is held in flight so we can observe
    // that Save is blocked for the whole time it's pending.
    const secondPreview = deferred<typeof previewResult>();
    const onPreview = vi
      .fn()
      .mockImplementation((input: { sourceFieldExpression: string }) =>
        input.sourceFieldExpression === '$.spec.other'
          ? secondPreview.promise
          : Promise.resolve(previewResult),
      );
    const { result } = renderEditor(onPreview);

    await waitFor(() => expect(result.current.previewResult).toBeTruthy());

    act(() => {
      result.current.setSourceFieldExpression('$.spec.other');
    });

    // Once the debounce fires, the preview re-runs for the new inputs. While
    // that request is in flight the result is stale for the current inputs, so
    // Save must be blocked — never save a rule against a stale preview.
    await waitFor(() =>
      expect(onPreview).toHaveBeenCalledWith(
        expect.objectContaining({ sourceFieldExpression: '$.spec.other' }),
        expect.anything(),
      ),
    );
    expect(result.current.canSave).toBe(false);
    expect(result.current.previewStale).toBe(true);
    // The rule is now dirty and the preview is stale, so the hint appears.
    expect(result.current.saveBlockedReason).toBeTruthy();

    // Resolving the new preview unlocks Save again.
    secondPreview.resolve(previewResult);
    await waitFor(() => expect(result.current.canSave).toBe(true));
  });

  it('re-blocks Save when a filter expression changes', async () => {
    const filteredPreview = deferred<typeof previewResult>();
    const onPreview = vi
      .fn()
      .mockImplementation((input: { sourceFilterExpression?: string }) =>
        input.sourceFilterExpression === '$.active = true'
          ? filteredPreview.promise
          : Promise.resolve(previewResult),
      );
    const { result } = renderEditor(onPreview);

    await waitFor(() => expect(result.current.previewResult).toBeTruthy());

    act(() => {
      result.current.setSourceFilterExpression('$.active = true');
    });

    await waitFor(() =>
      expect(onPreview).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceFilterExpression: '$.active = true',
        }),
        expect.anything(),
      ),
    );
    expect(result.current.canSave).toBe(false);
    expect(result.current.previewStale).toBe(true);

    filteredPreview.resolve(previewResult);
    await waitFor(() => expect(result.current.canSave).toBe(true));
  });
});

describe('useRelationshipRuleEditor integration-backed preview gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const INTEGRATION_RULE = makeRule({
    strategy: 'integration-backed',
    sourceFieldExpression: '$.spec.login',
    targetFieldExpression: '$.metadata.name',
    integrationConfig: {
      integrationId: 'github',
      method: 'GET',
      path: '/repos/{value}',
      responseMatchExpression: '$.slug',
    },
  });

  function renderIntegrationEditor(onPreview: MockPreview) {
    const onClose = vi.fn();
    const onSave = vi.fn().mockResolvedValue(undefined);
    return renderHook(
      () =>
        useRelationshipRuleEditor({
          open: true,
          sourceDatasourceId: 'src-ds',
          targetDatasourceId: 'tgt-ds',
          sourceLabel: 'Source',
          targetLabel: 'Target',
          sourceFields: NO_FIELDS,
          targetFields: NO_FIELDS,
          existingRule: INTEGRATION_RULE,
          onClose,
          onSave,
          onPreview,
        }),
      { wrapper: TestQueryProvider },
    );
  }

  it('allows preview when a template path is set', async () => {
    const onPreview = vi.fn().mockResolvedValue(previewResult);
    const { result } = renderIntegrationEditor(onPreview);

    expect(result.current.hasPreviewInputs).toBe(true);

    // Save also needs something to save; the preview is the other half.
    act(() => result.current.setSourceFilterExpression('$.active = true'));

    await act(async () => {
      result.current.setPreviewSourceObjectId('source-specific');
    });

    await act(async () => {
      await result.current.handleIntegrationPreview();
    });

    expect(onPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        integrationConfig: expect.objectContaining({
          path: '/repos/{value}',
        }),
      }),
      { sampleLimit: 5, sourceObjectId: 'source-specific' },
    );
    expect(result.current.canSave).toBe(true);
  });

  it('assigns a fresh response-sample token to every explicit run', async () => {
    const onPreview = vi.fn().mockResolvedValue(previewResult);
    const { result } = renderIntegrationEditor(onPreview);

    expect(result.current.responseSampleRunId).toBeNull();
    await act(async () => result.current.handleIntegrationPreview());
    const firstRunId = result.current.responseSampleRunId;
    expect(firstRunId).not.toBeNull();

    await act(async () => result.current.handleIntegrationPreview());
    expect(result.current.responseSampleRunId).toBeGreaterThan(firstRunId ?? 0);
  });

  it('re-blocks Save when the integration sample limit changes', async () => {
    const onPreview = vi.fn().mockResolvedValue(previewResult);
    const { result } = renderIntegrationEditor(onPreview);

    await act(async () => {
      await result.current.handleIntegrationPreview();
    });
    await waitFor(() => expect(result.current.previewResult).toBeTruthy());

    act(() => {
      result.current.setIntegrationSampleLimit(10);
    });

    expect(result.current.canSave).toBe(false);
    expect(result.current.previewStale).toBe(true);
  });

  it('blocks Save when every sampled integration source failed', async () => {
    const onPreview = vi.fn().mockResolvedValue({
      items: [],
      total: 2,
      skippedSources: ['source-1', 'source-2'],
    });
    const { result } = renderIntegrationEditor(onPreview);

    await act(async () => {
      await result.current.handleIntegrationPreview();
    });

    expect(result.current.canSave).toBe(false);
    expect(result.current.saveBlockedReason).toMatch(/failed source calls/i);
  });

  it('allows Save when an integration preview only partially failed', async () => {
    const onPreview = vi.fn().mockResolvedValue({
      ...previewResult,
      skippedSources: ['source-2'],
    });
    const { result } = renderIntegrationEditor(onPreview);

    act(() => result.current.setSourceFilterExpression('$.active = true'));

    await act(async () => {
      await result.current.handleIntegrationPreview();
    });

    expect(result.current.canSave).toBe(true);
  });
});

describe('useRelationshipRuleEditor duplicate detection', () => {
  function renderWithExistingRules(
    existingRule: RelationshipRule,
    existingRules: RelationshipRule[],
    onPreview = vi.fn().mockResolvedValue(previewResult),
  ) {
    const onClose = vi.fn();
    const onSave = vi.fn().mockResolvedValue(undefined);
    return renderHook(
      () =>
        useRelationshipRuleEditor({
          open: true,
          sourceDatasourceId: 'src-ds',
          targetDatasourceId: 'tgt-ds',
          sourceLabel: 'Source',
          targetLabel: 'Target',
          sourceFields: NO_FIELDS,
          targetFields: NO_FIELDS,
          existingRule,
          existingRules,
          onClose,
          onSave,
          onPreview,
        }),
      { wrapper: TestQueryProvider },
    );
  }

  it('flags duplicate when all distinguishing fields match', () => {
    const existing = makeRule({
      id: 'editing',
      sourceFieldExpression: '$.dup.a',
      targetFieldExpression: '$.dup.b',
    });
    const collide = makeRule({
      id: 'other',
      sourceFieldExpression: '$.dup.a',
      targetFieldExpression: '$.dup.b',
    });
    const { result } = renderWithExistingRules(existing, [existing, collide]);

    expect(result.current.isDuplicate).toBe(true);
  });

  it('does not flag duplicate when only filter expressions differ', () => {
    const existing = makeRule({
      id: 'editing',
      sourceFieldExpression: '$.dup.a',
      targetFieldExpression: '$.dup.b',
      sourceFilterExpression: '$.active = true',
    });
    const collide = makeRule({
      id: 'other',
      sourceFieldExpression: '$.dup.a',
      targetFieldExpression: '$.dup.b',
      sourceFilterExpression: '$.archived = false',
    });
    const { result } = renderWithExistingRules(existing, [existing, collide]);

    expect(result.current.isDuplicate).toBe(false);
  });

  it('does not flag duplicate when only the match strategy differs', () => {
    const existing = makeRule({
      id: 'editing',
      sourceFieldExpression: '$.dup.a',
      targetFieldExpression: '$.dup.b',
      matchStrategy: 'exact',
    });
    const otherStrategy = makeRule({
      id: 'other',
      sourceFieldExpression: '$.dup.a',
      targetFieldExpression: '$.dup.b',
      matchStrategy: 'array_contains',
    });
    const { result } = renderWithExistingRules(existing, [
      existing,
      otherStrategy,
    ]);

    expect(result.current.isDuplicate).toBe(false);
  });

  it('does not flag duplicate when only integration config differs', () => {
    const base = {
      sourceFieldExpression: '$.spec.login',
      targetFieldExpression: '$.metadata.name',
      strategy: 'integration-backed' as const,
    };
    const existing = makeRule({
      id: 'editing',
      ...base,
      integrationConfig: {
        integrationId: 'github',
        method: 'GET',
        path: '/repos/{value}',
        responseMatchExpression: '$.slug',
      },
    });
    const collide = makeRule({
      id: 'other',
      ...base,
      integrationConfig: {
        integrationId: 'github',
        method: 'GET',
        path: '/orgs/{value}',
        responseMatchExpression: '$.slug',
      },
    });
    const { result } = renderWithExistingRules(existing, [existing, collide]);

    expect(result.current.isDuplicate).toBe(false);
  });
});

describe('useRelationshipRuleEditor integration request-path validity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderWithConfig(
    integrationConfig: NonNullable<RelationshipRule['integrationConfig']>,
  ) {
    const onPreview = vi.fn().mockResolvedValue(previewResult);
    const rule = makeRule({
      strategy: 'integration-backed',
      sourceFieldExpression: '$.spec.login',
      targetFieldExpression: '$.metadata.name',
      integrationConfig,
    });
    const view = renderHook(
      () =>
        useRelationshipRuleEditor({
          open: true,
          sourceDatasourceId: 'src-ds',
          targetDatasourceId: 'tgt-ds',
          sourceLabel: 'Source',
          targetLabel: 'Target',
          sourceFields: NO_FIELDS,
          targetFields: NO_FIELDS,
          existingRule: rule,
          onClose: vi.fn(),
          onSave: vi.fn().mockResolvedValue(undefined),
          onPreview,
        }),
      { wrapper: TestQueryProvider },
    );
    return { ...view, onPreview };
  }

  it('allows preview when only the request path is set', () => {
    const { result } = renderWithConfig({
      integrationId: 'github',
      method: 'GET',
      path: '/repos/{value}/teams',
      responseMatchExpression: '$.slug',
    });

    expect(result.current.hasPreviewInputs).toBe(true);
  });

  it('does not allow preview when the request path is empty', async () => {
    const { result, onPreview } = renderWithConfig({
      integrationId: 'github',
      method: 'GET',
      path: '',
      responseMatchExpression: '$.slug',
    });

    expect(result.current.hasPreviewInputs).toBe(false);

    // The button handler is a no-op when inputs are incomplete — it must never
    // fire a live integration call against a half-filled config.
    await act(async () => {
      await result.current.handleIntegrationPreview();
    });
    expect(onPreview).not.toHaveBeenCalled();
    expect(result.current.canSave).toBe(false);
  });

  it('allows backend preview when an advanced request path is configured', () => {
    const { result } = renderWithConfig({
      integrationId: 'github',
      method: 'GET',
      path: '',
      pathExpression: '"/repos/" & sourceValue',
      responseMatchExpression: '$.slug',
    });

    expect(result.current.hasPreviewInputs).toBe(true);
    expect(result.current.canRunPreview).toBe(true);
  });

  it('does not allow preview when the integration id is missing', () => {
    const { result } = renderWithConfig({
      integrationId: '',
      method: 'GET',
      path: '/repos/{value}/teams',
      responseMatchExpression: '$.slug',
    });

    expect(result.current.hasPreviewInputs).toBe(false);
  });

  it('does not allow preview when the response match expression is empty', () => {
    const { result } = renderWithConfig({
      integrationId: 'github',
      method: 'GET',
      path: '/repos/{value}/teams',
      responseMatchExpression: '',
    });

    expect(result.current.hasPreviewInputs).toBe(false);
  });
});

describe('useRelationshipRuleEditor integration preview cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const makeIntegrationRule = (id: string, path: string) =>
    makeRule({
      id,
      strategy: 'integration-backed',
      sourceFieldExpression: '$.spec.login',
      targetFieldExpression: '$.metadata.name',
      integrationConfig: {
        integrationId: 'github',
        method: 'GET',
        path,
        responseMatchExpression: '$.slug',
      },
    });

  function renderForRule(rule: RelationshipRule, onPreview: MockPreview) {
    return renderHook(
      ({ existingRule }: { existingRule: RelationshipRule }) =>
        useRelationshipRuleEditor({
          open: true,
          sourceDatasourceId: 'src-ds',
          targetDatasourceId: 'tgt-ds',
          sourceLabel: 'Source',
          targetLabel: 'Target',
          sourceFields: NO_FIELDS,
          targetFields: NO_FIELDS,
          existingRule,
          onClose: vi.fn(),
          onSave: vi.fn().mockResolvedValue(undefined),
          onPreview,
        }),
      { wrapper: TestQueryProvider, initialProps: { existingRule: rule } },
    );
  }

  it('discards an in-flight preview when the edited rule changes', async () => {
    const pending = deferred<typeof previewResult>();
    const onPreview = vi.fn().mockReturnValue(pending.promise);
    const ruleA = makeIntegrationRule('rule-a', '/orgs/{value}');
    const ruleB = makeIntegrationRule('rule-b', '/repos/{value}');

    const { result, rerender } = renderForRule(ruleA, onPreview);

    let previewCall: Promise<void> = Promise.resolve();
    act(() => {
      previewCall = result.current.handleIntegrationPreview();
    });
    expect(result.current.previewLoading).toBe(true);

    // Switch to a different integration-backed rule while A's request is still
    // pending — the strategy never changes, only the rule identity does.
    rerender({ existingRule: ruleB });

    // A's late response must not leak onto the preview now showing rule B.
    await act(async () => {
      pending.resolve(previewResult);
      await previewCall;
    });

    expect(result.current.previewResult).toBeNull();
    expect(result.current.canSave).toBe(false);
  });
});

describe('useRelationshipRuleEditor background refetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves unsaved edits when the rules list refetches', () => {
    const onPreview = vi.fn().mockResolvedValue(previewResult);
    // Stable reference across rerenders — mirrors React Query structural
    // sharing keeping the edited rule identity intact on a background refetch.
    const rule = makeRule({
      id: 'stable',
      strategy: 'integration-backed',
      sourceFieldExpression: '$.spec.login',
      targetFieldExpression: '$.metadata.name',
      integrationConfig: {
        integrationId: 'github',
        method: 'GET',
        path: '/repos/{value}/teams',
        responseMatchExpression: '$.slug',
      },
    });

    const { result, rerender } = renderHook(
      ({ existingRules }: { existingRules: RelationshipRule[] }) =>
        useRelationshipRuleEditor({
          open: true,
          sourceDatasourceId: 'src-ds',
          targetDatasourceId: 'tgt-ds',
          sourceLabel: 'Source',
          targetLabel: 'Target',
          sourceFields: NO_FIELDS,
          targetFields: NO_FIELDS,
          existingRule: rule,
          existingRules,
          onClose: vi.fn(),
          onSave: vi.fn().mockResolvedValue(undefined),
          onPreview,
        }),
      { wrapper: TestQueryProvider, initialProps: { existingRules: [rule] } },
    );

    act(() => {
      result.current.setIntegrationConfig({
        ...result.current.integrationConfig!,
        path: '/edited/{value}',
      });
    });
    expect(result.current.integrationConfig?.path).toBe('/edited/{value}');

    // Background list refetch: a brand-new existingRules array arrives while the
    // edited rule's own reference is unchanged. The hydration effect keys on the
    // rule reference, so the unsaved edit must survive.
    rerender({ existingRules: [{ ...rule }] });

    expect(result.current.integrationConfig?.path).toBe('/edited/{value}');
  });
});

describe('useRelationshipRuleEditor reciprocal normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderWithRule = (existingRule: RelationshipRule | undefined) =>
    renderHook(
      () =>
        useRelationshipRuleEditor({
          open: true,
          sourceDatasourceId: 'src-ds',
          targetDatasourceId: 'tgt-ds',
          sourceLabel: 'Source',
          targetLabel: 'Target',
          sourceFields: NO_FIELDS,
          targetFields: NO_FIELDS,
          existingRule,
          onClose: vi.fn(),
          onSave: vi.fn().mockResolvedValue(undefined),
          onPreview: vi.fn().mockResolvedValue(previewResult),
        }),
      { wrapper: TestQueryProvider },
    );

  it('drops a stale overridden reverse when switching to a type with a known inverse', () => {
    const { result } = renderWithRule(undefined);

    // Custom type (no known inverse) with a manually-set reverse verb.
    act(() => result.current.handleRelationshipTypeChange('relatesToFoo'));
    act(() => result.current.handleReciprocalChange('fooRelatesBack'));
    expect(result.current.reciprocalRelationshipType).toBe('fooRelatesBack');

    // Switching to a known pair must drop the now-invisible override and use the
    // derived reverse (the reverse field is hidden for known types).
    act(() => result.current.handleRelationshipTypeChange('dependsOn'));
    expect(deriveReciprocal('dependsOn')).not.toBe('');
    expect(result.current.reciprocalRelationshipType).toBe(
      deriveReciprocal('dependsOn'),
    );
  });

  it('normalizes a non-standard stored reverse on a known type when loading a rule', () => {
    const { result } = renderWithRule(
      makeRule({
        relationshipType: 'dependsOn',
        reciprocalRelationshipType: 'someWeirdReverse',
      }),
    );

    // The stored reverse is non-standard for a known type; show the derived
    // reverse rather than an invisible stale value that would be re-saved.
    expect(result.current.reciprocalRelationshipType).toBe(
      deriveReciprocal('dependsOn'),
    );
  });

  it('does not mark an untouched rule dirty when it normalizes a known-type reverse on open', () => {
    // A known type with a null stored reverse: seed state uses the derived
    // reverse, and the baseline signature must match it so opening the rule
    // isn't flagged as an unsaved edit (which would show the preview hint and
    // let a save rewrite the reciprocal as a side effect).
    const { result } = renderWithRule(
      makeRule({
        relationshipType: 'dependsOn',
        reciprocalRelationshipType: null,
      }),
    );

    expect(result.current.reciprocalRelationshipType).toBe(
      deriveReciprocal('dependsOn'),
    );
    // Not dirty → "nothing to save", not the "run a preview" hint. If the
    // baseline signature used the raw stored reverse, the normalized seed would
    // read as an edit and the preview hint would appear on open instead.
    expect(result.current.saveBlockedReason).toBe('No changes to save.');
  });
});

describe('useRelationshipRuleEditor save + direct-edge flush', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    datastoreMock.queryRelationships.mockResolvedValue({ items: [], total: 0 });
    datastoreMock.createRelationship.mockResolvedValue(undefined);
    datastoreMock.deleteRelationship.mockResolvedValue(undefined);
  });

  const renderSaveEditor = (
    existingRule: RelationshipRule | undefined,
    onClose: MockClose,
    onSave: MockSave,
  ) =>
    renderHook(
      () =>
        useRelationshipRuleEditor({
          open: true,
          sourceDatasourceId: 'src-ds',
          targetDatasourceId: 'tgt-ds',
          sourceLabel: 'Source',
          targetLabel: 'Target',
          sourceFields: NO_FIELDS,
          targetFields: NO_FIELDS,
          existingRule,
          onClose,
          onSave,
          onPreview: vi.fn().mockResolvedValue(previewResult),
        }),
      { wrapper: TestQueryProvider },
    );

  // Stage one direct add whose write will fail, then save. Shared by both cases.
  const saveWithFailingFlush = async (
    result: { current: ReturnType<typeof useRelationshipRuleEditor> },
    setFields: boolean,
  ) => {
    if (setFields) {
      act(() => {
        result.current.setSourceFieldExpression('$.email');
        result.current.setTargetFieldExpression('$.email');
      });
    }
    await waitFor(() => expect(result.current.previewResult).toBeTruthy());
    await waitFor(() => expect(result.current.direct.loading).toBe(false));
    act(() => result.current.direct.addDirect('src-obj', 'tgt-obj'));
    // The staged edge is unsaved work, so Save unlocks even with a clean form.
    await waitFor(() => expect(result.current.canSave).toBe(true));
    datastoreMock.createRelationship.mockRejectedValueOnce(new Error('boom'));
    await act(async () => {
      await result.current.handleSave();
    });
  };

  it('closes a NEW rule editor even when the direct flush fails, so a retry cannot re-create the rule', async () => {
    const onClose = vi.fn();
    const onSave = vi.fn().mockResolvedValue(makeRule({ id: 'created-1' }));
    const { result } = renderSaveEditor(undefined, onClose, onSave);

    await saveWithFailingFlush(result, true);

    // The rule was created exactly once; closing prevents a second Save from
    // issuing another create (the parent still has no id for the new rule).
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps an EXISTING rule editor open when the direct flush fails, so the user can retry', async () => {
    const onClose = vi.fn();
    const onSave = vi.fn().mockResolvedValue(RULE);
    const { result } = renderSaveEditor(RULE, onClose, onSave);

    await saveWithFailingFlush(result, false);

    // Re-saving an existing rule is an idempotent update, so staying open for
    // retry is safe.
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the editor open when onDelete reports a cancelled delete', async () => {
    const onClose = vi.fn();
    // `false` = the delete callback's own confirmation dialog was cancelled;
    // the rule still exists, so closing would discard edits over a live rule.
    const onDelete = vi.fn().mockResolvedValue(false);
    const { result } = renderHook(
      () =>
        useRelationshipRuleEditor({
          open: true,
          sourceDatasourceId: 'src-ds',
          targetDatasourceId: 'tgt-ds',
          sourceLabel: 'Source',
          targetLabel: 'Target',
          sourceFields: NO_FIELDS,
          targetFields: NO_FIELDS,
          existingRule: RULE,
          onClose,
          onSave: vi.fn().mockResolvedValue(undefined),
          onDelete,
          onPreview: vi.fn().mockResolvedValue(previewResult),
        }),
      { wrapper: TestQueryProvider },
    );

    await act(async () => {
      await result.current.handleDelete();
    });

    expect(onDelete).toHaveBeenCalledWith(RULE.id);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores a re-entrant save while the first save is still in flight', async () => {
    const onClose = vi.fn();
    const savePending = deferred<RelationshipRule>();
    const onSave = vi.fn().mockReturnValue(savePending.promise);
    const { result } = renderSaveEditor(RULE, onClose, onSave);

    act(() => result.current.setSourceFilterExpression('$.active = true'));
    await waitFor(() => expect(result.current.canSave).toBe(true));

    // Fire a second save while the first one's write is still pending — e.g. a
    // double-click or Cmd+Enter racing the button. The in-flight latch must
    // drop it; a second write for a NEW rule would create a duplicate.
    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = result.current.handleSave();
      await result.current.handleSave();
    });
    expect(onSave).toHaveBeenCalledTimes(1);

    await act(async () => {
      savePending.resolve(RULE);
      await first;
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  const renderApproveEditor = (
    onClose: MockClose,
    onSave: MockSave,
    onApprove: MockApprove,
  ) =>
    renderHook(
      () =>
        useRelationshipRuleEditor({
          open: true,
          sourceDatasourceId: 'src-ds',
          targetDatasourceId: 'tgt-ds',
          sourceLabel: 'Source',
          targetLabel: 'Target',
          sourceFields: NO_FIELDS,
          targetFields: NO_FIELDS,
          existingRule: makeRule({ state: 'suggested' }),
          onClose,
          onSave,
          onApprove,
          onPreview: vi.fn().mockResolvedValue(previewResult),
        }),
      { wrapper: TestQueryProvider },
    );

  it('approves an untouched suggestion directly, without saving', async () => {
    const onClose = vi.fn();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onApprove = vi.fn().mockResolvedValue(undefined);
    const { result } = renderApproveEditor(onClose, onSave, onApprove);
    expect(result.current.canApprove).toBe(true);

    await act(async () => {
      await result.current.handleApprove();
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(onApprove).toHaveBeenCalledWith('r1');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('approves with staged direct edges only, without requiring a fresh preview', async () => {
    const onClose = vi.fn();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onApprove = vi.fn().mockResolvedValue(undefined);
    const { result } = renderApproveEditor(onClose, onSave, onApprove);
    await waitFor(() => expect(result.current.direct.loading).toBe(false));

    act(() => result.current.direct.addDirect('src-obj', 'tgt-obj'));
    expect(result.current.hasUnsavedChanges).toBe(true);
    // Directs flush with the approval and never need a preview — only a
    // dirty FORM gates the button (see handleApprove).
    expect(result.current.canApprove).toBe(true);

    await act(async () => {
      await result.current.handleApprove();
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(onApprove).toHaveBeenCalledWith('r1');
  });

  it('persists tweaks before approving (tweak-and-approve)', async () => {
    const calls: string[] = [];
    const onClose = vi.fn();
    const onSave = vi.fn().mockImplementation(async () => {
      calls.push('save');
      return undefined;
    });
    const onApprove = vi.fn().mockImplementation(async () => {
      calls.push('approve');
    });
    const { result } = renderApproveEditor(onClose, onSave, onApprove);

    act(() => result.current.setSourceFilterExpression('$.active = true'));
    expect(result.current.canApprove).toBe(false);
    await waitFor(() => expect(result.current.canSave).toBe(true));
    expect(result.current.canApprove).toBe(true);

    await act(async () => {
      await result.current.handleApprove();
    });

    expect(calls).toEqual(['save', 'approve']);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('aborts the approve when the tweak save fails', async () => {
    const onClose = vi.fn();
    const onSave = vi.fn().mockRejectedValue(new Error('boom'));
    const onApprove = vi.fn();
    const { result } = renderApproveEditor(onClose, onSave, onApprove);

    act(() => result.current.setSourceFilterExpression('$.active = true'));
    await waitFor(() => expect(result.current.canSave).toBe(true));
    await act(async () => {
      await result.current.handleApprove();
    });

    expect(onApprove).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('refuses to approve a dirty editor without a fresh preview', async () => {
    const onClose = vi.fn();
    const onSave = vi.fn();
    const onApprove = vi.fn();
    const { result } = renderApproveEditor(onClose, onSave, onApprove);

    act(() => result.current.setSourceFilterExpression('$.active = true'));
    // Debounced preview has not settled: dirty but not saveable.
    await act(async () => {
      await result.current.handleApprove();
    });

    expect(onSave).not.toHaveBeenCalled();
    expect(onApprove).not.toHaveBeenCalled();
  });
});
