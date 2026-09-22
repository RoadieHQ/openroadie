import React, { useCallback, useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { integrationDetailQuery } from '../../../api/queries';
import type { Integration } from '../../integrations/types';
import {
  ArrowRightLeft,
  Blocks,
  Clock,
  Database,
  Filter,
  Link,
  MoreHorizontal,
  Split,
} from 'lucide-react';
import { IntegrationLogo } from '@roadiehq/ui/item-list';
import { Tabs, TabsContent } from '@roadiehq/ui/tabs';
import { useDataSourceEditorContext } from './data-source-editor-context';
import { LogsPanel, TrafficTable } from './execution-monitor';
import { ExecutionLog } from '../../../api/workflow/workflow-client';
import { InputOutputSchemaBlock } from './node-details-panel/input-output-schema-block';
import {
  DetailHeaderBlock,
  DetailTabBar,
  type StepInfo,
} from '../../common/pipeline-editor';
import { ErrorDisplay } from './error-display';
import {
  getServiceApiModeSubtitle,
  truncateNodeLabel,
} from './node-header-text';
import { getChainedSourceName } from './sources';
import type { StepStatus } from './step-components';
import { useLogoResolver } from '../use-resolved-logo';
import {
  LargePayloadAlert,
  largePayloadWarningFromLogs,
} from '../large-payload-warning';

/**
 * Wraps InputOutputSchemaBlock with internal tab state, seeded from
 * `defaultTab` on mount. Combine with `key={selectedStepId}` at the call
 * site so each step switch remounts the panel with a fresh default.
 */
function StepDataPanel({
  defaultTab,
  inputItems,
  outputItems,
  outputAsTable,
}: {
  defaultTab: 'input' | 'output';
  inputItems: unknown[] | undefined;
  outputItems: unknown[] | undefined;
  outputAsTable?: boolean;
}) {
  const [tab, setTab] = useState<'input' | 'output'>(defaultTab);
  return (
    <InputOutputSchemaBlock
      tab={tab}
      onTabChange={setTab}
      inputItems={inputItems}
      outputItems={outputItems}
      outputAsTable={outputAsTable}
    />
  );
}
type StepIconType =
  | 'schedule'
  | 'integration'
  | 'more'
  | 'transform'
  | 'flatmap'
  | 'link'
  | 'filter'
  | 'storage';

const SMALL_ICON_SIZE = 14;
const SMALL_STEP_ICONS: Record<StepIconType, React.ReactNode> = {
  schedule: <Clock size={SMALL_ICON_SIZE} />,
  integration: <Blocks size={SMALL_ICON_SIZE} />,
  more: <MoreHorizontal size={SMALL_ICON_SIZE} />,
  transform: <ArrowRightLeft size={SMALL_ICON_SIZE} />,
  flatmap: <Split size={SMALL_ICON_SIZE} />,
  link: <Link size={SMALL_ICON_SIZE} />,
  filter: <Filter size={SMALL_ICON_SIZE} />,
  storage: <Database size={SMALL_ICON_SIZE} />,
};

type DetailVariant = 'trigger' | 'source' | 'transform' | 'sink';

interface NodeDetail {
  iconType: StepIconType;
  variant: DetailVariant;
  title: string;
  subtitle: string;
  config: Record<string, unknown>;
  output: unknown[] | undefined;
  error: string | undefined;
}

export function NodeDetailsPanel() {
  const resolveLogoUrl = useLogoResolver();
  const {
    selectedSteps,
    setSelectedSteps,
    expandedStep,
    triggerType,
    triggerConfig,
    sourceType,
    sourceConfig,
    transforms,
    sinks,
    nodeOutputs,
    nodeErrors,
    runningNodes,
    sourceOutput,
    finalOutput,
    workflowApi,
    previewRequestLogs,
    previewLogs,
    previewExecutionId,
    hasRunPreview,
    allStepIds,
    handleStepClick,
  } = useDataSourceEditorContext();

  // Local Maps so reads use .get() instead of bracket access on a Record
  // (the security/detect-object-injection rule fires on bracket access by a
  // non-literal key — Maps don't have prototype semantics so they're safe
  // by construction).
  const nodeOutputsMap = useMemo(
    () => new Map(Object.entries(nodeOutputs)),
    [nodeOutputs],
  );
  const nodeErrorsMap = useMemo(
    () => new Map(Object.entries(nodeErrors)),
    [nodeErrors],
  );

  // Treat the panel as multi-select only when the user hasn't explicitly
  // expanded a step. Dry Run selects all steps to drive node-graph animation,
  // but if the user is focused on a specific step (e.g. Map) we should keep
  // showing that step's input/output instead of the whole-pipeline view.
  const isMultiSelect = !expandedStep && selectedSteps.length > 1;
  const firstSelectedStep = selectedSteps[0] ?? 'source';
  const lastSelectedStep = selectedSteps[selectedSteps.length - 1] ?? 'source';

  const getStepName = useCallback(
    (stepId: string): string => {
      if (stepId === 'trigger') return 'Schedule';
      if (stepId === 'source') return 'Source';
      const transform = transforms.find(t => t.id === stepId);
      if (transform) {
        if (transform.type === 'chained-source') return 'Chained Source';
        if (transform.type === 'filter') return 'Filter';
        if (transform.type === 'map') return 'Map';
        if (transform.type === 'flatmap') return 'Flatmap';
      }
      const sink = sinks.find(s => s.id === stepId);
      if (sink) return 'Store';
      return 'Node';
    },
    [transforms, sinks],
  );

  const getStepVariant = useCallback(
    (stepId: string): 'trigger' | 'source' | 'transform' | 'sink' => {
      if (stepId === 'trigger') return 'trigger';
      if (stepId === 'source') return 'source';
      const transform = transforms.find(t => t.id === stepId);
      if (transform) {
        if (transform.type === 'chained-source') return 'source';
        return 'transform';
      }
      return 'sink';
    },
    [transforms],
  );

  // Unique integration ids referenced by the source and any chained sources.
  const integrationIds = useMemo(() => {
    const ids: string[] = [];
    if (sourceConfig.integrationId) {
      ids.push(String(sourceConfig.integrationId));
    }
    for (const t of transforms) {
      if (t.type === 'chained-source' && t.config.integrationId) {
        ids.push(String(t.config.integrationId));
      }
    }
    return Array.from(new Set(ids));
  }, [sourceConfig.integrationId, transforms]);

  const integrationQueries = useQueries({
    queries: integrationIds.map(id => integrationDetailQuery(workflowApi, id)),
  });

  // A missing/unreadable integration (query error or a null result) simply
  // yields no entry, so step icons fall back to the generic glyph.
  const integrations = useMemo(() => {
    const map = new Map<string, Integration>();
    integrationIds.forEach((id, index) => {
      const integration = integrationQueries[`${index}`]?.data;
      if (integration) {
        map.set(id, integration);
      }
    });
    return map;
  }, [integrationIds, integrationQueries]);

  const getStepIcon = useCallback(
    (stepId: string): React.ReactNode => {
      if (stepId === 'trigger') return SMALL_STEP_ICONS.schedule;
      if (stepId === 'source') {
        const integrationId = sourceConfig.integrationId
          ? String(sourceConfig.integrationId)
          : undefined;
        const integration = integrationId
          ? integrations.get(integrationId)
          : undefined;
        const sourceLogo = resolveLogoUrl(integration);
        if (sourceLogo) {
          return <IntegrationLogo src={sourceLogo} size={SMALL_ICON_SIZE} />;
        }
        return SMALL_STEP_ICONS.more;
      }
      const transform = transforms.find(t => t.id === stepId);
      if (transform) {
        if (transform.type === 'chained-source') {
          const integrationId = transform.config.integrationId
            ? String(transform.config.integrationId)
            : undefined;
          const integration = integrationId
            ? integrations.get(integrationId)
            : undefined;
          const chainedLogo = resolveLogoUrl(integration);
          if (chainedLogo) {
            return <IntegrationLogo src={chainedLogo} size={SMALL_ICON_SIZE} />;
          }
          return SMALL_STEP_ICONS.link;
        }
        if (transform.type === 'filter') return SMALL_STEP_ICONS.filter;
        if (transform.type === 'flatmap') return SMALL_STEP_ICONS.flatmap;
        return SMALL_STEP_ICONS.transform;
      }
      return SMALL_STEP_ICONS.storage;
    },
    [sourceConfig.integrationId, transforms, integrations, resolveLogoUrl],
  );

  const getStepStatus = useCallback(
    (stepId: string): StepStatus => {
      if (stepId === 'trigger') {
        return 'configured';
      }
      const nodeId = stepId === 'source' ? 'source-node' : stepId;
      if (nodeErrorsMap.get(nodeId)) {
        return 'error';
      }
      if (runningNodes.has(nodeId)) {
        return 'running';
      }
      if (Array.isArray(nodeOutputsMap.get(nodeId))) {
        return 'success';
      }
      return 'configured';
    },
    [nodeErrorsMap, runningNodes, nodeOutputsMap],
  );

  const stepsInfo: StepInfo[] = useMemo(() => {
    return allStepIds.map(id => ({
      id,
      name: getStepName(id),
      variant: getStepVariant(id),
      icon: getStepIcon(id),
      status: getStepStatus(id),
    }));
  }, [allStepIds, getStepName, getStepVariant, getStepIcon, getStepStatus]);

  const [activeTab, setActiveTab] = React.useState<
    'details' | 'traffic' | 'logs'
  >('details');

  const transformInputById = useMemo(() => {
    const inputById = new Map<string, unknown[] | undefined>();
    let currentData = sourceOutput;
    for (const transform of transforms) {
      inputById.set(transform.id, currentData);
      currentData = nodeOutputsMap.get(transform.id);
    }
    return inputById;
  }, [nodeOutputsMap, sourceOutput, transforms]);

  React.useEffect(() => {
    if (expandedStep && !selectedSteps.includes(expandedStep)) {
      setSelectedSteps([expandedStep]);
    }
  }, [expandedStep, selectedSteps, setSelectedSteps]);

  const selectedStepId = expandedStep ?? firstSelectedStep;

  const selectedTransform = useMemo(
    () => transforms.find(t => t.id === selectedStepId),
    [selectedStepId, transforms],
  );
  const selectedSink = useMemo(
    () => sinks.find(s => s.id === selectedStepId),
    [selectedStepId, sinks],
  );

  // The default tab for the data preview panel depends on the step type.
  // Filter/map/chained-source/sink → output is more informative. The actual
  // tab state is owned by <StepDataPanel> below, keyed by selectedStepId so
  // it remounts (and re-seeds from defaultTab) only when the user switches
  // between steps — not on every config edit.
  const selectedTransformType = selectedTransform?.type;
  const hasSelectedSink = !!selectedSink;
  const defaultDataTab: 'input' | 'output' =
    selectedTransformType === 'filter' ||
    selectedTransformType === 'map' ||
    selectedTransformType === 'flatmap' ||
    selectedTransformType === 'chained-source' ||
    hasSelectedSink
      ? 'output'
      : 'input';

  const detail: NodeDetail = useMemo(() => {
    if (selectedStepId === 'trigger') {
      let scheduleSubtitle = 'Not configured';
      if (
        triggerType === 'schedule' &&
        triggerConfig.frequencyValue &&
        triggerConfig.frequencyUnit
      ) {
        const frequencyValue = String(triggerConfig.frequencyValue);
        const frequencyUnit = String(triggerConfig.frequencyUnit);
        scheduleSubtitle = truncateNodeLabel(
          frequencyValue === '1'
            ? `Every ${frequencyUnit.slice(0, -1)}`
            : `Every ${frequencyValue} ${frequencyUnit}`,
          40,
        );
      }
      return {
        iconType: triggerType === 'schedule' ? 'schedule' : 'more',
        variant: 'trigger',
        title: 'Schedule',
        subtitle: scheduleSubtitle,
        config: triggerConfig,
        output: undefined,
        error: undefined,
      } satisfies NodeDetail;
    }

    if (selectedStepId === 'source') {
      let sourceSubtitle = 'Select an integration';
      const sourcePath = sourceConfig.path;
      const sourceResource = sourceConfig.resourceType;
      const sourceErr = nodeErrors['source-node'];
      const sourceOut = nodeOutputs['source-node'];
      if (sourceErr) {
        sourceSubtitle = 'Execution failed';
      } else if (runningNodes.has('source-node')) {
        sourceSubtitle = 'Fetching data...';
      } else if (sourceType === 'http' && sourcePath) {
        sourceSubtitle = String(sourcePath);
      } else if (sourceType === 'aws') {
        const apiSubtitle = getServiceApiModeSubtitle(sourceConfig);
        if (apiSubtitle !== undefined) {
          sourceSubtitle = apiSubtitle;
        } else if (sourceResource) {
          sourceSubtitle = String(sourceResource);
        }
      } else if (sourceType && !sourceConfig.integrationId) {
        sourceSubtitle = 'Configure connection details';
      } else if (sourceType) {
        sourceSubtitle = 'Configured';
      }
      return {
        iconType: 'more',
        variant: 'source',
        title: 'Source',
        subtitle: sourceSubtitle,
        config: sourceConfig,
        output: sourceOut,
        error: sourceErr,
      } satisfies NodeDetail;
    }

    if (selectedTransform) {
      const transformErr = nodeErrors[selectedTransform.id];
      const isRunningT = runningNodes.has(selectedTransform.id);
      const hasOutputT = Array.isArray(nodeOutputs[selectedTransform.id]);

      if (selectedTransform.type === 'chained-source') {
        let chainedSubtitle = 'Configure integration';
        const chainedPath = selectedTransform.config.path;
        const chainedResource = selectedTransform.config.resourceType;
        const chainedService = selectedTransform.config.service;
        if (transformErr) {
          chainedSubtitle = 'Execution failed';
        } else if (isRunningT) {
          chainedSubtitle = 'Fetching per-item data...';
        } else {
          const apiSubtitle = getServiceApiModeSubtitle(
            selectedTransform.config,
          );
          if (apiSubtitle !== undefined) {
            chainedSubtitle = apiSubtitle;
          } else if (
            typeof chainedPath === 'string' &&
            chainedPath &&
            (selectedTransform.config.mode !== 'service-api' ||
              (typeof chainedService === 'string' && chainedService))
          ) {
            chainedSubtitle = chainedPath;
          } else if (typeof chainedResource === 'string' && chainedResource) {
            chainedSubtitle = chainedResource;
          } else if (selectedTransform.config.integrationId) {
            chainedSubtitle = getChainedSourceName(selectedTransform.config);
          }
        }
        return {
          iconType: 'link',
          variant: 'source',
          title: 'Chained Source',
          subtitle: chainedSubtitle,
          config: selectedTransform.config,
          output: nodeOutputs[selectedTransform.id],
          error: transformErr,
        } satisfies NodeDetail;
      }

      let transformIcon: StepIconType = 'transform';
      let transformTitle = 'Map';
      if (selectedTransform.type === 'filter') {
        transformIcon = 'filter';
        transformTitle = 'Filter';
      } else if (selectedTransform.type === 'flatmap') {
        transformIcon = 'flatmap';
        transformTitle = 'Flatmap';
      }
      let transformSubtitle: string | undefined;
      if (transformErr) {
        transformSubtitle = 'Execution failed';
      } else if (isRunningT) {
        transformSubtitle = 'Processing...';
      } else if (hasOutputT) {
        const items = (nodeOutputs[selectedTransform.id] as unknown[]).length;
        transformSubtitle = `${items} item${items !== 1 ? 's' : ''}`;
      } else if (selectedTransform.config.expression) {
        transformSubtitle = truncateNodeLabel(
          String(selectedTransform.config.expression),
          44,
        );
      }
      return {
        iconType: transformIcon,
        variant: 'transform',
        title: transformTitle,
        subtitle: transformSubtitle ?? 'Configure expression',
        config: selectedTransform.config,
        output: nodeOutputs[selectedTransform.id],
        error: transformErr,
      } satisfies NodeDetail;
    }

    if (selectedSink) {
      const sinkErr = nodeErrors[selectedSink.id];
      const isRunningS = runningNodes.has(selectedSink.id);
      const sinkOut = nodeOutputs[selectedSink.id];
      const hasSinkRun = Array.isArray(sinkOut);
      let sinkSubtitle: string = selectedSink.type;
      if (sinkErr) {
        sinkSubtitle = 'Execution failed';
      } else if (isRunningS) {
        sinkSubtitle = 'Processing...';
      } else if (hasSinkRun) {
        const written = (sinkOut as unknown[]).length;
        const itemLabel = written === 1 ? 'item' : 'items';
        sinkSubtitle = `Last run: ${written} ${itemLabel} written to the datastore`;
      } else if (finalOutput && finalOutput.length > 0) {
        const rows = finalOutput.length;
        sinkSubtitle = `${rows} row${rows !== 1 ? 's' : ''} from pipeline — run to sync`;
      }
      return {
        iconType: 'storage',
        variant: 'sink',
        title: 'Store',
        subtitle: sinkSubtitle,
        config: selectedSink.config,
        output: sinkOut,
        error: sinkErr,
      } satisfies NodeDetail;
    }

    return {
      iconType: 'more',
      variant: 'source',
      title: 'Node',
      subtitle: 'Select a node',
      config: {},
      output: undefined,
      error: undefined,
    } satisfies NodeDetail;
  }, [
    selectedStepId,
    triggerType,
    triggerConfig,
    sourceType,
    sourceConfig,
    selectedTransform,
    selectedSink,
    nodeOutputs,
    nodeErrors,
    runningNodes,
    finalOutput,
  ]);

  const selectedNodeIds = useMemo(() => {
    return selectedSteps
      .map(stepId => {
        if (stepId === 'source') return 'source-node';
        if (stepId === 'trigger') return undefined;
        return stepId;
      })
      .filter((id): id is string => id !== undefined);
  }, [selectedSteps]);

  const supportsTraffic = useMemo(() => {
    return selectedSteps.some(stepId => {
      if (stepId === 'source') return true;
      const transform = transforms.find(t => t.id === stepId);
      return transform?.type === 'chained-source';
    });
  }, [selectedSteps, transforms]);

  React.useEffect(() => {
    if (!supportsTraffic && activeTab === 'traffic') {
      setActiveTab('details');
    }
  }, [activeTab, supportsTraffic]);

  const nodeTraffic = useMemo(() => {
    if (selectedNodeIds.length === 0) {
      return [];
    }
    const nodeIdSet = new Set(selectedNodeIds);
    return previewRequestLogs.filter(log => nodeIdSet.has(log.nodeId));
  }, [previewRequestLogs, selectedNodeIds]);

  const nodeLogs = useMemo(() => {
    if (selectedNodeIds.length === 0) {
      return [];
    }
    const nodeIdSet = new Set(selectedNodeIds);
    const filtered = previewLogs.filter(
      log => typeof log.nodeId === 'string' && nodeIdSet.has(log.nodeId),
    );
    if (!detail.error || selectedNodeIds.length === 0) {
      return filtered;
    }
    const hasMatchingErrorLog = filtered.some(
      log => log.level === 'error' && log.message === detail.error,
    );
    if (hasMatchingErrorLog) {
      return filtered;
    }
    const syntheticErrorLog: ExecutionLog = {
      id: -1,
      executionId: previewExecutionId ?? 'local',
      nodeId: selectedNodeIds[0] ?? 'local',
      level: 'error',
      message: detail.error,
      createdAt: new Date().toISOString(),
    };
    return [...filtered, syntheticErrorLog];
  }, [detail.error, previewExecutionId, previewLogs, selectedNodeIds]);
  const largePayloadWarning = useMemo(
    () => largePayloadWarningFromLogs(nodeLogs),
    [nodeLogs],
  );

  const getInputForStep = useCallback(
    (stepId: string): unknown[] => {
      if (stepId === 'trigger') return [];
      if (stepId === 'source') return [];
      const transformIdx = transforms.findIndex(t => t.id === stepId);
      if (transformIdx >= 0 && transformInputById.has(stepId)) {
        return transformInputById.get(stepId) ?? [];
      }
      return finalOutput ?? [];
    },
    [transforms, transformInputById, finalOutput],
  );

  const getOutputForStep = useCallback(
    (stepId: string): unknown[] => {
      if (stepId === 'trigger') return [];
      if (stepId === 'source') return sourceOutput ?? [];
      const transform = transforms.find(t => t.id === stepId);
      if (transform && nodeOutputsMap.has(stepId)) {
        return nodeOutputsMap.get(stepId) ?? [];
      }
      const sink = sinks.find(s => s.id === stepId);
      if (sink && nodeOutputsMap.has(stepId)) {
        return nodeOutputsMap.get(stepId) ?? [];
      }
      return [];
    },
    [sourceOutput, transforms, sinks, nodeOutputsMap],
  );

  const renderDetailsContent = () => {
    if (selectedStepId === 'trigger' && !isMultiSelect) {
      return null;
    }

    if (detail.error && !isMultiSelect) {
      return <ErrorDisplay error={detail.error} />;
    }

    if (!hasRunPreview) {
      return (
        <div className="px-2 py-4">
          <p className="text-sm text-muted-foreground">
            Dry run the data source to see the parsed response here.
          </p>
        </div>
      );
    }

    if (isMultiSelect) {
      const firstInput = getInputForStep(firstSelectedStep);
      const lastOutput = getOutputForStep(lastSelectedStep);
      const lastSink = sinks.find(s => s.id === lastSelectedStep);
      return (
        <StepDataPanel
          key={`multi-${firstSelectedStep}-${lastSelectedStep}`}
          defaultTab={defaultDataTab}
          inputItems={firstInput}
          outputItems={lastOutput}
          outputAsTable={!!lastSink}
        />
      );
    }

    if (selectedStepId === 'source') {
      return (
        <StepDataPanel
          key={selectedStepId}
          defaultTab={defaultDataTab}
          inputItems={[]}
          outputItems={sourceOutput ?? []}
        />
      );
    }

    if (selectedTransform) {
      return (
        <StepDataPanel
          key={selectedTransform.id}
          defaultTab={defaultDataTab}
          inputItems={transformInputById.get(selectedTransform.id) ?? []}
          outputItems={nodeOutputsMap.get(selectedTransform.id) ?? []}
        />
      );
    }

    if (selectedSink) {
      return (
        <StepDataPanel
          key={selectedSink.id}
          defaultTab={defaultDataTab}
          inputItems={finalOutput ?? []}
          outputItems={nodeOutputsMap.get(selectedSink.id) ?? []}
          outputAsTable
        />
      );
    }

    return null;
  };

  const tabs = [
    { id: 'details' as const, label: 'Details' },
    ...(supportsTraffic
      ? [
          {
            id: 'traffic' as const,
            label: `HTTP Traffic (${nodeTraffic.length})`,
          },
        ]
      : []),
    { id: 'logs' as const, label: `Logs (${nodeLogs.length})` },
  ];

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-card [--field-bg:var(--color-card)]">
      <div className="flex min-h-0 flex-1 flex-col">
        <DetailHeaderBlock
          steps={stepsInfo}
          selectedSteps={selectedSteps}
          onStepClick={handleStepClick}
        />

        {largePayloadWarning && (
          <div className="px-3 pt-3">
            <LargePayloadAlert warning={largePayloadWarning} />
          </div>
        )}

        <Tabs
          value={activeTab}
          onValueChange={value => setActiveTab(value as typeof activeTab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <DetailTabBar tabs={tabs} />

          <TabsContent
            value="details"
            className="mt-0 flex min-h-0 flex-1 flex-col"
          >
            <div className="flex min-h-0 flex-1 flex-col">
              {renderDetailsContent()}
            </div>
          </TabsContent>

          {supportsTraffic && (
            <TabsContent
              value="traffic"
              className="mt-0 flex min-h-0 flex-1 flex-col"
            >
              {!hasRunPreview ? (
                <div className="px-2 py-4">
                  <p className="text-sm text-muted-foreground">
                    Dry run the data source to see HTTP traffic here.
                  </p>
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-auto">
                  <TrafficTable logs={nodeTraffic} compact />
                </div>
              )}
            </TabsContent>
          )}

          <TabsContent
            value="logs"
            className="mt-0 flex min-h-0 flex-1 flex-col"
          >
            {!hasRunPreview && nodeLogs.length === 0 ? (
              <div className="px-2 py-4">
                <p className="text-sm text-muted-foreground">
                  Dry run the data source to see logs here.
                </p>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto">
                <LogsPanel logs={nodeLogs} compact />
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
