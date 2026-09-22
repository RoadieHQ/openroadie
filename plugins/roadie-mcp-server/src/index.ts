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
export {
  mcpServerPlugin as default,
  mcpServiceExtensionPoint,
  mcpEventSinkExtensionPoint,
} from './plugin';
export type { McpEventSinkExtensionPoint } from './plugin';
export * from './types';
export { McpService } from './services/McpService';
export { SessionTelemetryStore } from './stores/session-telemetry-store';
export type {
  SessionTelemetryEvent,
  SessionTelemetryInsert,
  SessionTelemetryQueryParams,
  SessionTelemetryFacets,
} from './stores/session-telemetry-store';
