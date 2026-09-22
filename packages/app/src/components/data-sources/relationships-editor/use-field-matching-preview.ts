import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type {
  RelationshipRuleMatchStrategy,
  RelationshipRulePreviewInput,
  RelationshipRulePreviewOptions,
  RelationshipRulePreviewResult,
} from '../../../api/datastore/datastore-client';
import { formatErrorString } from '../../../api/workflow/parse-execution-error';
import { workspaceQueryKey } from '../../../api/workspace-scope';

const PREVIEW_LIMIT = 25;
const PREVIEW_DEBOUNCE_MS = 400;

interface FieldMatchingPreviewArgs {
  open: boolean;
  isIntegrationBacked: boolean;
  hasPreviewInputs: boolean;
  sourceDatasourceId: string;
  targetDatasourceId: string;
  sourceFieldExpression: string;
  targetFieldExpression: string;
  sourceFilterExpression: string;
  targetFilterExpression: string;
  relationshipType: string;
  matchStrategy: RelationshipRuleMatchStrategy;
  sourceObjectId: string | null;
  onPreview?: (
    input: RelationshipRulePreviewInput,
    options?: RelationshipRulePreviewOptions,
  ) => Promise<RelationshipRulePreviewResult>;
}

/**
 * Field-matching preview: auto-runs on debounced inputs via React Query. A stale
 * response lands on its own cache entry (no generation guard needed) and
 * `keepPreviousData` keeps the last result on screen while the next one loads.
 * `fresh` reports a result that reflects the *current* inputs — debounce settled,
 * not a placeholder, no refetch in flight — which is what gates Save.
 */
export function useFieldMatchingPreview({
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
  sourceObjectId,
  onPreview,
}: FieldMatchingPreviewArgs) {
  const previewParams = useMemo(
    () => ({
      sourceDatasourceId,
      targetDatasourceId,
      sourceFieldExpression: sourceFieldExpression.trim(),
      targetFieldExpression: targetFieldExpression.trim(),
      sourceFilterExpression: sourceFilterExpression.trim(),
      targetFilterExpression: targetFilterExpression.trim(),
      relationshipType: relationshipType.trim(),
      matchStrategy,
      sourceObjectId,
    }),
    [
      sourceDatasourceId,
      targetDatasourceId,
      sourceFieldExpression,
      targetFieldExpression,
      sourceFilterExpression,
      targetFilterExpression,
      relationshipType,
      matchStrategy,
      sourceObjectId,
    ],
  );
  const liveKey = `${previewParams.sourceFieldExpression}|${previewParams.targetFieldExpression}|${previewParams.sourceFilterExpression}|${previewParams.targetFilterExpression}|${previewParams.relationshipType}|${previewParams.matchStrategy}|${previewParams.sourceObjectId ?? ''}`;
  const [debouncedParams, setDebouncedParams] = useState(previewParams);
  useEffect(() => {
    const handle = setTimeout(
      () => setDebouncedParams(previewParams),
      PREVIEW_DEBOUNCE_MS,
    );
    return () => clearTimeout(handle);
  }, [previewParams]);

  const debouncedKey = `${debouncedParams.sourceFieldExpression}|${debouncedParams.targetFieldExpression}|${debouncedParams.sourceFilterExpression}|${debouncedParams.targetFilterExpression}|${debouncedParams.relationshipType}|${debouncedParams.matchStrategy}|${debouncedParams.sourceObjectId ?? ''}`;
  const enabled = Boolean(
    open &&
    onPreview &&
    !isIntegrationBacked &&
    debouncedParams.sourceFieldExpression.length > 0 &&
    debouncedParams.targetFieldExpression.length > 0 &&
    debouncedParams.relationshipType.length > 0,
  );
  const previewQuery = useQuery({
    queryKey: workspaceQueryKey(
      'relationshipRules',
      'preview',
      debouncedParams.sourceDatasourceId,
      debouncedParams.targetDatasourceId,
      debouncedParams.sourceFieldExpression,
      debouncedParams.targetFieldExpression,
      debouncedParams.sourceFilterExpression,
      debouncedParams.targetFilterExpression,
      debouncedParams.relationshipType,
      debouncedParams.matchStrategy,
      debouncedParams.sourceObjectId,
    ),
    queryFn: () => {
      const { sourceObjectId, ...ruleParams } = debouncedParams;
      return onPreview!(
        {
          ...ruleParams,
          sourceFilterExpression:
            debouncedParams.sourceFilterExpression || undefined,
          targetFilterExpression:
            debouncedParams.targetFilterExpression || undefined,
        },
        {
          limit: PREVIEW_LIMIT,
          sourceObjectId: sourceObjectId ?? undefined,
        },
      );
    },
    enabled,
    placeholderData: keepPreviousData,
  });

  // Still typing: the debounced inputs haven't caught up to the live ones yet.
  const typing = hasPreviewInputs && debouncedKey !== liveKey;
  const result = enabled ? (previewQuery.data ?? null) : null;
  const fresh =
    enabled &&
    result !== null &&
    !typing &&
    !previewQuery.isFetching &&
    !previewQuery.isPlaceholderData;
  const loading = enabled && (typing || previewQuery.isFetching);
  const error =
    enabled && previewQuery.error
      ? formatErrorString(previewQuery.error)
      : null;

  return { result, fresh, loading, error };
}
