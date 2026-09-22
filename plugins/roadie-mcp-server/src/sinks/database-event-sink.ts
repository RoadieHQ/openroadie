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
import { Knex } from 'knex';
import { v4 as uuid } from 'uuid';
import { McpEventSink, McpToolCallEvent } from '../types';

const TABLE = 'mcp_tool_call_log';

export class DatabaseEventSink implements McpEventSink {
  private lastCleanup = 0;
  private static readonly CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  constructor(
    private readonly knex: Knex,
    private readonly retentionDays: number,
  ) {}

  table() {
    return this.knex(TABLE);
  }

  async emit(event: McpToolCallEvent): Promise<void> {
    if (!event.workspaceId) {
      throw new Error('MCP event workspace is required');
    }
    await this.table().insert({
      id: uuid(),
      workspace_id: event.workspaceId,
      correlation_id: event.correlationId,
      service: event.service,
      tool: event.tool,
      status: event.status,
      duration_ms: event.durationMs,
      customer_id: event.customerId ?? null,
      tool_input: event.toolInput ? JSON.stringify(event.toolInput) : null,
      tool_output:
        event.toolOutput !== undefined
          ? JSON.stringify(event.toolOutput)
          : null,
      input_tokens: event.inputTokens ?? null,
      output_tokens: event.outputTokens ?? null,
      error_message: event.errorMessage ?? null,
      created_at: event.timestamp,
    });

    await this.maybeCleanup();
  }

  private async maybeCleanup(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCleanup < DatabaseEventSink.CLEANUP_INTERVAL_MS) {
      return;
    }
    this.lastCleanup = now;

    const cutoff = new Date(
      now - this.retentionDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    await this.knex(TABLE).where('created_at', '<', cutoff).del();
  }
}
