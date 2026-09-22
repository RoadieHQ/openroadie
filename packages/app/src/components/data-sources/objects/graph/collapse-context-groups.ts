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

import type {
  ContextGroupReference,
  ObjectGraphRelationshipSummary,
} from '../../../../api/datastore/datastore-client';
import { objectGraphNodeId } from './object-graph-focus';

/**
 * Presentation-level collapse of a fetched object graph into context-group
 * nodes. The traversal (depth, node limits, hidden-neighbor counts) is
 * untouched — this folds the nodes that happened to be fetched:
 *
 * - An object in N groups is represented by ALL N group nodes (its relations
 *   radiate from each); anchors (the ego root, paths endpoints) never fold.
 * - An edge maps to every (source rep, target rep) pairing; pairings that
 *   land on the same group node are internal and disappear into it.
 * - Group-touching edges aggregate per (source, target, relationship type)
 *   and carry their underlying member relationships for the drawer.
 * - Object↔object edges pass through untouched, ids included.
 *
 * Pure functions, no rendering concerns.
 */

/** Namespaced so group-node keys can't collide with `${dsId}:${objectId}`
 * object keys (datasource ids are UUIDs, never `group`). */
const CONTEXT_GROUP_NODE_PREFIX = 'group:';

export function contextGroupNodeKey(groupId: string): string {
  return `${CONTEXT_GROUP_NODE_PREFIX}${groupId}`;
}

export function isContextGroupNodeKey(key: string): boolean {
  return key.startsWith(CONTEXT_GROUP_NODE_PREFIX);
}

/** Minimum node shape the collapse needs; both graph modes' summaries fit. */
export interface CollapsibleGraphNode {
  datasourceId: string;
  objectId: string;
  displayName: string;
  contextGroups?: ContextGroupReference[];
}

export interface CollapsedGroupMember {
  datasourceId: string;
  objectId: string;
  label: string;
}

export interface CollapsedGroupNode {
  key: string;
  groupId: string;
  ruleId: string;
  ruleName: string;
  title: string;
  /** The fetched objects folded into this node — NOT the group's full
   * roster, which may extend beyond the traversal. */
  members: CollapsedGroupMember[];
}

export interface CollapsedEdgeEndpoint {
  datasourceId: string;
  objectId: string;
  label: string;
}

/** One member relationship folded into a group-touching edge. */
export interface CollapsedUnderlyingRelationship {
  id: string;
  relationshipType: string;
  ruleId: string | null;
  source: CollapsedEdgeEndpoint;
  target: CollapsedEdgeEndpoint;
}

export interface CollapsedGraphEdge {
  /** The original relationship id for a pass-through object↔object edge;
   * synthetic (and stable) for group-touching aggregates. */
  id: string;
  sourceKey: string;
  targetKey: string;
  relationshipType: string;
  /** True when every folded relationship is hand-asserted (no rule). */
  direct: boolean;
  ruleId: string | null;
  /** Present only on group-touching edges: the member relationships this
   * aggregate stands for (length 1 is possible and still aggregated). */
  underlying?: CollapsedUnderlyingRelationship[];
}

export interface CollapseContextGroupsResult<N extends CollapsibleGraphNode> {
  /** Object nodes that stayed expanded: anchors and ungrouped objects. */
  objectNodes: N[];
  groupNodes: CollapsedGroupNode[];
  edges: CollapsedGraphEdge[];
  /** For each folded object's key, the group-node keys standing in for it
   * (e.g. to move a selection ring onto the containing groups). */
  groupKeysByMemberKey: Map<string, string[]>;
  /** relationship id → the collapsed edge id(s) it contributes to. Internal
   * (same-group) relationships map to an empty array. */
  edgeIdsByRelationshipId: Map<string, string[]>;
}

/** Non-printable separator: object ids are arbitrary text, so printable
 * separators could collide across keys. */
const AGGREGATE_SEPARATOR = '\u001f';

function aggregateEdgeId(
  sourceKey: string,
  targetKey: string,
  relationshipType: string,
): string {
  return `cg-edge:${sourceKey}${AGGREGATE_SEPARATOR}${targetKey}${AGGREGATE_SEPARATOR}${relationshipType}`;
}

export function collapseContextGroups<N extends CollapsibleGraphNode>(options: {
  nodes: N[];
  relationships: ObjectGraphRelationshipSummary[];
  /** Node keys that must stay expanded (the ego root, paths endpoints). */
  anchorKeys: ReadonlySet<string>;
  /** Groups to leave expanded — reserved for a future per-group override. */
  expandedGroupIds?: ReadonlySet<string>;
}): CollapseContextGroupsResult<N> {
  const { nodes, relationships, anchorKeys, expandedGroupIds } = options;

  const objectNodes: N[] = [];
  const groupNodesByKey = new Map<string, CollapsedGroupNode>();
  const groupKeysByMemberKey = new Map<string, string[]>();
  // Every node's display representation(s): itself, or its group node(s).
  const repsByKey = new Map<string, string[]>();
  const labelByKey = new Map<string, string>();

  for (const node of nodes) {
    const key = objectGraphNodeId(node.datasourceId, node.objectId);
    labelByKey.set(key, node.displayName);
    const groups = (node.contextGroups ?? []).filter(
      group => !expandedGroupIds?.has(group.groupId),
    );
    if (anchorKeys.has(key) || groups.length === 0) {
      objectNodes.push(node);
      repsByKey.set(key, [key]);
      continue;
    }
    const sorted = [...groups].sort(
      (a, b) =>
        a.ruleName.localeCompare(b.ruleName) ||
        a.title.localeCompare(b.title) ||
        a.groupId.localeCompare(b.groupId),
    );
    const repKeys: string[] = [];
    for (const group of sorted) {
      const groupKey = contextGroupNodeKey(group.groupId);
      repKeys.push(groupKey);
      const existing = groupNodesByKey.get(groupKey);
      const member: CollapsedGroupMember = {
        datasourceId: node.datasourceId,
        objectId: node.objectId,
        label: node.displayName,
      };
      if (existing) {
        existing.members.push(member);
      } else {
        groupNodesByKey.set(groupKey, {
          key: groupKey,
          groupId: group.groupId,
          ruleId: group.ruleId,
          ruleName: group.ruleName,
          title: group.title,
          members: [member],
        });
      }
    }
    repsByKey.set(key, repKeys);
    groupKeysByMemberKey.set(key, repKeys);
  }

  const edges: CollapsedGraphEdge[] = [];
  const aggregateByKey = new Map<string, CollapsedGraphEdge>();
  const edgeIdsByRelationshipId = new Map<string, string[]>();

  for (const relationship of relationships) {
    const sourceKey = objectGraphNodeId(
      relationship.sourceDatasourceId,
      relationship.sourceObjectId,
    );
    const targetKey = objectGraphNodeId(
      relationship.destinationDatasourceId,
      relationship.destinationObjectId,
    );
    // Endpoints outside the node set (defensive) represent themselves.
    const sourceReps = repsByKey.get(sourceKey) ?? [sourceKey];
    const targetReps = repsByKey.get(targetKey) ?? [targetKey];
    const contributed: string[] = [];

    if (
      sourceReps.length === 1 &&
      targetReps.length === 1 &&
      sourceReps[0] === sourceKey &&
      targetReps[0] === targetKey
    ) {
      // Both endpoints stayed expanded: the edge passes through untouched
      // (self-loops included), so ids and parallel edges behave as today.
      edges.push({
        id: relationship.id,
        sourceKey,
        targetKey,
        relationshipType: relationship.relationshipType,
        direct:
          relationship.ruleId === null || relationship.ruleId === undefined,
        ruleId: relationship.ruleId ?? null,
      });
      edgeIdsByRelationshipId.set(relationship.id, [relationship.id]);
      continue;
    }

    const underlying: CollapsedUnderlyingRelationship = {
      id: relationship.id,
      relationshipType: relationship.relationshipType,
      ruleId: relationship.ruleId ?? null,
      source: {
        datasourceId: relationship.sourceDatasourceId,
        objectId: relationship.sourceObjectId,
        label: labelByKey.get(sourceKey) ?? relationship.sourceObjectId,
      },
      target: {
        datasourceId: relationship.destinationDatasourceId,
        objectId: relationship.destinationObjectId,
        label: labelByKey.get(targetKey) ?? relationship.destinationObjectId,
      },
    };

    for (const sourceRep of sourceReps) {
      for (const targetRep of targetReps) {
        // A pairing folded into one group node is internal to that group.
        if (sourceRep === targetRep) {
          continue;
        }
        const id = aggregateEdgeId(
          sourceRep,
          targetRep,
          relationship.relationshipType,
        );
        const direct =
          relationship.ruleId === null || relationship.ruleId === undefined;
        const existing = aggregateByKey.get(id);
        if (existing) {
          existing.underlying!.push(underlying);
          existing.direct = existing.direct && direct;
          if (existing.ruleId !== (relationship.ruleId ?? null)) {
            existing.ruleId = null;
          }
        } else {
          const edge: CollapsedGraphEdge = {
            id,
            sourceKey: sourceRep,
            targetKey: targetRep,
            relationshipType: relationship.relationshipType,
            direct,
            ruleId: relationship.ruleId ?? null,
            underlying: [underlying],
          };
          aggregateByKey.set(id, edge);
          edges.push(edge);
        }
        contributed.push(id);
      }
    }
    edgeIdsByRelationshipId.set(relationship.id, contributed);
  }

  const groupNodes = [...groupNodesByKey.values()].sort(
    (a, b) =>
      a.ruleName.localeCompare(b.ruleName) ||
      a.title.localeCompare(b.title) ||
      a.groupId.localeCompare(b.groupId),
  );
  for (const group of groupNodes) {
    group.members.sort(
      (a, b) =>
        a.label.localeCompare(b.label) || a.objectId.localeCompare(b.objectId),
    );
  }

  return {
    objectNodes,
    groupNodes,
    edges,
    groupKeysByMemberKey,
    edgeIdsByRelationshipId,
  };
}
