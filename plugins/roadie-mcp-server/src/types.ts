/*
 * Copyright 2025 Larder Software Ltd.
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
import {
  PromptCallback,
  ReadResourceCallback,
  ReadResourceTemplateCallback,
  ResourceMetadata,
  ResourceTemplate,
  ToolCallback,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { ZodOptional, ZodType } from 'zod';
import { PrePermissionedFetchClient } from '@roadiehq/plugin-mcp-node';
import { DiscoveryService } from '@roadiehq/extensions-api';
import type { ScopeChecker } from '@roadiehq/scopes';

export type McpTrackingContext = {
  customerId?: string;
  scopeId?: string;
  workspaceId?: string;
};

export type RoadieMcpCallContext = {
  prePermissionedFetchClient: PrePermissionedFetchClient;
  discovery: DiscoveryService;
  tracking?: McpTrackingContext;
  correlationId: string;
  /**
   * Decides which tools the caller may see and call for this request. Omitted in
   * some test/legacy call sites; treated as allow-all when absent (see McpService).
   */
  scopeChecker?: ScopeChecker;
};

export interface McpToolCallEvent {
  correlationId: string;
  service: string;
  tool: string;
  durationMs: number;
  status: 'success' | 'error';
  customerId?: string;
  scopeId?: string;
  workspaceId?: string;
  timestamp: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: unknown;
  inputTokens?: number;
  outputTokens?: number;
  errorMessage?: string;
}

export interface McpEventSink {
  emit(event: McpToolCallEvent): void | Promise<void>;
}

export type ToolRegistration<
  InputSchema extends Record<string, ZodType>,
  OutputSchema extends Record<string, ZodType> = Record<string, ZodType>,
> = {
  name: string;
  config: {
    title?: string;
    description?: string;
    inputSchema?: InputSchema;
    outputSchema?: OutputSchema;
    annotations?: ToolAnnotations;
  };
  /**
   * The scope required to see and call this tool, e.g. `SCOPES.action.execute`.
   * The tool is hidden from `tools/list` unless the caller holds this scope's
   * family, and each call re-checks it (narrowed by {@link scopeTarget}).
   */
  scope: string;
  /**
   * Optional. Narrows the required scope to a specific resource instance derived
   * from the call arguments, e.g. `args => args.action` yields
   * `action:execute:<action>`. When omitted (or it returns undefined) the bare
   * {@link scope} is required.
   */
  scopeTarget?: (args: Record<string, unknown>) => string | undefined;
  /**
   * Optional. For collection tools (a listing/search) that admit the whole
   * family of {@link scope}: when true, a call is allowed if the caller holds
   * the bare scope OR any narrowed `scope:target`, and the tool is responsible
   * for filtering its results to the granted targets (typically by proxying a
   * backend endpoint that does the same via `allowedTargets`). Mutually
   * exclusive with {@link scopeTarget}.
   */
  familyScope?: boolean;
  cb: (ctx: RoadieMcpCallContext) => ToolCallback<InputSchema>;
};

export type ResourceRegistration =
  | {
      name: string;
      uriOrTemplate: string;
      config: ResourceMetadata;
      cb: (ctx: RoadieMcpCallContext) => ReadResourceCallback;
    }
  | {
      name: string;
      uriOrTemplate: ResourceTemplate;
      config: ResourceMetadata;
      cb: (ctx: RoadieMcpCallContext) => ReadResourceTemplateCallback;
    };

export type PromptArgs = {
  [k: string]: ZodType<string, string> | ZodOptional<ZodType<string, string>>;
};

export type PromptRegistration<Args extends PromptArgs> = {
  name: string;
  config: {
    title?: string;
    description?: string;
    argsSchema?: Args;
  };
  cb: (ctx: RoadieMcpCallContext) => PromptCallback<Args>;
};
