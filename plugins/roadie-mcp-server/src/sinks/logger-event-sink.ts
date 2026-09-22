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
import { LoggerService } from '@roadiehq/extensions-api';
import { McpEventSink, McpToolCallEvent } from '../types';

export class LoggerEventSink implements McpEventSink {
  constructor(private readonly logger: LoggerService) {}

  emit(event: McpToolCallEvent): void {
    const fields = {
      correlationId: event.correlationId,
      service: event.service,
      tool: event.tool,
      durationMs: event.durationMs,
      status: event.status,
      customerId: event.customerId,
      scopeId: event.scopeId,
      workspaceId: event.workspaceId,
      timestamp: event.timestamp,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
    };
    if (event.status === 'error') {
      this.logger.error('MCP tool threw', {
        ...fields,
        errorMessage: event.errorMessage,
      });
    } else {
      this.logger.info('MCP tool called', fields);
    }
  }
}
