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
import { Counter, Gauge, Histogram, register } from 'prom-client';

export const toolCallsCounter: Counter<'service' | 'tool' | 'status'> =
  (register.getSingleMetric('mcp_tool_calls_total') as Counter<
    'service' | 'tool' | 'status'
  >) ??
  new Counter({
    name: 'mcp_tool_calls_total',
    help: 'Total number of MCP tool invocations',
    labelNames: ['service', 'tool', 'status'] as const,
  });

export const toolDurationHistogram: Histogram<'service' | 'tool'> =
  (register.getSingleMetric('mcp_tool_duration_seconds') as Histogram<
    'service' | 'tool'
  >) ??
  new Histogram({
    name: 'mcp_tool_duration_seconds',
    help: 'Duration of MCP tool executions in seconds',
    labelNames: ['service', 'tool'] as const,
    buckets: [0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10, 30],
  });

export const sseConnectionsGauge: Gauge<'service'> =
  (register.getSingleMetric(
    'mcp_sse_connections_active',
  ) as Gauge<'service'>) ??
  new Gauge({
    name: 'mcp_sse_connections_active',
    help: 'Number of active MCP SSE connections',
    labelNames: ['service'] as const,
  });
