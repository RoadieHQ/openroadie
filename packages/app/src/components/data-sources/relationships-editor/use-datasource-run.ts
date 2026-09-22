import { useCallback, useEffect, useRef, useState } from 'react';
import { useAlert, useDatastore, useWorkflows } from '../../../api';
import type { DatastoreSchema } from '../../../api/datastore/datastore-client';
import { formatErrorString } from '../../../api/workflow/parse-execution-error';
import {
  isRunAlreadyInProgress,
  RUN_ALREADY_IN_PROGRESS_MESSAGE,
} from '../run-conflict';

interface UseDataSourceRunResult {
  /** Data sources with an ingestion run in flight. */
  runningIds: ReadonlySet<string>;
  /**
   * Schemas produced by runs in this session. A run reshapes the data source,
   * and the node needs the new fields immediately — so these are layered over
   * the fetched schemas rather than waiting for a refetch.
   */
  localSchemas: ReadonlyMap<string, DatastoreSchema>;
  /** Trigger a run and resolve once it finishes. Failures are toasted. */
  run: (datasourceId: string) => Promise<void>;
}

/**
 * Runs a data source's ingestion from the graph canvas, following the execution
 * to completion over SSE.
 *
 * Deliberately not React Query: this brackets a live stream (execute → follow
 * events → read the resulting schema), not a request. See the accepted
 * exceptions in `.claude/rules/data-loading.md`.
 */
export function useDataSourceRun(): UseDataSourceRunResult {
  const api = useWorkflows();
  const datastoreApi = useDatastore();
  const alertApi = useAlert();

  const [runningIds, setRunningIds] = useState<ReadonlySet<string>>(new Set());
  const [localSchemas, setLocalSchemas] = useState<
    ReadonlyMap<string, DatastoreSchema>
  >(new Map());
  // Open stream teardowns, by data source id. A run that is still streaming
  // when we unmount must be closed or the connection outlives the component.
  const cleanupRefs = useRef<Map<string, () => void>>(new Map());

  useEffect(() => {
    const refs = cleanupRefs.current;
    return () => {
      refs.forEach(cleanup => cleanup());
      refs.clear();
    };
  }, []);

  const run = useCallback(
    async (datasourceId: string) => {
      setRunningIds(prev => new Set(prev).add(datasourceId));
      try {
        const { executionId } = await api.executions.execute(datasourceId);

        await new Promise<void>((resolve, reject) => {
          // The stream can deliver a terminal event and an error; the first one
          // decides the outcome and closes the connection.
          let settled = false;
          const finish = (outcome: () => void) => {
            if (settled) {
              return;
            }
            settled = true;
            cleanupRefs.current.get(datasourceId)?.();
            cleanupRefs.current.delete(datasourceId);
            outcome();
          };

          const cleanup = api.streaming.streamExecution(
            executionId,
            event => {
              if (event.type === 'execution-completed') {
                finish(resolve);
              } else if (
                event.type === 'execution-error' ||
                event.type === 'execution-cancelled'
              ) {
                const message =
                  event.type === 'execution-error'
                    ? 'Execution failed'
                    : 'Execution cancelled';
                finish(() => reject(new Error(message)));
              }
            },
            error => finish(() => reject(error)),
          );
          cleanupRefs.current.set(datasourceId, cleanup);
        });

        const updatedSchema = await datastoreApi.getLatestSchema(datasourceId);
        if (updatedSchema) {
          setLocalSchemas(prev =>
            new Map(prev).set(datasourceId, updatedSchema),
          );
        }
      } catch (error) {
        if (isRunAlreadyInProgress(error)) {
          alertApi.post({
            message: RUN_ALREADY_IN_PROGRESS_MESSAGE,
            severity: 'info',
            display: 'transient',
          });
        } else {
          alertApi.post({
            message: `Run failed: ${formatErrorString(error)}`,
            severity: 'error',
          });
        }
      } finally {
        setRunningIds(prev => {
          const next = new Set(prev);
          next.delete(datasourceId);
          return next;
        });
      }
    },
    [api, datastoreApi, alertApi],
  );

  return { runningIds, localSchemas, run };
}
