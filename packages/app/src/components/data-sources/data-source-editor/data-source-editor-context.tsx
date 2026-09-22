import { createContext, useContext } from 'react';
import type { JsonValue } from '../../../types';
import type { AwsSourceMode } from '@roadiehq/types';
import type { SourceType, TriggerType, PipelineStep, SinkStep } from '../types';
import type { WorkflowClient } from '../../../api';
import type {
  WorkflowRequestLog,
  ExecutionLog,
} from '../../../api/workflow/workflow-client';

export interface Header {
  key: string;
  value: string;
}

export interface AwsAccountSelectionConfig {
  mode: 'all';
  excludedAccountIds?: string[];
  requiredTags?: Header[];
  excludedTags?: Header[];
}

export type PaginationConfig =
  | {
      type: 'none';
    }
  | {
      type: 'cursor';
      cursorParam: string;
      nextCursorExpression: string;
      paramLocation?: 'query' | 'body';
      bodyParamsPath?: string;
    }
  | {
      type: 'page';
      pageParam: string;
      perPageParam: string;
      perPage: number;
      startPage?: number;
    }
  | {
      type: 'offset';
      offsetParam: string;
      limitParam: string;
      limit: number;
      paramLocation?: 'query' | 'body';
      bodyParamsPath?: string;
      totalExpression?: string;
    }
  | {
      type: 'link';
      perPageParam?: string;
      perPage?: number;
      nextRequestMethod?: 'GET' | 'POST';
      nextLinkCondition?: {
        param: string;
        equals?: string;
        notEquals?: string;
      };
    }
  | {
      type: 'body-link';
      nextLinkExpression: string;
      perPageParam?: string;
      perPage?: number;
      nextRequestMethod?: 'GET' | 'POST';
    }
  | {
      type: 'graphql-cursor';
      cursorVariable: string;
      nextCursorExpression: string;
      hasNextPageExpression?: string;
    };

export type PaginationMode = 'inherit' | 'custom' | 'disabled';

export interface HttpIntegrationSourceConfig {
  integrationId?: string;
  path?: string;
  pathTemplate?: string;
  pathParams?: Record<string, string>;
  method?: string;
  headers?: Header[];
  body?: unknown;
  /** Raw JSON text the user typed for the POST body; parsed into `body` on save (mirrors graphqlVariables). */
  bodyText?: string;
  arrayExpression?: string;
  objectIdExpression?: string;
  pagination?: PaginationConfig;
  paginationMode?: PaginationMode;
  effectivePaginationDefault?: PaginationConfig;
  mode?: 'rest' | 'graphql';
  graphqlQuery?: string;
  /** Raw JSON text the user typed; parsed on save. Persisted as-is so a temporarily invalid JSON value isn't lost while editing. */
  graphqlVariables?: string;
}

export interface AwsIntegrationSourceConfig {
  mode?: AwsSourceMode;
  accountIds?: string[];
  accountSelection?: AwsAccountSelectionConfig;
  resourceType?: string;
  regions?: string[];
  resourceModel?: string;
  roleName?: string;
  externalId?: string;
  authRegion?: string;
  service?: string;
  operation?: string;
  path?: string;
  method?: string;
  headers?: Header[];
  body?: unknown;
  arrayExpression?: string;
  objectIdExpression?: string;
  pagination?: PaginationConfig;
}

type SourceMode = AwsSourceMode | HttpIntegrationSourceConfig['mode'];

export type SourceConfig = Omit<
  AwsIntegrationSourceConfig & HttpIntegrationSourceConfig,
  'mode'
> & {
  mode?: SourceMode;
} & Record<string, unknown>;

export type SinkSchemaOverride = Record<string, JsonValue | null>;

export interface DataSourceEditorContextValue {
  triggerType: TriggerType;
  setTriggerType: (type: TriggerType) => void;
  triggerConfig: Record<string, unknown>;
  setTriggerConfig: (
    config:
      | Record<string, unknown>
      | ((prev: Record<string, unknown>) => Record<string, unknown>),
  ) => void;
  sourceType: SourceType;
  setSourceType: (type: SourceType) => void;
  sourceConfig: SourceConfig;
  setSourceConfig: (
    config: SourceConfig | ((prev: SourceConfig) => SourceConfig),
  ) => void;
  transforms: PipelineStep[];
  setTransforms: (
    transforms: PipelineStep[] | ((prev: PipelineStep[]) => PipelineStep[]),
  ) => void;
  sinks: SinkStep[];
  setSinks: (sinks: SinkStep[] | ((prev: SinkStep[]) => SinkStep[])) => void;
  selectedSteps: string[];
  setSelectedSteps: (steps: string[] | ((prev: string[]) => string[])) => void;
  expandedStep: string | null;
  setExpandedStep: (step: string | null) => void;
  nodeOutputs: Record<string, unknown[]>;
  setNodeOutputs: (
    outputs:
      | Record<string, unknown[]>
      | ((prev: Record<string, unknown[]>) => Record<string, unknown[]>),
  ) => void;
  nodeErrors: Record<string, string>;
  setNodeErrors: (
    errors:
      | Record<string, string>
      | ((prev: Record<string, string>) => Record<string, string>),
  ) => void;
  runningNodes: Set<string>;
  setRunningNodes: (
    nodes: Set<string> | ((prev: Set<string>) => Set<string>),
  ) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  isSourceConfigured: boolean;
  sourceOutput: unknown[] | undefined;
  finalOutput: unknown[] | undefined;
  previewLoading: boolean;
  previewError: string | null;
  isPreviewRun: boolean;
  previewRequestLogs: WorkflowRequestLog[];
  previewLogs: ExecutionLog[];
  previewExecutionId: string | undefined;
  hasRunPreview: boolean;
  confirmedSinkSchema: Record<string, JsonValue | null>;
  setConfirmedSinkSchema: (
    schema:
      | Record<string, JsonValue | null>
      | ((
          prev: Record<string, JsonValue | null>,
        ) => Record<string, JsonValue | null>),
  ) => void;
  workflowApi: WorkflowClient;
  handleAddTrigger: (type: 'schedule') => void;
  handleTriggerConfigChange: (field: string, value: unknown) => void;
  markChanged: () => void;
  handleSourceConfigChange: (field: string, value: unknown) => void;
  handleAddTransform: (
    type: 'filter' | 'map' | 'flatmap',
    atIndex?: number,
  ) => void;
  handleAddChainedSource: (atIndex?: number) => void;
  handleUpdateTransform: (id: string, field: string, value: unknown) => void;
  handleDeleteTransform: (id: string) => void;
  handleUpdateSink: (id: string, field: string, value: unknown) => void;
  handleDeleteSink: (id: string) => void;
  handleRun: (
    dryRun?: boolean,
    signal?: AbortSignal,
    sinkSchemaOverride?: SinkSchemaOverride,
  ) => Promise<void>;
  sourceSchemaVersion: number;
  bumpSourceSchemaVersion: () => void;
  accumulatedSchema: JsonValue | null;
  setAccumulatedSchema: (schema: JsonValue | null) => void;
  workflowId?: string;
  isEnabled?: boolean;
  secretRefreshNonce: number;
  bumpSecretRefresh: () => void;
  scheduleRefreshNonce: number;
  allStepIds: string[];
  handleStepClick: (stepId: string, shiftKey: boolean) => void;
}

export const DataSourceEditorContext =
  createContext<DataSourceEditorContextValue | null>(null);

export function useDataSourceEditorContext() {
  const context = useContext(DataSourceEditorContext);
  if (!context) {
    throw new Error(
      'useDataSourceEditorContext must be used within DataSourceEditorContext.Provider',
    );
  }
  return context;
}
