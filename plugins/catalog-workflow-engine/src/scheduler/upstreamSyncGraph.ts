/*
 * Copyright 2026 Larder Software Limited
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
  NODE_TYPES,
  WorkflowDefinition,
  WorkflowNode,
} from '@roadiehq/catalog-workflow-common';

const LIST_PAGE_SIZE = 1000;

/**
 * The dependency graph is only correct if every workflow is visible to the
 * walk, so callers must never build it from a single capped page.
 */
export async function listAllWorkflows(
  workflowDao: {
    list: (options: {
      limit: number;
      offset: number;
      workspaceId?: string;
    }) => Promise<{ workflows: WorkflowDefinition[]; total: number }>;
  },
  workspaceId?: string,
): Promise<WorkflowDefinition[]> {
  const workflows: WorkflowDefinition[] = [];
  for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
    const page = await workflowDao.list({
      limit: LIST_PAGE_SIZE,
      offset,
      workspaceId,
    });
    workflows.push(...page.workflows);
    if (workflows.length >= page.total || page.workflows.length === 0) {
      break;
    }
  }
  return workflows;
}

export const MAX_UPSTREAM_SYNC_CHAIN_DEPTH = 10;

export type UpstreamSyncWalkResult =
  | { ok: true }
  | { ok: false; reason: 'cycle' | 'depth' };

function upstreamIdsOf(nodes: WorkflowNode[]): string[] {
  return nodes
    .filter(n => n.type === NODE_TYPES.SOURCE_DATASTORE)
    .map(n => n.data?.config?.datasourceId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

export function getUpstreamDatasourceIds(
  workflow: Pick<WorkflowDefinition, 'nodes'>,
): string[] {
  return upstreamIdsOf(workflow.nodes);
}

export function getUpstreamDatasourceIdsFromNodes(
  nodes: WorkflowNode[],
): string[] {
  return upstreamIdsOf(nodes);
}

export function walkUpstreamSyncChain(
  workflowId: string,
  workflows: Array<Pick<WorkflowDefinition, 'id' | 'nodes'>>,
  maxDepth = MAX_UPSTREAM_SYNC_CHAIN_DEPTH,
): UpstreamSyncWalkResult {
  const upstreamsByWorkflowId = new Map<string, string[]>();
  for (const workflow of workflows) {
    const upstreamIds = getUpstreamDatasourceIds(workflow);
    if (upstreamIds.length > 0) {
      upstreamsByWorkflowId.set(workflow.id, upstreamIds);
    }
  }

  const walk = (
    currentId: string,
    depth: number,
    path: Set<string>,
  ): UpstreamSyncWalkResult => {
    const upstreamIds = upstreamsByWorkflowId.get(currentId) ?? [];
    if (upstreamIds.length === 0) {
      return { ok: true };
    }
    if (depth >= maxDepth) {
      return { ok: false, reason: 'depth' };
    }
    for (const upstreamId of upstreamIds) {
      if (path.has(upstreamId)) {
        return { ok: false, reason: 'cycle' };
      }
      path.add(upstreamId);
      const result = walk(upstreamId, depth + 1, path);
      if (!result.ok) {
        return result;
      }
      path.delete(upstreamId);
    }
    return { ok: true };
  };

  return walk(workflowId, 0, new Set([workflowId]));
}
