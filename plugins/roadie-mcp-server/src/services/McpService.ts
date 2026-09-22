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
  McpServer,
  ReadResourceCallback,
  ToolCallback,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { LoggerService } from '@roadiehq/extensions-api';
import {
  ALL_SCOPES,
  createScopeChecker,
  type ScopeChecker,
} from '@roadiehq/scopes';
import { ZodRawShape } from 'zod';
import { version } from '../../package.json';
import {
  McpEventSink,
  PromptArgs,
  PromptRegistration,
  ResourceRegistration,
  RoadieMcpCallContext,
  ToolRegistration,
} from '../types';
import { toolCallsCounter, toolDurationHistogram } from '../metrics';
import { redactSensitiveValues, redactValue } from '../redact';
import { countTokens } from '../token-count';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- type erasure for heterogeneous tool collections
type AnyToolRegistration = ToolRegistration<any>;

export class McpService {
  private readonly _name: string;
  private readonly _tools: AnyToolRegistration[];
  private readonly _resources: ResourceRegistration[];
  private readonly _prompts: PromptRegistration<PromptArgs>[];
  private readonly _instructions?: string;

  get name() {
    return this._name;
  }
  get instructions() {
    return this._instructions;
  }
  get tools() {
    return this._tools;
  }
  get resources() {
    return this._resources;
  }
  get prompts() {
    return this._prompts;
  }

  constructor(
    name: string,
    {
      tools,
      resources,
      prompts,
      instructions,
    }: {
      tools: AnyToolRegistration[];
      resources: ResourceRegistration[];
      prompts: PromptRegistration<PromptArgs>[];
      instructions?: string;
    },
  ) {
    this._name = name;
    this._tools = tools;
    this._resources = resources;
    this._prompts = prompts;
    this._instructions = instructions;
  }

  static create(
    name: string,
    opts: {
      tools?: AnyToolRegistration[];
      resources?: ResourceRegistration[];
      prompts?: PromptRegistration<PromptArgs>[];
      instructions?: string;
    } = {},
  ) {
    return new McpService(name, {
      tools: opts.tools ?? [],
      resources: opts.resources ?? [],
      prompts: opts.prompts ?? [],
      instructions: opts.instructions,
    });
  }

  getServer(
    ctx: RoadieMcpCallContext,
    logger: LoggerService,
    eventSink?: McpEventSink,
  ) {
    // Declaring a capability the SDK has no registrations for leaves its
    // `*/list` handler unwired, so the client gets -32601 instead of an empty
    // list. `tools` is safe unconditionally — see the placeholder below.
    const server = new McpServer(
      {
        name: this.name,
        version,
      },
      {
        capabilities: {
          tools: {},
          ...(this.resources.length > 0 ? { resources: {} } : {}),
          ...(this.prompts.length > 0 ? { prompts: {} } : {}),
        },
        instructions: this.instructions,
      },
    );

    // No checker on the context (some test/legacy call sites) means allow-all.
    const checker = ctx.scopeChecker ?? createScopeChecker(ALL_SCOPES);

    let registeredAnyTool = false;
    this.tools.forEach(tool => {
      // Hide tools the caller can't reach so they never appear in `tools/list`.
      if (!checker.allowsFamily(tool.scope)) {
        return;
      }
      server.registerTool(
        tool.name,
        tool.config,
        this.instrumentToolCallback(tool, ctx, checker, logger, eventSink),
      );
      registeredAnyTool = true;
    });

    // The MCP SDK only wires up the `tools/list` request handler the first time
    // a tool is registered. When a caller's scopes filter out every tool (e.g.
    // `deny:all`), skipping registration entirely leaves the handler unwired, so
    // `tools/list` answers with `-32601 Method not found` instead of an empty
    // list. Register a placeholder and immediately remove it to force the
    // handler into place; `remove()` deletes the tool but leaves the handler
    // wired, so the caller gets an empty (but valid) tool list.
    if (!registeredAnyTool) {
      server
        .registerTool(
          '__scope_placeholder__',
          { description: 'internal placeholder' },
          async () => ({ content: [] }),
        )
        .remove();
    }

    this.resources.forEach(resource => {
      server.registerResource(
        resource.name,
        resource.uriOrTemplate as string,
        resource.config,
        resource.cb(ctx) as ReadResourceCallback,
      );
    });

    this.prompts.forEach(prompt => {
      server.registerPrompt(prompt.name, prompt.config, prompt.cb(ctx));
    });

    return server;
  }

  private instrumentToolCallback(
    tool: AnyToolRegistration,
    ctx: RoadieMcpCallContext,
    checker: ScopeChecker,
    logger: LoggerService,
    eventSink?: McpEventSink,
  ): ToolCallback<ZodRawShape> {
    const originalCb = tool.cb(ctx) as ToolCallback<ZodRawShape>;
    const service = this.name;
    const toolName = tool.name;
    const tracking = ctx.tracking;
    const correlationId = ctx.correlationId;

    return async (args, extra) => {
      const toolInput = args as Record<string, unknown> | undefined;
      const redactedInput = redactSensitiveValues(toolInput);
      const inputTokens = countTokens(redactedInput);

      // Re-check at call time: a tool visible because the caller holds one target
      // (`action:execute:action-1`) must still reject other targets. A
      // family-scoped collection tool instead admits any target in the family
      // and filters its own results.
      const target = tool.scopeTarget?.(toolInput ?? {});
      const requiredScope = target ? `${tool.scope}:${target}` : tool.scope;
      const admitted = tool.familyScope
        ? checker.allowsFamily(tool.scope)
        : checker.allows(requiredScope);
      if (!admitted) {
        const errorMessage = `insufficient scope: requires ${
          tool.familyScope
            ? `${tool.scope} (or a narrowed target)`
            : requiredScope
        }`;
        toolCallsCounter.inc({ service, tool: toolName, status: 'error' });
        if (eventSink) {
          eventSink.emit({
            correlationId,
            service,
            tool: toolName,
            durationMs: 0,
            status: 'error',
            customerId: tracking?.customerId,
            scopeId: tracking?.scopeId,
            workspaceId: tracking?.workspaceId,
            timestamp: new Date().toISOString(),
            toolInput: redactedInput,
            inputTokens,
            errorMessage,
          });
        }
        return {
          content: [{ type: 'text', text: errorMessage }],
          isError: true,
        };
      }

      const endTimer = toolDurationHistogram.startTimer({
        service,
        tool: toolName,
      });
      const startMs = Date.now();

      try {
        const result = await originalCb(args, extra);
        const durationMs = Date.now() - startMs;
        const status = result.isError ? 'error' : 'success';

        endTimer();
        toolCallsCounter.inc({ service, tool: toolName, status });

        const toolOutput = redactValue(
          result.structuredContent ?? result.content,
        );
        const outputTokens = countTokens(toolOutput);

        if (eventSink) {
          eventSink.emit({
            correlationId,
            service,
            tool: toolName,
            durationMs,
            status,
            customerId: tracking?.customerId,
            scopeId: tracking?.scopeId,
            workspaceId: tracking?.workspaceId,
            timestamp: new Date(startMs).toISOString(),
            toolInput: redactedInput,
            toolOutput,
            inputTokens,
            outputTokens,
          });
        } else {
          logger.info('MCP tool called', {
            service,
            tool: toolName,
            durationMs,
            status,
            customerId: tracking?.customerId,
            scopeId: tracking?.scopeId,
            workspaceId: tracking?.workspaceId,
          });
        }

        return result;
      } catch (error: unknown) {
        const durationMs = Date.now() - startMs;

        endTimer();
        toolCallsCounter.inc({
          service,
          tool: toolName,
          status: 'error',
        });

        const errorMessage =
          error instanceof Error ? error.message : String(error);

        if (eventSink) {
          eventSink.emit({
            correlationId,
            service,
            tool: toolName,
            durationMs,
            status: 'error',
            customerId: tracking?.customerId,
            scopeId: tracking?.scopeId,
            workspaceId: tracking?.workspaceId,
            timestamp: new Date(startMs).toISOString(),
            toolInput: redactedInput,
            inputTokens,
            errorMessage,
          });
        } else {
          logger.error('MCP tool threw', {
            service,
            tool: toolName,
            durationMs,
            customerId: tracking?.customerId,
            scopeId: tracking?.scopeId,
            workspaceId: tracking?.workspaceId,
            error: errorMessage,
          });
        }

        throw error;
      }
    };
  }
}
