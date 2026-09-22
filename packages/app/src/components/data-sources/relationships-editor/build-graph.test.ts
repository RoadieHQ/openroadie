import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import type {
  Relationship,
  RelationshipRule,
} from '../../../api/datastore/datastore-client';
import {
  buildDirectRelationshipEdges,
  buildEdgesFromRules,
  buildLegendItems,
  buildNodes,
  buildPendingEdge,
  collectAllFieldPaths,
  DIRECT_AGGREGATE_COLOR,
  DIRECT_AGGREGATE_DASH,
  resolveFieldHandle,
  rulesForRelationshipTypeColors,
  type BuildNodesHandlers,
  type BuildNodesOptions,
} from './build-graph';
import { FALLBACK_RELATIONSHIP_COLOR } from './relationship-edge-style';
import type { SchemaField } from './schema-field-utils';
import { NODE_PREFIX, type EnrichedItem } from './types';
import { createFieldHandleId, normalizeFieldPath } from './workflow-graph-node';

const sourceDatasourceId = 'source-ds';
const targetDatasourceId = 'target-ds';

function makeRule(overrides: Partial<RelationshipRule>): RelationshipRule {
  return {
    id: 'rule-1',
    name: 'rule-1',
    sourceDatasourceId,
    targetDatasourceId,
    sourceFieldExpression: '$._additionalData.members[*].login',
    targetFieldExpression: '$.login',
    relationshipType: 'dependsOn',
    reciprocalRelationshipType: null,
    strategy: 'field-matching',
    matchStrategy: 'exact',
    origin: 'manual',
    state: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
    // Only the fields the builders read are set.
  } as RelationshipRule;
}

describe('buildEdgesFromRules', () => {
  it('resolves persisted JSONata array traversal expressions to nested graph field handles', () => {
    const sourceFields: SchemaField[] = [
      {
        name: '_additionalData',
        type: 'object',
        rawValue: {
          type: 'object',
          properties: {
            members: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  login: { type: 'string' },
                },
              },
            },
          },
        },
      },
    ];
    const sourceSchemaFields = new Set(collectAllFieldPaths(sourceFields));

    expect(sourceSchemaFields).toContain('_additionalData.members.login');
    expect(normalizeFieldPath('$._additionalData.members[*].login')).toBe(
      '_additionalData.members.login',
    );
    expect(
      resolveFieldHandle(
        '_additionalData.members.login',
        new Set(['_additionalData', '_additionalData.members']),
        sourceSchemaFields,
      ),
    ).toBe('_additionalData.members.login');

    const edges = buildEdgesFromRules(
      [makeRule({})],
      new Set([sourceDatasourceId, targetDatasourceId]),
      null,
      new Map([
        [sourceDatasourceId, sourceSchemaFields],
        [targetDatasourceId, new Set(['login'])],
      ]),
      null,
      new Map([
        [`node-${sourceDatasourceId}`, { x: 0, y: 0 }],
        [`node-${targetDatasourceId}`, { x: 300, y: 0 }],
      ]),
      new Map([
        [
          sourceDatasourceId,
          new Set(['_additionalData', '_additionalData.members']),
        ],
      ]),
    );

    expect(edges[0].sourceHandle).toBe(
      createFieldHandleId('right', '_additionalData.members.login', 'rule-1'),
    );
  });
});

function makeDirectEdge(overrides: Partial<Relationship>): Relationship {
  return {
    id: 'edge-1',
    sourceDatasourceId,
    sourceObjectId: 'obj-1',
    destinationDatasourceId: targetDatasourceId,
    destinationObjectId: 'obj-2',
    relationshipType: 'ownedBy',
    reciprocalRelationshipType: null,
    updatedBy: 'user:default/joao',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ruleId: null,
    origin: 'manual',
    ...overrides,
  } as Relationship;
}

describe('buildDirectRelationshipEdges', () => {
  const datasourceIds = new Set([sourceDatasourceId, targetDatasourceId]);
  const positions = new Map([
    [`${NODE_PREFIX}${sourceDatasourceId}`, { x: 0, y: 0 }],
    [`${NODE_PREFIX}${targetDatasourceId}`, { x: 300, y: 0 }],
  ]);

  it('aggregates direct edges per data-source pair with a count label', () => {
    const edges = buildDirectRelationshipEdges(
      [
        makeDirectEdge({ id: 'e1' }),
        makeDirectEdge({ id: 'e2', sourceObjectId: 'obj-3' }),
      ],
      datasourceIds,
      null,
      positions,
      null,
    );

    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe(`${NODE_PREFIX}${sourceDatasourceId}`);
    expect(edges[0].target).toBe(`${NODE_PREFIX}${targetDatasourceId}`);
    expect(edges[0].data?.sourceText).toBe('2 direct relationships');
    expect(edges[0].data?.isDirectAggregate).toBe(true);
    expect(edges[0].data?.pairKey).toBe(
      `${sourceDatasourceId}|${targetDatasourceId}`,
    );
    expect(edges[0].selectable).toBe(true);
    expect(edges[0].data?.isSelected).toBe(false);
  });

  it('skips direct edges folded into a matching rule edge', () => {
    const edges = buildDirectRelationshipEdges(
      [
        makeDirectEdge({ id: 'e1', relationshipType: 'sameIdentityAs' }),
        makeDirectEdge({ id: 'e2', relationshipType: 'dependsOn' }),
      ],
      datasourceIds,
      null,
      positions,
      null,
      new Set([`${sourceDatasourceId}|${targetDatasourceId}|sameIdentityAs`]),
    );

    // The sameIdentityAs edge folds into the rule; only dependsOn remains.
    expect(edges).toHaveLength(1);
    expect(edges[0].data?.sourceText).toBe('1 direct relationship');
  });

  it('marks the selected pair', () => {
    const edges = buildDirectRelationshipEdges(
      [makeDirectEdge({ id: 'e1' })],
      datasourceIds,
      null,
      positions,
      `${sourceDatasourceId}|${targetDatasourceId}`,
    );

    expect(edges[0].data?.isSelected).toBe(true);
  });

  it('keeps distinct pairs as separate edges and skips hidden datasources', () => {
    const edges = buildDirectRelationshipEdges(
      [
        makeDirectEdge({ id: 'e1' }),
        makeDirectEdge({
          id: 'e2',
          sourceDatasourceId: 'hidden-ds',
        }),
        makeDirectEdge({
          id: 'e3',
          sourceDatasourceId: targetDatasourceId,
          destinationDatasourceId: sourceDatasourceId,
        }),
      ],
      datasourceIds,
      null,
      positions,
      null,
    );

    expect(edges).toHaveLength(2);
    expect(edges.map(e => e.data?.sourceText)).toEqual([
      '1 direct relationship',
      '1 direct relationship',
    ]);
  });
});

describe('buildEdgesFromRules direct counts', () => {
  it('carries the folded direct-edge count on the rule edge data', () => {
    const edges = buildEdgesFromRules(
      [makeRule({})],
      new Set([sourceDatasourceId, targetDatasourceId]),
      null,
      new Map(),
      null,
      new Map(),
      new Map(),
      undefined,
      undefined,
      undefined,
      new Map([['rule-1', 3]]),
    );

    expect(edges[0].data?.directCount).toBe(3);
  });
});

describe('rulesForRelationshipTypeColors', () => {
  const datasourceIds = new Set([sourceDatasourceId, targetDatasourceId]);

  it('includes only active, non-suggested rules with visible datasources', () => {
    const rules = [
      makeRule({ id: 'active', relationshipType: 'ownedBy' }),
      makeRule({
        id: 'suggested',
        state: 'suggested',
        relationshipType: 'deployedBy',
      }),
      makeRule({
        id: 'inactive',
        state: 'inactive',
        relationshipType: 'dependsOn',
      }),
      makeRule({
        id: 'hidden',
        sourceDatasourceId: 'other-ds',
        relationshipType: 'partOf',
      }),
    ];

    expect(rulesForRelationshipTypeColors(rules, datasourceIds)).toEqual([
      rules[0],
    ]);
  });
});

describe('buildNodes', () => {
  const noopHandlers: BuildNodesHandlers = {
    onRun: () => {},
    onExpandedFieldsChange: () => {},
    onWidthChange: () => {},
    onWidthChangeEnd: () => {},
    onHide: () => {},
    onToggleEnabled: () => {},
    onRequestDelete: () => {},
  };

  function makeItem(id: string): EnrichedItem {
    return {
      ds: { id, name: id, logoUrl: `${id}.png`, enabled: true } as never,
      schema: undefined,
      schemaFields: [],
    };
  }

  function build(overrides: Partial<BuildNodesOptions> = {}): Node[] {
    return buildNodes({
      items: [makeItem('a'), makeItem('b')],
      positions: new Map(),
      runningIds: new Set(),
      suggestingIds: new Set(),
      nodeWidths: new Map(),
      suggestMode: false,
      editMode: true,
      focusedNodeId: null,
      connectedNodeIds: null,
      scopeSelectedIds: new Set(),
      handlers: noopHandlers,
      ...overrides,
    });
  }

  it('marks the focused node so the focus ring survives a node rebuild', () => {
    const nodes = build({ focusedNodeId: `${NODE_PREFIX}a` });

    expect(nodes.find(n => n.id === `${NODE_PREFIX}a`)?.data.focused).toBe(
      true,
    );
    expect(nodes.find(n => n.id === `${NODE_PREFIX}b`)?.data.focused).toBe(
      false,
    );
  });

  it('dims nodes outside the connected set', () => {
    const nodes = build({
      connectedNodeIds: new Set([`${NODE_PREFIX}a`]),
    });

    expect(nodes.find(n => n.id === `${NODE_PREFIX}a`)?.style?.opacity).toBe(1);
    expect(nodes.find(n => n.id === `${NODE_PREFIX}b`)?.style?.opacity).toBe(
      0.15,
    );
  });

  it('leaves every node undimmed when there is no selection', () => {
    for (const node of build({ connectedNodeIds: null })) {
      expect(node.style?.opacity).toBe(1);
    }
  });

  it('rings the Suggest-mode generation scope', () => {
    const nodes = build({
      suggestMode: true,
      scopeSelectedIds: new Set(['a']),
    });

    expect(
      nodes.find(n => n.id === `${NODE_PREFIX}a`)?.data.scopeSelected,
    ).toBe(true);
    expect(
      nodes.find(n => n.id === `${NODE_PREFIX}b`)?.data.scopeSelected,
    ).toBe(false);
  });

  it('does not ring the scope outside Suggest mode', () => {
    const nodes = build({
      suggestMode: false,
      scopeSelectedIds: new Set(['a']),
    });

    expect(
      nodes.find(n => n.id === `${NODE_PREFIX}a`)?.data.scopeSelected,
    ).toBe(false);
  });

  // The regression this whole signature exists for: the selection flags used
  // to be stamped onto React Flow's node state by an effect keyed only on the
  // selection, so a rebuild triggered by anything else silently dropped them.
  // Rebuilding with an unrelated input changed must not disturb them.
  it('keeps focus, scope and dim across a rebuild from an unrelated input', () => {
    const selection = {
      suggestMode: true,
      focusedNodeId: `${NODE_PREFIX}a`,
      connectedNodeIds: new Set([`${NODE_PREFIX}a`]),
      scopeSelectedIds: new Set(['a']),
    } satisfies Partial<BuildNodesOptions>;

    const before = build(selection);
    // Generate flipping `suggestingIds` is exactly what used to wipe them.
    const after = build({ ...selection, suggestingIds: new Set(['a']) });

    for (const nodeId of [`${NODE_PREFIX}a`, `${NODE_PREFIX}b`]) {
      const a = before.find(n => n.id === nodeId);
      const b = after.find(n => n.id === nodeId);
      expect(b?.data.focused).toBe(a?.data.focused);
      expect(b?.data.scopeSelected).toBe(a?.data.scopeSelected);
      expect(b?.style?.opacity).toBe(a?.style?.opacity);
    }
    expect(after.find(n => n.id === `${NODE_PREFIX}b`)?.style?.opacity).toBe(
      0.15,
    );
  });

  it('keeps the persisted node width while dimming', () => {
    const nodes = build({
      nodeWidths: new Map([['b', 420]]),
      connectedNodeIds: new Set([`${NODE_PREFIX}a`]),
    });

    const dimmed = nodes.find(n => n.id === `${NODE_PREFIX}b`);
    expect(dimmed?.style?.opacity).toBe(0.15);
    expect(dimmed?.style?.width).toBe(420);
  });
});

describe('edge dimming', () => {
  const datasourceIds = new Set([sourceDatasourceId, targetDatasourceId]);

  function buildEdges(selectedRuleId: string | null, focusedNodeId = null) {
    return buildEdgesFromRules(
      [makeRule({ id: 'a' }), makeRule({ id: 'b' })],
      datasourceIds,
      selectedRuleId,
      new Map(),
      focusedNodeId,
      new Map(),
      new Map(),
    );
  }

  it('dims every edge except the selected rule', () => {
    const edges = buildEdges('a');

    expect(edges.find(e => e.data?.ruleId === 'a')?.data?.dimmed).toBe(false);
    expect(edges.find(e => e.data?.ruleId === 'b')?.data?.dimmed).toBe(true);
  });

  it('dims nothing when no rule is selected', () => {
    for (const edge of buildEdges(null)) {
      expect(edge.data?.dimmed).toBe(false);
    }
  });

  it('dims direct aggregates while a rule is selected', () => {
    const [edge] = buildDirectRelationshipEdges(
      [makeDirectEdge({})],
      datasourceIds,
      null,
      new Map(),
      null,
      undefined,
      'some-rule',
    );

    expect(edge.data?.dimmed).toBe(true);
  });
});

// React Flow's own `selected` flag mirrors the canvas selection, so the
// builders derive it. It used to be stamped imperatively by every handler that
// moved the selection (via a ref, because those handlers are declared long
// before the edge state exists), which meant the flag and the selection could
// disagree whenever a handler forgot to mark it.
describe('edge selection is derived', () => {
  const datasourceIds = new Set([sourceDatasourceId, targetDatasourceId]);

  it('marks the selected rule edge and only that one', () => {
    const edges = buildEdgesFromRules(
      [makeRule({ id: 'a' }), makeRule({ id: 'b' })],
      datasourceIds,
      'a',
      new Map(),
      null,
      new Map(),
      new Map(),
    );

    expect(edges.find(e => e.data?.ruleId === 'a')?.selected).toBe(true);
    expect(edges.find(e => e.data?.ruleId === 'b')?.selected).toBe(false);
  });

  it('leaves every rule edge unselected when nothing is selected', () => {
    const edges = buildEdgesFromRules(
      [makeRule({ id: 'a' })],
      datasourceIds,
      null,
      new Map(),
      null,
      new Map(),
      new Map(),
    );

    expect(edges[0].selected).toBe(false);
  });

  it('marks the selected direct-relationship pair', () => {
    const pairKey = `${sourceDatasourceId}|${targetDatasourceId}`;
    const [selected] = buildDirectRelationshipEdges(
      [makeDirectEdge({})],
      datasourceIds,
      null,
      new Map(),
      pairKey,
    );
    const [unselected] = buildDirectRelationshipEdges(
      [makeDirectEdge({})],
      datasourceIds,
      null,
      new Map(),
      null,
    );

    expect(selected.selected).toBe(true);
    expect(unselected.selected).toBe(false);
  });
});

describe('buildLegendItems', () => {
  const colors = new Map([
    ['dependsOn', '#111111'],
    ['ownedBy', '#222222'],
  ]);

  function ruleEdgeData(overrides: Record<string, unknown>) {
    return {
      data: {
        edgeId: 'e',
        sourceText: 'dependsOn',
        targetText: '',
        edgeColor: '#111111',
        isSelected: false,
        isSuggested: false,
        ...overrides,
      },
      // Only `data` matters to the legend.
    } as unknown as Edge;
  }

  it('lists each drawn relationship type once, sorted', () => {
    const items = buildLegendItems(
      [
        ruleEdgeData({ sourceText: 'ownedBy' }),
        ruleEdgeData({ sourceText: 'dependsOn' }),
        ruleEdgeData({ sourceText: 'dependsOn' }),
      ],
      colors,
      false,
    );

    expect(items.map(i => i.type)).toEqual(['dependsOn', 'ownedBy']);
  });

  // Suggested edges use a single review colour, not a per-type one, so they
  // would add a legend row that lies about what the colour means.
  it('excludes suggested edges', () => {
    expect(
      buildLegendItems(
        [ruleEdgeData({ sourceText: 'proposed', isSuggested: true })],
        colors,
        false,
      ),
    ).toEqual([]);
  });

  // Their sourceText is a count ("3 direct relationships"), not a type.
  it('excludes direct aggregates from the per-type rows', () => {
    expect(
      buildLegendItems(
        [
          ruleEdgeData({
            sourceText: '3 direct relationships',
            isDirectAggregate: true,
          }),
        ],
        colors,
        false,
      ),
    ).toEqual([]);
  });

  it('adds one direct-relationships row when any aggregate is drawn', () => {
    const items = buildLegendItems([ruleEdgeData({})], colors, true);

    expect(items.at(-1)).toEqual({
      type: 'direct relationships',
      color: DIRECT_AGGREGATE_COLOR,
      dashPattern: DIRECT_AGGREGATE_DASH,
    });
  });

  it('falls back to the shared colour for an unmapped type', () => {
    const items = buildLegendItems(
      [ruleEdgeData({ sourceText: 'unmapped' })],
      new Map(),
      false,
    );

    expect(items[0].color).toBe(FALLBACK_RELATIONSHIP_COLOR);
  });

  it('skips an edge with no type text', () => {
    expect(
      buildLegendItems([ruleEdgeData({ sourceText: '' })], colors, false),
    ).toEqual([]);
  });
});

describe('buildPendingEdge', () => {
  const connection = {
    sourceDatasourceId,
    targetDatasourceId,
    sourceLabel: 'A',
    targetLabel: 'B',
    sourceFields: [],
    targetFields: [],
  };
  const positions = new Map([
    [`${NODE_PREFIX}${sourceDatasourceId}`, { x: 0, y: 0 }],
    [`${NODE_PREFIX}${targetDatasourceId}`, { x: 300, y: 0 }],
  ]);

  it('draws between the two data sources it connects', () => {
    const edge = buildPendingEdge({
      connection,
      nodePositions: positions,
      expandedFieldsByNode: new Map(),
      schemaFieldsByDatasourceId: new Map(),
    });

    expect(edge?.source).toBe(`${NODE_PREFIX}${sourceDatasourceId}`);
    expect(edge?.target).toBe(`${NODE_PREFIX}${targetDatasourceId}`);
    expect(edge?.data?.isPending).toBe(true);
    // It previews a rule that does not exist yet, so it cannot be picked.
    expect(edge?.selectable).toBe(false);
  });

  it('is nothing without a connection', () => {
    expect(
      buildPendingEdge({
        connection: null,
        nodePositions: positions,
        expandedFieldsByNode: new Map(),
        schemaFieldsByDatasourceId: new Map(),
      }),
    ).toBeNull();
  });

  // Handle sides follow the nodes' relative x, so the edge leaves the facing
  // side of each node rather than crossing back over it.
  it('picks handle sides from the nodes relative positions', () => {
    const leftToRight = buildPendingEdge({
      connection,
      nodePositions: positions,
      expandedFieldsByNode: new Map(),
      schemaFieldsByDatasourceId: new Map(),
    });
    const rightToLeft = buildPendingEdge({
      connection,
      nodePositions: new Map([
        [`${NODE_PREFIX}${sourceDatasourceId}`, { x: 300, y: 0 }],
        [`${NODE_PREFIX}${targetDatasourceId}`, { x: 0, y: 0 }],
      ]),
      expandedFieldsByNode: new Map(),
      schemaFieldsByDatasourceId: new Map(),
    });

    expect(leftToRight?.sourceHandle).not.toBe(rightToLeft?.sourceHandle);
  });

  it('anchors to a field handle when the connection names a field', () => {
    const edge = buildPendingEdge({
      connection: { ...connection, initialSourceField: 'login' },
      nodePositions: positions,
      expandedFieldsByNode: new Map(),
      schemaFieldsByDatasourceId: new Map([
        [sourceDatasourceId, new Set(['login'])],
      ]),
    });

    expect(edge?.sourceHandle).toBe(createFieldHandleId('right', 'login'));
  });

  it('falls back to the node handle when the named field is not in the schema', () => {
    const edge = buildPendingEdge({
      connection: { ...connection, initialSourceField: 'ghost' },
      nodePositions: positions,
      expandedFieldsByNode: new Map(),
      schemaFieldsByDatasourceId: new Map([
        [sourceDatasourceId, new Set(['login'])],
      ]),
    });

    expect(edge?.sourceHandle).toBe('handle-right');
  });
});
