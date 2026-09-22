import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDatastore, useWorkflows } from '../../../api';
import { ResponseError } from '../../../api/infrastructure/errors';
import type { RelationshipRulePreviewItem } from '../../../api/datastore/datastore-client';
import {
  isAdvancedExpression,
  resolveHighlightPath,
  splitFieldPath,
} from './field-expression';
import {
  asHttpMethod,
  isAdvancedIntegrationRequestPath,
  resolveLookupPath,
  valueAtPath,
} from './step-list-utils';
import {
  sampleCounts,
  selectSampleCandidates,
  type SampleFilter,
} from './sample-selection';
import { DEFAULT_INTEGRATION_CONFIG } from './integration-backed-rule-fields';
import type { RelationshipRuleEditorState } from './use-relationship-rule-editor';
import { formatErrorString } from '../../../api/workflow/parse-execution-error';
import { workspaceQueryKey } from '../../../api/workspace-scope';

/**
 * A representative object for a preview card. When a preview has produced a
 * specific matched object we fetch that; otherwise we read the first object
 * straight from the datasource so the card can show a real sample before any
 * (live) preview runs. One pattern for every object preview — source or target.
 */
function useSampleObject(
  datastore: ReturnType<typeof useDatastore>,
  datasourceId: string,
  matchedObjectId: string | null,
  // Fall back to the datasource's first object when there's no specific id.
  // Disabled for the target once a source is actively selected: showing an
  // unrelated first object would misrepresent an object that didn't match.
  allowFallback = true,
) {
  const matchedQuery = useQuery({
    queryKey: workspaceQueryKey(
      'relationship-sample-object',
      datasourceId,
      matchedObjectId,
    ),
    queryFn: async () =>
      (await datastore.getObject(datasourceId, matchedObjectId ?? '')) ?? null,
    enabled: !!matchedObjectId,
  });
  const fallbackAllowed = allowFallback && !matchedObjectId;
  const fallbackQuery = useQuery({
    queryKey: workspaceQueryKey('relationship-sample-fallback', datasourceId),
    queryFn: async () =>
      (await datastore.queryObjects(datasourceId, { limit: 1 })) ?? null,
    enabled: fallbackAllowed && !!datasourceId,
  });
  return {
    // Read the fallback only while it's allowed: a disabled query keeps its
    // cached data, and surfacing that here would present an unrelated "first
    // object" as the match for a source that didn't match anything.
    object:
      matchedQuery.data?.object ??
      (fallbackAllowed ? fallbackQuery.data?.items?.[0]?.object : undefined),
    loading: matchedObjectId ? matchedQuery.isLoading : fallbackQuery.isLoading,
    error: matchedObjectId ? matchedQuery.error : fallbackQuery.error,
  };
}

export type StepPreviewData = ReturnType<typeof useStepPreviewData>;
export type SourceEvaluationState =
  | 'browsing'
  | 'needs-preview'
  | 'matched'
  | 'unmatched'
  | 'failed';

/**
 * Owns "which sampled object flows through the preview chain" and the live
 * fetches that back each column: the source/target sample objects, the
 * integration lookup response, and every derived join/highlight value the
 * columns render. Pure preview state — no rule mutation beyond writing a picked
 * response-match expression back through the editor.
 */
export function useStepPreviewData(editor: RelationshipRuleEditorState) {
  const datastore = useDatastore();
  const workflows = useWorkflows();

  // Which sampled source object drives the preview chain. `sampleFilter` narrows
  // the cycled set (all / matched / unmatched), `sampleIndex` is the position in
  // it, and `pinnedSourceId` overrides both when the author searches for a
  // specific object. All three are pure preview UI state.
  const [sampleFilter, setSampleFilter] = useState<SampleFilter>('any');
  const [sampleIndex, setSampleIndex] = useState(0);
  const pinnedSourceId = editor.previewSourceObjectId;
  const setPinnedSourceId = editor.setPreviewSourceObjectId;
  // Which of the selected source's matched targets to show, when it matched more
  // than one. Reset whenever the source selection changes (below).
  const [targetIndex, setTargetIndex] = useState(0);

  // Per-part preview: the author chooses which sampled source object flows
  // through the chain, and we fetch its real source + target objects so each row
  // shows a live sample next to its configuration.
  const previewItems = useMemo<RelationshipRulePreviewItem[]>(
    () => editor.previewResult?.items ?? [],
    [editor.previewResult],
  );
  const counts = sampleCounts(previewItems);
  // The cycled set: filtered by matched/unmatched, then fill-biased so objects
  // that actually exercise the join sort first.
  const candidateItems = useMemo(
    () => selectSampleCandidates(previewItems, sampleFilter),
    [previewItems, sampleFilter],
  );
  const clampedIndex = candidateItems.length
    ? Math.min(sampleIndex, candidateItems.length - 1)
    : 0;
  // A pinned object may sit outside the current preview sample; keep its matched
  // item when present (so its target resolves) but still show the source object.
  const pinnedItem = pinnedSourceId
    ? (previewItems.find(i => i.sourceObjectId === pinnedSourceId) ?? null)
    : null;
  const sampleItem = pinnedSourceId
    ? pinnedItem
    : (candidateItems.at(clampedIndex) ?? null);
  const sampleSourceObjectId =
    pinnedSourceId ?? sampleItem?.sourceObjectId ?? null;
  const pinnedSourcePreviewComplete = Boolean(
    pinnedSourceId &&
    !editor.previewLoading &&
    !editor.previewStale &&
    (editor.isIntegrationBacked
      ? editor.lastPreviewSourceObjectId === pinnedSourceId
      : editor.previewResult || editor.previewError),
  );
  const pinnedSourcePreviewFailed = Boolean(
    pinnedSourcePreviewComplete &&
    (editor.previewError ||
      editor.previewResult?.skippedSources?.includes(pinnedSourceId ?? '')),
  );
  const emptyFilteredPreview =
    !pinnedSourceId && !sampleItem && previewItems.length > 0;
  const sourceEvaluationState: SourceEvaluationState = pinnedSourceId
    ? !pinnedSourcePreviewComplete
      ? 'needs-preview'
      : pinnedSourcePreviewFailed
        ? 'failed'
        : pinnedItem?.targetObjectIds.length
          ? 'matched'
          : 'unmatched'
    : sampleItem
      ? sampleItem.targetObjectIds.length > 0
        ? 'matched'
        : 'unmatched'
      : emptyFilteredPreview
        ? sampleFilter === 'matched'
          ? 'matched'
          : 'unmatched'
        : 'browsing';
  const targetMatchIds =
    sourceEvaluationState === 'matched'
      ? (sampleItem?.targetObjectIds ?? [])
      : [];
  const clampedTargetIndex = targetMatchIds.length
    ? Math.min(targetIndex, targetMatchIds.length - 1)
    : 0;
  const sampleTargetObjectId = targetMatchIds.at(clampedTargetIndex) ?? null;
  const showingEvaluationResult =
    sourceEvaluationState === 'matched' ||
    sourceEvaluationState === 'unmatched' ||
    sourceEvaluationState === 'failed';
  const sourceSample = useSampleObject(
    datastore,
    editor.sourceDatasourceId,
    sampleSourceObjectId,
  );
  const targetSample = useSampleObject(
    datastore,
    editor.targetDatasourceId,
    sampleTargetObjectId,
    !showingEvaluationResult,
  );

  // Picking a different source object resets which matched target is shown.
  const selectSourceObject = (id: string | null) => {
    setPinnedSourceId(id);
    setTargetIndex(0);
  };
  const selectSampleFilter = (f: SampleFilter) => {
    setPinnedSourceId(null);
    setSampleFilter(f);
    setSampleIndex(0);
    setTargetIndex(0);
  };
  const stepSample = (delta: number) => {
    setPinnedSourceId(null);
    setSampleIndex(
      Math.max(0, Math.min(candidateItems.length - 1, clampedIndex + delta)),
    );
    setTargetIndex(0);
  };
  const stepTarget = (delta: number) =>
    setTargetIndex(
      Math.max(
        0,
        Math.min(targetMatchIds.length - 1, clampedTargetIndex + delta),
      ),
    );

  // The sample match chain. Each row shows a growing prefix of it — Source
  // shows [source], Lookup shows [source, lookup], Match shows the whole chain —
  // so you can read "what matches what" left→right. The lookup result isn't a
  // catalog object, so its card shows the request + extracted values instead.
  const evaluatedSampleItem =
    sourceEvaluationState === 'matched' || sourceEvaluationState === 'unmatched'
      ? sampleItem
      : null;
  const sourceMatchValue =
    evaluatedSampleItem?.matchSourceValues?.[0] ??
    evaluatedSampleItem?.sourceValue;
  // Integration-backed rules don't return the source-side matched value. Align
  // the join value to the target being shown when there are several matches.
  const targetMatchValue =
    evaluatedSampleItem?.matchTargetValues?.at(clampedTargetIndex) ??
    evaluatedSampleItem?.matchTargetValues?.[0] ??
    evaluatedSampleItem?.targetValue;
  // Highlight (and expand/scroll to) the joined property inside each tree —
  // resolved against the sample so a match nested inside an array expands to
  // the actual matched element rather than staying collapsed.
  const sourceHighlightPath = resolveHighlightPath(
    editor.sourceFieldExpression,
    sourceSample.object,
    sourceMatchValue,
  );
  const targetHighlightPath = resolveHighlightPath(
    editor.targetFieldExpression,
    targetSample.object,
    targetMatchValue,
  );
  // Whether each field uses an advanced expression the picker can't represent —
  // drives the cogwheel dot and the in-tree marker.
  const sourceAdvanced = isAdvancedExpression(editor.sourceFieldExpression);
  const targetAdvanced = isAdvancedExpression(editor.targetFieldExpression);

  // The concrete source value the lookup request is built from: the matched
  // value once a preview ran, else the sample source object's field value.
  const currentPreviewSourceValue = editor.previewStale
    ? undefined
    : sourceMatchValue;
  const liveSourceValue =
    currentPreviewSourceValue ??
    (sourceHighlightPath
      ? valueAtPath(sourceSample.object, sourceHighlightPath)
      : undefined);

  // Warn when the current sample doesn't populate the chosen source field — the
  // usual reason a sample "isn't what I need": the tree shows nothing to join on.
  //
  // Deliberately NOT gated on `hasActiveSource`: a source field that resolves
  // for nothing is dropped from the preview entirely (the backend only returns
  // rows that produced a value), so requiring preview items suppressed this
  // warning in the one case that most needs it — zero matches with no
  // explanation.
  //
  // It IS gated on having evidence. A filter/function/concat can't be evaluated
  // in the browser (`resolveHighlightPath` gives no path for one), so an
  // unresolved value there proves nothing — only a resolvable accessor path
  // (wildcards included) or a settled preview can show the field is empty.
  const sourceFieldLeaf =
    splitFieldPath(editor.sourceFieldExpression).leaf || undefined;
  const canJudgeFieldEmpty =
    !!sourceHighlightPath ||
    (!!editor.previewResult && !editor.previewLoading && !editor.previewStale);
  const sampleFieldEmpty =
    !!editor.sourceFieldExpression.trim() &&
    !!sourceSample.object &&
    !liveSourceValue &&
    canJudgeFieldEmpty;

  // Live sample of the integration response the match expression runs against.
  // Before a response field is configured, Run makes one direct request so the
  // author can inspect the response and choose that field. Once configured, the
  // backend preview already makes the request and returns its first response;
  // reuse it here instead of executing the integration a second time.
  const lookupConfig = editor.integrationConfig;
  const lookupIntegrationId = lookupConfig?.integrationId;
  const lookupMethod = asHttpMethod(lookupConfig?.method);
  const lookupPathTemplate = lookupConfig?.path;
  const hasAdvancedRequestPath = isAdvancedIntegrationRequestPath(lookupConfig);
  const responseMatchExpression = lookupConfig?.responseMatchExpression?.trim();
  const responseAdvanced = isAdvancedExpression(responseMatchExpression);
  const responseSampleArmed = editor.responseSampleArmed;
  const responseSampleRunId = editor.responseSampleRunId;
  const backendResponseSample = responseSampleArmed
    ? editor.previewResult?.responseSample
    : undefined;
  // Once matching is configured, the backend preview is authoritative for the
  // evaluated source value. Do not start the raw-response request from an older
  // preview while the current explicit run is still resolving.
  const responseRunSourceValue =
    responseMatchExpression && (editor.previewLoading || editor.previewStale)
      ? undefined
      : liveSourceValue;
  const [responseSampleRequest, setResponseSampleRequest] = useState<{
    runId: number;
    integrationId: string | undefined;
    method: typeof lookupMethod;
    pathTemplate: string | undefined;
    sourceValue: string | undefined;
  }>();

  useEffect(() => {
    if (responseSampleRunId === null) {
      setResponseSampleRequest(undefined);
      return;
    }
    setResponseSampleRequest(current => {
      if (current?.runId === responseSampleRunId) {
        return current.sourceValue === undefined && responseRunSourceValue
          ? { ...current, sourceValue: responseRunSourceValue }
          : current;
      }
      return {
        runId: responseSampleRunId,
        integrationId: lookupIntegrationId,
        method: lookupMethod,
        pathTemplate: lookupPathTemplate,
        sourceValue: responseRunSourceValue,
      };
    });
  }, [
    lookupIntegrationId,
    lookupMethod,
    lookupPathTemplate,
    responseRunSourceValue,
    responseSampleRunId,
  ]);

  const responseSourceValue = responseSampleRequest?.sourceValue;
  const lookupResponseEnabled =
    editor.isIntegrationBacked &&
    !responseMatchExpression &&
    !hasAdvancedRequestPath &&
    !!responseSampleRequest?.integrationId &&
    !!responseSampleRequest.pathTemplate &&
    !!responseSourceValue &&
    responseSampleArmed;
  const lookupResponseQuery = useQuery({
    queryKey: workspaceQueryKey(
      'relationship-lookup-response',
      responseSampleRequest?.integrationId,
      responseSampleRequest?.method,
      responseSampleRequest?.pathTemplate,
      responseSampleRequest?.runId,
      responseSourceValue,
    ),
    queryFn: async (): Promise<{ path: string; data: unknown }> => {
      const path = resolveLookupPath(
        responseSampleRequest?.pathTemplate,
        responseSourceValue,
      );
      const { data } = await workflows.integrations.proxyRequest(
        responseSampleRequest?.integrationId ?? '',
        {
          backendType: 'http',
          method: responseSampleRequest?.method ?? 'GET',
          path,
        },
      );
      return { path, data: data ?? null };
    },
    enabled: lookupResponseEnabled,
    staleTime: Infinity,
    retry: false,
  });

  // Prefer the path actually resolved by the backend, which also supports an
  // advanced path expression. Before a configured preview runs, the simple
  // template path can still be shown without a network request.
  const resolvedLookupPath = useMemo(
    () =>
      backendResponseSample?.path ??
      (editor.isIntegrationBacked &&
      !hasAdvancedRequestPath &&
      lookupPathTemplate &&
      liveSourceValue
        ? resolveLookupPath(lookupPathTemplate, liveSourceValue)
        : undefined),
    [
      backendResponseSample?.path,
      editor.isIntegrationBacked,
      hasAdvancedRequestPath,
      lookupPathTemplate,
      liveSourceValue,
    ],
  );

  // Lookup setup state — drives the header "Setup required" pill and the
  // cogwheel warning dot. The request needs an integration + a path; matching
  // also needs a response field. A failed sample fetch counts as erroring.
  const lookupRequestConfigured =
    !!lookupIntegrationId?.trim() &&
    (!!lookupPathTemplate?.trim() || hasAdvancedRequestPath);
  const lookupErroring = Boolean(
    lookupResponseQuery.error ||
    (responseMatchExpression && editor.previewError),
  );
  const lookupConfigIncomplete =
    !lookupRequestConfigured || !responseMatchExpression || lookupErroring;
  // HTTP status + the integration's message from the last failed run, surfaced
  // in the Lookup config's Request tab (and the preview panel).
  const lookupRequestError = lookupResponseQuery.error
    ? {
        status:
          lookupResponseQuery.error instanceof ResponseError
            ? lookupResponseQuery.error.statusCode
            : undefined,
        message: formatErrorString(lookupResponseQuery.error),
      }
    : responseMatchExpression && editor.previewError
      ? { status: undefined, message: editor.previewError }
      : undefined;

  // The sampled response feeds the Response field's Field-mode picker. The
  // response body depends only on the request (integration/path/source value),
  // which is the query key — so once fetched it's valid until one of those
  // changes, independent of the match expression. Gating on the (matched-)
  // preview's freshness instead would drop the sample the moment you pick or
  // edit the match, since that marks the matched preview stale.
  const responseSample = backendResponseSample
    ? backendResponseSample.data
    : lookupResponseQuery.data?.data;
  const responseSampleReady =
    backendResponseSample !== undefined || lookupResponseQuery.data != null;
  const lookupUnavailableReason =
    responseSampleArmed && hasAdvancedRequestPath && !backendResponseSample
      ? 'Advanced request paths are resolved by the backend preview.'
      : responseSampleArmed && responseSampleRequest && !responseSourceValue
        ? 'No source value was produced for this sample.'
        : undefined;
  // Resolve the match against the sampled response + the value the two sides
  // joined on, so a match inside `items[*]` expands to the matched element.
  const responseMatchPath = resolveHighlightPath(
    responseMatchExpression,
    responseSample,
    targetMatchValue,
  );
  // One continuous loading state across both phases — running the preview and
  // then fetching the sampled response — so the lookup panel doesn't flash
  // twice. The last clause covers the gap after the query is enabled but before
  // it reports fetching (data still undefined), which would otherwise flash
  // "No response.".
  const lookupLoading =
    editor.previewLoading ||
    lookupResponseQuery.isFetching ||
    (lookupResponseEnabled &&
      !lookupResponseQuery.error &&
      lookupResponseQuery.data === undefined);

  // Picking a property from an object preview writes its accessor expression
  // straight into the matching field, so you can build the join by clicking.
  const pickResponseMatch = (expr: string) =>
    editor.setIntegrationConfig({
      ...(lookupConfig ?? DEFAULT_INTEGRATION_CONFIG),
      responseMatchExpression: expr,
    });

  const emptyFilterText =
    sampleFilter === 'matched'
      ? 'No matched samples.'
      : 'No unmatched samples.';
  const targetEmptyText = targetSample.object
    ? undefined
    : sourceEvaluationState === 'failed'
      ? 'Lookup failed for this source object.'
      : emptyFilteredPreview
        ? emptyFilterText
        : sourceEvaluationState === 'unmatched'
          ? 'No match for this source object.'
          : sourceEvaluationState === 'matched'
            ? 'Matched target could not be loaded.'
            : 'No target examples in this data source.';
  const matchEmptyText =
    sourceEvaluationState === 'needs-preview'
      ? editor.isIntegrationBacked
        ? 'Run preview to evaluate this source.'
        : editor.previewLoading
          ? 'Evaluating this source…'
          : 'Complete the rule to evaluate this source.'
      : sourceEvaluationState === 'failed'
        ? 'Lookup failed for this source.'
        : emptyFilteredPreview
          ? emptyFilterText
          : sourceEvaluationState === 'browsing'
            ? 'No preview match yet'
            : 'No match for this sample';
  const pendingEvaluationLabel =
    sourceEvaluationState === 'needs-preview'
      ? editor.isIntegrationBacked
        ? 'Run to test'
        : editor.previewLoading
          ? 'Evaluating'
          : 'Example only'
      : undefined;

  return {
    // Sample navigation (drives SampleObjectControls + the target stepper).
    sampleFilter,
    selectSampleFilter,
    pinnedSourceId,
    selectSourceObject,
    sourceEvaluationState,
    pendingEvaluationLabel,
    counts,
    candidatePosition: candidateItems.length ? clampedIndex + 1 : 0,
    candidateTotal: candidateItems.length,
    stepSample,
    targetPosition: clampedTargetIndex + 1,
    targetMatchCount: targetMatchIds.length,
    stepTarget,

    // Source column.
    sourceSample,
    sourceHighlightPath,
    sourceAdvanced,
    sourceFieldLeaf,
    sampleFieldEmpty,

    // Target column.
    targetSample,
    targetHighlightPath,
    targetAdvanced,
    targetEmptyText,
    targetShowingExample:
      (sourceEvaluationState === 'browsing' ||
        sourceEvaluationState === 'needs-preview') &&
      !!targetSample.object,

    // Match summary connector.
    sourceMatchValue,
    targetMatchValue,
    matchEmptyText,

    // Lookup column + config.
    lookupMethod,
    resolvedLookupPath,
    lookupLoading,
    lookupErroring,
    lookupRequestError,
    lookupRequestConfigured,
    lookupConfigIncomplete,
    lookupUnavailableReason,
    responseAdvanced,
    responseSample,
    responseSampleReady,
    responseSampleArmed,
    responseMatchPath,
    pickResponseMatch,
  };
}
