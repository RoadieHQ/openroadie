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
import {
  AgentRegistry,
  AgentConfig,
  AgentRef,
  ToolsetRef,
} from '@roadiehq/ai-node';

export class DefaultAgentRegistry implements AgentRegistry {
  private readonly agents = new Map<AgentRef, AgentConfig>();
  private readonly frontendAgents = new Map<string, AgentRef>();
  private readonly toolsets = new Map<AgentRef, Array<ToolsetRef>>();

  constructor(private readonly logger: LoggerService) {}

  getAttachedToolsets(ref: AgentRef): Array<ToolsetRef> {
    return this.toolsets.get(ref) ?? [];
  }

  attachToolset(ref: AgentRef, toolsetRef: ToolsetRef) {
    this.toolsets.set(ref, [toolsetRef, ...(this.toolsets.get(ref) ?? [])]);
  }

  getExposedAgents(): Map<string, AgentRef> {
    return this.frontendAgents;
  }

  registerAgent(ref: AgentRef, agent: AgentConfig): void {
    this.logger.info(`Registering agent: ${ref.id}`);
    this.agents.set(ref, agent);
  }

  exposeAgent(ref: AgentRef, path: string): void {
    this.frontendAgents.set(path, ref);
  }

  getAgent(ref: AgentRef): AgentConfig | undefined {
    return this.agents.get(ref);
  }

  listAgents(): AgentRef[] {
    return Array.from(this.agents.keys());
  }

  getAgents(): Map<AgentRef, AgentConfig> {
    return this.agents;
  }
}
