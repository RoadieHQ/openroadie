import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type {
  IntegrationBackedConfig,
  RelationshipRuleMatchStrategy,
  RelationshipRulePreviewInput,
  RelationshipRulePreviewOptions,
  RelationshipRulePreviewResult,
} from '../../../api/datastore/datastore-client';
import { formatErrorString } from '../../../api/workflow/parse-execution-error';
import {
  countPreviewRelationshipRows,
  type RelationshipPreviewFilter,
} from './relationship-rule-preview';
import { useFieldMatchingPreview } from './use-field-matching-preview';
import { isAdvancedIntegrationRequestPath } from './step-list-utils';

const DEFAULT_INTEGRATION_SAMPLE_LIMIT = 5;

function hasIntegrationRequestPath(
  config: IntegrationBackedConfig | null | undefined,
): boolean {
  return Boolean(
    config?.path.trim() || isAdvancedIntegrationRequestPath(config),
  );
}

export interface UseRulePreviewOptions {
  open: boolean;
  existingRuleId: string | undefined;
  sourceDatasourceId: string;
  targetDatasourceId: string;
  isIntegrationBacked: boolean;
  sourceFieldExpression: string;
  targetFieldExpression: string;
  sourceFilterExpression: string;
  targetFilterExpression: string;
  relationshipType: string;
  reciprocalRelationshipType: string;
  matchStrategy: RelationshipRuleMatchStrategy;
  integrationConfig: IntegrationBackedConfig | null;
  /** Serialized identity of the rule's editable inputs (the form's signature). */
  currentSignature: string;
  onPreview?: (
    input: RelationshipRulePreviewInput,
    options?: RelationshipRulePreviewOptions,
  ) => Promise<RelationshipRulePreviewResult>;
}

/**
 * One surface over the editor's two preview engines: the field-matching
 * preview (react-query, auto-runs on debounced inputs) and the
 * integration-backed preview (imperative — it hits a live integration per
 * source object, so the user triggers it explicitly). Owns the preview-side UI
 * state (row filter, sample limit, pinned source object, response-sample run
 * token) and reports freshness relative to the current inputs, which is what
 * gates Save.
 */
export function useRulePreview({
  open,
  existingRuleId,
  sourceDatasourceId,
  targetDatasourceId,
  isIntegrationBacked,
  sourceFieldExpression,
  targetFieldExpression,
  sourceFilterExpression,
  targetFilterExpression,
  relationshipType,
  reciprocalRelationshipType,
  matchStrategy,
  integrationConfig,
  currentSignature,
  onPreview,
}: UseRulePreviewOptions) {
  const [relationshipFilter, setRelationshipFilter] =
    useState<RelationshipPreviewFilter>('all');
  const [integrationSampleLimit, setIntegrationSampleLimit] = useState(
    DEFAULT_INTEGRATION_SAMPLE_LIMIT,
  );
  const [previewSourceObjectId, setPreviewSourceObjectId] = useState<
    string | null
  >(null);
  // Each explicit run gets a new token. The response-preview query snapshots
  // the selected source against that token, so sample navigation cannot issue
  // more live calls and re-running identical inputs still performs a fresh one.
  // Per-instance (a module counter would be shared across editors and leak
  // across tests, which don't reset module state).
  const responseSampleRunSeqRef = useRef(0);
  const [responseSampleRunId, setResponseSampleRunId] = useState<number | null>(
    null,
  );
  const responseSampleArmed = responseSampleRunId !== null;

  // Full input signature for the manual integration preview. Includes the
  // sample limit AND the pinned source object, so a run scoped to one pinned
  // object cannot pass for a fresh full-rule preview after the pin changes.
  const previewInputKey = useMemo(
    () =>
      isIntegrationBacked
        ? JSON.stringify({
            signature: currentSignature,
            integrationSampleLimit,
            previewSourceObjectId,
          })
        : currentSignature,
    [
      isIntegrationBacked,
      currentSignature,
      integrationSampleLimit,
      previewSourceObjectId,
    ],
  );

  const hasPreviewInputs =
    sourceFieldExpression.trim().length > 0 &&
    targetFieldExpression.trim().length > 0 &&
    relationshipType.trim().length > 0 &&
    (!isIntegrationBacked ||
      (!!integrationConfig?.integrationId.trim() &&
        hasIntegrationRequestPath(integrationConfig) &&
        !!integrationConfig.responseMatchExpression.trim()));

  // Inputs needed to ISSUE the lookup request — everything a preview needs
  // except the response-match expression, which only the match/materialization
  // step consumes. Lets the author run the request to inspect the response and
  // then pick the response field from it. Field-matching has no separate
  // request stage, so it's just hasPreviewInputs.
  const canRunPreview = isIntegrationBacked
    ? sourceFieldExpression.trim().length > 0 &&
      targetFieldExpression.trim().length > 0 &&
      relationshipType.trim().length > 0 &&
      !!integrationConfig?.integrationId.trim() &&
      hasIntegrationRequestPath(integrationConfig)
    : hasPreviewInputs;

  // --- Field-matching preview (react-query, auto-runs on debounced inputs) ---
  const {
    result: fieldPreviewResult,
    fresh: fieldPreviewFresh,
    loading: fieldPreviewLoading,
    error: fieldPreviewError,
  } = useFieldMatchingPreview({
    open,
    isIntegrationBacked,
    hasPreviewInputs,
    sourceDatasourceId,
    targetDatasourceId,
    sourceFieldExpression,
    targetFieldExpression,
    sourceFilterExpression,
    targetFilterExpression,
    relationshipType,
    matchStrategy,
    sourceObjectId: previewSourceObjectId,
    onPreview,
  });

  // --- Integration-backed preview (imperative: real API calls, button-run) ---
  // The mutation holds the result; the submitted input signature rides along as
  // the mutation variables' `key`, so we can tell whether it still reflects the
  // current inputs (freshness) without a separate generation guard — a
  // superseded run is dropped by `reset()` on identity change below.
  const previewMutation = useMutation({
    mutationFn: ({
      input,
      sampleLimit,
      sourceObjectId,
    }: {
      input: RelationshipRulePreviewInput;
      key: string;
      sampleLimit: number;
      sourceObjectId?: string;
    }) =>
      onPreview!(input, {
        sampleLimit,
        ...(sourceObjectId ? { sourceObjectId } : {}),
      }),
  });
  const { mutateAsync: runIntegrationPreview, reset: resetIntegrationPreview } =
    previewMutation;

  // Reset the manual integration preview whenever the thing being edited
  // changes identity — the strategy flips, the drawer (re)opens, or we switch
  // to a different rule / datasource pair. Keying only on strategy let a stale
  // result (and any in-flight request) leak when hopping between two
  // integration-backed rules without the strategy changing.
  useEffect(() => {
    resetIntegrationPreview();
    setResponseSampleRunId(null);
    setPreviewSourceObjectId(null);
    // The sample size is per-rule input too — without this, previewing one
    // rule at 25 rows silently sends 25 on the next rule's first run.
    setIntegrationSampleLimit(DEFAULT_INTEGRATION_SAMPLE_LIMIT);
  }, [
    resetIntegrationPreview,
    isIntegrationBacked,
    open,
    existingRuleId,
    sourceDatasourceId,
    targetDatasourceId,
  ]);

  // Disarm the response-sample fetch whenever the request definition changes,
  // so editing the path/integration/source field doesn't silently re-hit the
  // integration — the author must run again. The advanced inputs
  // (pathExpression, sourceContext) shape the request too, so they disarm as
  // well. Excludes the response-match expression (the sample doesn't depend on
  // it), so picking a response field keeps the fetched response on screen.
  useEffect(() => {
    setResponseSampleRunId(null);
  }, [
    integrationConfig?.integrationId,
    integrationConfig?.method,
    integrationConfig?.path,
    integrationConfig?.pathExpression,
    integrationConfig?.sourceContext,
    sourceFieldExpression,
  ]);

  // --- Unified preview surface consumed by the UI ---
  const integrationPreviewResult = previewMutation.data ?? null;
  const integrationPreviewError = previewMutation.error
    ? formatErrorString(previewMutation.error)
    : null;
  const previewResult = isIntegrationBacked
    ? integrationPreviewResult
    : fieldPreviewResult;
  const previewHasResult = previewResult !== null;
  const previewLoading = isIntegrationBacked
    ? previewMutation.isPending
    : fieldPreviewLoading;
  const previewError = isIntegrationBacked
    ? integrationPreviewError
    : fieldPreviewError;
  const previewFreshForCurrent = isIntegrationBacked
    ? previewHasResult && previewMutation.variables?.key === previewInputKey
    : fieldPreviewFresh;
  const previewStale = previewHasResult && !previewFreshForCurrent;
  const integrationPreviewFullyFailed = Boolean(
    isIntegrationBacked &&
    previewResult &&
    previewResult.items.length === 0 &&
    (previewResult.skippedSources?.length ?? 0) > 0,
  );

  const relationshipFilterCounts = useMemo(
    () => countPreviewRelationshipRows(previewResult?.items),
    [previewResult],
  );

  const handleIntegrationPreview = useCallback(async () => {
    if (!onPreview || !isIntegrationBacked || !canRunPreview) {
      return;
    }
    responseSampleRunSeqRef.current += 1;
    setResponseSampleRunId(responseSampleRunSeqRef.current);
    // Without a response-match expression there's nothing to materialize yet;
    // the run only fetches the response so the author can pick a field from it.
    // Clear any stale matches so the table prompts for that next step.
    if (!integrationConfig?.responseMatchExpression?.trim()) {
      resetIntegrationPreview();
      return;
    }
    // mutateAsync rejects on failure; the error is captured on the mutation, so
    // swallow it here rather than let it surface as an unhandled rejection.
    await runIntegrationPreview({
      key: previewInputKey,
      sampleLimit: integrationSampleLimit,
      sourceObjectId: previewSourceObjectId ?? undefined,
      input: {
        sourceDatasourceId,
        targetDatasourceId,
        sourceFieldExpression: sourceFieldExpression.trim(),
        targetFieldExpression: targetFieldExpression.trim(),
        sourceFilterExpression: sourceFilterExpression.trim() || undefined,
        targetFilterExpression: targetFilterExpression.trim() || undefined,
        relationshipType: relationshipType.trim(),
        reciprocalRelationshipType:
          reciprocalRelationshipType.trim() || undefined,
        strategy: 'integration-backed',
        matchStrategy,
        integrationConfig,
      },
    }).catch(() => undefined);
  }, [
    onPreview,
    isIntegrationBacked,
    canRunPreview,
    runIntegrationPreview,
    resetIntegrationPreview,
    sourceDatasourceId,
    targetDatasourceId,
    sourceFieldExpression,
    targetFieldExpression,
    sourceFilterExpression,
    targetFilterExpression,
    relationshipType,
    reciprocalRelationshipType,
    matchStrategy,
    integrationConfig,
    integrationSampleLimit,
    previewSourceObjectId,
    previewInputKey,
  ]);

  // Why the run control is disabled for an integration-backed rule, surfaced as
  // a tooltip on the disabled run button. Ordered to name the next thing to set
  // given what's already there. The response-match field isn't listed — it's
  // optional to RUN (the run fetches the response so you can pick it), only
  // required to materialize matches.
  const previewBlockedReason = useMemo(() => {
    if (!isIntegrationBacked || canRunPreview) {
      return null;
    }
    if (!sourceFieldExpression.trim()) {
      return 'Choose a source field first.';
    }
    if (!integrationConfig?.integrationId.trim()) {
      return 'Select an integration first.';
    }
    if (!hasIntegrationRequestPath(integrationConfig)) {
      return 'Set a request path first.';
    }
    if (!targetFieldExpression.trim()) {
      return 'Choose a target field first.';
    }
    if (!relationshipType.trim()) {
      return 'Choose a relationship type first.';
    }
    return null;
  }, [
    isIntegrationBacked,
    canRunPreview,
    sourceFieldExpression,
    integrationConfig,
    targetFieldExpression,
    relationshipType,
  ]);

  // A preview that reflects the current inputs and succeeded. With no preview
  // callback there is nothing to wait for, so the gate is open.
  const previewFresh =
    !onPreview ||
    (hasPreviewInputs &&
      previewFreshForCurrent &&
      !previewLoading &&
      !previewStale &&
      !integrationPreviewFullyFailed &&
      previewError === null);

  return {
    relationshipFilter,
    setRelationshipFilter,
    previewResult,
    previewHasResult,
    previewLoading,
    previewError,
    previewStale,
    previewFresh,
    integrationPreviewFullyFailed,
    hasPreviewInputs,
    canRunPreview,
    previewBlockedReason,
    integrationSampleLimit,
    setIntegrationSampleLimit,
    previewSourceObjectId,
    setPreviewSourceObjectId,
    lastPreviewSourceObjectId:
      previewMutation.variables?.sourceObjectId ?? null,
    handleIntegrationPreview,
    responseSampleArmed,
    responseSampleRunId,
    relationshipFilterCounts,
  };
}
