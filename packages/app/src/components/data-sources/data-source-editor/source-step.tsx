import React, { useCallback, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Database, MoreHorizontal } from 'lucide-react';
import { StepNode, StepStatus } from './step-components';
import { IntegrationLogo } from '@roadiehq/ui/item-list';
import { useDataSourceEditorContext } from './data-source-editor-context';
import { SourceConfig } from './sources';
import type { Integration } from '../../integrations/types';
import { queryKeys } from '../../../api/queries';
import {
  getWorkspaceScopeKey,
  workspaceQueryKeyInScope,
} from '../../../api/workspace-scope';
import { useIntegrationDetail } from './use-integration-detail';
import { useLogoResolver } from '../use-resolved-logo';
import { getServiceApiModeSubtitle } from './node-header-text';

export function SourceStep() {
  const workspaceScopeKey = getWorkspaceScopeKey();
  const resolveLogoUrl = useLogoResolver();
  const {
    sourceType,
    setSourceType,
    sourceConfig,
    setSourceConfig,
    setNodeOutputs,
    expandedStep,
    selectedSteps,
    handleStepClick,
    nodeOutputs,
    nodeErrors,
    runningNodes,
    previewLoading,
    isSourceConfigured,
    handleSourceConfigChange,
    markChanged,
    workflowApi,
  } = useDataSourceEditorContext();

  const queryClient = useQueryClient();
  const integrationId = sourceConfig.integrationId
    ? String(sourceConfig.integrationId)
    : undefined;

  const integrationQuery = useIntegrationDetail(workflowApi, integrationId);
  const integration = integrationQuery.data ?? null;

  const handleIntegrationSelect = useCallback(
    (value: string, selectedIntegration: Integration) => {
      // Seed the detail cache so the just-picked integration renders instantly
      // instead of flashing empty while the id-keyed query refetches.
      queryClient.setQueryData(
        queryKeys.integrationDetail(value),
        selectedIntegration,
      );
      setSourceType(selectedIntegration.backendType === 'aws' ? 'aws' : 'http');
      if (selectedIntegration.backendType === 'aws') {
        setSourceConfig({
          integrationId: value,
          integrationName:
            selectedIntegration.name || selectedIntegration.host || '',
          integrationHost: selectedIntegration.host,
          mode: 'cloud-control',
          objectIdExpression: 'id',
        });
      } else {
        setSourceConfig({
          integrationId: value,
          integrationName:
            selectedIntegration.name || selectedIntegration.host || '',
          integrationHost: selectedIntegration.host,
          path: '',
          method: 'GET',
          headers: [],
          arrayExpression: '$',
          objectIdExpression: 'id',
          paginationMode: 'inherit',
        });
      }
      setNodeOutputs({});
      markChanged();
    },
    [queryClient, setSourceType, setSourceConfig, setNodeOutputs, markChanged],
  );

  const handleDatastoreSourceSelect = useCallback(() => {
    setSourceType('datastore');
    setSourceConfig({});
    setNodeOutputs({});
    markChanged();
  }, [setSourceType, setSourceConfig, setNodeOutputs, markChanged]);

  // Restore the source type from the loaded integration (e.g. reopening a saved
  // data source) so the aws/http config renders correctly on first paint.
  useEffect(() => {
    if (integration) {
      setSourceType(integration.backendType === 'aws' ? 'aws' : 'http');
    }
  }, [integration, setSourceType]);

  const handleConfigChange = useCallback(
    (field: string, value: unknown) => {
      handleSourceConfigChange(field, value);
    },
    [handleSourceConfigChange],
  );

  const handleIntegrationUpdated = useCallback(
    (updated: Integration) => {
      queryClient.setQueryData(
        workspaceQueryKeyInScope(
          queryKeys.integrationDetail(String(updated.id)),
          workspaceScopeKey,
        ),
        updated,
      );
    },
    [queryClient, workspaceScopeKey],
  );

  const sourceNodeId = 'source-node';
  const sourceOutput = nodeOutputs['source-node'];
  const sourceError = nodeErrors['source-node'];
  const isSourceRunning = runningNodes.has(sourceNodeId);
  const hasSourceRun = Array.isArray(sourceOutput);
  const isSourceExecutionInProgress =
    isSourceRunning || (previewLoading && !sourceError && !hasSourceRun);

  const sourceStatus: StepStatus = useMemo(() => {
    if (sourceError) {
      return 'error';
    }
    if (isSourceExecutionInProgress) {
      return 'running';
    }
    if (hasSourceRun) {
      return 'success';
    }
    if (isSourceConfigured) {
      return 'configured';
    }
    return 'pending';
  }, [
    sourceError,
    isSourceExecutionInProgress,
    hasSourceRun,
    isSourceConfigured,
  ]);

  const sourceSubtitle = useMemo(() => {
    if (sourceError) {
      return 'Execution failed';
    }
    if (isSourceExecutionInProgress) {
      return isSourceRunning ? 'Fetching data...' : 'Starting execution...';
    }
    if (!sourceType) {
      return 'Select an integration';
    }
    if (sourceType === 'datastore') {
      if (!isSourceConfigured) {
        return 'Select a data source';
      }
      return typeof sourceConfig.datasourceName === 'string' &&
        sourceConfig.datasourceName
        ? sourceConfig.datasourceName
        : 'Data source';
    }
    if (!isSourceConfigured) {
      return 'Configure connection details';
    }
    if (sourceType === 'http') {
      return sourceConfig.path;
    }
    if (sourceType === 'aws') {
      const apiSubtitle = getServiceApiModeSubtitle(sourceConfig);
      if (apiSubtitle !== undefined) {
        return apiSubtitle;
      }
      return sourceConfig.resourceType;
    }
    return 'Configured';
  }, [
    sourceError,
    isSourceExecutionInProgress,
    isSourceRunning,
    sourceType,
    isSourceConfigured,
    sourceConfig,
  ]);

  const resolvedLogoUrl = useMemo(
    () => resolveLogoUrl(integration ?? undefined),
    [resolveLogoUrl, integration],
  );

  const sourceIcon = useMemo(() => {
    if (sourceType === 'datastore') {
      return <Database className="size-5" />;
    }
    if (resolvedLogoUrl) {
      return <IntegrationLogo src={resolvedLogoUrl} size={20} />;
    }
    return <MoreHorizontal className="size-5" />;
  }, [sourceType, resolvedLogoUrl]);

  return (
    <StepNode
      icon={sourceIcon}
      title="Source"
      subtitle={sourceSubtitle}
      status={sourceStatus}
      variant="source"
      expanded={expandedStep === 'source'}
      selected={selectedSteps.includes('source')}
      onToggle={opts => handleStepClick('source', opts?.shiftKey ?? false)}
      testId="source-step"
    >
      <SourceConfig
        config={sourceConfig}
        sourceType={sourceType}
        onChange={handleConfigChange}
        onIntegrationSelect={handleIntegrationSelect}
        integration={integration}
        onIntegrationUpdated={handleIntegrationUpdated}
        allowDatastoreSource
        onDatastoreSourceSelect={handleDatastoreSourceSelect}
      />
    </StepNode>
  );
}
