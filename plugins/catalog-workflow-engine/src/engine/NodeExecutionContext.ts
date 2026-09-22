/*
 * Copyright 2025 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { LoggerService } from '@roadiehq/extensions-api';
import { JsonValue } from '@roadiehq/types';
import { IntegrationClient } from '@roadiehq/integrations-node';
import { ExecutionStore } from './ExecutionStore';
import {
  createWorkflowInstrumentedClient,
  WorkflowRequestLogCallback,
} from './InstrumentedIntegrationClient';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type NodeLogCallback = (event: {
  executionId: string;
  nodeId: string;
  level: LogLevel;
  message: string;
  metadata?: JsonValue;
  timestamp: string;
}) => void;

export interface NodeExecutionContext<
  TConfig extends Record<string, unknown> = Record<string, unknown>,
  TInput = unknown,
> {
  nodeId: string;
  nodeType: string;
  executionId: string;
  workflowId: string;
  workflowName: string;
  workspaceId?: string;
  scopeId?: string;
  config: TConfig;
  input: TInput;
  logger: LoggerService;
  signal: AbortSignal;
  dryRun: boolean;
  previewLimit?: number;
  triggeredBy?: string;
  log: (
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    metadata?: JsonValue,
  ) => Promise<void>;
  getSecret: (name: string) => string | undefined;
  integrationClient?: IntegrationClient;
}

export interface CreateNodeContextOptions {
  nodeId: string;
  nodeType: string;
  executionId: string;
  workflowId: string;
  workflowName: string;
  workspaceId?: string;
  config: Record<string, unknown>;
  input: unknown;
  logger: LoggerService;
  executionDao?: ExecutionStore;
  signal: AbortSignal;
  dryRun: boolean;
  previewLimit?: number;
  secrets: Record<string, string>;
  onRequestLog?: WorkflowRequestLogCallback;
  onLog?: NodeLogCallback;
  triggeredBy?: string;
  scopeId?: string;
  integrationClient?: IntegrationClient;
}

export function createNodeExecutionContext(
  options: CreateNodeContextOptions,
): NodeExecutionContext {
  const {
    nodeId,
    nodeType,
    executionId,
    workflowId,
    workflowName,
    workspaceId,
    config,
    input,
    logger,
    executionDao,
    signal,
    dryRun,
    previewLimit,
    secrets,
    onRequestLog,
    onLog,
    triggeredBy,
    scopeId,
    integrationClient,
  } = options;

  const nodeLogger = logger.child({ nodeId, nodeType });
  const scopedIntegrationClient: IntegrationClient | undefined =
    integrationClient && workspaceId
      ? {
          request: (integrationId, requestOptions) =>
            integrationClient.request(integrationId, {
              ...requestOptions,
              workspaceId,
            }),
          requestPages: (integrationId, requestOptions) =>
            integrationClient.requestPages(integrationId, {
              ...requestOptions,
              workspaceId,
            }),
          getIntegration: integrationId =>
            integrationClient.getIntegration(integrationId, workspaceId),
          listIntegrations: () =>
            integrationClient.listIntegrations(workspaceId),
          unregisterIntegration: integrationId =>
            integrationClient.unregisterIntegration(integrationId),
        }
      : integrationClient;

  return {
    nodeId,
    nodeType,
    executionId,
    workflowId,
    workflowName,
    workspaceId,
    scopeId,
    config,
    input,
    logger: nodeLogger,
    signal,
    dryRun,
    previewLimit,
    triggeredBy,

    log: async (level, message, metadata) => {
      const timestamp = new Date().toISOString();
      nodeLogger[level](message);
      if (executionDao) {
        await executionDao.addLog({
          executionId,
          nodeId,
          level,
          message,
          metadata,
        });
      }
      onLog?.({
        executionId,
        nodeId,
        level,
        message,
        metadata,
        timestamp,
      });
    },

    getSecret: (name: string) => secrets[name],

    integrationClient:
      scopedIntegrationClient && onRequestLog
        ? createWorkflowInstrumentedClient({
            executionId,
            nodeId,
            nodeType,
            onRequestLog,
            client: scopedIntegrationClient,
          })
        : scopedIntegrationClient,
  };
}
