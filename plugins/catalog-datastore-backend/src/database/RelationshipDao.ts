import type { Knex } from 'knex';
import {
  DEFAULT_WORKSPACE_ID,
  workspaceOwnershipFields,
} from '@roadiehq/workspaces-backend';
import {
  Relationship,
  RelationshipInput,
  RelationshipQueryParams,
  RelationshipRow,
} from './types';
import {
  ObjectRelationship,
  type GraphEdgeOriginFilter,
  type GraphTraversalDirection,
  type ObjectGraphRelationshipSummary,
  type RelationshipSummaryItem,
} from '@roadiehq/catalog-datastore-common';
import { parseJsonColumn } from './json';

const RELATIONSHIP_TABLE_NAME = 'datastore_relation';
// Objects live in ObjectDao's table; the graph traversals only probe it for
// existence (dangling relationship endpoints must not surface as nodes).
const OBJECT_TABLE_NAME = 'datastore';

/** Work bound for the rooted-walk recursive CTE (pathological-graph guard). */
const ROOTED_WALK_ROW_CAP = 100_000;
/** Work bound for the all-simple-paths recursive CTE. */
const PATHS_ROW_CAP = 200_000;

export interface GraphEdgeTraversalFilters {
  direction: GraphTraversalDirection;
  datasourceIds?: string[];
  relationshipTypes?: string[];
  origin?: GraphEdgeOriginFilter;
}

interface SqlFragment {
  sql: string;
  bindings: Knex.RawBinding[];
}

/**
 * The directed edge view of the relation table under the shared graph
 * filters. Each arm is one direction of travel; `both` unions them. The
 * datasource scope applies to the endpoint being *entered*, so a traversal
 * never walks into an out-of-scope data source (the seed node is the
 * caller's responsibility). Written as raw SQL so the recursive CTEs can
 * inline it against the (source_*)/(destination_*) indexes.
 */
function buildEdgeArms(
  filters: GraphEdgeTraversalFilters,
  workspaceId = DEFAULT_WORKSPACE_ID,
): SqlFragment {
  const conditions: string[] = ['workspace_id = ?'];
  const conditionBindings: Knex.RawBinding[] = [workspaceId];

  if (filters.relationshipTypes && filters.relationshipTypes.length > 0) {
    // An edge matches when either name matches — reciprocal_relation_type is
    // the same edge read from the other side (see integrationBackedRule).
    conditions.push(
      '(relation_type = ANY(?::text[]) OR reciprocal_relation_type = ANY(?::text[]))',
    );
    conditionBindings.push(
      filters.relationshipTypes,
      filters.relationshipTypes,
    );
  }
  if (filters.origin === 'rule') {
    conditions.push('rule_id IS NOT NULL');
  } else if (filters.origin === 'direct') {
    conditions.push('rule_id IS NULL');
  }

  const scoped = filters.datasourceIds && filters.datasourceIds.length > 0;

  const arm = (enteredColumn: string): string =>
    [
      'WHERE true',
      ...conditions.map(condition => `AND ${condition}`),
      ...(scoped ? [`AND ${enteredColumn} = ANY(?::uuid[])`] : []),
    ].join(' ');

  const armBindings = (): Knex.RawBinding[] =>
    scoped
      ? [...conditionBindings, filters.datasourceIds as string[]]
      : [...conditionBindings];

  const forward = `SELECT id, source_datasource_id AS from_ds, source_object_id AS from_obj,
       destination_datasource_id AS to_ds, destination_object_id AS to_obj
FROM ${RELATIONSHIP_TABLE_NAME} ${arm('destination_datasource_id')}`;
  const reverse = `SELECT id, destination_datasource_id AS from_ds, destination_object_id AS from_obj,
       source_datasource_id AS to_ds, source_object_id AS to_obj
FROM ${RELATIONSHIP_TABLE_NAME} ${arm('source_datasource_id')}`;

  if (filters.direction === 'out') {
    return { sql: forward, bindings: armBindings() };
  }
  if (filters.direction === 'in') {
    return { sql: reverse, bindings: armBindings() };
  }
  return {
    sql: `${forward}\nUNION ALL\n${reverse}`,
    bindings: [...armBindings(), ...armBindings()],
  };
}

function rowToRelationship(row: RelationshipRow): Relationship {
  return {
    id: row.id,
    ...workspaceOwnershipFields(row.workspace_id ?? DEFAULT_WORKSPACE_ID),
    sourceDatasourceId: row.source_datasource_id,
    sourceObjectId: row.source_object_id,
    destinationDatasourceId: row.destination_datasource_id,
    destinationObjectId: row.destination_object_id,
    relationshipType: row.relation_type,
    reciprocalRelationshipType: row.reciprocal_relation_type,
    updatedBy: row.updated_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    ruleId: row.rule_id,
    sourceDatastoreId: row.source_datastore_id,
    targetDatastoreId: row.target_datastore_id,
    origin: row.origin ?? 'manual',
    confidence: row.confidence,
    metadata: parseJsonColumn<Record<string, unknown>>(row.metadata),
  };
}

function relationshipInputToRow(
  input: RelationshipInput,
  workspaceId = DEFAULT_WORKSPACE_ID,
): Omit<RelationshipRow, 'id' | 'created_at' | 'updated_at'> {
  return {
    workspace_id: workspaceId,
    source_datasource_id: input.sourceDatasourceId,
    source_object_id: input.sourceObjectId,
    destination_datasource_id: input.destinationDatasourceId,
    destination_object_id: input.destinationObjectId,
    relation_type: input.relationshipType,
    reciprocal_relation_type: input.reciprocalRelationshipType ?? null,
    updated_by: input.updatedBy ?? null,
    rule_id: input.ruleId ?? null,
    source_datastore_id: input.sourceDatastoreId ?? null,
    target_datastore_id: input.targetDatastoreId ?? null,
    origin: input.origin ?? 'manual',
    confidence: input.confidence ?? null,
    metadata: input.metadata ?? null,
  };
}

export class RelationshipDao {
  private readonly knex: Knex;

  constructor(options: { knex: Knex }) {
    this.knex = options.knex;
  }

  relationshipTable(trx?: Knex) {
    return (trx || this.knex)<RelationshipRow>(RELATIONSHIP_TABLE_NAME);
  }

  async upsertRelationship(
    input: RelationshipInput,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Relationship> {
    const row = relationshipInputToRow(input, workspaceId);
    const [result] = await this.relationshipTable()
      .insert(row)
      .onConflict([
        'workspace_id',
        'source_datasource_id',
        'source_object_id',
        'relation_type',
        'destination_datasource_id',
        'destination_object_id',
      ])
      .merge({
        updated_by: row.updated_by,
        updated_at: this.knex.fn.now(),
        metadata: this.knex.raw('coalesce(?, ??.metadata)', [
          row.metadata ?? null,
          RELATIONSHIP_TABLE_NAME,
        ]),
      })
      .returning('*');
    return rowToRelationship(result);
  }

  async upsertRelationships(
    inputs: RelationshipInput[],
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Relationship[]> {
    return this.knex.transaction(async trx => {
      const results: Relationship[] = [];
      for (const input of inputs) {
        const row = relationshipInputToRow(input, workspaceId);
        const [result] = await this.relationshipTable(trx)
          .insert(row)
          .onConflict([
            'workspace_id',
            'source_datasource_id',
            'source_object_id',
            'relation_type',
            'destination_datasource_id',
            'destination_object_id',
          ])
          .merge({
            updated_by: row.updated_by,
            updated_at: this.knex.fn.now(),
            metadata: this.knex.raw('coalesce(?, ??.metadata)', [
              row.metadata ?? null,
              RELATIONSHIP_TABLE_NAME,
            ]),
          })
          .returning('*');
        results.push(rowToRelationship(result));
      }
      return results;
    });
  }

  async getRelationship(
    id: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Relationship | undefined> {
    const row = await this.relationshipTable()
      .where({ id, workspace_id: workspaceId })
      .first();
    return row ? rowToRelationship(row) : undefined;
  }

  async deleteRelationship(
    id: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<void> {
    await this.relationshipTable()
      .where({ id, workspace_id: workspaceId })
      .delete();
  }

  async queryRelationshipsBySource(
    datasourceId: string,
    objectId: string,
    params: RelationshipQueryParams = {},
  ): Promise<{ items: Relationship[]; total: number }> {
    const {
      workspaceId = DEFAULT_WORKSPACE_ID,
      relationshipType,
      limit = 50,
      offset = 0,
      origin,
      ruleId,
      direct,
    } = params;

    const q = this.relationshipTable()
      .where(`${RELATIONSHIP_TABLE_NAME}.workspace_id`, workspaceId)
      .where(`${RELATIONSHIP_TABLE_NAME}.source_datasource_id`, datasourceId)
      .andWhere(`${RELATIONSHIP_TABLE_NAME}.source_object_id`, objectId);

    if (relationshipType) {
      q.andWhere(`${RELATIONSHIP_TABLE_NAME}.relation_type`, relationshipType);
    }
    if (origin) {
      q.andWhere(`${RELATIONSHIP_TABLE_NAME}.origin`, origin);
    }
    if (ruleId) {
      q.andWhere(`${RELATIONSHIP_TABLE_NAME}.rule_id`, ruleId);
    }
    if (direct) {
      q.whereNull(`${RELATIONSHIP_TABLE_NAME}.rule_id`);
    }

    const [countResult] = await q
      .clone()
      .count<Array<{ count: string }>>('* as count');

    const items = await q
      .select(`${RELATIONSHIP_TABLE_NAME}.*`)
      .orderBy(`${RELATIONSHIP_TABLE_NAME}.updated_at`, 'desc')
      .limit(limit)
      .offset(offset);

    return {
      items: items.map(rowToRelationship),
      total: Number(countResult.count),
    };
  }

  async queryRelationshipsByDestination(
    datasourceId: string,
    objectId: string,
    params: RelationshipQueryParams = {},
  ): Promise<{ items: Relationship[]; total: number }> {
    const {
      workspaceId = DEFAULT_WORKSPACE_ID,
      relationshipType,
      limit = 50,
      offset = 0,
      origin,
      ruleId,
      direct,
    } = params;

    const q = this.relationshipTable()
      .where(`${RELATIONSHIP_TABLE_NAME}.workspace_id`, workspaceId)
      .where(
        `${RELATIONSHIP_TABLE_NAME}.destination_datasource_id`,
        datasourceId,
      )
      .andWhere(`${RELATIONSHIP_TABLE_NAME}.destination_object_id`, objectId);

    if (relationshipType) {
      q.andWhere(`${RELATIONSHIP_TABLE_NAME}.relation_type`, relationshipType);
    }
    if (origin) {
      q.andWhere(`${RELATIONSHIP_TABLE_NAME}.origin`, origin);
    }
    if (ruleId) {
      q.andWhere(`${RELATIONSHIP_TABLE_NAME}.rule_id`, ruleId);
    }
    if (direct) {
      q.whereNull(`${RELATIONSHIP_TABLE_NAME}.rule_id`);
    }

    const [countResult] = await q
      .clone()
      .count<Array<{ count: string }>>('* as count');

    const items = await q
      .select(`${RELATIONSHIP_TABLE_NAME}.*`)
      .orderBy(`${RELATIONSHIP_TABLE_NAME}.updated_at`, 'desc')
      .limit(limit)
      .offset(offset);

    return {
      items: items.map(rowToRelationship),
      total: Number(countResult.count),
    };
  }

  async getRelationshipsForObject(
    datasourceId: string,
    objectId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<ObjectRelationship[]> {
    const outgoingRows = await this.relationshipTable()
      .where(`${RELATIONSHIP_TABLE_NAME}.workspace_id`, workspaceId)
      .where(`${RELATIONSHIP_TABLE_NAME}.source_datasource_id`, datasourceId)
      .andWhere(`${RELATIONSHIP_TABLE_NAME}.source_object_id`, objectId)
      .select(`${RELATIONSHIP_TABLE_NAME}.*`)
      .orderBy(`${RELATIONSHIP_TABLE_NAME}.updated_at`, 'desc');

    const incomingRows = await this.relationshipTable()
      .where(`${RELATIONSHIP_TABLE_NAME}.workspace_id`, workspaceId)
      .where(
        `${RELATIONSHIP_TABLE_NAME}.destination_datasource_id`,
        datasourceId,
      )
      .andWhere(`${RELATIONSHIP_TABLE_NAME}.destination_object_id`, objectId)
      .select(`${RELATIONSHIP_TABLE_NAME}.*`)
      .orderBy(`${RELATIONSHIP_TABLE_NAME}.updated_at`, 'desc');

    const outgoing: ObjectRelationship[] = outgoingRows.map(row => ({
      ...rowToRelationship(row),
      direction: 'outgoing' as const,
    }));

    const incoming: ObjectRelationship[] = incomingRows.map(row => ({
      ...rowToRelationship(row),
      direction: 'incoming' as const,
    }));

    return [...outgoing, ...incoming];
  }

  async getRelationshipsForObjects(
    objects: Array<{ datasourceId: string; objectId: string }>,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<
    Map<
      string,
      Array<{
        datasourceId: string;
        objectId: string;
        relationshipType: string;
        direction: 'outgoing' | 'incoming';
      }>
    >
  > {
    if (objects.length === 0) {
      return new Map();
    }

    const outgoingRows = await this.relationshipTable()
      .where('workspace_id', workspaceId)
      .where(function () {
        for (const obj of objects) {
          this.orWhere({
            source_datasource_id: obj.datasourceId,
            source_object_id: obj.objectId,
          });
        }
      })
      .select(
        'source_datasource_id',
        'source_object_id',
        'destination_datasource_id',
        'destination_object_id',
        'relation_type',
      );

    const incomingRows = await this.relationshipTable()
      .where('workspace_id', workspaceId)
      .where(function () {
        for (const obj of objects) {
          this.orWhere({
            destination_datasource_id: obj.datasourceId,
            destination_object_id: obj.objectId,
          });
        }
      })
      .select(
        'source_datasource_id',
        'source_object_id',
        'destination_datasource_id',
        'destination_object_id',
        'relation_type',
      );

    const result = new Map<
      string,
      Array<{
        datasourceId: string;
        objectId: string;
        relationshipType: string;
        direction: 'outgoing' | 'incoming';
      }>
    >();

    for (const obj of objects) {
      result.set(`${obj.datasourceId}:${obj.objectId}`, []);
    }

    for (const row of outgoingRows) {
      const key = `${row.source_datasource_id}:${row.source_object_id}`;
      const refs = result.get(key);
      if (refs) {
        refs.push({
          datasourceId: row.destination_datasource_id,
          objectId: row.destination_object_id,
          relationshipType: row.relation_type,
          direction: 'outgoing',
        });
      }
    }

    for (const row of incomingRows) {
      const key = `${row.destination_datasource_id}:${row.destination_object_id}`;
      const refs = result.get(key);
      if (refs) {
        refs.push({
          datasourceId: row.source_datasource_id,
          objectId: row.source_object_id,
          relationshipType: row.relation_type,
          direction: 'incoming',
        });
      }
    }

    return result;
  }

  async queryAll(
    params: RelationshipQueryParams = {},
  ): Promise<{ items: Relationship[]; total: number }> {
    const {
      workspaceId = DEFAULT_WORKSPACE_ID,
      relationshipType,
      limit = 50,
      offset = 0,
      origin,
      ruleId,
      direct,
    } = params;

    const q = this.relationshipTable().where('workspace_id', workspaceId);

    if (relationshipType) {
      q.where(`${RELATIONSHIP_TABLE_NAME}.relation_type`, relationshipType);
    }
    if (origin) {
      q.andWhere(`${RELATIONSHIP_TABLE_NAME}.origin`, origin);
    }
    if (ruleId) {
      q.andWhere(`${RELATIONSHIP_TABLE_NAME}.rule_id`, ruleId);
    }
    if (direct) {
      q.whereNull(`${RELATIONSHIP_TABLE_NAME}.rule_id`);
    }

    const [countResult] = await q
      .clone()
      .count<Array<{ count: string }>>('* as count');

    const items = await q
      .select(`${RELATIONSHIP_TABLE_NAME}.*`)
      .orderBy(`${RELATIONSHIP_TABLE_NAME}.updated_at`, 'desc')
      .limit(limit)
      .offset(offset);

    return {
      items: items.map(rowToRelationship),
      total: Number(countResult.count),
    };
  }

  async queryGraphRelationships(options: {
    workspaceId?: string;
    datasourceIds?: string[];
    limit?: number;
  }): Promise<{
    items: ObjectGraphRelationshipSummary[];
    total: number;
  }> {
    const { datasourceIds, limit } = options;
    const q = this.relationshipTable().where(
      'workspace_id',
      options.workspaceId ?? DEFAULT_WORKSPACE_ID,
    );

    if (datasourceIds && datasourceIds.length > 0) {
      q.whereIn('source_datasource_id', datasourceIds).whereIn(
        'destination_datasource_id',
        datasourceIds,
      );
    }

    const [countResult] = await q
      .clone()
      .count<Array<{ count: string }>>('* as count');

    const rowsQuery = q.clone().orderBy('updated_at', 'desc');
    if (limit !== undefined) {
      rowsQuery.limit(limit);
    }
    const rows = await rowsQuery;

    return {
      items: rows.map(row => ({
        id: row.id,
        ...workspaceOwnershipFields(row.workspace_id ?? DEFAULT_WORKSPACE_ID),
        sourceDatasourceId: row.source_datasource_id,
        sourceObjectId: row.source_object_id,
        destinationDatasourceId: row.destination_datasource_id,
        destinationObjectId: row.destination_object_id,
        relationshipType: row.relation_type,
        ruleId: row.rule_id,
        origin: row.origin ?? 'manual',
        confidence: row.confidence,
      })),
      total: Number(countResult.count),
    };
  }

  async listRelationshipTypesByDatasource(
    datasourceId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<string[]> {
    const rows = await this.relationshipTable()
      .where('workspace_id', workspaceId)
      .where('source_datasource_id', datasourceId)
      .distinct('relation_type')
      .select('relation_type')
      .orderBy('relation_type');
    return rows.map((r: { relation_type: string }) => r.relation_type);
  }

  async deleteRelationshipsBySource(
    datasourceId: string,
    objectId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<void> {
    await this.relationshipTable()
      .where('workspace_id', workspaceId)
      .where('source_datasource_id', datasourceId)
      .andWhere('source_object_id', objectId)
      .delete();
  }

  async deleteRelationshipsByDestination(
    datasourceId: string,
    objectId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<void> {
    await this.relationshipTable()
      .where('workspace_id', workspaceId)
      .where('destination_datasource_id', datasourceId)
      .andWhere('destination_object_id', objectId)
      .delete();
  }

  async listRelationshipsByRuleId(
    ruleId: string,
    options?: { workspaceId?: string; limit?: number; offset?: number },
  ): Promise<{ items: Relationship[]; total: number }> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const q = this.relationshipTable()
      .where('workspace_id', options?.workspaceId ?? DEFAULT_WORKSPACE_ID)
      .where('rule_id', ruleId);

    const [countResult] = await q
      .clone()
      .count<Array<{ count: string }>>('* as count');

    const rows = await q
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    return {
      items: rows.map(rowToRelationship),
      total: Number(countResult.count),
    };
  }

  async deleteByRuleId(
    ruleId: string,
    trx?: Knex,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<number> {
    return this.relationshipTable(trx)
      .where({ rule_id: ruleId, workspace_id: workspaceId })
      .delete();
  }

  async deleteByRuleIdExceptSources(
    ruleId: string,
    keepSourceObjectIds: string[],
    trx?: Knex,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<number> {
    const query = this.relationshipTable(trx).where({
      rule_id: ruleId,
      workspace_id: workspaceId,
    });
    if (keepSourceObjectIds.length > 0) {
      query.whereNotIn('source_object_id', keepSourceObjectIds);
    }
    return query.delete();
  }

  async insertRuleRelationships(
    rows: Array<
      Omit<RelationshipRow, 'id' | 'created_at' | 'updated_at'> & {
        id: string;
        created_at: Date;
        updated_at: Date;
      }
    >,
    trx?: Knex,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<void> {
    if (rows.length === 0) return;
    // Each RelationshipRow has 15 columns; stay well under PostgreSQL's 65535-parameter limit.
    const BATCH_SIZE = 1000;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE).map(row => ({
        ...row,
        workspace_id: row.workspace_id ?? workspaceId,
      }));
      // Only refresh updated_at on conflict. rule_id and reciprocal_relation_type
      // belong to whichever rule first claimed the tuple — re-applies of overlapping
      // rules must not steal attribution from each other.
      await this.relationshipTable(trx)
        .insert(batch)
        .onConflict([
          'workspace_id',
          'source_datasource_id',
          'source_object_id',
          'relation_type',
          'destination_datasource_id',
          'destination_object_id',
        ])
        .merge(['updated_at']);
    }
  }

  async summarizeRelationships(workspaceId = DEFAULT_WORKSPACE_ID): Promise<{
    total: number;
    byOrigin: Record<string, number>;
    byRuleId: Array<{ ruleId: string | null; count: number }>;
    byOriginAndRuleId: Array<{
      origin: string;
      ruleId: string | null;
      count: number;
    }>;
  }> {
    const [totalRow] = await this.relationshipTable()
      .where('workspace_id', workspaceId)
      .count<Array<{ count: string | number }>>('* as count');
    const byOriginRows = await this.relationshipTable()
      .where('workspace_id', workspaceId)
      .select('origin')
      .count<Array<{ origin: string; count: string | number }>>('* as count')
      .groupBy('origin');
    const byRuleRows = await this.relationshipTable()
      .where('workspace_id', workspaceId)
      .select('rule_id')
      .count<
        Array<{ rule_id: string | null; count: string | number }>
      >('* as count')
      .groupBy('rule_id');
    const byOriginAndRuleRows = await this.relationshipTable()
      .where('workspace_id', workspaceId)
      .select('origin', 'rule_id')
      .count<
        Array<{
          origin: string;
          rule_id: string | null;
          count: string | number;
        }>
      >('* as count')
      .groupBy('origin', 'rule_id');

    const byOrigin: Record<string, number> = {};
    for (const row of byOriginRows) {
      byOrigin[row.origin] = Number(row.count);
    }

    return {
      total: Number(totalRow.count),
      byOrigin,
      byRuleId: byRuleRows.map(row => ({
        ruleId: row.rule_id,
        count: Number(row.count),
      })),
      byOriginAndRuleId: byOriginAndRuleRows.map(row => ({
        origin: row.origin,
        ruleId: row.rule_id,
        count: Number(row.count),
      })),
    };
  }

  /**
   * Breadth-bounded walk from a root node over the filtered edge view.
   * Returns the reached node refs with their minimum depth, the induced
   * edges among them, and per-node counts of filtered neighbors left
   * off-graph (the "+N" affordance). Work is bounded by the depth, the
   * node limit, and a hard row cap on the recursion.
   */
  async traverseFromRoot(options: {
    workspaceId?: string;
    root: { datasourceId: string; objectId: string };
    depth: number;
    nodeLimit: number;
    filters: GraphEdgeTraversalFilters;
  }): Promise<{
    nodes: Array<{ datasourceId: string; objectId: string; depth: number }>;
    relationships: ObjectGraphRelationshipSummary[];
    hiddenNeighborCounts: Map<string, number>;
    truncated: boolean;
  }> {
    const { root, depth, nodeLimit, filters } = options;
    const workspaceId = options.workspaceId ?? DEFAULT_WORKSPACE_ID;
    const edges = buildEdgeArms(filters, workspaceId);

    // Cycle-guard keys are `<uuid>:<objectId>` — unambiguous because the
    // datasource id is a fixed-width uuid, and identical to the frontend's
    // objectGraphNodeId format.
    const walkRows = await this.knex.raw<{
      rows: Array<{ ds: string; obj: string; depth: number }>;
    }>(
      `WITH RECURSIVE edges AS (
${edges.sql}
),
walk (ds, obj, depth, path) AS (
  SELECT ?::uuid, ?::text, 0, ARRAY[?::text]
  UNION ALL
  SELECT e.to_ds, e.to_obj, w.depth + 1,
         w.path || (e.to_ds::text || ':' || e.to_obj)
  FROM walk w
  JOIN edges e ON e.from_ds = w.ds AND e.from_obj = w.obj
  WHERE w.depth < ?
    AND NOT ((e.to_ds::text || ':' || e.to_obj) = ANY(w.path))
    AND EXISTS (
      SELECT 1 FROM ${OBJECT_TABLE_NAME} o
      WHERE o.workspace_id = ? AND o.datasource_id = e.to_ds AND o.object_id = e.to_obj
    )
)
SELECT ds, obj, MIN(depth) AS depth
FROM (SELECT * FROM walk LIMIT ?) w
GROUP BY ds, obj
ORDER BY depth ASC, ds ASC, obj ASC
LIMIT ?`,
      [
        ...edges.bindings,
        root.datasourceId,
        root.objectId,
        `${root.datasourceId}:${root.objectId}`,
        depth,
        workspaceId,
        ROOTED_WALK_ROW_CAP,
        nodeLimit + 1,
      ],
    );

    const reached = walkRows.rows.map(row => ({
      datasourceId: row.ds,
      objectId: row.obj,
      depth: Number(row.depth),
    }));
    const truncated = reached.length > nodeLimit;
    const nodes = truncated ? reached.slice(0, nodeLimit) : reached;
    if (nodes.length === 0) {
      return {
        nodes,
        relationships: [],
        hiddenNeighborCounts: new Map(),
        truncated,
      };
    }

    const pairs = nodes.map(node => [node.datasourceId, node.objectId]);
    const inducedQuery = this.relationshipTable()
      .where('workspace_id', workspaceId)
      .whereIn(['source_datasource_id', 'source_object_id'], pairs)
      .whereIn(['destination_datasource_id', 'destination_object_id'], pairs);
    this.applyEdgeFilters(inducedQuery, filters);
    // Direction deliberately does not constrain induced edges: an edge
    // between two retained nodes is part of the subgraph regardless of
    // which arm discovered them.
    const inducedRows = await inducedQuery.select('*');

    const relationships: ObjectGraphRelationshipSummary[] = inducedRows.map(
      row => ({
        id: row.id,
        ...workspaceOwnershipFields(row.workspace_id ?? DEFAULT_WORKSPACE_ID),
        sourceDatasourceId: row.source_datasource_id,
        sourceObjectId: row.source_object_id,
        destinationDatasourceId: row.destination_datasource_id,
        destinationObjectId: row.destination_object_id,
        relationshipType: row.relation_type,
        ruleId: row.rule_id,
        origin: row.origin ?? 'manual',
        confidence: row.confidence,
      }),
    );

    const hiddenNeighborCounts = await this.countHiddenNeighbors(
      nodes,
      filters,
      workspaceId,
    );

    return { nodes, relationships, hiddenNeighborCounts, truncated };
  }

  /**
   * All simple paths between two nodes over the filtered edge view, up to
   * `maxDepth` hops, shortest first, capped at `pathLimit` (+truncated flag).
   */
  async findPaths(options: {
    workspaceId?: string;
    source: { datasourceId: string; objectId: string };
    target: { datasourceId: string; objectId: string };
    maxDepth: number;
    pathLimit: number;
    filters: GraphEdgeTraversalFilters;
  }): Promise<{
    paths: Array<{
      nodes: Array<{ datasourceId: string; objectId: string }>;
      relationshipIds: string[];
      hops: number;
    }>;
    truncated: boolean;
  }> {
    const { source, target, maxDepth, pathLimit, filters } = options;
    const workspaceId = options.workspaceId ?? DEFAULT_WORKSPACE_ID;
    const edges = buildEdgeArms(filters, workspaceId);

    // Parallel uuid[]/text[] arrays carry the visited sequence so the cycle
    // guard compares composite identity without delimiter games, and the
    // result rows come back as structured arrays (no string parsing).
    const result = await this.knex.raw<{
      rows: Array<{
        node_ds_path: string[];
        node_obj_path: string[];
        edge_path: string[];
        hops: number;
      }>;
    }>(
      `WITH RECURSIVE edges AS (
${edges.sql}
),
paths (ds, obj, depth, node_ds_path, node_obj_path, edge_path) AS (
  SELECT ?::uuid, ?::text, 0, ARRAY[?::uuid], ARRAY[?::text], ARRAY[]::uuid[]
  UNION ALL
  SELECT e.to_ds, e.to_obj, p.depth + 1,
         p.node_ds_path || e.to_ds, p.node_obj_path || e.to_obj,
         p.edge_path || e.id
  FROM paths p
  JOIN edges e ON e.from_ds = p.ds AND e.from_obj = p.obj
  WHERE p.depth < ?
    AND NOT (p.ds = ?::uuid AND p.obj = ?::text)
    AND NOT EXISTS (
      SELECT 1 FROM unnest(p.node_ds_path, p.node_obj_path) AS v(ds, obj)
      WHERE v.ds = e.to_ds AND v.obj = e.to_obj
    )
    AND EXISTS (
      SELECT 1 FROM ${OBJECT_TABLE_NAME} o
      WHERE o.workspace_id = ? AND o.datasource_id = e.to_ds AND o.object_id = e.to_obj
    )
)
SELECT node_ds_path, node_obj_path, edge_path, depth AS hops
FROM (SELECT * FROM paths LIMIT ?) p
WHERE ds = ?::uuid AND obj = ?::text
ORDER BY hops ASC, node_obj_path ASC
LIMIT ?`,
      [
        ...edges.bindings,
        source.datasourceId,
        source.objectId,
        source.datasourceId,
        source.objectId,
        maxDepth,
        target.datasourceId,
        target.objectId,
        workspaceId,
        PATHS_ROW_CAP,
        target.datasourceId,
        target.objectId,
        pathLimit + 1,
      ],
    );

    const truncated = result.rows.length > pathLimit;
    const rows = truncated ? result.rows.slice(0, pathLimit) : result.rows;

    return {
      paths: rows.map(row => ({
        nodes: row.node_ds_path.map((datasourceId, index) => ({
          datasourceId,
          objectId: row.node_obj_path[Number(index)],
        })),
        relationshipIds: row.edge_path,
        hops: Number(row.hops),
      })),
      truncated,
    };
  }

  /**
   * Meta-graph aggregate: edge counts grouped by (source datasource,
   * destination datasource, relationship type) under the shared filters.
   * Datasource scoping matches queryGraphRelationships: both endpoints in
   * scope.
   */
  async summarizeGraphEdges(options: {
    workspaceId?: string;
    datasourceIds?: string[];
    relationshipTypes?: string[];
    origin?: GraphEdgeOriginFilter;
  }): Promise<{
    items: RelationshipSummaryItem[];
    totalRelationships: number;
  }> {
    const conditions: string[] = ['workspace_id = ?'];
    const bindings: Knex.RawBinding[] = [
      options.workspaceId ?? DEFAULT_WORKSPACE_ID,
    ];
    if (options.datasourceIds && options.datasourceIds.length > 0) {
      // Both endpoints in scope, matching queryGraphRelationships semantics.
      conditions.push(
        'source_datasource_id = ANY(?::uuid[])',
        'destination_datasource_id = ANY(?::uuid[])',
      );
      bindings.push(options.datasourceIds, options.datasourceIds);
    }
    if (options.relationshipTypes && options.relationshipTypes.length > 0) {
      conditions.push(
        '(relation_type = ANY(?::text[]) OR reciprocal_relation_type = ANY(?::text[]))',
      );
      bindings.push(options.relationshipTypes, options.relationshipTypes);
    }
    if (options.origin === 'rule') {
      conditions.push('rule_id IS NOT NULL');
    } else if (options.origin === 'direct') {
      conditions.push('rule_id IS NULL');
    }

    const result = await this.knex.raw<{
      rows: Array<{
        source_datasource_id: string;
        destination_datasource_id: string;
        relation_type: string;
        count: string | number;
      }>;
    }>(
      `SELECT source_datasource_id, destination_datasource_id, relation_type,
       COUNT(*) AS count
FROM ${RELATIONSHIP_TABLE_NAME}
WHERE ${conditions.join(' AND ')}
GROUP BY source_datasource_id, destination_datasource_id, relation_type
ORDER BY count DESC, source_datasource_id, destination_datasource_id, relation_type`,
      bindings,
    );

    const items = result.rows.map(row => ({
      sourceDatasourceId: row.source_datasource_id,
      destinationDatasourceId: row.destination_datasource_id,
      relationshipType: row.relation_type,
      count: Number(row.count),
    }));
    return {
      items,
      totalRelationships: items.reduce((sum, item) => sum + item.count, 0),
    };
  }

  /**
   * Distinct relationship type names (including reciprocal names) where
   * either endpoint is in scope; no scope = the whole table. The per-
   * datasource listRelationshipTypesByDatasource stays as-is for its route.
   */
  async listRelationshipTypes(options?: {
    workspaceId?: string;
    datasourceIds?: string[];
  }): Promise<string[]> {
    const scoped =
      options?.datasourceIds && options.datasourceIds.length > 0
        ? options.datasourceIds
        : undefined;
    const scopeSql = scoped
      ? 'workspace_id = ? AND (source_datasource_id = ANY(?::uuid[]) OR destination_datasource_id = ANY(?::uuid[]))'
      : 'workspace_id = ?';
    const workspaceId = options?.workspaceId ?? DEFAULT_WORKSPACE_ID;
    const scopeBindings = scoped
      ? [workspaceId, scoped, scoped]
      : [workspaceId];

    const result = await this.knex.raw<{ rows: Array<{ t: string }> }>(
      `SELECT DISTINCT t FROM (
  SELECT relation_type AS t FROM ${RELATIONSHIP_TABLE_NAME} WHERE ${scopeSql}
  UNION
  SELECT reciprocal_relation_type FROM ${RELATIONSHIP_TABLE_NAME}
  WHERE reciprocal_relation_type IS NOT NULL AND ${scopeSql}
) u WHERE t IS NOT NULL ORDER BY t`,
      [...scopeBindings, ...scopeBindings],
    );
    return result.rows.map(row => row.t);
  }

  /** Graph edge summaries for an explicit id set (paths responses). */
  async getGraphRelationshipsByIds(
    ids: string[],
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<ObjectGraphRelationshipSummary[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.relationshipTable()
      .where('workspace_id', workspaceId)
      .whereIn('id', ids)
      .select('*');
    return rows.map(row => ({
      id: row.id,
      ...workspaceOwnershipFields(row.workspace_id ?? DEFAULT_WORKSPACE_ID),
      sourceDatasourceId: row.source_datasource_id,
      sourceObjectId: row.source_object_id,
      destinationDatasourceId: row.destination_datasource_id,
      destinationObjectId: row.destination_object_id,
      relationshipType: row.relation_type,
      ruleId: row.rule_id,
      origin: row.origin ?? 'manual',
      confidence: row.confidence,
    }));
  }

  /** Shared relationshipTypes/origin predicates for plain knex builders. */
  private applyEdgeFilters(
    q: Knex.QueryBuilder<RelationshipRow, unknown>,
    filters: Pick<
      GraphEdgeTraversalFilters,
      'relationshipTypes' | 'origin' | 'direction'
    >,
  ): void {
    const types = filters.relationshipTypes;
    if (types && types.length > 0) {
      q.where(function () {
        this.whereIn('relation_type', types).orWhereIn(
          'reciprocal_relation_type',
          types,
        );
      });
    }
    if (filters.origin === 'rule') {
      q.whereNotNull('rule_id');
    } else if (filters.origin === 'direct') {
      q.whereNull('rule_id');
    }
  }

  /**
   * For each given node: how many distinct filtered neighbors exist that are
   * not themselves in the given set. Dangling endpoints (no stored object)
   * are excluded to match what an expansion could actually reveal.
   */
  private async countHiddenNeighbors(
    nodes: Array<{ datasourceId: string; objectId: string }>,
    filters: GraphEdgeTraversalFilters,
    workspaceId: string,
  ): Promise<Map<string, number>> {
    if (nodes.length === 0) {
      return new Map();
    }
    const edges = buildEdgeArms(filters, workspaceId);
    const valuesSql = nodes
      .map((_, index) => (index === 0 ? '(?::uuid, ?::text)' : '(?, ?)'))
      .join(', ');
    const valuesBindings = nodes.flatMap(node => [
      node.datasourceId,
      node.objectId,
    ]);

    const result = await this.knex.raw<{
      rows: Array<{ ds: string; obj: string; hidden: string | number }>;
    }>(
      `WITH refs (ds, obj) AS (VALUES ${valuesSql}),
edges AS (
${edges.sql}
)
SELECT r.ds, r.obj,
       COUNT(DISTINCT (e.to_ds::text || ':' || e.to_obj)) AS hidden
FROM refs r
JOIN edges e ON e.from_ds = r.ds AND e.from_obj = r.obj
LEFT JOIN refs t ON t.ds = e.to_ds AND t.obj = e.to_obj
WHERE t.ds IS NULL
  AND EXISTS (
    SELECT 1 FROM ${OBJECT_TABLE_NAME} o
    WHERE o.workspace_id = ? AND o.datasource_id = e.to_ds AND o.object_id = e.to_obj
  )
GROUP BY r.ds, r.obj`,
      [...valuesBindings, ...edges.bindings, workspaceId],
    );

    const counts = new Map<string, number>();
    for (const row of result.rows) {
      counts.set(`${row.ds}:${row.obj}`, Number(row.hidden));
    }
    return counts;
  }
}
