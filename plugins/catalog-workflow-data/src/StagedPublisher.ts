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

/**
 * Staged publish core (sc-34101): turns a sink node's completed staging range
 * into `datastore` rows via finalization + diff-merge, guarded by three abort
 * gates, all inside ONE transaction on the datastore database.
 *
 * Gates (before any datastore mutation):
 *   1. Attempt fence — lock the attempt row FOR UPDATE; only the active
 *      attempt may publish. A superseded (zombie) attempt aborts here.
 *   2. Manifest recount — staging tables are UNLOGGED (truncated on PG
 *      crash/failover); the logged manifest's per-node row and index-row
 *      counts must match a live recount, so truncation reads as a mismatch,
 *      never as a mass deletion.
 *   3. Snapshot set-equality — the attempt's publish snapshot must equal the
 *      live index configurations (changed, removed, AND added configs all
 *      abort; a config added mid-run was backfilled from pre-publish rows and
 *      would end up missing entries for this publish's delta). The snapshot's
 *      virtual `id` entry is created as a real configuration in-tx.
 *
 * Finalization marks the surviving row set `is_final` per the duplicate
 * strategy (fail / keep_last / expand in SQL; append as a paged JS pass over
 * duplicate groups only). The diff-merge then DELETEs vanished object_ids,
 * UPDATEs hash-changed rows, INSERTs new ones, and reconciles
 * `datastore_index` from `workflow_staging_index` through final rows' seq.
 * App memory is O(page); everything else is DB-to-DB.
 */

import { createHash } from 'crypto';
import type { Knex } from 'knex';
import { v4 as uuid } from 'uuid';
import type { LoggerService } from '@roadiehq/extensions-api';
import type { JsonObject, JsonValue } from '@roadiehq/types';
import jsonataSafe from '@roadiehq/jsonata-safe';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';
import {
  ADDITIONAL_DEDUPLICATION_RESULTS_FIELD,
  APPEND_KEEP,
  DATASOURCE_PUBLISH_LOCK_NS,
  DUPLICATE_OBJECT_ID_EXPAND_SEP,
  PAGE_SIZE,
  SCHEMA_SAMPLE_ITEMS,
  type DuplicateObjectIdStrategy,
} from '@roadiehq/catalog-datastore-common';
import {
  canonicalJsonHash,
  diffMergePublish,
  restampUnchangedSchemaIds,
  upsertSchemaVersion,
  type PublishSourceRelation,
} from '@roadiehq/catalog-datastore-node';
import { PublishAbortedError } from './engine-errors';

const STAGING_TABLE = 'workflow_staging';
const STAGING_INDEX_TABLE = 'workflow_staging_index';
const ATTEMPT_TABLE = 'workflow_execution_attempt';
const DATASTORE_TABLE = 'datastore';
const DATASTORE_INDEX_TABLE = 'datastore_index';
const INDEX_CONFIG_TABLE = 'datastore_index_configuration';
/** Field added by `append` finalization: total duplicates folded into the winner. */
export const DUPLICATE_COUNT_FIELD = 'duplicateCount';

/**
 * Must evaluate index expressions exactly like the read/write paths in
 * catalog-datastore-backend's IndexDao do, or `append`'s re-indexed winners
 * would drift from rows indexed at spill time.
 */
const jsonata = (expression: string) =>
  jsonataSafe(expression, {
    allowLambdas: false,
    allowedFunctions: ['lowercase'],
  });

export interface PublishSnapshotIndexEntry {
  key: string;
  expression: string;
  expressionHash: string;
  /**
   * Auto-added from the sink's id selector at spill start; may not exist as a
   * live configuration yet. Created in-tx by the publish (and its index rows
   * cover ALL final rows, not just this publish's delta).
   */
  virtual?: boolean;
}

export interface PublishSnapshot {
  indexes: PublishSnapshotIndexEntry[];
}

export interface StagingManifestEntry {
  rows: number;
  indexRows: number;
}

/** Keyed by node_id; written via `WorkflowAttemptDao.recordManifest` at spill completion. */
export type StagingManifest = Record<string, StagingManifestEntry>;

export interface PublishResult {
  deleted: number;
  updated: number;
  inserted: number;
  unchanged: number;
  finalRows: number;
  /** Staged rows discarded/folded by duplicate resolution (keep_last / append). */
  duplicatesResolved: number;
  /** Schema version stamped on this publish's rows; null for an empty dataset. */
  schemaId: string | null;
}

export interface StagedPublisherOptions {
  knex: Knex;
  logger: LoggerService;
}

export interface PublishArgs {
  executionId: string;
  attemptId: string;
  nodeId: string;
  datasourceId: string;
  workspaceId?: string;
  strategy: DuplicateObjectIdStrategy;
  /** Used in the generated schema-version description; defaults to the id. */
  datasourceName?: string;
  /** Explicit (possibly auto-corrected) schema; skips inference when set. */
  schema?: JsonValue;
}

/** Fingerprint for index expressions; spill (T6) must use the same function. */
export function indexExpressionHash(expression: string): string {
  return createHash('sha256').update(expression).digest('hex');
}

/**
 * Captures the publish snapshot at spill start: every live index
 * configuration's (key, expression, hash), plus a virtual `id` entry for the
 * sink's id selector when no live `id` configuration exists yet. Stored on
 * the attempt row (`startAttempt`) and verified by gate 3 at publish.
 */
export async function capturePublishSnapshot(
  knex: Knex,
  datasourceId: string,
  options?: { workspaceId?: string; idSelectorExpression?: string },
): Promise<PublishSnapshot> {
  const workspaceId = options?.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const configs: Array<{ key: string; value_expression: string }> = await knex(
    INDEX_CONFIG_TABLE,
  )
    .where({ datasource_id: datasourceId, workspace_id: workspaceId })
    .orderBy('key')
    .select('key', 'value_expression');

  const indexes: PublishSnapshotIndexEntry[] = configs.map(config => ({
    key: config.key,
    expression: config.value_expression,
    expressionHash: indexExpressionHash(config.value_expression),
  }));

  const idExpression = options?.idSelectorExpression;
  if (idExpression && !configs.some(config => config.key === 'id')) {
    indexes.push({
      key: 'id',
      expression: idExpression,
      expressionHash: indexExpressionHash(idExpression),
      virtual: true,
    });
  }

  return { indexes };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSnapshot(value: JsonValue): PublishSnapshot {
  if (!isRecord(value) || !Array.isArray(value.indexes)) {
    throw new PublishAbortedError(
      'Attempt publish snapshot is malformed (missing indexes)',
    );
  }
  const indexes: PublishSnapshotIndexEntry[] = [];
  for (const entry of value.indexes) {
    if (
      !isRecord(entry) ||
      typeof entry.key !== 'string' ||
      typeof entry.expression !== 'string' ||
      typeof entry.expressionHash !== 'string'
    ) {
      throw new PublishAbortedError(
        'Attempt publish snapshot is malformed (bad index entry)',
      );
    }
    indexes.push({
      key: entry.key,
      expression: entry.expression,
      expressionHash: entry.expressionHash,
      virtual: entry.virtual === true,
    });
  }
  return { indexes };
}

function parseManifestEntry(
  manifest: JsonValue | null,
  nodeId: string,
): StagingManifestEntry {
  if (!isRecord(manifest)) {
    throw new PublishAbortedError(
      `No staging manifest recorded for the attempt; refusing to publish`,
    );
  }
  const entry = manifest[`${nodeId}`];
  if (
    !isRecord(entry) ||
    typeof entry.rows !== 'number' ||
    typeof entry.indexRows !== 'number'
  ) {
    throw new PublishAbortedError(
      `No staging manifest entry for node ${nodeId}; refusing to publish`,
    );
  }
  return { rows: entry.rows, indexRows: entry.indexRows };
}

interface AttemptRowSlice {
  state: string;
  manifest: JsonValue | null;
  publish_snapshot: JsonValue;
}

interface ResolvedIndexConfig {
  entry: PublishSnapshotIndexEntry;
  configId: string;
  createdVirtual: boolean;
}

export class StagedPublisher {
  private readonly knex: Knex;
  private readonly logger: LoggerService;

  constructor(options: StagedPublisherOptions) {
    this.knex = options.knex;
    this.logger = options.logger.child({ name: 'StagedPublisher' });
  }

  async publish(args: PublishArgs): Promise<PublishResult> {
    const workspaceId = args.workspaceId ?? DEFAULT_WORKSPACE_ID;
    return this.knex.transaction(async trx => {
      await trx.raw(`SELECT pg_advisory_xact_lock(hashtext(?))`, [
        `${DATASOURCE_PUBLISH_LOCK_NS}${workspaceId}:${args.datasourceId}`,
      ]);

      // The staging tables were just bulk-loaded and may never have been
      // analyzed; without stats the planner nested-loops the finalization and
      // diff-merge joins (quadratic on big ranges). ANALYZE is cheap and
      // transaction-safe.
      await trx.raw(`ANALYZE ${STAGING_TABLE}`);
      await trx.raw(`ANALYZE ${STAGING_INDEX_TABLE}`);

      const attempt = await this.fenceGate(trx, args);
      await this.manifestGate(trx, args, attempt);
      const snapshot = parseSnapshot(attempt.publish_snapshot);
      const resolvedConfigs = await this.snapshotGate(trx, args, snapshot);

      const totalStaged = await this.countStaged(trx, args);
      await this.finalize(trx, args, snapshot);
      const finalRows = await this.countStaged(trx, args, { finalOnly: true });

      const schemaId =
        finalRows > 0 ? await this.persistSchemaVersion(trx, args) : null;

      const delta = await diffMergePublish(trx, {
        datasourceId: args.datasourceId,
        workspaceId,
        source: this.finalRowsRelation(args),
        schemaId,
      });
      if (schemaId) {
        await restampUnchangedSchemaIds(trx, {
          datasourceId: args.datasourceId,
          workspaceId,
          schemaId,
        });
      }
      await this.reconcileIndexes(trx, args, resolvedConfigs);

      const result: PublishResult = {
        ...delta,
        unchanged: finalRows - delta.updated - delta.inserted,
        finalRows,
        duplicatesResolved: totalStaged - finalRows,
        schemaId,
      };
      this.logger.info(
        `Published node ${args.nodeId} to datasource ${args.datasourceId}: ` +
          `${result.inserted} inserted, ${result.updated} updated, ` +
          `${result.deleted} deleted, ${result.unchanged} unchanged` +
          (result.duplicatesResolved > 0
            ? ` (${result.duplicatesResolved} duplicate row(s) resolved by ${args.strategy})`
            : ''),
      );
      return result;
    });
  }

  /** Gate 1: only the active attempt may publish; lock it for the transaction. */
  private async fenceGate(
    trx: Knex.Transaction,
    args: PublishArgs,
  ): Promise<AttemptRowSlice> {
    const attempt: AttemptRowSlice | undefined = await trx(ATTEMPT_TABLE)
      .where({ execution_id: args.executionId, attempt_id: args.attemptId })
      .forUpdate()
      .select('state', 'manifest', 'publish_snapshot')
      .first();
    if (!attempt || attempt.state !== 'active') {
      throw new PublishAbortedError(
        `Attempt ${args.attemptId} is ${attempt?.state ?? 'missing'}, not active; refusing to publish (execution ${args.executionId})`,
      );
    }
    return attempt;
  }

  /** Gate 2: recount both UNLOGGED ranges against the logged manifest. */
  private async manifestGate(
    trx: Knex.Transaction,
    args: PublishArgs,
    attempt: AttemptRowSlice,
  ): Promise<void> {
    const expected = parseManifestEntry(attempt.manifest, args.nodeId);
    const rows = await this.countStaged(trx, args);
    const indexRows = await this.countStagedIndex(trx, args);
    if (rows !== expected.rows || indexRows !== expected.indexRows) {
      throw new PublishAbortedError(
        `Staging manifest mismatch for node ${args.nodeId} ` +
          `(rows ${rows}/${expected.rows}, index rows ${indexRows}/${expected.indexRows}); ` +
          `staging may have been truncated by a crash/failover — refusing to publish`,
      );
    }
  }

  /**
   * Gate 3: live index configurations must equal the snapshot as a set —
   * changed, removed, and added configs all abort. The snapshot's virtual
   * `id` entry is created as a real configuration here and resolved to its id.
   */
  private async snapshotGate(
    trx: Knex.Transaction,
    args: PublishArgs,
    snapshot: PublishSnapshot,
  ): Promise<ResolvedIndexConfig[]> {
    const liveConfigs: Array<{
      id: string;
      key: string;
      value_expression: string;
    }> = await trx(INDEX_CONFIG_TABLE)
      .where({
        datasource_id: args.datasourceId,
        workspace_id: args.workspaceId ?? DEFAULT_WORKSPACE_ID,
      })
      .forUpdate()
      .select('id', 'key', 'value_expression');

    const liveByKey = new Map(liveConfigs.map(config => [config.key, config]));
    const snapshotKeys = new Set(snapshot.indexes.map(entry => entry.key));
    const resolved: ResolvedIndexConfig[] = [];

    for (const entry of snapshot.indexes) {
      const live = liveByKey.get(entry.key);
      if (!live) {
        if (!entry.virtual) {
          throw new PublishAbortedError(
            `Index configuration "${entry.key}" was removed during the run; refusing to publish against a stale snapshot`,
          );
        }
        const configId = uuid();
        await trx(INDEX_CONFIG_TABLE).insert({
          id: configId,
          workspace_id: args.workspaceId ?? DEFAULT_WORKSPACE_ID,
          datasource_id: args.datasourceId,
          key: entry.key,
          value_expression: entry.expression,
        });
        resolved.push({ entry, configId, createdVirtual: true });
        continue;
      }
      if (live.value_expression !== entry.expression) {
        throw new PublishAbortedError(
          `Index configuration "${entry.key}" changed during the run; refusing to publish against a stale snapshot`,
        );
      }
      resolved.push({ entry, configId: live.id, createdVirtual: false });
    }

    for (const live of liveConfigs) {
      if (!snapshotKeys.has(live.key)) {
        throw new PublishAbortedError(
          `Index configuration "${live.key}" was added during the run; its backfill predates this publish — refusing to publish against a stale snapshot`,
        );
      }
    }

    return resolved;
  }

  private stagingRange(
    trx: Knex.Transaction,
    args: PublishArgs,
  ): Knex.QueryBuilder {
    return trx(STAGING_TABLE).where({
      execution_id: args.executionId,
      attempt_id: args.attemptId,
      node_id: args.nodeId,
    });
  }

  /** The staging feeder for the shared diff-merge: this node's final rows. */
  private finalRowsRelation(args: PublishArgs): PublishSourceRelation {
    return {
      sql: `
        SELECT object_id, object, object_hash FROM ${STAGING_TABLE}
        WHERE execution_id = ? AND attempt_id = ? AND node_id = ? AND is_final
      `,
      bindings: [args.executionId, args.attemptId, args.nodeId],
    };
  }

  private async persistSchemaVersion(
    trx: Knex.Transaction,
    args: PublishArgs,
  ): Promise<string> {
    const sampleRows: Array<{ object: string }> = await this.stagingRange(
      trx,
      args,
    )
      .andWhere('is_final', true)
      .orderBy([
        { column: 'order_key', order: 'asc' },
        { column: 'seq', order: 'asc' },
      ])
      .limit(SCHEMA_SAMPLE_ITEMS)
      .select('object');
    const sampleObjects = sampleRows.map(
      row => JSON.parse(row.object) as JsonValue,
    );
    return upsertSchemaVersion(trx, {
      datasourceId: args.datasourceId,
      workspaceId: args.workspaceId,
      datasourceName: args.datasourceName ?? args.datasourceId,
      sampleObjects,
      explicitSchema: args.schema,
    });
  }

  private async countStaged(
    trx: Knex.Transaction,
    args: PublishArgs,
    options?: { finalOnly?: boolean },
  ): Promise<number> {
    const query = this.stagingRange(trx, args);
    if (options?.finalOnly) {
      query.andWhere('is_final', true);
    }
    const [{ count }] =
      await query.count<Array<{ count: string }>>('* as count');
    return Number(count);
  }

  private async countStagedIndex(
    trx: Knex.Transaction,
    args: PublishArgs,
  ): Promise<number> {
    const [{ count }] = await trx(STAGING_INDEX_TABLE)
      .where({
        execution_id: args.executionId,
        attempt_id: args.attemptId,
        node_id: args.nodeId,
      })
      .count<Array<{ count: string }>>('* as count');
    return Number(count);
  }

  private async finalize(
    trx: Knex.Transaction,
    args: PublishArgs,
    snapshot: PublishSnapshot,
  ): Promise<void> {
    await this.stagingRange(trx, args).update({ is_final: false });

    const [{ count: nullIds }] = await this.stagingRange(trx, args)
      .whereNull('object_id')
      .count<Array<{ count: string }>>('* as count');
    if (Number(nullIds) > 0) {
      throw new PublishAbortedError(
        `${nullIds} staged row(s) for node ${args.nodeId} have no object_id; the sink must evaluate ids at spill time`,
      );
    }

    const rangeBindings = [args.executionId, args.attemptId, args.nodeId];
    switch (args.strategy) {
      case 'fail': {
        const duplicates: Array<{ object_id: string }> =
          await this.stagingRange(trx, args)
            .groupBy('object_id')
            .havingRaw('count(*) > 1')
            .orderBy('object_id')
            .limit(21)
            .select('object_id');
        if (duplicates.length > 0) {
          const list = duplicates
            .slice(0, 20)
            .map(row => row.object_id)
            .join(', ');
          const suffix = duplicates.length > 20 ? '…' : '';
          throw new PublishAbortedError(
            `Duplicate objectId values: ${list}${suffix}. Prefer a compound unique index (JSONata), e.g. $string(_parent.id) & "-" & $string($.id). Or set collision handling to keep one row per index, append (extra rows under additionalResults), or expand (compound keys).`,
          );
        }
        await this.stagingRange(trx, args).update({ is_final: true });
        return;
      }
      case 'keep_last': {
        await trx.raw(
          `
          UPDATE ${STAGING_TABLE} s
          SET is_final = true
          WHERE s.execution_id = ? AND s.attempt_id = ? AND s.node_id = ?
            AND s.seq IN (
              SELECT seq FROM (
                SELECT seq,
                       row_number() OVER (
                         PARTITION BY object_id
                         ORDER BY order_key DESC, seq DESC
                       ) AS rn
                FROM ${STAGING_TABLE}
                WHERE execution_id = ? AND attempt_id = ? AND node_id = ?
              ) w
              WHERE w.rn = 1
            )
          `,
          [...rangeBindings, ...rangeBindings],
        );
        return;
      }
      case 'expand': {
        await trx.raw(
          `
          UPDATE ${STAGING_TABLE} s
          SET is_final = true,
              object_id = CASE
                WHEN w.rn = 1 THEN s.object_id
                ELSE s.object_id || ? || (w.rn - 1)::text
              END
          FROM (
            SELECT seq,
                   row_number() OVER (
                     PARTITION BY object_id
                     ORDER BY order_key ASC, seq ASC
                   ) AS rn
            FROM ${STAGING_TABLE}
            WHERE execution_id = ? AND attempt_id = ? AND node_id = ?
          ) w
          WHERE s.execution_id = ? AND s.attempt_id = ? AND s.node_id = ?
            AND s.seq = w.seq
          `,
          [DUPLICATE_OBJECT_ID_EXPAND_SEP, ...rangeBindings, ...rangeBindings],
        );
        return;
      }
      case 'append': {
        await trx.raw(
          `
          UPDATE ${STAGING_TABLE} s
          SET is_final = true
          WHERE s.execution_id = ? AND s.attempt_id = ? AND s.node_id = ?
            AND s.seq IN (
              SELECT seq FROM (
                SELECT seq,
                       row_number() OVER (
                         PARTITION BY object_id
                         ORDER BY order_key ASC, seq ASC
                       ) AS rn
                FROM ${STAGING_TABLE}
                WHERE execution_id = ? AND attempt_id = ? AND node_id = ?
              ) w
              WHERE w.rn = 1
            )
          `,
          [...rangeBindings, ...rangeBindings],
        );
        await this.finalizeAppendGroups(trx, args, snapshot);
        return;
      }
      default: {
        const _exhaustive: never = args.strategy;
        throw new PublishAbortedError(
          `Unexpected duplicate object id strategy: ${_exhaustive}`,
        );
      }
    }
  }

  /**
   * `append`'s duplicate groups, the one paged JS pass in publish: per group
   * load at most APPEND_KEEP + 1 objects, fold duplicates into the winner's
   * additionalResults (+ duplicateCount for ALL duplicates, embedded or not),
   * rewrite the winner's object/hash, and re-derive its staging-index rows —
   * merged objects must be indexed as merged.
   */
  private async finalizeAppendGroups(
    trx: Knex.Transaction,
    args: PublishArgs,
    snapshot: PublishSnapshot,
  ): Promise<void> {
    const expressions: SnapshotExpression[] = snapshot.indexes.map(entry => ({
      key: entry.key,
      expressionHash: entry.expressionHash,
      expression: jsonata(entry.expression),
    }));
    const groupPageSize = Math.max(
      1,
      Math.floor(PAGE_SIZE / (APPEND_KEEP + 1)),
    );

    let afterObjectId: string | undefined;
    for (;;) {
      const groupQuery = this.stagingRange(trx, args)
        .groupBy('object_id')
        .havingRaw('count(*) > 1')
        .orderBy('object_id')
        .limit(groupPageSize)
        .select('object_id')
        .count<Array<{ object_id: string; count: string }>>('* as count');
      if (afterObjectId !== undefined) {
        groupQuery.andWhere('object_id', '>', afterObjectId);
      }
      const groups: Array<{ object_id: string; count: string }> =
        await groupQuery;
      if (groups.length === 0) {
        return;
      }

      for (const group of groups) {
        await this.mergeAppendGroup(
          trx,
          args,
          group.object_id,
          Number(group.count),
          expressions,
        );
      }

      if (groups.length < groupPageSize) {
        return;
      }
      afterObjectId = groups[groups.length - 1].object_id;
    }
  }

  private async mergeAppendGroup(
    trx: Knex.Transaction,
    args: PublishArgs,
    objectId: string,
    groupSize: number,
    expressions: SnapshotExpression[],
  ): Promise<void> {
    const rows: Array<{ seq: string; object: string }> =
      await this.stagingRange(trx, args)
        .andWhere('object_id', objectId)
        .orderBy('order_key', 'asc')
        .orderBy('seq', 'asc')
        .limit(APPEND_KEEP + 1)
        .select('seq', 'object');

    const [winner, ...duplicates] = rows;
    const parsedWinner: unknown = JSON.parse(winner.object);
    if (!isRecord(parsedWinner)) {
      // Mirrors the retired resolver: a non-object winner cannot carry
      // additionalResults, so the LAST occurrence is kept unmerged instead.
      await trx.raw(
        `
        UPDATE ${STAGING_TABLE} s
        SET is_final = (s.seq = w.last_seq)
        FROM (
          SELECT seq AS last_seq FROM ${STAGING_TABLE}
          WHERE execution_id = ? AND attempt_id = ? AND node_id = ?
            AND object_id = ?
          ORDER BY order_key DESC, seq DESC
          LIMIT 1
        ) w
        WHERE s.execution_id = ? AND s.attempt_id = ? AND s.node_id = ?
          AND s.object_id = ?
        `,
        [
          args.executionId,
          args.attemptId,
          args.nodeId,
          objectId,
          args.executionId,
          args.attemptId,
          args.nodeId,
          objectId,
        ],
      );
      return;
    }

    const appended: JsonObject[] = [];
    for (const duplicate of duplicates) {
      const parsed: unknown = JSON.parse(duplicate.object);
      if (isRecord(parsed)) {
        appended.push(parsed as JsonObject);
      }
    }
    if (appended.length === 0) {
      return;
    }

    const merged: JsonObject = { ...(parsedWinner as JsonObject) };
    const prior = merged[ADDITIONAL_DEDUPLICATION_RESULTS_FIELD];
    let priorEntries: JsonValue[];
    if (Array.isArray(prior)) {
      priorEntries = [...prior];
    } else if (prior !== undefined) {
      priorEntries = [prior];
    } else {
      priorEntries = [];
    }
    merged[ADDITIONAL_DEDUPLICATION_RESULTS_FIELD] = [
      ...priorEntries,
      ...appended,
    ];
    merged[DUPLICATE_COUNT_FIELD] = groupSize - 1;

    await this.stagingRange(trx, args)
      .andWhere('seq', winner.seq)
      .update({
        object: JSON.stringify(merged),
        object_hash: canonicalJsonHash(merged),
      });

    await trx(STAGING_INDEX_TABLE)
      .where({
        execution_id: args.executionId,
        attempt_id: args.attemptId,
        node_id: args.nodeId,
        seq: winner.seq,
      })
      .del();
    for (const entry of expressions) {
      let value: unknown;
      try {
        value = await entry.expression.evaluate(merged);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        this.logger.warn(
          `Failed to re-index merged object ${objectId} for ${entry.key}: ${message}`,
        );
        continue;
      }
      if (typeof value !== 'string') {
        continue;
      }
      await trx(STAGING_INDEX_TABLE).insert({
        execution_id: args.executionId,
        attempt_id: args.attemptId,
        node_id: args.nodeId,
        seq: winner.seq,
        config_key: entry.key,
        expression_hash: entry.expressionHash,
        value,
      });
    }
  }

  private async reconcileIndexes(
    trx: Knex.Transaction,
    args: PublishArgs,
    configs: ResolvedIndexConfig[],
  ): Promise<void> {
    await trx.raw(
      `
      DELETE FROM ${DATASTORE_INDEX_TABLE} di
      USING publish_delta pd
      WHERE pd.kind = 'updated' AND di.datastore_id = pd.datastore_id
      `,
    );

    for (const config of configs) {
      const deltaFilter = config.createdVirtual
        ? ''
        : `AND EXISTS (
             SELECT 1 FROM publish_delta pd WHERE pd.datastore_id = d.id
           )`;
      await trx.raw(
        `
        INSERT INTO ${DATASTORE_INDEX_TABLE}
          (id, datastore_id, datastore_index_configuration_id, key, value)
        SELECT gen_random_uuid(), d.id, ?, ?, si.value
        FROM ${STAGING_TABLE} s
        JOIN ${STAGING_INDEX_TABLE} si
          ON si.execution_id = s.execution_id
          AND si.attempt_id = s.attempt_id
          AND si.node_id = s.node_id
          AND si.seq = s.seq
        JOIN ${DATASTORE_TABLE} d
          ON d.datasource_id = ?
          AND d.workspace_id = ?
          AND d.object_id = s.object_id
        WHERE s.execution_id = ? AND s.attempt_id = ? AND s.node_id = ?
          AND s.is_final
          AND si.config_key = ? AND si.expression_hash = ?
          ${deltaFilter}
        `,
        [
          config.configId,
          config.entry.key,
          args.datasourceId,
          args.workspaceId ?? DEFAULT_WORKSPACE_ID,
          args.executionId,
          args.attemptId,
          args.nodeId,
          config.entry.key,
          config.entry.expressionHash,
        ],
      );
    }
  }
}

interface SnapshotExpression {
  key: string;
  expressionHash: string;
  expression: ReturnType<typeof jsonata>;
}
