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
  NodeTypeDefinition,
  NodeCategory,
  WorkflowType,
} from '@roadiehq/catalog-workflow-common';
import type { PagedNodeHandler } from './paged/node-contract';

export interface RegisteredNodeType extends NodeTypeDefinition {
  /**
   * Absent only for trigger nodes: a trigger's firing is the execution, so the
   * executor completes it synthetically and never runs a handler for it. Every
   * other node type is rejected at run time without one.
   */
  pagedHandler?: PagedNodeHandler;
  usesMergeJoin?: boolean;
}

export class NodeRegistry {
  private readonly nodes = new Map<string, RegisteredNodeType>();
  private readonly logger: LoggerService;

  constructor(options: { logger: LoggerService }) {
    this.logger = options.logger.child({ name: 'NodeRegistry' });
  }

  register(node: RegisteredNodeType): void {
    if (this.nodes.has(node.type)) {
      this.logger.warn(
        `Node type ${node.type} is already registered, overwriting`,
      );
    }

    this.nodes.set(node.type, node);
    this.logger.info(`Registered node type: ${node.type}`);
  }

  registerAll(nodes: RegisteredNodeType[]): void {
    for (const node of nodes) {
      this.register(node);
    }
  }

  get(type: string): RegisteredNodeType | undefined {
    return this.nodes.get(type);
  }

  getAll(): RegisteredNodeType[] {
    return Array.from(this.nodes.values());
  }

  getByCategory(category: NodeCategory): RegisteredNodeType[] {
    return this.getAll().filter(node => node.category === category);
  }

  getDefinitions(): NodeTypeDefinition[] {
    return this.getAll().map(
      ({
        pagedHandler: _pagedHandler,
        usesMergeJoin: _usesMergeJoin,
        ...definition
      }) => definition,
    );
  }

  getDefinitionsByWorkflowType(
    workflowType?: WorkflowType,
  ): NodeTypeDefinition[] {
    return this.getDefinitions().filter(
      node =>
        !workflowType ||
        !node.workflowTypes ||
        node.workflowTypes.includes(workflowType),
    );
  }

  getDefinition(type: string): NodeTypeDefinition | undefined {
    const node = this.get(type);
    if (!node) {
      return undefined;
    }

    const { pagedHandler: _pagedHandler, ...definition } = node;
    return definition;
  }

  has(type: string): boolean {
    return this.nodes.has(type);
  }
}
