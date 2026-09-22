import { useCallback, useMemo, MutableRefObject } from 'react';
import {
  WorkflowDefinition,
  UpdateWorkflowInput,
  WorkflowNode,
  WorkflowEdge,
  ExecutionEvent,
  PREVIEW_ITEM_LIMIT,
  WorkflowRequestLog,
  ExecutionLog,
} from '../../api/workflow/workflow-client';
import type { WorkflowClient } from '../../api';
import { normalizeExecutionOutput } from './data-source-editor/normalize-execution-output';
import type { SinkSchemaOverride } from './data-source-editor/data-source-editor-context';
import { formatErrorString } from '../../api/workflow/parse-execution-error';

interface UseDataSourceExecutionOptions {
  workflowApi: WorkflowClient;
  workflowName: string;
  buildWorkflowNodes: (override?: SinkSchemaOverride) => WorkflowNode[];
  buildWorkflowEdges: (override?: SinkSchemaOverride) => WorkflowEdge[];
  onSave: (input: UpdateWorkflowInput) => Promise<WorkflowDefinition>;
  onExecute: () => Promise<{ executionId: string }>;
  streamCleanupRef: MutableRefObject<(() => void) | null>;
  setPreviewLoading: (loading: boolean) => void;
  setPreviewError: (error: string | null) => void;
  setNodeOutputs: (
    fn: (prev: Record<string, unknown[]>) => Record<string, unknown[]>,
  ) => void;
  setNodeErrors: (
    fn: (prev: Record<string, string>) => Record<string, string>,
  ) => void;
  setRunningNodes: (fn: (prev: Set<string>) => Set<string>) => void;
  setIsPreviewRun: (isPreview: boolean) => void;
  setPreviewRequestLogs: (
    fn: (prev: WorkflowRequestLog[]) => WorkflowRequestLog[],
  ) => void;
  setPreviewLogs: (fn: (prev: ExecutionLog[]) => ExecutionLog[]) => void;
  setPreviewExecutionId: (id: string | undefined) => void;
  setHasRunPreview: (value: boolean) => void;
  clearIsDirty: () => void;
}

export function useDataSourceExecution({
  workflowApi,
  workflowName,
  buildWorkflowNodes,
  buildWorkflowEdges,
  onSave,
  onExecute,
  streamCleanupRef,
  setPreviewLoading,
  setPreviewError,
  setNodeOutputs,
  setNodeErrors,
  setRunningNodes,
  setIsPreviewRun,
  setPreviewRequestLogs,
  setPreviewLogs,
  setPreviewExecutionId,
  setHasRunPreview,
  clearIsDirty,
}: UseDataSourceExecutionOptions) {
  const handleSave = useCallback(
    async (inputOverrides?: Partial<UpdateWorkflowInput>) => {
      const nodes = buildWorkflowNodes();
      const edges = buildWorkflowEdges();
      const saved = await onSave({
        name: workflowName,
        nodes,
        edges,
        ...inputOverrides,
      });
      if (!(saved instanceof Error)) {
        clearIsDirty();
      }
      return saved;
    },
    [
      buildWorkflowNodes,
      buildWorkflowEdges,
      onSave,
      workflowName,
      clearIsDirty,
    ],
  );

  const streamExecution = useCallback(
    async (executionId: string) => {
      const cleanup = await workflowApi.streaming.streamExecutionAsync(
        executionId,
        (event: ExecutionEvent) => {
          if (event.type === 'node-started') {
            setRunningNodes(prev => new Set([...prev, event.nodeId]));
          }
          if (event.type === 'node-completed') {
            setRunningNodes(prev => {
              const next = new Set(prev);
              next.delete(event.nodeId);
              return next;
            });
            if (event.output !== undefined) {
              const normalized = normalizeExecutionOutput(event.output);
              if (!normalized) {
                return;
              }
              setNodeOutputs(prev => ({
                ...prev,
                [event.nodeId]: normalized,
              }));
            }
          }
          if (event.type === 'node-error') {
            setRunningNodes(prev => {
              const next = new Set(prev);
              next.delete(event.nodeId);
              return next;
            });
            setNodeErrors(prev => ({
              ...prev,
              [event.nodeId]: formatErrorString(event.error) || 'Failed',
            }));
          }
          if (event.type === 'http-request') {
            setPreviewRequestLogs(prev => [...prev, event.log]);
            const requestError = event.log.error;
            const requestStatus = event.log.status;
            const failed =
              !!requestError ||
              (typeof requestStatus === 'string' &&
                /^[45]/.test(requestStatus));
            if (failed && event.log.nodeId) {
              const failedNodeId = event.log.nodeId;
              const message =
                requestError || `HTTP ${requestStatus ?? 'request failed'}`;
              setNodeErrors(prev =>
                Object.hasOwn(prev, failedNodeId)
                  ? prev
                  : { ...prev, [failedNodeId]: message },
              );
            }
          }
          if (event.type === 'log') {
            setPreviewLogs(prev => [
              ...prev,
              {
                id: prev.length,
                executionId: event.executionId,
                nodeId: event.nodeId,
                level: event.level,
                message: event.message,
                metadata: event.metadata,
                createdAt: event.timestamp,
              },
            ]);
            if (event.level === 'error' && event.nodeId) {
              const errorNodeId = event.nodeId;
              const message = event.message;
              setNodeErrors(prev =>
                Object.hasOwn(prev, errorNodeId)
                  ? prev
                  : { ...prev, [errorNodeId]: message },
              );
            }
          }
          if (
            event.type === 'execution-completed' ||
            event.type === 'execution-error' ||
            event.type === 'execution-cancelled'
          ) {
            setPreviewLoading(false);
            setRunningNodes(() => new Set());
            if (event.type === 'execution-error') {
              setPreviewError(
                (event as ExecutionEvent & { error?: string }).error ||
                  'Execution failed',
              );
            }
            if (event.type === 'execution-cancelled') {
              setPreviewError('Execution was cancelled');
            }
            cleanup();
            streamCleanupRef.current = null;
          }
        },
        (error: Error) => {
          setPreviewError(error.message);
          setPreviewLoading(false);
          setRunningNodes(() => new Set());
        },
      );
      streamCleanupRef.current = cleanup;
    },
    [
      workflowApi,
      streamCleanupRef,
      setPreviewLoading,
      setPreviewError,
      setNodeOutputs,
      setNodeErrors,
      setRunningNodes,
      setPreviewRequestLogs,
      setPreviewLogs,
    ],
  );

  const handleRun = useCallback(
    async (
      dryRun: boolean = true,
      signal?: AbortSignal,
      sinkSchemaOverride?: SinkSchemaOverride,
    ) => {
      setPreviewLoading(true);
      setPreviewError(null);
      setIsPreviewRun(dryRun);
      setNodeOutputs(() => ({}));
      setNodeErrors(() => ({}));
      setRunningNodes(() => new Set());
      setPreviewRequestLogs(() => []);
      setPreviewLogs(() => []);
      setPreviewExecutionId(undefined);
      setHasRunPreview(true);
      // Don't reset the user's focused step on dry run — if they're working
      // on the Map step and hit Dry Run, they want to see Map's output, not
      // jump back to Source.

      try {
        streamCleanupRef.current?.();

        let executionId: string;
        if (dryRun) {
          const nodes = buildWorkflowNodes(sinkSchemaOverride);
          const edges = buildWorkflowEdges(sinkSchemaOverride);
          const result = await workflowApi.executions.executeDryRun(
            { nodes, edges, previewLimit: PREVIEW_ITEM_LIMIT },
            { signal },
          );
          executionId = result.executionId;
        } else {
          const result = await onExecute();
          executionId = result.executionId;
        }

        setPreviewExecutionId(executionId);
        await streamExecution(executionId);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        setPreviewError(error instanceof Error ? error.message : 'Failed');
        setPreviewLoading(false);
        setRunningNodes(() => new Set());
      }
    },
    [
      onExecute,
      workflowApi,
      buildWorkflowNodes,
      buildWorkflowEdges,
      streamCleanupRef,
      streamExecution,
      setPreviewLoading,
      setPreviewError,
      setIsPreviewRun,
      setNodeOutputs,
      setNodeErrors,
      setRunningNodes,
      setPreviewRequestLogs,
      setPreviewLogs,
      setPreviewExecutionId,
      setHasRunPreview,
    ],
  );

  return useMemo(() => ({ handleSave, handleRun }), [handleSave, handleRun]);
}
