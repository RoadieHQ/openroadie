import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  NODE_TYPES,
  SINK_NODE_TYPES,
  WorkflowDefinition,
  WorkflowRequestLog,
  ExecutionLog,
} from '../../api/workflow/workflow-client';
import type { JsonValue } from '../../types';
import type { SourceType, TriggerType, PipelineStep, SinkStep } from './types';
import type { SourceConfig } from './data-source-editor/data-source-editor-context';
import { extractPathParams } from './data-source-editor/sources/integration-path-suggestions';
import {
  buildSuggestedDataSourceNameFromPipeline,
  isAutoNamedDataSourceDraft,
} from './data-source-name';
import { getResourceModelJsonError } from './data-source-editor/sources/resource-model-json';
import { parseRequestBodyText } from './request-body';
import { hydrateConfigHeaders, toHeaderPairs } from './request-headers';
import {
  formatInvalidAwsAccountIdsMessage,
  getInvalidAwsAccountIds,
} from '../integrations/aws-config';
import {
  hasDynamicAwsAccountSelection,
  isAwsSourceConfigured,
} from './aws-source-configured';

function clearDownstreamOutputs(
  transforms: PipelineStep[],
  targetId: string,
  setNodeOutputs: React.Dispatch<
    React.SetStateAction<Record<string, unknown[]>>
  >,
) {
  const index = transforms.findIndex(t => t.id === targetId);
  if (index === -1) {
    return;
  }
  const keepIds = new Set([
    'source-node',
    ...transforms.slice(0, index).map(t => t.id),
  ]);
  setNodeOutputs(outputs =>
    Object.fromEntries(
      Object.entries(outputs).filter(([key]) => keepIds.has(key)),
    ),
  );
}

interface UseDataSourceStateOptions {
  workflow: WorkflowDefinition | undefined;
}

export function useDataSourceState({ workflow }: UseDataSourceStateOptions) {
  const initialWorkflowName = workflow?.name || 'New Pipeline';
  const [searchQuery, setSearchQuery] = useState('');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [nodeErrors, setNodeErrors] = useState<Record<string, string>>({});
  const [runningNodes, setRunningNodes] = useState<Set<string>>(new Set());
  const [workflowNameState, setWorkflowNameState] =
    useState(initialWorkflowName);
  const autoDraftNameRef = useRef(
    isAutoNamedDataSourceDraft(workflow) ? initialWorkflowName : null,
  );
  const lastSuggestedWorkflowNameRef = useRef(initialWorkflowName);
  const [isDirty, setIsDirty] = useState(false);
  const streamCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      // Intentionally reading ref at cleanup time to get latest cleanup function
      // eslint-disable-next-line react-hooks/exhaustive-deps
      streamCleanupRef.current?.();
    };
  }, []);

  const triggerNode = useMemo(() => {
    return workflow?.nodes.find(n => n.type === NODE_TYPES.TRIGGER_SCHEDULE);
  }, [workflow]);

  const initialTriggerType = useMemo((): TriggerType => 'schedule', []);

  const sourceNode = useMemo(() => {
    return workflow?.nodes.find(
      n =>
        n.type === NODE_TYPES.SOURCE_INTEGRATION ||
        n.type === NODE_TYPES.SOURCE_DATASTORE,
    );
  }, [workflow]);

  const initialSourceType = useMemo((): SourceType => {
    if (!sourceNode) {
      return null;
    }
    if (sourceNode.type === NODE_TYPES.SOURCE_DATASTORE) {
      return 'datastore';
    }
    const config = sourceNode.data?.config as
      | Record<string, unknown>
      | undefined;
    if (config?.backendType === 'aws') {
      return 'aws';
    }
    return 'http';
  }, [sourceNode]);

  const transformNodes = useMemo(() => {
    return (
      workflow?.nodes
        .filter(
          n =>
            n.type === 'transform-filter' ||
            n.type === 'transform-map' ||
            n.type === 'transform-flatmap' ||
            n.type === 'source-chained',
        )
        .sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0)) ?? []
    );
  }, [workflow]);

  const sinkNodes = useMemo(() => {
    return workflow?.nodes.filter(n => n.type === 'sink-datastore') ?? [];
  }, [workflow]);

  const [triggerType, setTriggerType] =
    useState<TriggerType>(initialTriggerType);
  const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>(
    () => {
      const defaults = {
        frequencyValue: 1,
        frequencyUnit: 'hours',
      };
      if (!triggerNode?.data.config) {
        return defaults;
      }
      return { ...defaults, ...triggerNode.data.config };
    },
  );
  const [sourceType, setSourceType] = useState<SourceType>(initialSourceType);
  const [sourceConfig, setSourceConfig] = useState<SourceConfig>(() => {
    if (!sourceNode?.data.config) {
      return {};
    }
    if (sourceNode.type === NODE_TYPES.SOURCE_DATASTORE) {
      return { ...sourceNode.data.config };
    }
    const defaults = {
      integrationId: '',
      path: '/users',
      method: 'GET',
      headers: [] as Array<{ key: string; value: string }>,
      arrayExpression: '$',
      objectIdExpression: 'id',
    };
    const config = { ...defaults, ...sourceNode.data.config };
    if (
      config.headers &&
      typeof config.headers === 'object' &&
      !Array.isArray(config.headers)
    ) {
      config.headers = toHeaderPairs(config.headers);
    }
    return config;
  });
  const [transforms, setTransforms] = useState<PipelineStep[]>(
    transformNodes.map(n => {
      let type: PipelineStep['type'];
      if (n.type === 'transform-filter') {
        type = 'filter';
      } else if (n.type === 'transform-flatmap') {
        type = 'flatmap';
      } else if (n.type === 'source-chained') {
        type = 'chained-source';
      } else {
        type = 'map';
      }
      return {
        id: n.id,
        type,
        config:
          type === 'chained-source'
            ? hydrateConfigHeaders(n.data.config)
            : n.data.config,
      };
    }),
  );
  const [sinks, setSinks] = useState<SinkStep[]>(() => {
    if (sinkNodes.length > 0) {
      return sinkNodes.map(n => ({
        id: n.id,
        type: SINK_NODE_TYPES.DATASTORE,
        config: n.data.config,
      }));
    }
    return [
      {
        id: `sink-${Date.now()}`,
        type: SINK_NODE_TYPES.DATASTORE,
        config: {},
      },
    ];
  });
  const [selectedSteps, setSelectedSteps] = useState<string[]>(['source']);
  const [expandedStep, setExpandedStep] = useState<string | null>('source');
  const [nodeOutputs, setNodeOutputs] = useState<Record<string, unknown[]>>({});
  const [confirmedSinkSchema, setConfirmedSinkSchema] = useState<
    Record<string, JsonValue | null>
  >(() => {
    const initial: Record<string, JsonValue | null> = {};
    for (const s of sinks) {
      if (s.config.schema) {
        initial[s.id] = s.config.schema as JsonValue;
      }
    }
    return initial;
  });
  const [previewLoading, setPreviewLoading] = useState(false);
  const [isPreviewRun, setIsPreviewRun] = useState(true);
  const [previewRequestLogs, setPreviewRequestLogs] = useState<
    WorkflowRequestLog[]
  >([]);
  const [previewLogs, setPreviewLogs] = useState<ExecutionLog[]>([]);
  const [previewExecutionId, setPreviewExecutionId] = useState<
    string | undefined
  >(undefined);
  const [hasRunPreview, setHasRunPreview] = useState(false);
  const [sourceSchemaVersion, setSourceSchemaVersion] = useState(0);
  const bumpSourceSchemaVersion = useCallback(() => {
    setSourceSchemaVersion(v => v + 1);
    setConfirmedSinkSchema({});
  }, []);

  const clearIsDirty = useCallback(() => {
    setIsDirty(false);
  }, []);

  const setWorkflowName = useCallback((name: string) => {
    if (
      autoDraftNameRef.current &&
      name !== lastSuggestedWorkflowNameRef.current
    ) {
      autoDraftNameRef.current = null;
    }
    setWorkflowNameState(name);
  }, []);

  useEffect(() => {
    const draftName = autoDraftNameRef.current;
    if (!draftName) {
      return;
    }
    if (workflowNameState !== lastSuggestedWorkflowNameRef.current) {
      autoDraftNameRef.current = null;
      return;
    }

    const nextName = buildSuggestedDataSourceNameFromPipeline({
      draftName,
      sourceConfig,
      transforms,
    });
    if (nextName === lastSuggestedWorkflowNameRef.current) {
      return;
    }

    lastSuggestedWorkflowNameRef.current = nextName;
    setWorkflowNameState(nextName);
  }, [sourceConfig, transforms, workflowNameState]);

  const handleTriggerConfigChange = useCallback(
    (field: string, value: unknown) => {
      setTriggerConfig(prev => ({ ...prev, [field]: value }));
      setIsDirty(true);
    },
    [],
  );

  const handleSourceConfigChange = useCallback(
    (field: string, value: unknown) => {
      setNodeOutputs(outputs => {
        const next = { ...outputs };
        delete next['source-node'];
        return next;
      });
      setSourceConfig(prev => ({ ...prev, [field]: value }));
      setIsDirty(true);
    },
    [],
  );

  const handleAddTransform = useCallback(
    (type: PipelineStep['type'], atIndex?: number) => {
      const newStep: PipelineStep = {
        id: `transform-${Date.now()}`,
        type,
        config: {},
      };
      setTransforms(prev => {
        if (atIndex !== undefined && atIndex >= 0 && atIndex <= prev.length) {
          const next = [...prev];
          next.splice(atIndex, 0, newStep);
          return next;
        }
        return [...prev, newStep];
      });
      setSelectedSteps([newStep.id]);
      setExpandedStep(newStep.id);
      setIsDirty(true);
    },
    [],
  );

  const handleAddChainedSource = useCallback((atIndex?: number) => {
    const newStep: PipelineStep = {
      id: `chained-source-${Date.now()}`,
      type: 'chained-source',
      config: {},
    };
    setTransforms(prev => {
      if (atIndex !== undefined && atIndex >= 0 && atIndex <= prev.length) {
        const next = [...prev];
        next.splice(atIndex, 0, newStep);
        return next;
      }
      return [...prev, newStep];
    });
    setSelectedSteps([newStep.id]);
    setExpandedStep(newStep.id);
    setIsDirty(true);
  }, []);

  const handleUpdateTransform = useCallback(
    (id: string, field: string, value: unknown) => {
      let changed = false;
      setTransforms(prev => {
        const target = prev.find(t => t.id === id);
        const targetConfig = (target?.config ?? {}) as Record<string, unknown>;
        if (target && targetConfig[`${field}`] === value) {
          return prev;
        }
        changed = true;
        clearDownstreamOutputs(prev, id, setNodeOutputs);
        return prev.map(t =>
          t.id === id ? { ...t, config: { ...t.config, [field]: value } } : t,
        );
      });
      if (changed) {
        setIsDirty(true);
      }
    },
    [],
  );

  const handleDeleteTransform = useCallback((id: string) => {
    setTransforms(prev => {
      clearDownstreamOutputs(prev, id, setNodeOutputs);
      return prev.filter(t => t.id !== id);
    });
    setIsDirty(true);
  }, []);

  const handleUpdateSink = useCallback(
    (id: string, field: string, value: unknown) => {
      setSinks(prev =>
        prev.map(s =>
          s.id === id ? { ...s, config: { ...s.config, [field]: value } } : s,
        ),
      );
      setIsDirty(true);
    },
    [],
  );

  const handleDeleteSink = useCallback((id: string) => {
    let removed = false;
    setSinks(prev => {
      if (prev.length <= 1) {
        return prev;
      }
      removed = true;
      return prev.filter(s => s.id !== id);
    });
    setConfirmedSinkSchema(prev => {
      if (!Object.hasOwn(prev, id)) {
        return prev;
      }
      return Object.fromEntries(
        Object.entries(prev).filter(([key]) => key !== id),
      );
    });
    if (removed) {
      setIsDirty(true);
    }
  }, []);

  const handleAddTrigger = useCallback((type: 'schedule') => {
    setTriggerType(type);
    setTriggerConfig({
      frequencyValue: 1,
      frequencyUnit: 'hours',
    });
    setSelectedSteps(['trigger']);
    setExpandedStep('trigger');
    setIsDirty(true);
  }, []);

  const markChanged = useCallback(() => {
    setIsDirty(true);
  }, []);

  const isSourceConfigured = useMemo(() => {
    if (!sourceType) {
      return false;
    }
    if (sourceType === 'datastore') {
      return (
        typeof sourceConfig.datasourceId === 'string' &&
        sourceConfig.datasourceId.length > 0
      );
    }
    if (sourceType === 'http') {
      if (!sourceConfig.integrationId) {
        return false;
      }
      if (sourceConfig.mode === 'graphql') {
        const query = sourceConfig.graphqlQuery;
        return typeof query === 'string' && query.trim().length > 0;
      }
      if (!sourceConfig.path) {
        return false;
      }
      if (sourceConfig.pathTemplate) {
        const params = extractPathParams(sourceConfig.pathTemplate as string);
        const pathParamsVal = (sourceConfig.pathParams || {}) as Record<
          string,
          string
        >;
        const pathParamsMap = new Map(Object.entries(pathParamsVal));
        if (params.some(p => !pathParamsMap.get(p))) {
          return false;
        }
      }
      if (sourceConfig.method === 'POST') {
        const bodyResult = parseRequestBodyText(
          sourceConfig.bodyText as string | undefined,
        );
        if (!bodyResult.ok) {
          return false;
        }
      }
      return true;
    }
    if (sourceType === 'aws') {
      return isAwsSourceConfigured(sourceConfig);
    }
    return false;
  }, [sourceType, sourceConfig]);

  const sourceMissingReason = useMemo<string | undefined>(() => {
    if (!sourceType) {
      return 'Select an integration';
    }
    if (sourceType === 'datastore') {
      return typeof sourceConfig.datasourceId === 'string' &&
        sourceConfig.datasourceId.length > 0
        ? undefined
        : 'Select a data source';
    }
    if (sourceType === 'http') {
      if (!sourceConfig.integrationId) {
        return 'Select an integration';
      }
      if (sourceConfig.mode === 'graphql') {
        const query = sourceConfig.graphqlQuery;
        if (typeof query !== 'string' || query.trim().length === 0) {
          return 'Add a GraphQL query';
        }
        return undefined;
      }
      if (!sourceConfig.path) {
        return 'Add an API path';
      }
      if (sourceConfig.pathTemplate) {
        const params = extractPathParams(sourceConfig.pathTemplate as string);
        const pathParamsMap = new Map(
          Object.entries(
            (sourceConfig.pathParams || {}) as Record<string, string>,
          ),
        );
        const missing = params.filter(p => !pathParamsMap.get(p));
        if (missing.length > 0) {
          return `Fill in path parameter${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`;
        }
      }
      if (sourceConfig.method === 'POST') {
        const bodyResult = parseRequestBodyText(
          sourceConfig.bodyText as string | undefined,
        );
        if (!bodyResult.ok) {
          return 'Fix the request body JSON';
        }
      }
      return undefined;
    }
    if (sourceType === 'aws') {
      if (sourceConfig.mode === 'configured-accounts') {
        return undefined;
      }
      const invalidAccountIds = [
        ...getInvalidAwsAccountIds(
          (sourceConfig.accountIds as string[] | undefined) ?? [],
        ),
        ...getInvalidAwsAccountIds(
          (
            sourceConfig.accountSelection as
              | { excludedAccountIds?: string[] }
              | undefined
          )?.excludedAccountIds ?? [],
        ),
      ];
      const invalidAccountIdsMessage =
        formatInvalidAwsAccountIdsMessage(invalidAccountIds);
      if (invalidAccountIdsMessage) {
        return invalidAccountIdsMessage;
      }

      const hasAccountTargets =
        Boolean((sourceConfig.accountIds as string[] | undefined)?.length) ||
        hasDynamicAwsAccountSelection(sourceConfig);
      const awsMode =
        sourceConfig.mode === 'service-api' ? 'service-api' : 'cloud-control';
      if (awsMode === 'service-api') {
        if (!hasAccountTargets) {
          return 'Select at least one AWS account';
        }
        if (!sourceConfig.service) {
          return 'Select a service';
        }
        if (!sourceConfig.operation) {
          return 'Select an operation';
        }
        return undefined;
      }
      if (!hasAccountTargets) {
        return 'Select at least one AWS account';
      }
      if (!sourceConfig.resourceType) {
        return 'Select a resource type';
      }
      if (getResourceModelJsonError(sourceConfig.resourceModel)) {
        return 'Fix invalid JSON in the advanced filter field';
      }
      return undefined;
    }
    return undefined;
  }, [sourceType, sourceConfig]);

  const sourceOutput = useMemo(() => nodeOutputs['source-node'], [nodeOutputs]);

  const finalOutput = useMemo(() => {
    if (nodeOutputs['committed-output']) {
      return nodeOutputs['committed-output'];
    }
    if (transforms.length === 0) {
      return sourceOutput;
    }
    const lastTransform = transforms[transforms.length - 1];
    return nodeOutputs[lastTransform.id];
  }, [nodeOutputs, sourceOutput, transforms]);

  const allStepIds = useMemo(() => {
    return [
      ...(triggerType ? ['trigger'] : []),
      'source',
      ...transforms.map(t => t.id),
      ...sinks.map(s => s.id),
    ];
  }, [triggerType, transforms, sinks]);

  const handleStepClick = useCallback(
    (stepId: string, shiftKey: boolean) => {
      if (shiftKey && selectedSteps.length > 0) {
        const lastSelectedId = selectedSteps[selectedSteps.length - 1];
        const lastIndex = allStepIds.indexOf(lastSelectedId);
        const clickedIndex = allStepIds.indexOf(stepId);

        if (lastIndex !== -1 && clickedIndex !== -1) {
          const startIdx = Math.min(lastIndex, clickedIndex);
          const endIdx = Math.max(lastIndex, clickedIndex);
          const rangeIds = allStepIds.slice(startIdx, endIdx + 1);
          const newSelection = [...new Set([...selectedSteps, ...rangeIds])];
          newSelection.sort(
            (a, b) => allStepIds.indexOf(a) - allStepIds.indexOf(b),
          );
          setSelectedSteps(newSelection);
          if (!expandedStep) {
            setExpandedStep(newSelection[0]);
          }
          return;
        }
      }
      if (selectedSteps.length === 1 && selectedSteps[0] === stepId) {
        setExpandedStep(expandedStep === stepId ? null : stepId);
      } else {
        setSelectedSteps([stepId]);
        setExpandedStep(stepId);
      }
    },
    [selectedSteps, allStepIds, expandedStep],
  );

  return {
    searchQuery,
    setSearchQuery,
    previewError,
    setPreviewError,
    nodeErrors,
    setNodeErrors,
    runningNodes,
    setRunningNodes,
    workflowName: workflowNameState,
    setWorkflowName,
    triggerType,
    setTriggerType,
    triggerConfig,
    setTriggerConfig,
    sourceType,
    setSourceType,
    sourceConfig,
    setSourceConfig,
    transforms,
    setTransforms,
    sinks,
    setSinks,
    selectedSteps,
    setSelectedSteps,
    expandedStep,
    setExpandedStep,
    nodeOutputs,
    setNodeOutputs,
    confirmedSinkSchema,
    setConfirmedSinkSchema,
    previewLoading,
    setPreviewLoading,
    isPreviewRun,
    setIsPreviewRun,
    previewRequestLogs,
    setPreviewRequestLogs,
    previewLogs,
    setPreviewLogs,
    previewExecutionId,
    setPreviewExecutionId,
    hasRunPreview,
    setHasRunPreview,

    streamCleanupRef,

    isSourceConfigured,
    sourceMissingReason,
    sourceOutput,
    finalOutput,
    isDirty,

    clearIsDirty,
    handleAddTrigger,
    handleTriggerConfigChange,
    handleSourceConfigChange,
    handleAddTransform,
    handleAddChainedSource,
    handleUpdateTransform,
    handleDeleteTransform,
    handleUpdateSink,
    handleDeleteSink,
    markChanged,
    sourceSchemaVersion,
    bumpSourceSchemaVersion,
    allStepIds,
    handleStepClick,
  };
}
