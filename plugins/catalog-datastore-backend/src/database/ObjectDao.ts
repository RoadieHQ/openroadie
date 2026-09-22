import type { Knex } from 'knex';
import { DatastoreObject, DatastoreRow, IndexConfigurationRow } from './types';
import { v4 as uuid } from 'uuid';
import {
  resolveObjectPresentation,
  SortOrder,
} from '@roadiehq/catalog-datastore-common';
import type {
  ObjectGraphNodeSummary,
  ObjectPresentation,
  ObjectPresentationPurpose,
} from '@roadiehq/catalog-datastore-common';
import { canonicalJsonHash } from '@roadiehq/catalog-datastore-node';
import { DatasourceActivityDao } from './DatasourceActivityDao';
import { DatasourceEvents } from '../webhooks';
import { DISPLAY_NAME_PATHS } from './object-label';
import { escapeIlike, parseSearchQuery } from './search-query';
import {
  DEFAULT_WORKSPACE_ID,
  workspaceOwnershipFields,
} from '@roadiehq/workspaces-backend';

const TABLE_NAME = 'datastore';
const INDEX_TABLE_NAME = 'datastore_index';
const INDEX_CONFIGURATION_TABLE_NAME = 'datastore_index_configuration';
const RELATIONSHIP_TABLE_NAME = 'datastore_relation';
const CONTEXT_GROUP_TABLE_NAME = 'context_group';
const CONTEXT_GROUP_MEMBER_TABLE_NAME = 'context_group_member';
const CONTEXT_GROUP_RULE_TABLE_NAME = 'context_group_rule';
const RESERVED_ORDER_KEYS = new Set([
  'datasourceId',
  'objectId',
  'title',
  'relationshipCount',
  'contextGroupCount',
]);
const RESERVED_FILTER_KEYS = new Set(['contextGroupTitle']);
export const SUGGESTION_SAMPLE_LIMIT = 1000;

/**
 * Parse a profiler field expression (`$.a.b`, `$.'odd.key'.c`) into a Postgres
 * `#>>` path (`['a', 'b']`). Returns null for expressions that can't map to a
 * JSON path — array-of-object qualifier segments (`$.items[k="v"].f`), which
 * the profiler emits for key/value-pair arrays — so callers can treat those as
 * unverifiable rather than mis-scoping the lookup.
 */
function fieldExpressionToJsonPath(field: string): string[] | null {
  const segments: string[] = [];
  let i = field.startsWith('$') ? 1 : 0;
  while (i < field.length) {
    if (field[`${i}`] === '.') {
      i += 1;
      continue;
    }
    if (field[`${i}`] === '[') {
      return null; // array-object qualifier — not a plain JSON path
    }
    if (field[`${i}`] === "'") {
      i += 1;
      let segment = '';
      while (i < field.length && field[`${i}`] !== "'") {
        segment += field[`${i}`];
        i += 1;
      }
      if (i >= field.length) {
        return null; // unterminated quote
      }
      i += 1; // closing quote
      segments.push(segment);
      continue;
    }
    let segment = '';
    while (i < field.length && field[`${i}`] !== '.' && field[`${i}`] !== '[') {
      segment += field[`${i}`];
      i += 1;
    }
    if (i < field.length && field[`${i}`] === '[') {
      return null;
    }
    segments.push(segment);
  }
  return segments.length > 0 ? segments : null;
}

/**
 * Render path segments as a Postgres text[] literal, double-quoting every
 * element so keys with commas, spaces or braces stay one segment.
 */
function toPgTextArrayLiteral(segments: string[]): string {
  return `{${segments
    .map(s => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(',')}}`;
}

const TITLE_SORT_PATHS = [
  ['name'],
  ['display_name'],
  ['displayName'],
  ['title'],
  ['full_name'],
  ['login'],
  ['username'],
  ['email'],
  ['slug'],
  ['profile', 'name'],
  ['profile', 'display_name'],
  ['profile', 'displayName'],
  ['profile', 'email'],
  ['fields', 'summary'],
] as const;

function rowToDatastoreObject(row: DatastoreRow): DatastoreObject {
  return {
    id: row.id,
    ...workspaceOwnershipFields(row.workspace_id ?? DEFAULT_WORKSPACE_ID),
    datasourceId: row.datasource_id,
    objectId: row.object_id,
    object: JSON.parse(row.object),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function datastoreObjectToRow(
  obj: Omit<Omit<Omit<DatastoreObject, 'id'>, 'createdAt'>, 'updatedAt'> & {
    id?: string;
    updatedAt?: string;
    createdAt?: string;
  },
  workspaceId = DEFAULT_WORKSPACE_ID,
): DatastoreRow {
  return {
    id: obj.id || uuid(),
    workspace_id: workspaceId,
    datasource_id: obj.datasourceId,
    object_id: obj.objectId,
    object: JSON.stringify(obj.object),
    object_hash: canonicalJsonHash(obj.object),
    created_at: new Date(obj.createdAt || Date.now()),
    updated_at: new Date(obj.updatedAt || Date.now()),
  };
}

export { rowToDatastoreObject, datastoreObjectToRow };

export interface BaseQueryParams {
  explain?: boolean;
}

export interface DatastoreQueryParams extends BaseQueryParams {
  workspaceId?: string;
  datasourceId?: string;
  limit?: number;
  offset?: number;
  orderBy?: string;
  sortOrder?: SortOrder;
  filter?: Record<string, string>;
}

export interface SearchParams extends BaseQueryParams {
  workspaceId?: string;
  q: string;
  datasourceIds?: string[];
  limit?: number;
  offset?: number;
}

type GraphNodeRow = Pick<
  DatastoreRow,
  'id' | 'datasource_id' | 'object_id' | 'created_at' | 'updated_at'
> & {
  display_name: string;
};

interface RelationshipCountRow {
  datasource_id?: string;
  object_id: string;
  relationship_count: string | number;
}

interface PresentationIndexRow {
  datastore_id: string;
  purpose: ObjectPresentationPurpose;
  value: string;
}

/*
 * Deletes on `datastore` cascade into `datastore_relation`, whose rows are
 * reachable from BOTH endpoints (`source_datastore_id` / `target_datastore_id`
 * FKs) — so two concurrent deletes touching opposite ends of the same edges
 * lock those rows in different orders, and Postgres resolves the cycle by
 * aborting one transaction with SQLSTATE 40P01. The victim is fully rolled
 * back, so rerunning its transaction is safe.
 */
const DEADLOCK_SQLSTATE = '40P01';
const DEADLOCK_RETRY_ATTEMPTS = 3;
const DEADLOCK_RETRY_BASE_DELAY_MS = 25;

function isDeadlockError(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: unknown }).code === DEADLOCK_SQLSTATE
  );
}

async function retryOnDeadlock<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (e: unknown) {
      if (attempt >= DEADLOCK_RETRY_ATTEMPTS || !isDeadlockError(e)) {
        throw e;
      }
      await new Promise(resolve =>
        setTimeout(resolve, DEADLOCK_RETRY_BASE_DELAY_MS * attempt),
      );
    }
  }
}

export class ObjectDao {
  private readonly knex: Knex;
  private readonly activityDao?: DatasourceActivityDao;
  private readonly events?: DatasourceEvents;

  constructor(options: {
    knex: Knex;
    activityDao?: DatasourceActivityDao;
    events?: DatasourceEvents;
  }) {
    this.knex = options.knex;
    this.activityDao = options.activityDao;
    this.events = options.events;
  }

  table(trx?: Knex) {
    return (trx || this.knex)<DatastoreRow>(TABLE_NAME);
  }

  private titleExpressionForAlias(tableAlias: string) {
    const pathSql = TITLE_SORT_PATHS.map(
      () => `NULLIF(${tableAlias}.object::jsonb #>> ?, '')`,
    ).join(', ');
    const pathBindings = TITLE_SORT_PATHS.map(path => `{${path.join(',')}}`);

    return this.knex.raw(
      `COALESCE((
        SELECT idx.value
        FROM ?? idx
        JOIN ?? cfg
          ON cfg.id = idx.datastore_index_configuration_id
        WHERE idx.datastore_id = ??.id
          AND cfg.purpose = 'title'
        LIMIT 1
      ), ${pathSql}, ??.object_id)`,
      [
        INDEX_TABLE_NAME,
        INDEX_CONFIGURATION_TABLE_NAME,
        tableAlias,
        ...pathBindings,
        tableAlias,
      ],
    );
  }

  private titleOrderExpression() {
    return this.titleExpressionForAlias(TABLE_NAME);
  }

  private async withPresentation<T extends DatastoreObject>(
    items: T[],
  ): Promise<T[]> {
    if (items.length === 0) {
      return items;
    }

    const rows = await this.knex(`${INDEX_TABLE_NAME} as idx`)
      .join(
        `${INDEX_CONFIGURATION_TABLE_NAME} as cfg`,
        'idx.datastore_index_configuration_id',
        '=',
        'cfg.id',
      )
      .whereIn(
        'idx.datastore_id',
        items.map(item => item.id),
      )
      .whereIn('cfg.purpose', ['title', 'subtitle', 'image'])
      .select<PresentationIndexRow[]>(
        'idx.datastore_id',
        'cfg.purpose',
        'idx.value',
      );

    const configuredById = new Map<string, Partial<ObjectPresentation>>();
    for (const row of rows) {
      const current = configuredById.get(row.datastore_id) ?? {};
      if (row.purpose === 'title') {
        current.title = row.value;
      } else if (row.purpose === 'subtitle') {
        current.subtitle = row.value;
      } else if (row.purpose === 'image') {
        current.image = row.value;
      }
      configuredById.set(row.datastore_id, current);
    }

    return items.map(item => ({
      ...item,
      presentation: resolveObjectPresentation(
        item.object,
        item.objectId,
        configuredById.get(item.id),
      ),
    }));
  }

  async query(datasourceId: string, params: DatastoreQueryParams = {}) {
    const {
      limit = 50,
      offset = 0,
      orderBy,
      sortOrder = 'asc',
      filter = {},
    } = params;
    const workspaceId = params.workspaceId ?? DEFAULT_WORKSPACE_ID;
    const requiredIndexes: string[] = [...Object.keys(filter), orderBy]
      .filter((v): v is string => Boolean(v))
      .filter(
        key => !RESERVED_ORDER_KEYS.has(key) && !RESERVED_FILTER_KEYS.has(key),
      );

    if (requiredIndexes.length !== 0) {
      const countResult = (await this.knex<IndexConfigurationRow>(
        INDEX_CONFIGURATION_TABLE_NAME,
      )
        .whereIn('key', requiredIndexes)
        .andWhere('datasource_id', datasourceId)
        .andWhere('workspace_id', workspaceId)
        .count('* as count')) as { count: string | number }[];
      if (Number(countResult[0].count) !== requiredIndexes.length) {
        throw new Error(
          `Index configuration not found for keys ${requiredIndexes.join(
            ', ',
          )}, create an index configuration for these keys first.`,
        );
      }
    }

    const q = this.table();

    if (orderBy === 'objectId') {
      q.orderBy(`${TABLE_NAME}.object_id`, sortOrder);
    } else if (orderBy === 'title') {
      q.orderByRaw(`? ${sortOrder}`, [this.titleOrderExpression()]);
    } else if (orderBy === 'contextGroupCount') {
      q.orderByRaw(
        `COALESCE((
          SELECT COUNT(DISTINCT member.context_group_id)::int
          FROM ?? member
          JOIN ?? grp ON grp.id = member.context_group_id
          JOIN ?? rule ON rule.id = grp.rule_id
          WHERE member.datasource_id = ?
            AND member.object_id = ??.object_id
            AND rule.workspace_id = ?
        ), 0) ${sortOrder}`,
        [
          CONTEXT_GROUP_MEMBER_TABLE_NAME,
          CONTEXT_GROUP_TABLE_NAME,
          CONTEXT_GROUP_RULE_TABLE_NAME,
          datasourceId,
          TABLE_NAME,
          workspaceId,
        ],
      );
    } else if (orderBy === 'relationshipCount') {
      q.orderByRaw(
        `(
          SELECT COUNT(*)::int
          FROM (
            SELECT 1
            FROM ?? rel
            WHERE rel.workspace_id = ?
              AND rel.source_datasource_id = ?
              AND rel.source_object_id = ??.object_id
              AND rel.workspace_id = ?
            UNION ALL
            SELECT 1
            FROM ?? rel
            WHERE rel.workspace_id = ?
              AND rel.destination_datasource_id = ?
              AND rel.destination_object_id = ??.object_id
              AND rel.workspace_id = ?
          ) relationship_counts
        ) ${sortOrder}`,
        [
          RELATIONSHIP_TABLE_NAME,
          workspaceId,
          datasourceId,
          TABLE_NAME,
          workspaceId,
          RELATIONSHIP_TABLE_NAME,
          workspaceId,
          datasourceId,
          TABLE_NAME,
          workspaceId,
        ],
      );
    } else if (orderBy) {
      q.join(
        `${INDEX_TABLE_NAME} as order_idx`,
        `${TABLE_NAME}.id`,
        '=',
        'order_idx.datastore_id',
      );
      q.where('order_idx.key', orderBy);
      q.orderBy('order_idx.value', sortOrder);
    } else {
      q.orderBy(`${TABLE_NAME}.updated_at`, 'desc');
    }
    // Bulk syncs write identical timestamps; without a unique tiebreaker,
    // offset pagination can drop or repeat rows across pages.
    q.orderBy(`${TABLE_NAME}.id`, 'asc');

    Object.entries(filter).forEach(([key, value], idx) => {
      if (key === 'contextGroupTitle') {
        // `datastore.datasource_id` is a uuid column while
        // `context_group_member.datasource_id` is text, so the join must cast
        // one side (Postgres won't implicitly compare uuid = text on columns).
        const knex = this.knex;
        const rootTitleExpression =
          this.titleExpressionForAlias('root').toSQL();
        q.whereExists(
          this.knex
            .select(this.knex.raw('1'))
            .from(`${CONTEXT_GROUP_MEMBER_TABLE_NAME} as member`)
            .join(
              `${CONTEXT_GROUP_TABLE_NAME} as grp`,
              'member.context_group_id',
              '=',
              'grp.id',
            )
            .join(
              `${CONTEXT_GROUP_RULE_TABLE_NAME} as rule`,
              'grp.rule_id',
              '=',
              'rule.id',
            )
            .leftJoin(
              `${CONTEXT_GROUP_MEMBER_TABLE_NAME} as root_member`,
              'root_member.context_group_id',
              '=',
              'grp.id',
            )
            .leftJoin(`${TABLE_NAME} as root`, function () {
              this.on(
                knex.raw(
                  'cast("root"."datasource_id" as text) = "root_member"."datasource_id"',
                ),
              )
                .andOn('root.object_id', '=', 'root_member.object_id')
                .andOnVal('root.workspace_id', '=', workspaceId);
            })
            .where('member.datasource_id', datasourceId)
            .where('rule.workspace_id', workspaceId)
            .whereRaw('member.object_id = ??.object_id', [TABLE_NAME])
            .whereRaw(
              `CONCAT(rule.name, ': ', ${rootTitleExpression.sql}) = ?`,
              [...rootTitleExpression.bindings, value],
            ),
        );
        return;
      }

      const alias = `filter_idx_${idx}`;
      q.join(
        `${INDEX_TABLE_NAME} as ${alias}`,
        `${TABLE_NAME}.id`,
        '=',
        `${alias}.datastore_id`,
      );
      q.where(`${alias}.key`, key);
      q.where(`${alias}.value`, value);
    });

    q.where(`${TABLE_NAME}.datasource_id`, datasourceId);
    q.where(`${TABLE_NAME}.workspace_id`, workspaceId);

    const totalQuery = q.clone().clearOrder().count<Array<{ count: string }>>();
    const [totalResult] = await totalQuery;

    const itemsQuery = q
      .clone()
      .select(`${TABLE_NAME}.*`)
      .limit(limit)
      .offset(offset);

    const items = await itemsQuery;

    const datastoreObjects = await this.withPresentation(
      items.map(rowToDatastoreObject),
    );
    const relationshipCounts = await this.getRelationshipCountsForObjects(
      datastoreObjects.map(item => ({
        datasourceId,
        objectId: item.objectId,
      })),
      workspaceId,
    );

    const result = {
      items: datastoreObjects.map(item => ({
        ...item,
        relationshipCount:
          relationshipCounts.get(`${datasourceId}:${item.objectId}`) ?? 0,
      })),
      total: Number(totalResult.count),
    };

    if (params.explain) {
      const totalExplain = await this.explainSql(totalQuery.toSQL());
      const itemsExplain = await this.explainSql(itemsQuery.toSQL());

      return {
        ...result,
        explain: {
          total: totalExplain,
          items: itemsExplain,
        },
      };
    }

    return result;
  }

  private async getRelationshipCountsForObjects(
    keys: Array<{ datasourceId: string; objectId: string }>,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Map<string, number>> {
    if (keys.length === 0) {
      return new Map();
    }
    const pairs: [string, string][] = keys.map(key => [
      key.datasourceId,
      key.objectId,
    ]);
    const [sourceRows, destinationRows] = await Promise.all([
      this.knex(RELATIONSHIP_TABLE_NAME)
        .select<
          RelationshipCountRow[]
        >('source_datasource_id as datasource_id', 'source_object_id as object_id')
        .count('id as relationship_count')
        .where('workspace_id', workspaceId)
        .whereIn(['source_datasource_id', 'source_object_id'], pairs)
        .groupBy('source_datasource_id', 'source_object_id'),
      this.knex(RELATIONSHIP_TABLE_NAME)
        .select<
          RelationshipCountRow[]
        >('destination_datasource_id as datasource_id', 'destination_object_id as object_id')
        .count('id as relationship_count')
        .where('workspace_id', workspaceId)
        .whereIn(['destination_datasource_id', 'destination_object_id'], pairs)
        .groupBy('destination_datasource_id', 'destination_object_id'),
    ]);

    const counts = new Map<string, number>();
    for (const row of [...sourceRows, ...destinationRows]) {
      const key = `${row.datasource_id}:${row.object_id}`;
      counts.set(key, (counts.get(key) ?? 0) + Number(row.relationship_count));
    }
    return counts;
  }

  async queryAll(
    params: {
      limit?: number;
      offset?: number;
      orderBy?: string;
      sortOrder?: SortOrder;
      datasourceIds?: string[];
      workspaceId?: string;
    } = {},
  ) {
    const {
      limit = 50,
      offset = 0,
      orderBy,
      sortOrder = 'asc',
      datasourceIds,
    } = params;
    const workspaceId = params.workspaceId ?? DEFAULT_WORKSPACE_ID;

    const q = this.table().where('workspace_id', workspaceId);

    if (datasourceIds && datasourceIds.length > 0) {
      q.whereIn('datasource_id', datasourceIds);
    }

    if (orderBy === 'datasourceId') {
      q.orderBy('datasource_id', sortOrder);
    } else if (orderBy === 'objectId') {
      q.orderBy('object_id', sortOrder);
    } else if (orderBy === 'title') {
      q.orderByRaw(`? ${sortOrder}`, [this.titleOrderExpression()]);
    } else if (orderBy === 'contextGroupCount') {
      q.orderByRaw(
        `COALESCE((
          SELECT COUNT(DISTINCT member.context_group_id)::int
          FROM ?? member
          JOIN ?? grp ON grp.id = member.context_group_id
          JOIN ?? rule ON rule.id = grp.rule_id
          WHERE member.datasource_id = ??.datasource_id
            AND member.object_id = ??.object_id
            AND rule.workspace_id = ?
        ), 0) ${sortOrder}`,
        [
          CONTEXT_GROUP_MEMBER_TABLE_NAME,
          CONTEXT_GROUP_TABLE_NAME,
          CONTEXT_GROUP_RULE_TABLE_NAME,
          TABLE_NAME,
          TABLE_NAME,
          workspaceId,
        ],
      );
    } else if (orderBy === 'relationshipCount') {
      q.orderByRaw(
        `(
          SELECT COUNT(*)::int
          FROM (
            SELECT 1
            FROM ?? rel
            WHERE rel.workspace_id = ?
              AND rel.source_datasource_id = ??.datasource_id
              AND rel.source_object_id = ??.object_id
              AND rel.workspace_id = ?
            UNION ALL
            SELECT 1
            FROM ?? rel
            WHERE rel.workspace_id = ?
              AND rel.destination_datasource_id = ??.datasource_id
              AND rel.destination_object_id = ??.object_id
              AND rel.workspace_id = ?
          ) relationship_counts
        ) ${sortOrder}`,
        [
          RELATIONSHIP_TABLE_NAME,
          workspaceId,
          TABLE_NAME,
          TABLE_NAME,
          workspaceId,
          RELATIONSHIP_TABLE_NAME,
          workspaceId,
          TABLE_NAME,
          TABLE_NAME,
          workspaceId,
        ],
      );
    } else {
      q.orderBy('updated_at', 'desc');
    }
    q.orderBy('id', 'asc');

    const [countResult] = await q
      .clone()
      .clearOrder()
      .count<Array<{ count: string }>>('* as count');

    const items = await q.limit(limit).offset(offset);

    const datastoreObjects = await this.withPresentation(
      items.map(rowToDatastoreObject),
    );
    const relationshipCounts = await this.getRelationshipCountsForObjects(
      datastoreObjects.map(item => ({
        datasourceId: item.datasourceId,
        objectId: item.objectId,
      })),
      workspaceId,
    );

    return {
      items: datastoreObjects.map(item => ({
        ...item,
        relationshipCount:
          relationshipCounts.get(`${item.datasourceId}:${item.objectId}`) ?? 0,
      })),
      total: Number(countResult.count),
    };
  }

  /**
   * Number of objects currently stored, grouped by datasource. Datasources
   * with zero objects are absent from the result (GROUP BY semantics).
   */
  async countByDatasource(
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Array<{ datasourceId: string; count: number }>> {
    const rows = await this.table()
      .where('workspace_id', workspaceId)
      .select('datasource_id')
      .count<Array<{ datasource_id: string; count: string }>>('* as count')
      .groupBy('datasource_id');

    return rows.map(row => ({
      datasourceId: row.datasource_id,
      count: Number(row.count),
    }));
  }

  /**
   * The graph-node display name: the configured title index value, else the
   * first non-empty DISPLAY_NAME_PATHS jsonb hit, else the object id.
   */
  private graphNodeDisplayNameSelect(): Knex.Raw {
    const labelPathSql = DISPLAY_NAME_PATHS.map(
      () => `NULLIF(${TABLE_NAME}.object::jsonb #>> ?, '')`,
    ).join(', ');
    const configuredLabelSql = `
      SELECT idx.value
      FROM ${INDEX_TABLE_NAME} idx
      JOIN ${INDEX_CONFIGURATION_TABLE_NAME} cfg
        ON cfg.id = idx.datastore_index_configuration_id
      WHERE idx.datastore_id = ${TABLE_NAME}.id
        AND cfg.purpose = 'title'
      LIMIT 1
    `;
    const labelBindings = DISPLAY_NAME_PATHS.map(path => `{${path.join(',')}}`);
    return this.knex.raw(
      `COALESCE((${configuredLabelSql}), ${labelPathSql}, ??) as display_name`,
      [...labelBindings, `${TABLE_NAME}.object_id`],
    );
  }

  private graphNodeRowToSummary(
    row: GraphNodeRow,
    workspaceId: string,
  ): ObjectGraphNodeSummary {
    const displayName = String(row.display_name);
    return {
      id: row.id,
      ...workspaceOwnershipFields(workspaceId),
      datasourceId: row.datasource_id,
      objectId: row.object_id,
      label: displayName,
      displayName,
      presentation: { title: displayName },
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  async queryGraphNodes(options: {
    datasourceIds?: string[];
    limit?: number;
    workspaceId?: string;
  }): Promise<{
    items: ObjectGraphNodeSummary[];
    total: number;
  }> {
    const { datasourceIds, limit } = options;
    const workspaceId = options.workspaceId ?? DEFAULT_WORKSPACE_ID;
    const q = this.table().where('workspace_id', workspaceId);

    if (datasourceIds && datasourceIds.length > 0) {
      q.whereIn('datasource_id', datasourceIds);
    }

    const [countResult] = await q
      .clone()
      .count<Array<{ count: string }>>('* as count');

    const rowsQuery = q
      .clone()
      .select<
        GraphNodeRow[]
      >('id', 'datasource_id', 'object_id', 'created_at', 'updated_at', this.graphNodeDisplayNameSelect())
      .orderBy('updated_at', 'desc');

    if (limit !== undefined) {
      rowsQuery.limit(limit);
    }
    const rows = await rowsQuery;

    return {
      items: rows.map(row => this.graphNodeRowToSummary(row, workspaceId)),
      total: Number(countResult.count),
    };
  }

  /**
   * Graph-node summaries (same label resolution as queryGraphNodes) for an
   * explicit set of refs — the caller owns ordering and limits. Intended for
   * the rooted/paths traversals, whose node sets are a few hundred at most.
   */
  async queryGraphNodesByRefs(
    refs: Array<{ datasourceId: string; objectId: string }>,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<ObjectGraphNodeSummary[]> {
    if (refs.length === 0) {
      return [];
    }
    const rows = await this.table()
      .where('workspace_id', workspaceId)
      .whereIn(
        ['datasource_id', 'object_id'],
        refs.map(ref => [ref.datasourceId, ref.objectId]),
      )
      .select<GraphNodeRow[]>(
        'id',
        'datasource_id',
        'object_id',
        'created_at',
        'updated_at',
        this.graphNodeDisplayNameSelect(),
      );
    return rows.map(row => this.graphNodeRowToSummary(row, workspaceId));
  }

  async search(params: SearchParams) {
    const { q, datasourceIds, limit = 50, offset = 0 } = params;

    const parsed = parseSearchQuery(q);
    if (!parsed) {
      return { items: [], total: 0 };
    }

    const itemsQuery = this.table()
      .where(
        `${TABLE_NAME}.workspace_id`,
        params.workspaceId ?? DEFAULT_WORKSPACE_ID,
      )
      .select(
        `${TABLE_NAME}.id`,
        `${TABLE_NAME}.datasource_id`,
        `${TABLE_NAME}.object_id`,
        `${TABLE_NAME}.object`,
        // pg_trgm `similarity` against the raw query gives a sensible
        // relevance score for multi-term searches.
        this.knex.raw(`similarity(search_text, ?) as rank`, [q]),
        this.knex.raw(`count(*) OVER() as total_count`),
      );

    for (const pattern of parsed.include) {
      itemsQuery.whereRaw(`search_text ILIKE ?`, [`%${escapeIlike(pattern)}%`]);
    }
    for (const pattern of parsed.exclude) {
      itemsQuery.whereRaw(`search_text NOT ILIKE ?`, [
        `%${escapeIlike(pattern)}%`,
      ]);
    }

    if (datasourceIds && datasourceIds.length > 0) {
      itemsQuery.whereIn('datasource_id', datasourceIds);
    }

    itemsQuery.orderBy('rank', 'desc').limit(limit).offset(offset);

    const items = await itemsQuery;

    const total =
      items.length > 0
        ? Number(
            (items[0] as DatastoreRow & { total_count: string }).total_count,
          )
        : 0;

    const result = {
      items: await this.withPresentation(
        items.map((row: DatastoreRow & { rank?: number }) => ({
          id: row.id,
          ...workspaceOwnershipFields(
            params.workspaceId ?? DEFAULT_WORKSPACE_ID,
          ),
          datasourceId: row.datasource_id,
          objectId: row.object_id,
          object: JSON.parse(row.object),
          createdAt: '',
          updatedAt: '',
        })),
      ),
      total,
    };

    if (params.explain) {
      const itemsExplain = await this.explainSql(itemsQuery.toSQL());

      return {
        ...result,
        explain: {
          items: itemsExplain,
        },
      };
    }

    return result;
  }

  async getDatastoreItem(
    datasourceId: string,
    objectId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<DatastoreObject | undefined> {
    const row = await this.table()
      .where('datasource_id', datasourceId)
      .andWhere('workspace_id', workspaceId)
      .andWhere('object_id', objectId)
      .first();
    if (!row) {
      return undefined;
    }
    const [item] = await this.withPresentation([rowToDatastoreObject(row)]);
    return item;
  }

  async deleteDatastoreItem(
    datasourceId: string,
    objectId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ) {
    await retryOnDeadlock(() =>
      this.knex.transaction(async trx => {
        await this.table(trx)
          .delete()
          .where('datasource_id', datasourceId)
          .andWhere('workspace_id', workspaceId)
          .andWhere('object_id', objectId);
        await this.activityDao?.touch(
          datasourceId,
          new Date(),
          trx,
          workspaceId,
        );
      }),
    );
    this.events?.emitChanged(datasourceId, workspaceId);
  }

  async deleteAllDatastoreItems(
    datasourceId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ) {
    await retryOnDeadlock(() =>
      this.knex.transaction(async trx => {
        await this.table(trx)
          .delete()
          .where('datasource_id', datasourceId)
          .andWhere('workspace_id', workspaceId);
        await this.activityDao?.touch(
          datasourceId,
          new Date(),
          trx,
          workspaceId,
        );
      }),
    );
    this.events?.emitChanged(datasourceId, workspaceId);
  }

  async checkObjectExists(
    datasourceId: string,
    objectId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<boolean> {
    const row = await this.table()
      .where('datasource_id', datasourceId)
      .andWhere('workspace_id', workspaceId)
      .andWhere('object_id', objectId)
      .select(this.knex.raw('1'))
      .first();
    return !!row;
  }

  async getRowsByDatasource(
    datasourceId: string,
    trx?: Knex,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<DatastoreRow[]> {
    return this.table(trx).where({
      datasource_id: datasourceId,
      workspace_id: workspaceId,
    });
  }

  async randomSample(
    datasourceId: string,
    limit: number = 50,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<{ items: DatastoreObject[]; total: number }> {
    const [countResult] = await this.table()
      .where('datasource_id', datasourceId)
      .andWhere('workspace_id', workspaceId)
      .count<Array<{ count: string }>>('* as count');

    const items = await this.table()
      .where('datasource_id', datasourceId)
      .andWhere('workspace_id', workspaceId)
      .orderByRaw('RANDOM()')
      .limit(limit);

    return {
      items: await this.withPresentation(items.map(rowToDatastoreObject)),
      total: Number(countResult.count),
    };
  }

  /**
   * Deterministic, full-when-small sample for the suggest-relationships path.
   * Orders by a deterministic hash of `id` (pseudo-random, stable) so the same
   * dataset returns the same rows on every call — eliminates the run-to-run
   * variability that random sampling introduces into the suggestion output.
   *
   * For datasources with `total <= limit` the result is the full enumeration;
   * for larger ones it is a stable head. Hash ordering is explicitly
   * pseudo-random and independent of insertion order, unlike UUID-ordered
   * sampling which can be biased by non-UUID or sequential ids. The default
   * `limit` is generous enough for typical Roadie workspaces (a few hundred to
   * a few thousand rows per datasource); raise it if a deployment has bigger
   * datasources.
   */
  async sampleForSuggestions(
    datasourceId: string,
    limit: number = SUGGESTION_SAMPLE_LIMIT,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<{ items: DatastoreObject[]; total: number }> {
    const [countResult] = await this.table()
      .where('datasource_id', datasourceId)
      .andWhere('workspace_id', workspaceId)
      .count<Array<{ count: string }>>('* as count');

    const items = await this.table()
      .where('datasource_id', datasourceId)
      .andWhere('workspace_id', workspaceId)
      .orderByRaw('md5(id::text)')
      .limit(limit);

    return {
      items: await this.withPresentation(items.map(rowToDatastoreObject)),
      total: Number(countResult.count),
    };
  }

  /**
   * Which of `values` appear as the value of `field` in this datasource's
   * objects, checked against the FULL table (not the suggestion sample). Used
   * to verify containment near-misses when the referenced side is larger than
   * its sample (FastFK-style staged verification): the caller (candidateGates)
   * skips candidates below its 0.5 containment floor and caps `values` at
   * VERIFICATION_VALUE_CAP, so this rescues referenced tables up to roughly 2x
   * the sample size.
   *
   * Scoped to `field` with whole-value equality — the value must equal the
   * field's scalar value, or an element of the field when it is an array —
   * rather than a substring match anywhere in the object. A relationship edge
   * is only real when the value IS the field's value; a false edge is
   * expensive downstream, since context-group merges follow every active edge
   * with no confidence or depth gate. Values are the profiler's raw string
   * leaves (numbers are not profiled), so the comparison is exact and
   * case-sensitive, mirroring the in-memory intersection this augments.
   *
   * `field` is a profiler field expression (`$.a.b`, `$.'odd key'.c`). Array-
   * of-object qualifier paths (`$.items[k="v"].f`) cannot map to a JSON path,
   * so they verify nothing and the candidate keeps its sample-based
   * containment — conservative: never a false promotion.
   */
  async findValuesPresent(
    datasourceId: string,
    field: string,
    values: string[],
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Set<string>> {
    if (values.length === 0) {
      return new Set();
    }
    const path = fieldExpressionToJsonPath(field);
    if (!path) {
      return new Set();
    }
    const pathLiteral = toPgTextArrayLiteral(path);
    // One scan of the datasource: the LATERAL yields the field's scalar value
    // plus every element when the field is an array, and ANY(...) keeps only
    // the requested values. No trigram index applies here, but this runs only
    // on capped near-miss rescues.
    const rows = await this.knex.raw(
      `SELECT DISTINCT fv.val
       FROM ?? d
       CROSS JOIN LATERAL (
         SELECT d.object::jsonb #>> ? AS val
         UNION ALL
         SELECT e.elem AS val
         FROM jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(d.object::jsonb #> ?) = 'array'
                THEN d.object::jsonb #> ?
                ELSE '[]'::jsonb END
         ) AS e(elem)
       ) fv
       WHERE d.datasource_id = ? AND d.workspace_id = ?
         AND fv.val = ANY(?::text[])`,
      [
        TABLE_NAME,
        pathLiteral,
        pathLiteral,
        pathLiteral,
        datasourceId,
        workspaceId,
        values,
      ],
    );
    return new Set(rows.rows.map((row: { val: string }) => row.val));
  }

  async explainSql({ sql, bindings }: ReturnType<Knex.QueryBuilder['toSQL']>) {
    const result = await this.knex.raw(
      `EXPLAIN (FORMAT JSON, ANALYZE) ${sql}`,
      bindings,
    );
    return result.rows[0]['QUERY PLAN'];
  }
}
