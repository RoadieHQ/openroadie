import React, { useEffect, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { integrationDetailQuery } from '../../../api/queries';
import { ArrowRightLeft, Filter, Link, Split } from 'lucide-react';
import { deriveOutputSchema } from '@roadiehq/catalog-datastore-common';
import type { JsonValue } from '@roadiehq/types';
import { IntegrationLogo } from '@roadiehq/ui/item-list';
import { useLogoResolver } from '../use-resolved-logo';
import {
  InsertStepConnector,
  type InsertStepMenuItem,
} from '../../common/pipeline-editor';
import type { StepStatus } from './step-components';
import { edgeState, StepNode } from './step-components';
import { useDataSourceEditorContext } from './data-source-editor-context';
import { FilterBuilder } from './filter-builder';
import { FlatmapBuilder } from './flatmap-builder';
import { MapBuilder } from './map-builder';
import type { RuleGroupType } from 'react-querybuilder';
import type { MapRules } from './map-builder';
import { ChainedSourceConfig, getChainedSourceName } from './sources';
import { getServiceApiModeSubtitle } from './node-header-text';
import type { Integration } from '../../integrations/types';
import { useSourceSchema } from '../use-source-schema';
import { useFeatureFlag } from '../../../api';
import {
  buildChainedOutputSchema,
  deriveDataKeyFrontend,
  useChainedSourceSchemas,
} from '../use-chained-source-schemas';

interface TransformNodeConfig {
  icon: React.ReactNode;
  title: string;
}

type PlainTransformType = 'filter' | 'map' | 'flatmap';

const TRANSFORM_CONFIG: Record<PlainTransformType, TransformNodeConfig> = {
  filter: {
    icon: <Filter className="size-5" />,
    title: 'Filter',
  },
  map: {
    icon: <ArrowRightLeft className="size-5" />,
    title: 'Map Transform',
  },
  flatmap: {
    icon: <Split className="size-5" />,
    title: 'Flatmap',
  },
};

export function TransformSteps() {
  const resolveLogoUrl = useLogoResolver();
  const {
    transforms,
    nodeOutputs,
    nodeErrors,
    runningNodes,
    expandedStep,
    selectedSteps,
    handleStepClick,
    handleAddTransform,
    handleAddChainedSource,
    handleUpdateTransform,
    handleDeleteTransform,
    sourceOutput,
    setTransforms,
    markChanged,
    workflowApi,
    sourceType,
    sourceConfig,
    sourceSchemaVersion,
    setAccumulatedSchema,
    sinks,
  } = useDataSourceEditorContext();

  const insertItems = (position: number): InsertStepMenuItem[] => [
    {
      icon: <Filter className="size-4" />,
      label: 'Filter',
      onSelect: () => handleAddTransform('filter', position),
    },
    {
      icon: <ArrowRightLeft className="size-4" />,
      label: 'Map',
      onSelect: () => handleAddTransform('map', position),
    },
    {
      icon: <Split className="size-4" />,
      label: 'Flatmap',
      onSelect: () => handleAddTransform('flatmap', position),
    },
    {
      icon: <Link className="size-4" />,
      label: 'Chained Source',
      onSelect: () => handleAddChainedSource(position),
    },
  ];

  const { value: aiProvidersEnabled } = useFeatureFlag('ai-providers', false);
  const jsonataAssist = aiProvidersEnabled
    ? workflowApi.jsonataAssist
    : undefined;

  const firstSinkId = sinks[0]?.id ?? null;
  const sourceNodeId = 'source-node';

  const sourceSchema = useSourceSchema(
    workflowApi,
    sourceType,
    sourceConfig,
    sourceSchemaVersion,
  );
  const chainedSourceSchemas = useChainedSourceSchemas(workflowApi, transforms);

  const finalSchema = useMemo(() => {
    let currentData = sourceOutput;
    let currentSchema: JsonValue | null = sourceSchema;

    for (const transform of transforms) {
      const transformOutput = nodeOutputs[transform.id];

      if (transform.type === 'chained-source') {
        const chainedSchema = chainedSourceSchemas[transform.id] ?? null;
        if (chainedSchema) {
          const resultMode =
            typeof transform.config.resultMode === 'string'
              ? transform.config.resultMode
              : 'enrich';
          const dataKey = deriveDataKeyFrontend(transform.config);
          const built = buildChainedOutputSchema(
            currentSchema,
            chainedSchema,
            resultMode,
            dataKey,
          );
          if (built) {
            currentSchema = built;
            currentData = transformOutput;
            continue;
          }
        }
      }

      if (
        Array.isArray(currentData) &&
        currentData.length > 0 &&
        Array.isArray(transformOutput) &&
        transformOutput.length > 0
      ) {
        currentSchema = deriveOutputSchema(
          currentSchema,
          currentData as JsonValue[],
          transformOutput as JsonValue[],
        );
      }

      currentData = transformOutput;
    }

    return currentSchema;
  }, [
    nodeOutputs,
    sourceOutput,
    sourceSchema,
    transforms,
    chainedSourceSchemas,
  ]);

  useEffect(() => {
    setAccumulatedSchema(finalSchema);
  }, [finalSchema, setAccumulatedSchema]);

  // Unique integration ids referenced by chained-source transforms.
  const chainedIntegrationIds = useMemo(() => {
    const ids = transforms
      .filter(t => t.type === 'chained-source' && t.config.integrationId)
      .map(t => String(t.config.integrationId));
    return Array.from(new Set(ids));
  }, [transforms]);

  const chainedIntegrationQueries = useQueries({
    queries: chainedIntegrationIds.map(id =>
      integrationDetailQuery(workflowApi, id),
    ),
  });

  const chainedIntegrations = useMemo(() => {
    const map = new Map<string, Integration>();
    chainedIntegrationIds.forEach((id, index) => {
      const integration = chainedIntegrationQueries[`${index}`]?.data;
      if (integration) {
        map.set(id, integration);
      }
    });
    return map;
  }, [chainedIntegrationIds, chainedIntegrationQueries]);

  if (transforms.length === 0) {
    return (
      <InsertStepConnector
        state={edgeState(sourceNodeId, firstSinkId, runningNodes, nodeOutputs)}
        items={insertItems(0)}
      />
    );
  }

  return (
    <>
      <InsertStepConnector
        state={edgeState(
          sourceNodeId,
          transforms[0].id,
          runningNodes,
          nodeOutputs,
        )}
        items={insertItems(0)}
      />
      {transforms.map((transform, index) => {
        const transformOutput = nodeOutputs[transform.id] as
          | unknown[]
          | undefined;
        const transformError = nodeErrors[transform.id];
        const isTransformRunning = runningNodes.has(transform.id);
        const hasTransformOutput =
          transformOutput && transformOutput.length > 0;

        const previousStepOutput = (
          index > 0 ? nodeOutputs[transforms[index - 1].id] : sourceOutput
        ) as unknown[] | undefined;

        if (transform.type === 'chained-source') {
          const chainedIntegration = transform.config.integrationId
            ? chainedIntegrations.get(transform.config.integrationId as string)
            : undefined;
          const chainedSourceType: 'http' | 'aws' | null = (() => {
            if (!chainedIntegration) {
              return null;
            }
            return chainedIntegration.backendType === 'aws' ? 'aws' : 'http';
          })();
          const isConfigured = !!transform.config.integrationId;

          const getStatus = (): StepStatus => {
            if (transformError) {
              return 'error';
            }
            if (isTransformRunning) {
              return 'running';
            }
            if (hasTransformOutput) {
              return 'success';
            }
            if (isConfigured) {
              return 'configured';
            }
            return 'pending';
          };

          const getSubtitle = (): string | undefined => {
            if (transformError) {
              return 'Execution failed';
            }
            if (isTransformRunning) {
              return 'Fetching per-item data...';
            }
            if (isConfigured) {
              const chainedPath = transform.config.path;
              const chainedResource = transform.config.resourceType;
              const chainedService = transform.config.service;
              const apiSubtitle = getServiceApiModeSubtitle(transform.config);
              if (apiSubtitle !== undefined) {
                return apiSubtitle;
              }
              if (
                typeof chainedPath === 'string' &&
                chainedPath &&
                (transform.config.mode !== 'service-api' ||
                  (typeof chainedService === 'string' && chainedService))
              ) {
                return chainedPath;
              }
              if (typeof chainedResource === 'string' && chainedResource) {
                return chainedResource;
              }
              return getChainedSourceName(transform.config);
            }
            return 'Configure integration';
          };

          const chainedLogoUrl = resolveLogoUrl(chainedIntegration);
          const chainedIcon = chainedLogoUrl ? (
            <IntegrationLogo src={chainedLogoUrl} size={20} />
          ) : (
            <Link className="size-5" />
          );

          return (
            <React.Fragment key={transform.id}>
              <StepNode
                icon={chainedIcon}
                title="Chained Source"
                subtitle={getSubtitle()}
                status={getStatus()}
                variant="source"
                expanded={expandedStep === transform.id}
                selected={selectedSteps.includes(transform.id)}
                onToggle={opts =>
                  handleStepClick(transform.id, opts?.shiftKey ?? false)
                }
                onDelete={() => handleDeleteTransform(transform.id)}
              >
                <ChainedSourceConfig
                  config={transform.config}
                  sourceType={chainedSourceType}
                  integration={chainedIntegration}
                  onChange={(field, value) =>
                    handleUpdateTransform(transform.id, field, value)
                  }
                  previousOutput={previousStepOutput}
                />
              </StepNode>
              {index < transforms.length - 1 && (
                <InsertStepConnector
                  state={edgeState(
                    transform.id,
                    transforms[index + 1].id,
                    runningNodes,
                    nodeOutputs,
                  )}
                  items={insertItems(index + 1)}
                />
              )}
            </React.Fragment>
          );
        }

        const config = TRANSFORM_CONFIG[transform.type as PlainTransformType];
        if (!config) {
          return null;
        }
        const isConfigured = !!(
          transform.config.expression ||
          transform.config.filter ||
          transform.config.mapRules
        );

        const getTransformStatus = (): StepStatus => {
          if (transformError) {
            return 'error';
          }
          if (isTransformRunning) {
            return 'running';
          }
          if (hasTransformOutput) {
            return 'success';
          }
          if (isConfigured) {
            return 'configured';
          }
          return 'pending';
        };

        const getTransformSubtitle = (): string | undefined => {
          if (transformError) {
            return 'Execution failed';
          }
          if (isTransformRunning) {
            return 'Processing...';
          }
          return undefined;
        };

        return (
          <React.Fragment key={transform.id}>
            <StepNode
              icon={config.icon}
              title={config.title}
              subtitle={getTransformSubtitle()}
              status={getTransformStatus()}
              variant="transform"
              expanded={expandedStep === transform.id}
              selected={selectedSteps.includes(transform.id)}
              onToggle={opts =>
                handleStepClick(transform.id, opts?.shiftKey ?? false)
              }
              onDelete={() => handleDeleteTransform(transform.id)}
            >
              <div>
                {transform.type === 'flatmap' && (
                  <FlatmapBuilder
                    config={transform.config}
                    inputSample={previousStepOutput}
                    onChange={(field, value) =>
                      handleUpdateTransform(transform.id, field, value)
                    }
                  />
                )}
                {transform.type === 'filter' && (
                  <FilterBuilder
                    filter={
                      transform.config.filter as RuleGroupType | undefined
                    }
                    expression={
                      transform.config.expression as string | undefined
                    }
                    inputSample={previousStepOutput}
                    onChange={(filter, expression) => {
                      setTransforms(prev =>
                        prev.map(t =>
                          t.id === transform.id
                            ? {
                                ...t,
                                config: {
                                  ...t.config,
                                  filter,
                                  expression,
                                },
                              }
                            : t,
                        ),
                      );
                      markChanged();
                    }}
                    jsonataAssist={jsonataAssist}
                    testId="filter-expression"
                  />
                )}
                {transform.type === 'map' && (
                  <MapBuilder
                    rules={transform.config.mapRules as MapRules | undefined}
                    expression={
                      transform.config.expression as string | undefined
                    }
                    inputSample={previousStepOutput}
                    onChange={(rulesNext, expression) => {
                      setTransforms(prev =>
                        prev.map(t =>
                          t.id === transform.id
                            ? {
                                ...t,
                                config: {
                                  ...t.config,
                                  mapRules: rulesNext,
                                  expression,
                                },
                              }
                            : t,
                        ),
                      );
                      markChanged();
                    }}
                    jsonataAssist={jsonataAssist}
                    testId="map-expression"
                  />
                )}
              </div>
            </StepNode>
            {index < transforms.length - 1 && (
              <InsertStepConnector
                state={edgeState(
                  transform.id,
                  transforms[index + 1].id,
                  runningNodes,
                  nodeOutputs,
                )}
                items={insertItems(index + 1)}
              />
            )}
          </React.Fragment>
        );
      })}
      <InsertStepConnector
        state={edgeState(
          transforms[transforms.length - 1].id,
          firstSinkId,
          runningNodes,
          nodeOutputs,
        )}
        items={insertItems(transforms.length)}
      />
    </>
  );
}
