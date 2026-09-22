import { describe, expect, it } from 'vitest';
import type {
  ContextGroupReference,
  ObjectGraphRelationshipSummary,
} from '../../../../api/datastore/datastore-client';
import {
  collapseContextGroups,
  contextGroupNodeKey,
  isContextGroupNodeKey,
  type CollapsibleGraphNode,
} from './collapse-context-groups';

const DS = 'ds-1';

function group(
  groupId: string,
  overrides?: Partial<ContextGroupReference>,
): ContextGroupReference {
  return {
    groupId,
    ruleId: `rule-${groupId}`,
    ruleName: `Rule ${groupId}`,
    title: `Group ${groupId}`,
    ...overrides,
  };
}

function node(
  objectId: string,
  contextGroups?: ContextGroupReference[],
): CollapsibleGraphNode {
  return {
    datasourceId: DS,
    objectId,
    displayName: objectId.toUpperCase(),
    contextGroups,
  };
}

function rel(
  id: string,
  source: string,
  target: string,
  overrides?: Partial<ObjectGraphRelationshipSummary>,
): ObjectGraphRelationshipSummary {
  return {
    id,
    sourceDatasourceId: DS,
    sourceObjectId: source,
    destinationDatasourceId: DS,
    destinationObjectId: target,
    relationshipType: 'uses',
    ruleId: null,
    origin: 'manual',
    ...overrides,
  };
}

const key = (objectId: string) => `${DS}:${objectId}`;

describe('contextGroupNodeKey', () => {
  it('round-trips through the namespace check', () => {
    expect(isContextGroupNodeKey(contextGroupNodeKey('g1'))).toBe(true);
    expect(isContextGroupNodeKey(key('g1'))).toBe(false);
  });
});

describe('collapseContextGroups', () => {
  it('passes an ungrouped graph through untouched, edge ids included', () => {
    const result = collapseContextGroups({
      nodes: [node('a'), node('b')],
      relationships: [rel('e1', 'a', 'b')],
      anchorKeys: new Set([key('a')]),
    });

    expect(result.objectNodes.map(n => n.objectId)).toEqual(['a', 'b']);
    expect(result.groupNodes).toEqual([]);
    expect(result.edges).toEqual([
      expect.objectContaining({
        id: 'e1',
        sourceKey: key('a'),
        targetKey: key('b'),
        direct: true,
      }),
    ]);
    expect(result.edges[0].underlying).toBeUndefined();
    expect(result.edgeIdsByRelationshipId.get('e1')).toEqual(['e1']);
  });

  it('folds members into a group node, drops internal edges, and aggregates external ones', () => {
    const g1 = group('g1');
    const result = collapseContextGroups({
      nodes: [node('root'), node('m1', [g1]), node('m2', [g1]), node('x')],
      relationships: [
        rel('e-internal', 'm1', 'm2'),
        rel('e-out-1', 'm1', 'x'),
        rel('e-out-2', 'm2', 'x'),
      ],
      anchorKeys: new Set([key('root')]),
    });

    expect(result.objectNodes.map(n => n.objectId)).toEqual(['root', 'x']);
    expect(result.groupNodes).toHaveLength(1);
    const groupNode = result.groupNodes[0];
    expect(groupNode.key).toBe(contextGroupNodeKey('g1'));
    expect(groupNode.title).toBe('Group g1');
    expect(groupNode.members.map(m => m.objectId)).toEqual(['m1', 'm2']);

    // Internal edge vanished; the two member→x edges aggregated into one.
    expect(result.edges).toHaveLength(1);
    const [edge] = result.edges;
    expect(edge.sourceKey).toBe(contextGroupNodeKey('g1'));
    expect(edge.targetKey).toBe(key('x'));
    expect(edge.underlying?.map(u => u.id)).toEqual(['e-out-1', 'e-out-2']);
    expect(edge.underlying?.[0].source.label).toBe('M1');
    expect(result.edgeIdsByRelationshipId.get('e-internal')).toEqual([]);
    expect(result.edgeIdsByRelationshipId.get('e-out-1')).toEqual([edge.id]);
  });

  it('never folds an anchor; its co-members still collapse around it', () => {
    const g1 = group('g1');
    const result = collapseContextGroups({
      nodes: [node('root', [g1]), node('m1', [g1])],
      relationships: [rel('e1', 'root', 'm1')],
      anchorKeys: new Set([key('root')]),
    });

    expect(result.objectNodes.map(n => n.objectId)).toEqual(['root']);
    expect(result.groupNodes.map(g => g.groupId)).toEqual(['g1']);
    // root → co-member becomes root → group.
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].sourceKey).toBe(key('root'));
    expect(result.edges[0].targetKey).toBe(contextGroupNodeKey('g1'));
    expect(result.edges[0].underlying).toHaveLength(1);
  });

  it('represents a multi-group object in every group it belongs to', () => {
    const g1 = group('g1');
    const g2 = group('g2');
    const result = collapseContextGroups({
      nodes: [node('root'), node('m', [g2, g1]), node('x')],
      relationships: [rel('e1', 'm', 'x')],
      anchorKeys: new Set([key('root')]),
    });

    // Deterministic order regardless of input order of memberships.
    expect(result.groupNodes.map(g => g.groupId)).toEqual(['g1', 'g2']);
    expect(result.groupKeysByMemberKey.get(key('m'))).toEqual([
      contextGroupNodeKey('g1'),
      contextGroupNodeKey('g2'),
    ]);
    // The relation radiates from both group nodes.
    expect(result.edges.map(edge => [edge.sourceKey, edge.targetKey])).toEqual([
      [contextGroupNodeKey('g1'), key('x')],
      [contextGroupNodeKey('g2'), key('x')],
    ]);
    expect(result.edgeIdsByRelationshipId.get('e1')).toHaveLength(2);
  });

  it('keeps a cross-group edge for the representation pair that is not internal', () => {
    const g1 = group('g1');
    const g2 = group('g2');
    // a ∈ {g1, g2}, c ∈ {g1}: the (g1,g1) pairing is internal, (g2,g1) is not.
    const result = collapseContextGroups({
      nodes: [node('a', [g1, g2]), node('c', [g1])],
      relationships: [rel('e1', 'a', 'c')],
      anchorKeys: new Set(),
    });

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].sourceKey).toBe(contextGroupNodeKey('g2'));
    expect(result.edges[0].targetKey).toBe(contextGroupNodeKey('g1'));
  });

  it('aggregates per relationship type and ANDs the direct flag', () => {
    const g1 = group('g1');
    const result = collapseContextGroups({
      nodes: [node('m1', [g1]), node('m2', [g1]), node('x')],
      relationships: [
        rel('e1', 'm1', 'x', { relationshipType: 'uses' }),
        rel('e2', 'm2', 'x', { relationshipType: 'uses', ruleId: 'r1' }),
        rel('e3', 'm1', 'x', { relationshipType: 'owns' }),
      ],
      anchorKeys: new Set(),
    });

    expect(result.edges).toHaveLength(2);
    const uses = result.edges.find(edge => edge.relationshipType === 'uses')!;
    const owns = result.edges.find(edge => edge.relationshipType === 'owns')!;
    expect(uses.underlying).toHaveLength(2);
    expect(uses.direct).toBe(false);
    expect(owns.underlying).toHaveLength(1);
    expect(owns.direct).toBe(true);
  });

  it('keeps opposite-direction aggregates apart', () => {
    const g1 = group('g1');
    const result = collapseContextGroups({
      nodes: [node('m1', [g1]), node('x')],
      relationships: [rel('e1', 'm1', 'x'), rel('e2', 'x', 'm1')],
      anchorKeys: new Set(),
    });

    expect(result.edges).toHaveLength(2);
    expect(result.edges[0].sourceKey).toBe(contextGroupNodeKey('g1'));
    expect(result.edges[1].sourceKey).toBe(key('x'));
  });

  it('collapses even a single fetched member', () => {
    const g1 = group('g1');
    const result = collapseContextGroups({
      nodes: [node('root'), node('m1', [g1])],
      relationships: [rel('e1', 'root', 'm1')],
      anchorKeys: new Set([key('root')]),
    });

    expect(result.groupNodes).toHaveLength(1);
    expect(result.groupNodes[0].members).toHaveLength(1);
    expect(result.objectNodes.map(n => n.objectId)).toEqual(['root']);
  });

  it('leaves groups listed in expandedGroupIds expanded', () => {
    const g1 = group('g1');
    const result = collapseContextGroups({
      nodes: [node('m1', [g1]), node('x')],
      relationships: [rel('e1', 'm1', 'x')],
      anchorKeys: new Set(),
      expandedGroupIds: new Set(['g1']),
    });

    expect(result.groupNodes).toEqual([]);
    expect(result.objectNodes.map(n => n.objectId)).toEqual(['m1', 'x']);
    expect(result.edges[0].id).toBe('e1');
  });
});
