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
import { AgentCallOptions, ToolsetBuilder } from '@roadiehq/ai-node';
import { createMCPClient, MCPClient } from '@ai-sdk/mcp';
import { Tool, ToolExecutionOptions } from 'ai';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export class RoadieMCPClientBuilder implements ToolsetBuilder {
  private mcpClient?: MCPClient;

  constructor(
    private readonly url: string,
    _name: string,
  ) {}

  connect = async ({ runtimeContext }: AgentCallOptions) => {
    const token = runtimeContext.token;

    if (typeof token !== 'string') {
      throw new Error('Token is not a string');
    }

    const transport = new StreamableHTTPClientTransport(new URL(this.url), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    this.mcpClient = await createMCPClient({
      transport,
    });
  };

  disconnect = () => {
    this.mcpClient?.close();
  };

  getToolset = async () => {
    if (!this.mcpClient) {
      throw new Error('MCP client is not connected');
    }

    const mcpTools = await this.mcpClient.tools();

    const wrappedTools: Record<string, Tool> = {};
    for (const [toolName, tool] of Object.entries(mcpTools)) {
      wrappedTools[toolName] = {
        ...tool,
        execute: async (input: unknown, options: ToolExecutionOptions) => {
          const result = await tool.execute(input, options);

          if (
            result &&
            typeof result === 'object' &&
            'structuredContent' in result &&
            'content' in result
          ) {
            const { content: _content, ...rest } = result;
            return rest;
          }

          return result;
        },
      };
    }

    return wrappedTools;
  };
}
