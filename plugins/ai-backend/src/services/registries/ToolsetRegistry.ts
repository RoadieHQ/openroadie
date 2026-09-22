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
  ToolsetRef,
  ToolsetRegistry,
  ToolsetBuilder,
  Tool,
} from '@roadiehq/ai-node';

const isToolsetBuilder = (
  builder: ToolsetBuilder | Record<string, Tool>,
): builder is ToolsetBuilder => {
  return (builder as ToolsetBuilder).getToolset !== undefined;
};

class StaticToolsetBuilder implements ToolsetBuilder {
  constructor(private readonly toolset: Record<string, Tool>) {}
  getToolset = async (): Promise<Record<string, Tool>> => {
    return this.toolset;
  };
}

export class DefaultToolsetRegistry implements ToolsetRegistry {
  private toolsets = new Map<ToolsetRef, ToolsetBuilder>();

  constructor(private readonly logger: LoggerService) {}

  registerToolset(
    ref: ToolsetRef,
    toolset: ToolsetBuilder | Record<string, Tool>,
  ): void {
    this.logger.info(`Registering tool: ${ref.id}`);
    this.toolsets.set(
      ref,
      isToolsetBuilder(toolset) ? toolset : new StaticToolsetBuilder(toolset),
    );
  }

  getToolsetBuilder(ref: ToolsetRef): ToolsetBuilder | undefined {
    return this.toolsets.get(ref);
  }

  listToolsetBuilders(): ToolsetRef[] {
    return Array.from(this.toolsets.keys());
  }

  getToolsetBuilders(): Map<ToolsetRef, ToolsetBuilder> {
    return this.toolsets;
  }
}
