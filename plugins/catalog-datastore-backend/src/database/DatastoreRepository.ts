import type { Knex } from 'knex';
import { v4 as uuid } from 'uuid';
import RE2 from 're2';
import type { Expression } from 'jsonata';
import { LoggerService } from '@roadiehq/extensions-api';
import type { JsonObject, JsonValue } from '@roadiehq/types';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';
import {
  DatastoreObject,
  DatastoreRow,
  IndexConfiguration,
  IntegrationRuleCaller,
  RelationshipRule,
} from './types';
import { ObjectDao, datastoreObjectToRow } from './ObjectDao';
import { SchemaDao } from './SchemaDao';
import { IndexDao } from './IndexDao';
import { RelationshipDao } from './RelationshipDao';
import { RelationshipRuleDao } from './RelationshipRuleDao';
import { DatastoreDao } from './DatastoreDao';
import { AutoApplyCoalescer } from './AutoApplyCoalescer';
import {
  type DuplicateObjectIdStrategy,
  type IntegrationBackedConfig,
  type RelationshipRuleMatchStrategy,
  type RelationshipRuleStrategy,
  DATASOURCE_PUBLISH_LOCK_NS,
  SCHEMA_SAMPLE_ITEMS,
  parseDuplicateObjectIdStrategy,
  resolveDatastoreItemsByObjectIdStrategy,
} from '@roadiehq/catalog-datastore-common';
import {
  diffMergePublish,
  restampUnchangedSchemaIds,
  upsertSchemaVersion,
  type PublishDelta,
} from '@roadiehq/catalog-datastore-node';
import {
  expandIdentifierSearchAliases,
  expandPersonNameSearchAliases,
} from '../api/schemas/relationshipCandidateFilter';
import { DatasourceActivityDao } from './DatasourceActivityDao';
import { DatasourceEvents } from '../webhooks/DatasourceEvents';
import { jsonata, normalizeFieldValues } from './evaluationHelpers';
import { orderRulesByGraphDependencies } from './orderRulesByGraphDependencies';
import {
  applyIntegrationBackedRule,
  type ApplyRuleResult,
  type RuleCandidateEdge,
} from './integrationBackedRule';
import {
  applyRelationshipRuleSealed,
  type RelationshipApplyEngineDeps,
} from './relationshipApplyEngine';

const DATASTORE_BATCH_SIZE = 9000;
const DEFAULT_DRY_RUN_SAMPLE_LIMIT = 25;
// Returns the object's human label (name/title/metadata.name) or undefined when
// it has none. Callers that need a guaranteed string use readObjectLabel; those
// that must distinguish "no label" from "a label that happens to equal the id"
// use this directly.
function resolveObjectLabel(row: DatastoreRow): string | undefined {
  let object: unknown;
  try {
    object = JSON.parse(row.object);
  } catch {
    return undefined;
  }

  if (typeof object !== 'object' || object === null || Array.isArray(object)) {
    return undefined;
  }

  const record = object as Record<string, unknown>;
  if (typeof record.name === 'string' && record.name.trim()) {
    return record.name.trim();
  }
  if (typeof record.title === 'string' && record.title.trim()) {
    return record.title.trim();
  }

  const metadata = record.metadata;
  if (
    typeof metadata === 'object' &&
    metadata !== null &&
    !Array.isArray(metadata)
  ) {
    const metadataRecord = metadata as Record<string, unknown>;
    if (typeof metadataRecord.name === 'string' && metadataRecord.name.trim()) {
      return metadataRecord.name.trim();
    }
  }

  return undefined;
}

function readObjectLabel(row: DatastoreRow): string {
  return resolveObjectLabel(row) ?? row.object_id;
}

export class DatastoreRepository {
  private readonly knex: Knex;
  private readonly logger: LoggerService;
  private readonly objectDao: ObjectDao;
  private readonly schemaDao: SchemaDao;
  private readonly indexDao: IndexDao;
  private readonly relationshipDao: RelationshipDao;
  private readonly relationshipRuleDao: RelationshipRuleDao;
  private readonly dao: DatastoreDao;
  private readonly autoApplyCoalescer: AutoApplyCoalescer;
  private readonly activityDao?: DatasourceActivityDao;
  private readonly events?: DatasourceEvents;
  private readonly callIntegration?: IntegrationRuleCaller;

  constructor(options: {
    knex: Knex;
    logger: LoggerService;
    objectDao: ObjectDao;
    schemaDao: SchemaDao;
    indexDao: IndexDao;
    relationshipDao: RelationshipDao;
    relationshipRuleDao: RelationshipRuleDao;
    activityDao?: DatasourceActivityDao;
    events?: DatasourceEvents;
    callIntegration?: IntegrationRuleCaller;
    autoApplyCoalesceDelayMs?: number;
    workspaceExists?: (workspaceId: string) => Promise<boolean>;
  }) {
    this.knex = options.knex;
    this.logger = options.logger;
    this.objectDao = options.objectDao;
    this.schemaDao = options.schemaDao;
    this.indexDao = options.indexDao;
    this.relationshipDao = options.relationshipDao;
    this.relationshipRuleDao = options.relationshipRuleDao;
    this.activityDao = options.activityDao;
    this.events = options.events;
    this.callIntegration = options.callIntegration;
    this.dao = new DatastoreDao({
      knex: options.knex,
      logger: options.logger,
    });
    this.autoApplyCoalescer = new AutoApplyCoalescer({
      logger: options.logger,
      delayMs: options.autoApplyCoalesceDelayMs,
      run: async (ids, workspaceId) => {
        if (
          options.workspaceExists &&
          !(await options.workspaceExists(workspaceId))
        ) {
          return;
        }
        await this.applyRelationshipRulesForDatasources(ids, workspaceId);
      },
    });
  }

  /** Test helper: drains the auto-apply queue so tests can assert outcomes. */
  async flushAutoApplyForTesting(): Promise<void> {
    await this.autoApplyCoalescer.flushNow();
  }

  async rebuildIndexes(
    datasourceId: string,
    key: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<void> {
    return this.dao.rebuildIndexes(datasourceId, key, workspaceId);
  }

  async queryWithJoin(params: {
    workspaceId?: string;
    leftDatasourceId: string;
    rightDatasourceId: string;
    leftIndexKey: string;
    rightIndexKey: string;
    limit?: number;
    offset?: number;
  }) {
    return this.dao.queryWithJoin(params);
  }

  async replaceDatasourceItems(
    datasourceId: string,
    items: (Omit<
      Omit<Omit<DatastoreObject, 'id'>, 'createdAt'>,
      'updatedAt'
    > & { id?: string; createdAt?: string; updatedAt?: string })[],
    options?: {
      workspaceId?: string;
      datasourceName?: string;
      schema?: JsonValue;
      duplicateObjectIdStrategy?: DuplicateObjectIdStrategy;
    },
  ): Promise<PublishDelta & { itemCount: number }> {
    const workspaceId = options?.workspaceId ?? DEFAULT_WORKSPACE_ID;
    const strategy = parseDuplicateObjectIdStrategy(
      options?.duplicateObjectIdStrategy,
    );
    let uniqueItems: typeof items;
    let duplicateRowsRemoved: number;
    try {
      const resolved = resolveDatastoreItemsByObjectIdStrategy(items, strategy);
      uniqueItems = resolved.items;
      duplicateRowsRemoved = resolved.removed;
    } catch (e: unknown) {
      if (e instanceof Error) {
        throw e;
      }
      throw new Error(String(e));
    }
    if (duplicateRowsRemoved > 0) {
      if (strategy === 'append') {
        this.logger.warn(
          `replaceDatasourceItems: recorded ${duplicateRowsRemoved} duplicate row(s) under additionalResults (append strategy, datasource ${datasourceId})`,
        );
      } else {
        this.logger.warn(
          `replaceDatasourceItems: removed ${duplicateRowsRemoved} duplicate row(s) with the same objectId; kept one row per id (datasource ${datasourceId})`,
        );
      }
    }

    const delta = await this.knex.transaction(async trx => {
      await trx.raw(`SELECT pg_advisory_xact_lock(hashtext(?))`, [
        `${DATASOURCE_PUBLISH_LOCK_NS}${workspaceId}:${datasourceId}`,
      ]);

      const schemaId =
        uniqueItems.length > 0
          ? await upsertSchemaVersion(trx, {
              datasourceId,
              workspaceId,
              datasourceName: options?.datasourceName ?? datasourceId,
              sampleObjects: uniqueItems
                .slice(0, SCHEMA_SAMPLE_ITEMS)
                .map(item => item.object),
              explicitSchema: options?.schema,
            })
          : null;

      await trx.raw(
        `CREATE TEMP TABLE publish_source (
           object_id text NOT NULL,
           object text NOT NULL,
           object_hash text NOT NULL
         ) ON COMMIT DROP`,
      );
      const sourceRows = uniqueItems.map(item => {
        const row = datastoreObjectToRow({ ...item, datasourceId });
        return {
          object_id: row.object_id,
          object: row.object,
          object_hash: row.object_hash,
        };
      });
      for (let i = 0; i < sourceRows.length; i += DATASTORE_BATCH_SIZE) {
        await trx('publish_source').insert(
          sourceRows.slice(i, i + DATASTORE_BATCH_SIZE),
        );
      }
      await trx.raw(`ANALYZE publish_source`);

      const publishDelta = await diffMergePublish(trx, {
        datasourceId,
        workspaceId,
        source: {
          sql: `SELECT object_id, object, object_hash FROM publish_source`,
          bindings: [],
        },
        schemaId,
      });
      if (schemaId) {
        await restampUnchangedSchemaIds(trx, {
          datasourceId,
          workspaceId,
          schemaId,
        });
      }

      await trx.raw(
        `DELETE FROM datastore_index di
         USING publish_delta pd
         WHERE pd.kind = 'updated' AND di.datastore_id = pd.datastore_id`,
      );
      if (publishDelta.updated + publishDelta.inserted > 0) {
        const indexConfigurations = await this.indexDao.getConfigsByDatasource(
          datasourceId,
          trx,
          workspaceId,
        );
        if (indexConfigurations.length > 0) {
          const deltaRows: DatastoreRow[] = await trx('datastore')
            .join('publish_delta as pd', 'pd.datastore_id', 'datastore.id')
            .select('datastore.*');
          await this.indexDao.buildIndexesForRows(
            deltaRows,
            indexConfigurations,
            trx,
          );
        }
      }

      return publishDelta;
    });

    await this.applyPublishSideEffects(datasourceId, delta, workspaceId);

    return { ...delta, itemCount: uniqueItems.length };
  }

  /**
   * The delta-gated side effects EVERY datastore publish must end in,
   * whichever feeder wrote it (sc-34102 §5d, sc-34243). Two feeders exist:
   * `replaceDatasourceItems` calls this inline after its transaction; the
   * paged engine's StagedPublisher writes via the shared diff-merge core in
   * another plugin, so its runs arrive here through `WorkflowSyncSubscriber`
   * on the workflow sync event. A new feeder MUST end in this method — the
   * publish-parity suite asserts both existing feeders produce identical
   * side effects.
   *
   * On a changed delta: activity touch, datasource-changed (context groups,
   * webhooks), and relationship-rule auto-apply. On a no-op: only the
   * activity marker, so reads can tell "synced but empty" from "never
   * synced" while `updated_since` consumers stay silent.
   */
  async applyPublishSideEffects(
    datasourceId: string,
    delta: PublishDelta,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<void> {
    const changed = delta.deleted + delta.updated + delta.inserted > 0;
    if (changed) {
      await this.activityDao?.touch(
        datasourceId,
        new Date(),
        undefined,
        workspaceId,
      );
      this.events?.emitChanged(datasourceId, workspaceId);
      this.autoApplyCoalescer.schedule(datasourceId, workspaceId);
    } else {
      await this.activityDao?.ensureExists(
        datasourceId,
        new Date(),
        undefined,
        workspaceId,
      );
    }
  }

  async getDatasourceItems(
    datasourceId: string,
    options?: { workspaceId?: string; limit?: number; offset?: number },
  ): Promise<{ items: JsonObject[]; total: number }> {
    const { items, total } = await this.objectDao.query(datasourceId, {
      workspaceId: options?.workspaceId,
      limit: options?.limit,
      offset: options?.offset,
    });
    if (total === 0 && this.activityDao) {
      // Distinguish "synced but currently empty" (activity row exists) from a
      // datasource the datastore has never seen.
      const activity = options?.workspaceId
        ? await this.activityDao.get(datasourceId, options.workspaceId)
        : await this.activityDao.get(datasourceId);
      if (!activity) {
        throw new Error(`Data source not found: ${datasourceId}`);
      }
    }
    // The write path (DatastoreItem.object) only accepts JSON objects, so the
    // stored values are objects.
    return { items: items.map(item => item.object as JsonObject), total };
  }

  async insertDatastoreItem(
    item: DatastoreObject,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ) {
    await this.knex.transaction(async trx => {
      const indexConfigurations = await this.indexDao.getConfigsByDatasource(
        item.datasourceId,
        trx,
        workspaceId,
      );
      const row = datastoreObjectToRow(item, workspaceId);
      await this.objectDao.table(trx).insert(row);
      await this.indexDao.buildIndexesForRows([row], indexConfigurations, trx);
      await this.activityDao?.touch(
        item.datasourceId,
        new Date(),
        trx,
        workspaceId,
      );
    });
    this.events?.emitChanged(item.datasourceId, workspaceId);
  }

  async upsertDatastoreItem(
    item: DatastoreObject,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ) {
    await this.knex.transaction(async trx => {
      await this.objectDao
        .table(trx)
        .where('datasource_id', item.datasourceId)
        .andWhere('workspace_id', workspaceId)
        .andWhere('object_id', item.objectId)
        .delete();

      const indexConfigurations = await this.indexDao.getConfigsByDatasource(
        item.datasourceId,
        trx,
        workspaceId,
      );
      const row = datastoreObjectToRow(item, workspaceId);
      await this.objectDao.table(trx).insert(row);
      await this.indexDao.buildIndexesForRows([row], indexConfigurations, trx);
      await this.activityDao?.touch(
        item.datasourceId,
        new Date(),
        trx,
        workspaceId,
      );
    });
    this.events?.emitChanged(item.datasourceId, workspaceId);
  }

  async createIndexConfiguration(
    config: IndexConfiguration,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<void> {
    await this.knex.transaction(async trx => {
      // Serialize against a concurrent staged publish (same lock key): the
      // backfill below reads the rows it can see, so interleaving with a
      // publish rewriting those rows would leave the new config's index rows
      // missing the publish's delta.
      await trx.raw(`SELECT pg_advisory_xact_lock(hashtext(?))`, [
        `${DATASOURCE_PUBLISH_LOCK_NS}${workspaceId}:${config.datasourceId}`,
      ]);
      const datastoreRows = await this.objectDao.getRowsByDatasource(
        config.datasourceId,
        trx,
        workspaceId,
      );
      await this.indexDao.insertConfigAndBuildIndexes(
        config,
        datastoreRows,
        trx,
        workspaceId,
      );
    });
  }

  async deleteRelationshipRule(id: string, workspaceId: string): Promise<void> {
    const rule = await this.relationshipRuleDao.getRelationshipRule(
      id,
      workspaceId,
    );
    let deleted = 0;
    await this.knex.transaction(async trx => {
      deleted = await this.relationshipDao.deleteByRuleId(id, trx, workspaceId);
      await this.relationshipRuleDao.deleteRelationshipRule(
        id,
        trx,
        workspaceId,
      );
    });
    if (rule && deleted > 0) {
      this.notifyRelationshipsChanged(
        [rule.sourceDatasourceId, rule.targetDatasourceId],
        workspaceId,
      );
    }
  }

  /**
   * Removes a rule's materialized edges without touching the rule itself —
   * the deactivate (active → inactive) path. Goes through the repository
   * rather than the DAO so consumers of the edges (context groups) are told
   * they changed.
   */
  async deleteRelationshipsByRuleId(
    ruleId: string,
    workspaceId: string,
  ): Promise<number> {
    const rule = await this.relationshipRuleDao.getRelationshipRule(
      ruleId,
      workspaceId,
    );
    const deleted = await this.relationshipDao.deleteByRuleId(
      ruleId,
      undefined,
      workspaceId,
    );
    if (rule && deleted > 0) {
      this.notifyRelationshipsChanged(
        [rule.sourceDatasourceId, rule.targetDatasourceId],
        workspaceId,
      );
    }
    return deleted;
  }

  /**
   * Context groups merge members across `datastore_relation` edges, so every
   * write path that changes edges must announce it — otherwise materialized
   * groups silently drift from the graph (the original bug: a second rule
   * reusing an existing relation type never re-materialized its groups).
   */
  private notifyRelationshipsChanged(
    datasourceIds: string[],
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): void {
    for (const datasourceId of new Set(datasourceIds)) {
      this.events?.emitRelationshipsChanged(datasourceId, workspaceId);
    }
  }

  private async evaluateRows(
    rows: DatastoreRow[],
    fieldExpr: Expression,
    options?: { filterExpr?: Expression; offset?: number; limit?: number },
  ): Promise<{
    items: Array<{ row: DatastoreRow; fieldValues: string[] }>;
    total: number;
  }> {
    const items: Array<{ row: DatastoreRow; fieldValues: string[] }> = [];
    const offset = options?.offset ?? 0;
    let matched = 0;
    for (const row of rows) {
      const obj = JSON.parse(row.object);
      if (options?.filterExpr) {
        const passes = await options.filterExpr.evaluate(obj);
        if (!passes) {
          continue;
        }
      }
      const value = await fieldExpr.evaluate(obj);
      const fieldValues = normalizeFieldValues(value);
      if (fieldValues.length > 0) {
        if (
          matched >= offset &&
          (!options?.limit || items.length < options.limit)
        ) {
          items.push({ row, fieldValues });
        }
        matched++;
      }
    }
    return { items, total: matched };
  }

  private findMatches(
    sources: Array<{ row: DatastoreRow; fieldValues: string[] }>,
    targets: Array<{ row: DatastoreRow; fieldValues: string[] }>,
    matchStrategy: RelationshipRuleMatchStrategy,
  ): Array<{
    source: DatastoreRow;
    target: DatastoreRow;
    matchedValue: string;
    matchedTargetValue: string;
  }> {
    const aliasKeysFor = (value: string): string[] => {
      const keys = new Set<string>();
      keys.add(value);
      keys.add(value.toLowerCase());
      for (const alias of expandIdentifierSearchAliases(value)) {
        keys.add(alias);
        keys.add(alias.toLowerCase());
      }
      for (const alias of expandPersonNameSearchAliases(value)) {
        keys.add(alias);
        keys.add(alias.toLowerCase());
      }
      return [...keys];
    };

    const matchesStrategy = (
      sourceValue: string,
      targetValue: string,
    ): boolean => {
      switch (matchStrategy) {
        case 'exact':
          return sourceValue === targetValue;
        case 'array_contains':
          return sourceValue === targetValue;
        case 'contains':
          return targetValue.includes(sourceValue);
        case 'regex':
          try {
            return new RE2(targetValue).test(sourceValue);
          } catch {
            return false;
          }
        case 'person_name_alias': {
          if (sourceValue === targetValue) {
            return true;
          }
          const sourceKeys = new Set(aliasKeysFor(sourceValue));
          for (const tKey of aliasKeysFor(targetValue)) {
            if (sourceKeys.has(tKey)) {
              return true;
            }
          }
          return false;
        }
        default:
          return sourceValue === targetValue;
      }
    };

    const indexByKey = new Map<
      string,
      Array<{ row: DatastoreRow; fieldValues: string[] }>
    >();
    // `array_contains` reduces to equality between expanded fieldValues, so
    // it shares the exact-equality index rather than falling into the
    // quadratic scan below.
    const isEqualityStrategy =
      matchStrategy === 'exact' || matchStrategy === 'array_contains';
    if (isEqualityStrategy || matchStrategy === 'person_name_alias') {
      for (const target of targets) {
        for (const targetValue of target.fieldValues) {
          const keys =
            matchStrategy === 'person_name_alias'
              ? aliasKeysFor(targetValue)
              : [targetValue];
          for (const key of keys) {
            const existing = indexByKey.get(key) ?? [];
            existing.push(target);
            indexByKey.set(key, existing);
          }
        }
      }
    }

    const pairs: Array<{
      source: DatastoreRow;
      target: DatastoreRow;
      matchedValue: string;
      matchedTargetValue: string;
    }> = [];

    for (const source of sources) {
      const matched = new Set<string>();
      for (const sourceValue of source.fieldValues) {
        let candidates: Array<{
          row: DatastoreRow;
          fieldValues: string[];
        }>;
        if (isEqualityStrategy) {
          candidates = indexByKey.get(sourceValue) ?? [];
        } else if (matchStrategy === 'person_name_alias') {
          const byId = new Map<
            string,
            { row: DatastoreRow; fieldValues: string[] }
          >();
          for (const key of aliasKeysFor(sourceValue)) {
            for (const t of indexByKey.get(key) ?? []) {
              byId.set(t.row.object_id, t);
            }
          }
          candidates = [...byId.values()];
        } else {
          candidates = targets.filter(t =>
            t.fieldValues.some(targetValue =>
              matchesStrategy(sourceValue, targetValue),
            ),
          );
        }

        for (const target of candidates) {
          if (matched.has(target.row.object_id)) {
            continue;
          }
          matched.add(target.row.object_id);
          const matchedTargetValue = target.fieldValues.find(tv =>
            matchesStrategy(sourceValue, tv),
          );
          pairs.push({
            source: source.row,
            target: target.row,
            matchedValue: sourceValue,
            matchedTargetValue: matchedTargetValue ?? sourceValue,
          });
        }
      }
    }

    return pairs;
  }

  /**
   * In-memory field-matching evaluator used **only** by the dry-run / preview
   * path (bounded by `sampleLimit`, never writes). Real applies run through the
   * three-phase sealed engine (`applyRelationshipRuleSealed`).
   */
  private async applyRuleWithRows(
    rule: RelationshipRule,
    sourceRows: DatastoreRow[],
    targetRows: DatastoreRow[],
    options?: { sampleLimit?: number },
  ): Promise<ApplyRuleResult> {
    const sampleLimit = options?.sampleLimit;
    const sourceFieldExpr = jsonata(rule.sourceFieldExpression);
    const targetFieldExpr = jsonata(rule.targetFieldExpression);
    const sourceFilterExpr = rule.sourceFilterExpression
      ? jsonata(rule.sourceFilterExpression)
      : undefined;
    const targetFilterExpr = rule.targetFilterExpression
      ? jsonata(rule.targetFilterExpression)
      : undefined;

    const { items: filteredSources } = await this.evaluateRows(
      sourceRows,
      sourceFieldExpr,
      { filterExpr: sourceFilterExpr },
    );
    const { items: filteredTargets } = await this.evaluateRows(
      targetRows,
      targetFieldExpr,
      { filterExpr: targetFilterExpr },
    );

    const truncated =
      sampleLimit !== undefined && filteredSources.length > sampleLimit;
    const sampledSources =
      sampleLimit !== undefined
        ? filteredSources.slice(0, sampleLimit)
        : filteredSources;

    const pairs = this.findMatches(
      sampledSources,
      filteredTargets,
      rule.matchStrategy,
    );

    return {
      created: pairs.length,
      deleted: 0,
      sourceRowCount: sourceRows.length,
      targetRowCount: targetRows.length,
      filteredSourceCount: filteredSources.length,
      filteredTargetCount: filteredTargets.length,
      pairCount: pairs.length,
      candidates: pairs.map(({ source, target }) => ({
        sourceObjectId: source.object_id,
        destinationObjectId: target.object_id,
        relationshipType: rule.relationshipType,
        metadata: null,
      })),
      skippedSources: [],
      truncated,
      sampled: sampledSources.length,
    };
  }

  /**
   * Dry-run evaluator only. Real applies go through the three-phase sealed
   * engine (`applyRelationshipRuleSealed`); this in-memory path survives solely
   * for preview / dry-run, which is bounded by `sampleLimit` and never writes.
   */
  private async evaluateRuleDryRun(
    rule: RelationshipRule,
    sourceRows: DatastoreRow[],
    targetRows: DatastoreRow[],
    options?: { sampleLimit?: number; workspaceId?: string },
  ): Promise<ApplyRuleResult> {
    if (rule.strategy === 'integration-backed') {
      return applyIntegrationBackedRule({
        rule,
        sourceRows,
        targetRows,
        callIntegration: this.callIntegration,
        evaluateRows: (rows, fieldExpr, opts) =>
          this.evaluateRows(rows, fieldExpr, opts),
        relationshipDao: this.relationshipDao,
        knex: this.knex,
        logger: this.logger,
        dryRun: true,
        sampleLimit: options?.sampleLimit,
        workspaceId: options?.workspaceId,
      });
    }
    return this.applyRuleWithRows(rule, sourceRows, targetRows, {
      sampleLimit: options?.sampleLimit,
    });
  }

  private relationshipEngineDeps(): RelationshipApplyEngineDeps {
    return {
      knex: this.knex,
      logger: this.logger,
      relationshipDao: this.relationshipDao,
      callIntegration: this.callIntegration,
    };
  }

  async applyRelationshipRule(
    ruleId: string,
    options?: {
      workspaceId?: string;
      triggerSource?: 'manual' | 'auto' | 'batch';
      runGroupId?: string;
      dryRun?: boolean;
      sampleLimit?: number;
    },
  ): Promise<{
    created: number;
    deleted: number;
    candidates?: RuleCandidateEdge[];
    skippedSources?: string[];
    truncated?: boolean;
    callLimitReached?: boolean;
    sampled?: number;
  }> {
    const workspaceId = options?.workspaceId ?? DEFAULT_WORKSPACE_ID;
    const rule = await this.relationshipRuleDao.getRelationshipRule(
      ruleId,
      workspaceId,
    );
    if (!rule) {
      throw new Error(`Relationship rule ${ruleId} not found`);
    }
    // A dry-run never writes, so it's allowed for any state — that's the whole
    // point of testing a suggested rule before activating it.
    if (!options?.dryRun && rule.state !== 'active') {
      throw new Error(
        `Relationship rule ${ruleId} cannot be applied because it is ${rule.state}`,
      );
    }

    // Dry-run stays on the bounded in-memory evaluator (sampleLimit-bounded,
    // never writes). A real apply runs the three-phase sealed engine, which
    // streams both datasources in pages — no whole-datasource load.
    if (options?.dryRun) {
      const [sourceRows, targetRows] = await Promise.all([
        this.objectDao.getRowsByDatasource(
          rule.sourceDatasourceId,
          undefined,
          workspaceId,
        ),
        this.objectDao.getRowsByDatasource(
          rule.targetDatasourceId,
          undefined,
          workspaceId,
        ),
      ]);
      const applyResult = await this.evaluateRuleDryRun(
        rule,
        sourceRows,
        targetRows,
        {
          sampleLimit:
            rule.strategy === 'integration-backed'
              ? (options.sampleLimit ?? DEFAULT_DRY_RUN_SAMPLE_LIMIT)
              : options.sampleLimit,
          workspaceId,
        },
      );
      return {
        created: applyResult.created,
        deleted: applyResult.deleted,
        candidates: applyResult.candidates ?? [],
        skippedSources: applyResult.skippedSources ?? [],
        truncated: applyResult.truncated ?? false,
        callLimitReached: applyResult.callLimitReached ?? false,
        sampled: applyResult.sampled ?? 0,
      };
    }

    const applyResult = await applyRelationshipRuleSealed(
      this.relationshipEngineDeps(),
      rule,
      undefined,
      workspaceId,
    );
    if (applyResult.created + applyResult.deleted > 0) {
      this.notifyRelationshipsChanged(
        [rule.sourceDatasourceId, rule.targetDatasourceId],
        workspaceId,
      );
    }
    return { created: applyResult.created, deleted: applyResult.deleted };
  }

  async previewRelationshipRule(input: {
    workspaceId?: string;
    sourceDatasourceId: string;
    targetDatasourceId: string;
    sourceFieldExpression: string;
    targetFieldExpression?: string;
    relationshipType: string;
    reciprocalRelationshipType?: string | null;
    matchStrategy: RelationshipRuleMatchStrategy;
    strategy?: RelationshipRuleStrategy;
    integrationConfig?: IntegrationBackedConfig | null;
    sourceFilterExpression?: string | null;
    targetFilterExpression?: string | null;
    offset?: number;
    limit?: number;
    sampleLimit?: number;
    sourceObjectId?: string;
  }): Promise<{
    items: Array<{
      sourceObjectId: string;
      relationshipType: string;
      targetObjectIds: string[];
      sourceValue?: string;
      targetValue?: string;
      matchSourceValues?: string[];
      matchTargetValues?: string[];
      sourceLabel?: string;
      targetLabels?: string[];
    }>;
    total: number;
    truncated?: boolean;
    callLimitReached?: boolean;
    skippedSources?: string[];
    /**
     * Only set for integration-backed input, which delegates to
     * previewIntegrationBackedRule below. Declared here because that result is
     * returned verbatim, so omitting it hid the field from every caller.
     */
    responseSample?: {
      sourceObjectId: string;
      sourceValue: string;
      path: string;
      data: unknown;
    };
  }> {
    // Integration-backed rules can't be matched with field expressions alone —
    // dry-run the real evaluator (live call + pathExpression + traversal) without
    // persisting, then shape the candidate edges like a field-matching preview.
    if (input.strategy === 'integration-backed' || input.integrationConfig) {
      return this.previewIntegrationBackedRule(input);
    }

    const limit = input.limit ?? 5;
    const offset = input.offset ?? 0;

    const sourceRows = await this.objectDao.getRowsByDatasource(
      input.sourceDatasourceId,
      undefined,
      input.workspaceId ?? DEFAULT_WORKSPACE_ID,
    );
    const scopedSourceRows = input.sourceObjectId
      ? sourceRows.filter(row => row.object_id === input.sourceObjectId)
      : sourceRows;

    const sourceFieldExpr = jsonata(input.sourceFieldExpression);

    // Evaluate the whole source set, not just the requested page. Paginating
    // sources in scan order and matching only within the page hides a sparse
    // real match: for a small target that is a subset of a large source (e.g. a
    // 6-repo target inside 214 source repos), the first page is almost all
    // non-matches, so the preview reads as "no matches" for a rule that does
    // match. We order matching sources first, then paginate, so the match is on
    // page one. `total` stays the count of sources that produced a field value.
    const { items: allSources, total } = await this.evaluateRows(
      scopedSourceRows,
      sourceFieldExpr,
    );

    if (!input.targetFieldExpression) {
      return {
        items: allSources
          .slice(offset, offset + limit)
          .map(({ row, fieldValues }) => ({
            sourceObjectId: row.object_id,
            relationshipType: input.relationshipType,
            targetObjectIds: [],
            sourceValue: fieldValues[0],
            sourceLabel: readObjectLabel(row),
            targetLabels: [],
          })),
        total,
      };
    }

    const targetRows = await this.objectDao.getRowsByDatasource(
      input.targetDatasourceId,
      undefined,
      input.workspaceId ?? DEFAULT_WORKSPACE_ID,
    );
    const targetFieldExpr = jsonata(input.targetFieldExpression);
    const { items: filteredTargets } = await this.evaluateRows(
      targetRows,
      targetFieldExpr,
    );

    // Match the full source set once, then order matching sources first
    // (preserving order within each group for determinism) and paginate that
    // ordering. The page's pairs are the subset of all matches on that page.
    const allPairs = this.findMatches(
      allSources,
      filteredTargets,
      input.matchStrategy,
    );
    const matchedSourceIds = new Set(
      allPairs.map(pair => pair.source.object_id),
    );
    const orderedSources = [
      ...allSources.filter(item => matchedSourceIds.has(item.row.object_id)),
      ...allSources.filter(item => !matchedSourceIds.has(item.row.object_id)),
    ];
    const paginatedSources = orderedSources.slice(offset, offset + limit);
    const pageSourceIds = new Set(
      paginatedSources.map(({ row }) => row.object_id),
    );
    const pairs = allPairs.filter(pair =>
      pageSourceIds.has(pair.source.object_id),
    );

    const targetsBySource = new Map<string, string[]>();
    const targetLabelsBySource = new Map<string, string[]>();
    const matchSourceValuesBySource = new Map<string, string[]>();
    const matchTargetValuesBySource = new Map<string, string[]>();
    for (const { source, target, matchedValue, matchedTargetValue } of pairs) {
      const existing = targetsBySource.get(source.object_id) ?? [];
      existing.push(target.object_id);
      targetsBySource.set(source.object_id, existing);
      const existingLabels = targetLabelsBySource.get(source.object_id) ?? [];
      existingLabels.push(readObjectLabel(target));
      targetLabelsBySource.set(source.object_id, existingLabels);
      const existingSrc = matchSourceValuesBySource.get(source.object_id) ?? [];
      existingSrc.push(matchedValue);
      matchSourceValuesBySource.set(source.object_id, existingSrc);
      const existingTgt = matchTargetValuesBySource.get(source.object_id) ?? [];
      existingTgt.push(matchedTargetValue);
      matchTargetValuesBySource.set(source.object_id, existingTgt);
    }

    return {
      items: paginatedSources.map(({ row, fieldValues }) => {
        const matchSourceValues =
          matchSourceValuesBySource.get(row.object_id) ?? [];
        const matchTargetValues =
          matchTargetValuesBySource.get(row.object_id) ?? [];
        return {
          sourceObjectId: row.object_id,
          relationshipType: input.relationshipType,
          targetObjectIds: targetsBySource.get(row.object_id) ?? [],
          sourceValue: matchSourceValues[0] ?? fieldValues[0],
          targetValue: matchTargetValues[0],
          matchSourceValues,
          matchTargetValues,
          sourceLabel: readObjectLabel(row),
          targetLabels: targetLabelsBySource.get(row.object_id) ?? [],
        };
      }),
      total,
    };
  }

  private async previewIntegrationBackedRule(input: {
    workspaceId?: string;
    sourceDatasourceId: string;
    targetDatasourceId: string;
    sourceFieldExpression: string;
    targetFieldExpression?: string;
    relationshipType: string;
    reciprocalRelationshipType?: string | null;
    matchStrategy: RelationshipRuleMatchStrategy;
    integrationConfig?: IntegrationBackedConfig | null;
    sourceFilterExpression?: string | null;
    targetFilterExpression?: string | null;
    offset?: number;
    limit?: number;
    sampleLimit?: number;
    sourceObjectId?: string;
  }): Promise<{
    items: Array<{
      sourceObjectId: string;
      relationshipType: string;
      targetObjectIds: string[];
      sourceValue?: string;
      targetValue?: string;
      matchSourceValues?: string[];
      matchTargetValues?: string[];
      sourceLabel?: string;
      targetLabels?: string[];
    }>;
    total: number;
    truncated?: boolean;
    callLimitReached?: boolean;
    skippedSources?: string[];
    responseSample?: {
      sourceObjectId: string;
      sourceValue: string;
      path: string;
      data: unknown;
    };
  }> {
    if (!input.integrationConfig) {
      throw new Error(
        'integration-backed preview requires an integrationConfig',
      );
    }

    if (!input.targetFieldExpression) {
      throw new Error(
        'integration-backed preview requires targetFieldExpression',
      );
    }

    // A synthetic, unsaved rule — enough for the evaluator to run in dry-run
    // mode. The id is only used for log messages here (the write/advisory-lock
    // path is skipped when dryRun is set).
    const now = new Date().toISOString();
    const rule: RelationshipRule = {
      id: `preview-${uuid()}`,
      name: 'preview',
      description: null,
      sourceDatasourceId: input.sourceDatasourceId,
      targetDatasourceId: input.targetDatasourceId,
      sourceFieldExpression: input.sourceFieldExpression,
      targetFieldExpression: input.targetFieldExpression,
      sourceFilterExpression: input.sourceFilterExpression ?? null,
      targetFilterExpression: input.targetFilterExpression ?? null,
      relationshipType: input.relationshipType,
      reciprocalRelationshipType: input.reciprocalRelationshipType ?? null,
      strategy: 'integration-backed',
      matchStrategy: input.matchStrategy,
      integrationConfig: input.integrationConfig,
      origin: 'preview',
      state: 'suggested',
      createdAt: now,
      updatedAt: now,
    };

    const [sourceRows, targetRows] = await Promise.all([
      this.objectDao.getRowsByDatasource(
        input.sourceDatasourceId,
        undefined,
        input.workspaceId ?? DEFAULT_WORKSPACE_ID,
      ),
      this.objectDao.getRowsByDatasource(
        input.targetDatasourceId,
        undefined,
        input.workspaceId ?? DEFAULT_WORKSPACE_ID,
      ),
    ]);

    const result = await applyIntegrationBackedRule({
      rule,
      sourceRows,
      targetRows,
      callIntegration: this.callIntegration,
      evaluateRows: (rows, fieldExpr, opts) =>
        this.evaluateRows(rows, fieldExpr, opts),
      relationshipDao: this.relationshipDao,
      knex: this.knex,
      logger: this.logger,
      dryRun: true,
      sampleLimit: input.sampleLimit ?? DEFAULT_DRY_RUN_SAMPLE_LIMIT,
      sourceObjectId: input.sourceObjectId,
      offset: input.offset,
      limit: input.limit,
      workspaceId: input.workspaceId,
    });

    // Resolve human labels for the objects involved so the preview shows the
    // matched login/name rather than raw object ids. Reuses the same
    // `readObjectLabel` helper as the field-matching path.
    const targetRowById = new Map(targetRows.map(row => [row.object_id, row]));
    const sourceRowById = new Map(sourceRows.map(row => [row.object_id, row]));

    interface Aggregate {
      targetObjectIds: string[];
      targetLabels: string[];
      matchValues: string[];
      matchedSourceValues: string[];
    }
    const bySource = new Map<string, Aggregate>();
    for (const candidate of result.candidates ?? []) {
      const agg = bySource.get(candidate.sourceObjectId) ?? {
        targetObjectIds: [],
        targetLabels: [],
        matchValues: [],
        matchedSourceValues: [],
      };
      agg.targetObjectIds.push(candidate.destinationObjectId);
      const targetRow = targetRowById.get(candidate.destinationObjectId);
      const resolvedLabel = targetRow
        ? resolveObjectLabel(targetRow)
        : undefined;
      // Prefer a human label; when the object genuinely has none, use the
      // matched value (the join key, e.g. a login) so the row never shows a bare
      // id, and only fall back to the id when there's no match value either.
      // Checking resolveObjectLabel for undefined (rather than comparing the
      // label to the id) preserves a real name that legitimately equals the id.
      agg.targetLabels.push(
        resolvedLabel ?? candidate.matchValue ?? candidate.destinationObjectId,
      );
      agg.matchValues.push(candidate.matchValue ?? '');
      agg.matchedSourceValues.push(candidate.matchSourceValue ?? '');
      bySource.set(candidate.sourceObjectId, agg);
    }

    // Emit one item per evaluated source — including sources that matched
    // nothing — so the preview reflects what was actually previewed, not just
    // the sources that produced an edge. Mirrors the field-matching path, which
    // maps every sampled source (empty `targetObjectIds` ⇒ "no match"). Sources
    // whose lookup errored are excluded (surfaced separately via
    // `skippedSources`) rather than misreported as unmatched.
    const skipped = new Set(result.skippedSources ?? []);
    const evaluatedSourceObjectIds = (
      result.sampledSourceObjectIds ?? [...bySource.keys()]
    ).filter(id => !skipped.has(id));
    const sourceValuesByObjectId = new Map(
      result.sampledSourceValues?.map(sample => [
        sample.sourceObjectId,
        sample.values,
      ]) ?? [],
    );

    return {
      items: evaluatedSourceObjectIds.map(sourceObjectId => {
        const sourceRow = sourceRowById.get(sourceObjectId);
        const agg = bySource.get(sourceObjectId);
        const sourceValues = sourceValuesByObjectId.get(sourceObjectId) ?? [];
        return {
          sourceObjectId,
          relationshipType: input.relationshipType,
          targetObjectIds: agg?.targetObjectIds ?? [],
          // Attribute the row to the source value whose lookup actually
          // matched (a source can evaluate to several values); fall back to
          // the first evaluated value for unmatched sources. Mirrors the
          // field-matching path, incl. matchSourceValues indexing per edge.
          sourceValue: agg?.matchedSourceValues[0] ?? sourceValues[0],
          matchSourceValues: agg?.matchedSourceValues ?? [],
          targetLabels: agg?.targetLabels ?? [],
          matchTargetValues: agg?.matchValues ?? [],
          targetValue: agg?.matchValues[0],
          sourceLabel: sourceRow ? readObjectLabel(sourceRow) : undefined,
        };
      }),
      total: result.filteredSourceCount,
      truncated: result.truncated,
      callLimitReached: result.callLimitReached,
      skippedSources: result.skippedSources,
      responseSample: result.responseSample,
    };
  }

  async applyRelationshipRulesForDatasource(
    datasourceId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<void> {
    return this.applyRelationshipRulesForDatasources(
      [datasourceId],
      workspaceId,
    );
  }

  async applyRelationshipRulesForDatasources(
    datasourceIds: string[],
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<void> {
    if (datasourceIds.length === 0) return;
    const rules =
      await this.relationshipRuleDao.listRelationshipRulesByDatasourceIds(
        datasourceIds,
        { state: 'active', workspaceId },
      );
    if (rules.length === 0) return;

    // Context-aware integration-backed rules traverse the edges other rules
    // produce, and a datasource refresh deletes relationships alongside the
    // rows it replaces — so a rule that consumes a relationship type must run
    // after the rules that produce it. Order by that producer→consumer
    // dependency rather than a coarse strategy bucket.
    const orderedRules = orderRulesByGraphDependencies(rules, this.logger);

    // Each rule drives its own three-phase sealed apply, which streams both
    // datasources in pages — memory is O(page) regardless of datasource size.
    const engineDeps = this.relationshipEngineDeps();
    const changedDatasourceIds = new Set<string>();
    for (const rule of orderedRules) {
      try {
        const result = await applyRelationshipRuleSealed(
          engineDeps,
          rule,
          undefined,
          workspaceId,
        );
        if (result.created + result.deleted > 0) {
          changedDatasourceIds.add(rule.sourceDatasourceId);
          changedDatasourceIds.add(rule.targetDatasourceId);
        }
      } catch (err: unknown) {
        this.logger.error(
          `Failed to auto-apply relationship rule ${rule.id}: ${err}`,
        );
      }
    }
    // Announced after the whole batch: the ingest that queued this apply also
    // queued a context-group sync on the same debounce, so that sync can run
    // against pre-apply edges — this follow-up notification is what guarantees
    // the groups converge on the post-apply graph.
    this.notifyRelationshipsChanged([...changedDatasourceIds], workspaceId);
  }
}
