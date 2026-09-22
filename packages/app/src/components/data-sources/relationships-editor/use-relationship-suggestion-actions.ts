import { useCallback, useMemo, useState } from 'react';
import {
  resolveRelationshipsSuggestionProducer,
  useAgent,
  useAlert,
  useAppConfig,
  useDatastore,
} from '../../../api';
import type { FieldMatchSuggestion } from '../../../api/datastore/datastore-client';
import { queryKeys } from '../../../api/queries';
import { useInvalidatingMutation } from '../../../api/query-hooks';
import { formatErrorString } from '../../../api/workflow/parse-execution-error';

const RELATIONSHIP_SUGGESTION_AGENT = 'relationship-suggestion-agent';

/**
 * Generate relationship suggestions (AI agent or backend batch). The rules
 * catalog refreshes via the mutations' cache invalidation.
 */
export function useRelationshipSuggestionActions() {
  const datastoreApi = useDatastore();
  const agentApi = useAgent();
  const alertApi = useAlert();
  const appConfig = useAppConfig();
  const suggestionProducer = useMemo(
    () => resolveRelationshipsSuggestionProducer(appConfig),
    [appConfig],
  );
  // Ephemeral UI state for the "suppressed this run" panel section — not
  // server state (data-loading.md), so a plain useState rather than React
  // Query: it describes what the last Generate call returned, not anything
  // durable the backend owns.
  const [lastRunSuppressed, setLastRunSuppressed] = useState<
    FieldMatchSuggestion[]
  >([]);
  const clearLastRunSuppressed = useCallback(() => {
    setLastRunSuppressed([]);
  }, []);

  // Batch suggestion. AI partial failure throws (surfaced by the caller's catch
  // as the generic "Suggest failed" toast, matching prior behavior).
  const suggestForAllMutation = useInvalidatingMutation({
    mutationFn: async (datasourceIds: string[]) => {
      if (suggestionProducer === 'ai') {
        const results = await Promise.all(
          datasourceIds.map(datasourceId =>
            agentApi.call({
              agentName: RELATIONSHIP_SUGGESTION_AGENT,
              // The run is scoped to the selected set, so the query names the
              // allowed targets — `query` is the only field agentApi.call
              // sends (its `context` option is silently dropped). Scope
              // enforcement still depends on the agent honoring
              // targetDatasourceIds; the backend producer enforces it
              // server-side.
              query: {
                datasourceId,
                targetDatasourceIds: datasourceIds.filter(
                  id => id !== datasourceId,
                ),
              },
            }),
          ),
        );
        const failure = results.find(result => !result.success);
        if (failure) {
          throw new Error(failure.error ?? 'Relationship suggestion failed');
        }
        return { producer: 'ai' as const };
      }
      const result =
        await datastoreApi.suggestRelationshipsBatch(datasourceIds);
      return {
        producer: 'backend' as const,
        createdCount: result.createdRules.length,
        // Response order across datasources; the AI producer never
        // populates this (no suppressed data is computed for that path).
        suppressed: result.results.flatMap(r => r.suppressedSuggestions ?? []),
      };
    },
    invalidates: [
      queryKeys.relationshipRules,
      queryKeys.dataSourceDetailsPrefix,
    ],
  });
  const { mutateAsync: mutateSuggestForAll } = suggestForAllMutation;

  const suggestForAllDatasourceIds = useCallback(
    async (datasourceIds: string[]) => {
      if (datasourceIds.length === 0) {
        alertApi.post({
          message: 'No enabled data sources are available for suggestions',
          severity: 'info',
          display: 'transient',
        });
        return;
      }

      try {
        const outcome = await mutateSuggestForAll(datasourceIds);
        const createdCount =
          outcome.producer === 'backend' ? outcome.createdCount : null;
        // Explicit on both branches — "AI leaves it empty" is a guarantee,
        // not just the AI branch happening never to write to it.
        setLastRunSuppressed(
          outcome.producer === 'backend' ? outcome.suppressed : [],
        );
        if (createdCount === 0) {
          alertApi.post({
            message: 'No new relationship suggestions found',
            severity: 'info',
            display: 'transient',
          });
        } else {
          alertApi.post({
            message: 'Relationship suggestions generated',
            severity: 'success',
            display: 'transient',
          });
        }
      } catch (error) {
        // A failed backend run must not leave a stale suppressed section
        // from a previous run showing under this run's error state. The AI
        // path never sets lastRunSuppressed to begin with, so it's already
        // clear by construction and needs no handling here.
        if (suggestionProducer === 'api') {
          setLastRunSuppressed([]);
        }
        alertApi.post({
          message: `Suggest failed: ${formatErrorString(error)}`,
          severity: 'error',
        });
      }
    },
    [mutateSuggestForAll, alertApi, suggestionProducer],
  );

  return {
    suggestForAllDatasourceIds,
    suggestionProducer,
    lastRunSuppressed,
    clearLastRunSuppressed,
  };
}
