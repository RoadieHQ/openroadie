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
 * Three-phase sealed relationship-rule application (sc-34004 §8, sc-34106).
 *
 * Replaces the in-memory `rowsCache` + `findMatches` path. Memory is O(page) at
 * any datasource size:
 *
 *   Phase 1 (extraction) — stream each side of the rule in keyset pages,
 *     evaluate the field expression per row, and insert match keys into the
 *     unlogged `relationship_apply_key` scratch table. For `person_name_alias`
 *     the alias expansion happens here — one key row per alias.
 *   Phase 2 (matching) — per strategy, join/scan the scratch keys and write
 *     matched tuples into the unlogged `relationship_apply_candidate` table.
 *     Never touches `datastore_relation`.
 *   Phase 3 (sealed swap) — write observed counts, mark the run `sealed`, then
 *     in ONE transaction take the per-rule advisory lock, recount both unlogged
 *     ranges against the sealed counts (a mismatch means UNLOGGED truncation and
 *     aborts before touching live relations), delete the rule's prior rows
 *     (excluding failed integration sources), bulk-insert candidates via the
 *     existing conflict behavior, and mark the run `committed`.
 *
 * The results are identical, per strategy, to the retired in-memory path (see
 * relationshipApply.equivalence.test.ts).
 */

import type { Knex } from 'knex';
import { v4 as uuid } from 'uuid';
import RE2 from 're2';
import type { Expression } from 'jsonata';
import type { LoggerService } from '@roadiehq/extensions-api';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';
import { PAGE_SIZE, BLOCKING_OP_CAP } from '@roadiehq/catalog-datastore-common';
import type {
  DatastoreRow,
  IntegrationRuleCaller,
  RelationshipRule,
} from './types';
import type { RelationshipDao } from './RelationshipDao';
import { jsonata, normalizeFieldValues } from './evaluationHelpers';
import {
  expandIdentifierSearchAliases,
  expandPersonNameSearchAliases,
} from '../api/schemas/relationshipCandidateFilter';
import {
  applyIntegrationBackedRuleStreamed,
  type IntegrationExtractionResult,
} from './integrationBackedRule';

const APPLY_RUN_TABLE = 'relationship_apply_run';
const APPLY_KEY_TABLE = 'relationship_apply_key';
const APPLY_CANDIDATE_TABLE = 'relationship_apply_candidate';
const DATASTORE_TABLE = 'datastore';
const KEY_BATCH_SIZE = 5000;
const CANDIDATE_BATCH_SIZE = 5000;

const HEARTBEAT_INTERVAL_MS = 15_000;
// A non-terminal run whose heartbeat is older than this is considered stranded
// by a hard process crash (SIGKILL/OOM). Postgres stays up through an app
// crash, so the UNLOGGED scratch tables are NOT auto-truncated and the
// crashed run's `cleanupScratch` never ran. The TTL must comfortably exceed
// the longest single phase-2 SQL statement (the equality/contains joins cannot
// heartbeat mid-statement); reaping a still-live run is nevertheless safe —
// its sealed-count recount aborts the swap without touching live relations.
const STALE_RUN_TTL_MS = 60 * 60 * 1000;
// Terminal run rows are kept for observability, then dropped.
const RUN_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type Side = 'source' | 'target';

export interface RelationshipApplyEngineDeps {
  knex: Knex;
  logger: LoggerService;
  relationshipDao: RelationshipDao;
  callIntegration?: IntegrationRuleCaller;
}

export interface ApplyResult {
  created: number;
  deleted: number;
}

/**
 * Test-only hooks for exercising crash-safety. Not used in production wiring.
 * `stopAfterMatching` returns after phases 1-2 without sealing/swapping —
 * simulating a crash before the swap. `beforeSwap` runs after sealing and
 * before the swap transaction, letting a test truncate the scratch tables to
 * force a sealed-count mismatch.
 */
export interface SealedApplyTestHooks {
  stopAfterMatching?: boolean;
  beforeSwap?: (runId: string) => Promise<void>;
  /**
   * Runs inside the swap transaction, after prior relations were deleted and
   * before candidates are materialized — the window where a concurrent reap
   * would truncate the candidate tail. Runs on its own connections.
   */
  duringSwap?: (runId: string) => Promise<void>;
}

/**
 * Build the alias key set for a value, exactly as the retired in-memory
 * `aliasKeysFor` did: the value, its lowercase, and the lowercase of every
 * identifier/person-name search alias.
 */
function aliasKeysFor(value: string): string[] {
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
}

/**
 * Stream a datasource in keyset pages ordered by datastore.id, so memory stays
 * O(PAGE_SIZE) regardless of datasource size.
 */
async function* streamRows(
  knex: Knex,
  datasourceId: string,
  workspaceId: string,
): AsyncGenerator<DatastoreRow[]> {
  let after: string | undefined;
  for (;;) {
    const q = knex<DatastoreRow>(DATASTORE_TABLE)
      .where('datasource_id', datasourceId)
      .andWhere('workspace_id', workspaceId)
      .orderBy('id', 'asc')
      .limit(PAGE_SIZE);
    if (after !== undefined) {
      q.andWhere('id', '>', after);
    }
    const page = await q;
    if (page.length === 0) {
      return;
    }
    yield page;
    if (page.length < PAGE_SIZE) {
      return;
    }
    after = page[page.length - 1].id;
  }
}

/**
 * A throttled heartbeat for one run: bumps `last_heartbeat_at` at most once per
 * HEARTBEAT_INTERVAL_MS. Called per streamed page so the reaper can tell a
 * busy multi-million-row extraction apart from a crashed run.
 */
function makeHeartbeat(knex: Knex, runId: string): () => Promise<void> {
  let lastBumpAt = 0;
  return async () => {
    const now = Date.now();
    if (now - lastBumpAt < HEARTBEAT_INTERVAL_MS) {
      return;
    }
    lastBumpAt = now;
    await knex(APPLY_RUN_TABLE)
      .where('run_id', runId)
      .update({ last_heartbeat_at: new Date() });
  };
}

/**
 * Reap runs stranded by a hard process crash: mark heartbeat-silent
 * non-terminal runs failed, drop scratch rows owned by any terminal run (this
 * also covers a crash between the swap commit and its cleanupScratch), and
 * expire old terminal run rows. Runs before every apply so stranded scratch
 * cannot accumulate across repeated crashes.
 *
 * Each reap takes the run's per-rule advisory lock with try-lock and skips if
 * it is held: the swap holds that lock for its whole transaction, and its
 * paged candidate materialization reads a fresh snapshot per page — a reap
 * landing mid-swap (a swap can legitimately outlive the stale TTL) would
 * truncate the candidate tail AFTER the sealed-count guard already passed and
 * prior relations were deleted, committing a partial replacement. Outside the
 * swap a premature reap stays abort-safe: the recount refuses the swap.
 */
async function reapStrandedRuns(
  deps: RelationshipApplyEngineDeps,
): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_RUN_TTL_MS);
  const stale: Array<{ run_id: string; rule_id: string }> = await deps
    .knex(APPLY_RUN_TABLE)
    .whereNotIn('state', ['committed', 'failed'])
    .andWhere('last_heartbeat_at', '<', staleBefore)
    .select('run_id', 'rule_id');

  for (const run of stale) {
    await deps.knex.transaction(async trx => {
      const lock = await trx.raw(
        `SELECT pg_try_advisory_xact_lock(hashtext(?)) AS locked`,
        [run.rule_id],
      );
      if (!lock.rows[0]?.locked) {
        return;
      }
      // Re-check under the lock: the run may have completed since the select.
      const marked = await trx(APPLY_RUN_TABLE)
        .where('run_id', run.run_id)
        .whereNotIn('state', ['committed', 'failed'])
        .andWhere('last_heartbeat_at', '<', staleBefore)
        .update({ state: 'failed', last_heartbeat_at: new Date() });
      if (marked === 0) {
        return;
      }
      await trx(APPLY_KEY_TABLE).where('run_id', run.run_id).del();
      await trx(APPLY_CANDIDATE_TABLE).where('run_id', run.run_id).del();
      deps.logger.warn(
        `Reaped stranded relationship apply run ${run.run_id} (rule ${run.rule_id})`,
      );
    });
  }

  const terminalRuns = deps
    .knex(APPLY_RUN_TABLE)
    .select('run_id')
    .whereIn('state', ['committed', 'failed']);
  await deps.knex(APPLY_KEY_TABLE).whereIn('run_id', terminalRuns).del();
  await deps.knex(APPLY_CANDIDATE_TABLE).whereIn('run_id', terminalRuns).del();

  await deps
    .knex(APPLY_RUN_TABLE)
    .whereIn('state', ['committed', 'failed'])
    .andWhere('created_at', '<', new Date(Date.now() - RUN_ROW_RETENTION_MS))
    .del();
}

/** Evaluate the field (and optional filter) expression for one row. */
async function fieldValuesForRow(
  row: DatastoreRow,
  fieldExpr: Expression,
  filterExpr?: Expression,
): Promise<string[]> {
  const obj = JSON.parse(row.object);
  if (filterExpr) {
    const passes = await filterExpr.evaluate(obj);
    if (!passes) {
      return [];
    }
  }
  const value = await fieldExpr.evaluate(obj);
  return normalizeFieldValues(value);
}

/**
 * Phase 1: extract match keys for one side of the rule into the scratch table,
 * streaming the datasource in pages. Returns the number of key rows written.
 * For `person_name_alias` every alias of every value becomes its own key row.
 */
async function extractKeys(
  deps: RelationshipApplyEngineDeps,
  runId: string,
  side: Side,
  datasourceId: string,
  fieldExpression: string,
  filterExpression: string | null,
  aliasExpand: boolean,
  heartbeat: () => Promise<void>,
  workspaceId: string,
): Promise<number> {
  const fieldExpr = jsonata(fieldExpression);
  const filterExpr = filterExpression ? jsonata(filterExpression) : undefined;

  let written = 0;
  let batch: Array<{
    run_id: string;
    side: Side;
    row_id: string;
    value: string;
  }> = [];

  const flush = async () => {
    if (batch.length === 0) return;
    await deps.knex(APPLY_KEY_TABLE).insert(batch);
    written += batch.length;
    batch = [];
  };

  for await (const page of streamRows(deps.knex, datasourceId, workspaceId)) {
    await heartbeat();
    for (const row of page) {
      const values = await fieldValuesForRow(row, fieldExpr, filterExpr);
      if (values.length === 0) {
        continue;
      }
      const keys = new Set<string>();
      for (const value of values) {
        if (aliasExpand) {
          for (const alias of aliasKeysFor(value)) {
            keys.add(alias);
          }
        } else {
          keys.add(value);
        }
      }
      for (const key of keys) {
        batch.push({ run_id: runId, side, row_id: row.id, value: key });
        if (batch.length >= KEY_BATCH_SIZE) {
          await flush();
        }
      }
    }
  }
  await flush();
  return written;
}

/** A resolved candidate tuple, ready to insert into the scratch candidate table. */
interface CandidateRow {
  run_id: string;
  source_datasource_id: string;
  source_object_id: string;
  relation_type: string;
  destination_datasource_id: string;
  destination_object_id: string;
  reciprocal_relation_type: string | null;
  metadata: string | null;
}

async function insertCandidates(
  knex: Knex,
  rows: CandidateRow[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += CANDIDATE_BATCH_SIZE) {
    await knex(APPLY_CANDIDATE_TABLE).insert(
      rows.slice(i, i + CANDIDATE_BATCH_SIZE),
    );
  }
}

/**
 * Phase 2 for the SQL-joinable strategies (exact / array_contains /
 * person_name_alias): a plain equality join over the scratch keys, projecting
 * one candidate per distinct (source object, target object) pair. The pair
 * dedupe mirrors the in-memory path's per-source `matched` set.
 */
async function matchEqualityJoin(
  deps: RelationshipApplyEngineDeps,
  runId: string,
  rule: RelationshipRule,
): Promise<number> {
  const inserted = await deps.knex.raw(
    `
    INSERT INTO ${APPLY_CANDIDATE_TABLE}
      (run_id, source_datasource_id, source_object_id, relation_type,
       destination_datasource_id, destination_object_id,
       reciprocal_relation_type, metadata)
    SELECT DISTINCT
      :runId::uuid, :sourceDs::uuid, sd.object_id, :relType,
      :targetDs::uuid, td.object_id, :recip, NULL::jsonb
    FROM ${APPLY_KEY_TABLE} sk
    JOIN ${APPLY_KEY_TABLE} tk
      ON tk.run_id = :runId::uuid AND tk.side = 'target'
      AND tk.value = sk.value
    JOIN ${DATASTORE_TABLE} sd ON sd.id = sk.row_id
    JOIN ${DATASTORE_TABLE} td ON td.id = tk.row_id
    WHERE sk.run_id = :runId::uuid AND sk.side = 'source'
    `,
    {
      runId,
      sourceDs: rule.sourceDatasourceId,
      targetDs: rule.targetDatasourceId,
      relType: rule.relationshipType,
      recip: rule.reciprocalRelationshipType ?? null,
    },
  );
  return inserted.rowCount ?? 0;
}

/**
 * Phase 2 for `contains`: a set-based join where the target key contains the
 * source key (`strpos(t.value, s.value) > 0`), matching the in-memory
 * `targetValue.includes(sourceValue)` direction. Quadratic in the DB, O(page)
 * in the process.
 */
async function matchContainsJoin(
  deps: RelationshipApplyEngineDeps,
  runId: string,
  rule: RelationshipRule,
): Promise<number> {
  const inserted = await deps.knex.raw(
    `
    INSERT INTO ${APPLY_CANDIDATE_TABLE}
      (run_id, source_datasource_id, source_object_id, relation_type,
       destination_datasource_id, destination_object_id,
       reciprocal_relation_type, metadata)
    SELECT DISTINCT
      :runId::uuid, :sourceDs::uuid, sd.object_id, :relType,
      :targetDs::uuid, td.object_id, :recip, NULL::jsonb
    FROM ${APPLY_KEY_TABLE} sk
    JOIN ${APPLY_KEY_TABLE} tk
      ON tk.run_id = :runId::uuid AND tk.side = 'target'
      AND strpos(tk.value, sk.value) > 0
    JOIN ${DATASTORE_TABLE} sd ON sd.id = sk.row_id
    JOIN ${DATASTORE_TABLE} td ON td.id = tk.row_id
    WHERE sk.run_id = :runId::uuid AND sk.side = 'source'
    `,
    {
      runId,
      sourceDs: rule.sourceDatasourceId,
      targetDs: rule.targetDatasourceId,
      relType: rule.relationshipType,
      recip: rule.reciprocalRelationshipType ?? null,
    },
  );
  return inserted.rowCount ?? 0;
}

/**
 * Phase 2 for `regex`: stays in JS because PG `~` is POSIX, not RE2. Distinct
 * target patterns are compiled once with RE2 (capped at BLOCKING_OP_CAP);
 * source keys are streamed in pages and tested against every pattern. The
 * target value IS the pattern tested against the source value, matching the
 * in-memory `new RE2(targetValue).test(sourceValue)` direction.
 */
async function matchRegex(
  deps: RelationshipApplyEngineDeps,
  runId: string,
  rule: RelationshipRule,
  heartbeat: () => Promise<void>,
): Promise<number> {
  // Distinct target patterns → the target rows carrying them (object_id).
  const targetRows: Array<{ value: string; object_id: string }> = await deps
    .knex(`${APPLY_KEY_TABLE} as tk`)
    .join(`${DATASTORE_TABLE} as td`, 'td.id', 'tk.row_id')
    .where('tk.run_id', runId)
    .andWhere('tk.side', 'target')
    .distinct('tk.value', 'td.object_id')
    .select('tk.value', 'td.object_id');

  const distinctPatterns = new Set(targetRows.map(r => r.value));
  if (distinctPatterns.size > BLOCKING_OP_CAP) {
    throw new Error(
      `Relationship rule ${rule.id} (regex) has ${distinctPatterns.size} distinct target patterns, exceeding the ${BLOCKING_OP_CAP} cap. Reduce the number of distinct target patterns.`,
    );
  }

  // Compile each distinct pattern once; drop invalid patterns (the in-memory
  // path returned false for a pattern that failed to compile).
  const compiled = new Map<string, RE2 | null>();
  const targetsByPattern = new Map<string, string[]>();
  for (const row of targetRows) {
    if (!compiled.has(row.value)) {
      try {
        compiled.set(row.value, new RE2(row.value));
      } catch {
        compiled.set(row.value, null);
      }
    }
    const list = targetsByPattern.get(row.value) ?? [];
    list.push(row.object_id);
    targetsByPattern.set(row.value, list);
  }

  let count = 0;
  // Compound keyset on (object_id, value): a single source object can emit far
  // more than PAGE_SIZE key rows, so an object_id-only keyset would skip the
  // object's remaining values on the next page (page 2's `object_id >` steps
  // past the object entirely). The row-value comparison advances within an
  // object across pages and only moves to the next object once its values are
  // exhausted.
  let afterObjectId: string | undefined;
  let afterValue: string | undefined;
  // Because rows are ordered by (object_id, value), at most ONE object straddles
  // any page boundary. Carry that object's matched-target set across pages so a
  // (source, target) pair split across the boundary is emitted exactly once —
  // mirroring the in-memory per-source `matched` set. The set is bounded by one
  // object's distinct matched targets.
  let straddleObjectId: string | undefined;
  let straddleMatched = new Set<string>();
  for (;;) {
    const q = deps
      .knex(`${APPLY_KEY_TABLE} as sk`)
      .join(`${DATASTORE_TABLE} as sd`, 'sd.id', 'sk.row_id')
      .where('sk.run_id', runId)
      .andWhere('sk.side', 'source')
      .orderBy('sd.object_id', 'asc')
      .orderBy('sk.value', 'asc')
      .limit(PAGE_SIZE)
      .select('sd.object_id as object_id', 'sk.value as value');
    if (afterObjectId !== undefined && afterValue !== undefined) {
      // PG row-value comparison: (object_id, value) > (afterObjectId, afterValue).
      q.andWhereRaw('(sd.object_id, sk.value) > (?, ?)', [
        afterObjectId,
        afterValue,
      ]);
    }
    const page: Array<{ object_id: string; value: string }> = await q;
    if (page.length === 0) {
      break;
    }
    await heartbeat();

    const batch: CandidateRow[] = [];
    // Per source object, dedupe target object ids across its source values.
    const perSourceMatched = new Map<string, Set<string>>();
    for (const { object_id: sourceObjectId, value: sourceValue } of page) {
      let matched = perSourceMatched.get(sourceObjectId);
      if (!matched) {
        // Reuse the carried set for the object that straddled the last boundary.
        matched =
          sourceObjectId === straddleObjectId
            ? straddleMatched
            : new Set<string>();
        perSourceMatched.set(sourceObjectId, matched);
      }
      for (const [pattern, re] of compiled) {
        if (!re) continue;
        if (!re.test(sourceValue)) continue;
        for (const targetObjectId of targetsByPattern.get(pattern) ?? []) {
          if (matched.has(targetObjectId)) continue;
          matched.add(targetObjectId);
          batch.push({
            run_id: runId,
            source_datasource_id: rule.sourceDatasourceId,
            source_object_id: sourceObjectId,
            relation_type: rule.relationshipType,
            destination_datasource_id: rule.targetDatasourceId,
            destination_object_id: targetObjectId,
            reciprocal_relation_type: rule.reciprocalRelationshipType ?? null,
            metadata: null,
          });
        }
      }
    }
    if (batch.length > 0) {
      await insertCandidates(deps.knex, batch);
      count += batch.length;
    }
    if (page.length < PAGE_SIZE) {
      break;
    }
    const last = page[page.length - 1];
    afterObjectId = last.object_id;
    afterValue = last.value;
    // The last object on this page may continue on the next one — carry its set.
    straddleObjectId = last.object_id;
    straddleMatched = perSourceMatched.get(last.object_id) ?? new Set<string>();
  }
  return count;
}

/** Terminal cleanup: drop this run's scratch key + candidate rows. */
async function cleanupScratch(knex: Knex, runId: string): Promise<void> {
  await knex(APPLY_KEY_TABLE).where('run_id', runId).del();
  await knex(APPLY_CANDIDATE_TABLE).where('run_id', runId).del();
}

/**
 * Phase 3: the sealed atomic swap. Runs entirely inside one transaction under
 * the per-rule advisory lock (same key as the retired path so old and new never
 * interleave). Recounts both unlogged ranges against the sealed counts; on any
 * mismatch it aborts before touching live relations.
 */
async function sealedSwap(
  deps: RelationshipApplyEngineDeps,
  runId: string,
  rule: RelationshipRule,
  sealedSourceKeys: number,
  sealedTargetKeys: number,
  sealedCandidates: number,
  failedSourceObjectIds: string[],
  workspaceId: string,
  testHooks?: SealedApplyTestHooks,
): Promise<{ created: number; deleted: number }> {
  const now = new Date();
  let deleted = 0;
  let created = 0;

  await deps.knex.transaction(async trx => {
    await trx.raw(`SELECT pg_advisory_xact_lock(hashtext(?))`, [rule.id]);

    // Recount the unlogged scratch ranges. A crash/failover truncates UNLOGGED
    // tables silently; a mismatch means the sealed dataset is gone and we must
    // never let the delete fire against a phantom-empty candidate set.
    const [{ count: sourceKeyCount }] = await trx(APPLY_KEY_TABLE)
      .where({ run_id: runId, side: 'source' })
      .count<Array<{ count: string }>>('* as count');
    const [{ count: targetKeyCount }] = await trx(APPLY_KEY_TABLE)
      .where({ run_id: runId, side: 'target' })
      .count<Array<{ count: string }>>('* as count');
    const [{ count: candidateCount }] = await trx(APPLY_CANDIDATE_TABLE)
      .where({ run_id: runId })
      .count<Array<{ count: string }>>('* as count');

    if (
      Number(sourceKeyCount) !== sealedSourceKeys ||
      Number(targetKeyCount) !== sealedTargetKeys ||
      Number(candidateCount) !== sealedCandidates
    ) {
      throw new Error(
        `Relationship apply run ${runId} sealed-count mismatch (source ${sourceKeyCount}/${sealedSourceKeys}, target ${targetKeyCount}/${sealedTargetKeys}, candidates ${candidateCount}/${sealedCandidates}); aborting swap without touching live relations`,
      );
    }

    // Delete the rule's prior rows. Integration-backed preserves relations owned
    // by sources whose integration call failed (deleteByRuleIdExceptSources).
    if (rule.strategy === 'integration-backed') {
      deleted = await deps.relationshipDao.deleteByRuleIdExceptSources(
        rule.id,
        failedSourceObjectIds,
        trx,
        workspaceId,
      );
    } else {
      deleted = await deps.relationshipDao.deleteByRuleId(
        rule.id,
        trx,
        workspaceId,
      );
    }

    // Materialize candidates into relationship rows and bulk-insert with the
    // existing conflict behavior (only updated_at changes when another rule
    // already owns the tuple). datastore ids are resolved by joining the live
    // rows — object_id is unique per datasource, so this is deterministic.
    //
    // INNER join, deliberately: `source_datastore_id`/`target_datastore_id` are
    // FKs to datastore(id) with ON DELETE CASCADE. If an object is deleted
    // between the match and this swap, a LEFT join would write a relation with a
    // NULL datastore id — an orphan the CASCADE can never reap. The old
    // in-memory path always wrote non-null ids, so CASCADE cleaned the relation
    // up when the object died. Skipping candidates whose source or target no
    // longer resolves reaches the same eventual state (no relation for a deleted
    // object) without leaving an unreachable orphan. No relation read path
    // depends on relations surviving object deletion (verified: graph/object
    // reads key on (datasource_id, object_id) text columns, not datastore ids).
    if (testHooks?.duringSwap) {
      await testHooks.duringSwap(runId);
    }

    // Materialize in keyset pages on the candidate seq — the candidate set can
    // approach source×target for dense rules, so loading it whole would
    // reintroduce the O(dataset) heap phases 1-2 exist to avoid. LIMIT applies
    // after the joins, so a short page means the candidates are exhausted.
    let afterSeq: string | undefined;
    for (;;) {
      const q = trx(`${APPLY_CANDIDATE_TABLE} as c`)
        .innerJoin(`${DATASTORE_TABLE} as sd`, function joinSource() {
          this.on('sd.datasource_id', '=', 'c.source_datasource_id').andOn(
            'sd.object_id',
            '=',
            'c.source_object_id',
          );
        })
        .innerJoin(`${DATASTORE_TABLE} as td`, function joinTarget() {
          this.on('td.datasource_id', '=', 'c.destination_datasource_id').andOn(
            'td.object_id',
            '=',
            'c.destination_object_id',
          );
        })
        .where('c.run_id', runId)
        .andWhere('sd.workspace_id', workspaceId)
        .andWhere('td.workspace_id', workspaceId)
        .orderBy('c.seq', 'asc')
        .limit(CANDIDATE_BATCH_SIZE)
        .select(
          'c.seq',
          'c.source_datasource_id',
          'c.source_object_id',
          'c.relation_type',
          'c.destination_datasource_id',
          'c.destination_object_id',
          'c.reciprocal_relation_type',
          'c.metadata',
          'sd.id as source_datastore_id',
          'td.id as target_datastore_id',
        );
      if (afterSeq !== undefined) {
        q.andWhere('c.seq', '>', afterSeq);
      }
      const candidateRows: Array<{
        seq: string;
        source_datasource_id: string;
        source_object_id: string;
        relation_type: string;
        destination_datasource_id: string;
        destination_object_id: string;
        reciprocal_relation_type: string | null;
        metadata: unknown;
        source_datastore_id: string;
        target_datastore_id: string;
      }> = await q;
      if (candidateRows.length === 0) {
        break;
      }

      const rows = candidateRows.map(c => ({
        id: uuid(),
        source_datasource_id: c.source_datasource_id,
        source_object_id: c.source_object_id,
        destination_datasource_id: c.destination_datasource_id,
        destination_object_id: c.destination_object_id,
        relation_type: c.relation_type,
        reciprocal_relation_type: c.reciprocal_relation_type,
        updated_by: null,
        rule_id: rule.id,
        source_datastore_id: c.source_datastore_id,
        target_datastore_id: c.target_datastore_id,
        origin:
          rule.strategy === 'integration-backed'
            ? 'integration-backed'
            : rule.origin,
        confidence: rule.score ?? null,
        metadata:
          c.metadata == null
            ? null
            : typeof c.metadata === 'string'
              ? (JSON.parse(c.metadata) as Record<string, unknown>)
              : (c.metadata as Record<string, unknown>),
        created_at: now,
        updated_at: now,
      }));

      await deps.relationshipDao.insertRuleRelationships(
        rows,
        trx,
        workspaceId,
      );
      // `created` counts candidates that actually resolved to live rows (the
      // INNER join drops any whose source/target object was deleted between
      // match and swap), so it matches the old path's semantics.
      created += rows.length;

      if (candidateRows.length < CANDIDATE_BATCH_SIZE) {
        break;
      }
      afterSeq = candidateRows[candidateRows.length - 1].seq;
    }

    await trx(APPLY_RUN_TABLE)
      .where('run_id', runId)
      .update({ state: 'committed', last_heartbeat_at: now });
  });

  return { created, deleted };
}

/**
 * Drive the full three-phase apply for a single rule. Returns the created and
 * deleted counts, matching the retired path's return shape.
 */
export async function applyRelationshipRuleSealed(
  deps: RelationshipApplyEngineDeps,
  rule: RelationshipRule,
  testHooks?: SealedApplyTestHooks,
  workspaceId = DEFAULT_WORKSPACE_ID,
): Promise<ApplyResult> {
  await reapStrandedRuns(deps).catch((err: unknown) => {
    deps.logger.warn(`Failed to reap stranded relationship apply runs: ${err}`);
  });

  const [{ run_id: runId }] = await deps
    .knex(APPLY_RUN_TABLE)
    .insert({ rule_id: rule.id, state: 'extracting' })
    .returning('run_id');
  const heartbeat = makeHeartbeat(deps.knex, runId);

  try {
    let sourceKeyCount = 0;
    let targetKeyCount = 0;
    let candidateCount = 0;
    let failedSourceObjectIds: string[] = [];

    if (rule.strategy === 'integration-backed') {
      // Integration-backed matching stays JS: source keys drive per-value
      // integration calls with memoization, exactly as before, but sourced from
      // streamed pages instead of a full in-memory array.
      const extraction: IntegrationExtractionResult =
        await applyIntegrationBackedRuleStreamed({
          rule,
          knex: deps.knex,
          logger: deps.logger,
          callIntegration: deps.callIntegration,
          relationshipDao: deps.relationshipDao,
          runId,
          workspaceId,
          streamRows: async function* heartbeatingRows(datasourceId) {
            for await (const page of streamRows(
              deps.knex,
              datasourceId,
              workspaceId,
            )) {
              await heartbeat();
              yield page;
            }
          },
          insertCandidates: rows => insertCandidates(deps.knex, rows),
        });
      candidateCount = extraction.candidateCount;
      failedSourceObjectIds = extraction.failedSourceObjectIds;
      // Integration-backed doesn't use the scratch key table; the sealed counts
      // for keys are 0 so the recount is a self-consistent no-op guard.
    } else {
      // Phase 1 — extraction for both sides.
      const aliasExpand = rule.matchStrategy === 'person_name_alias';
      sourceKeyCount = await extractKeys(
        deps,
        runId,
        'source',
        rule.sourceDatasourceId,
        rule.sourceFieldExpression,
        rule.sourceFilterExpression,
        aliasExpand,
        heartbeat,
        workspaceId,
      );
      targetKeyCount = await extractKeys(
        deps,
        runId,
        'target',
        rule.targetDatasourceId,
        rule.targetFieldExpression,
        rule.targetFilterExpression,
        aliasExpand,
        heartbeat,
        workspaceId,
      );

      await deps
        .knex(APPLY_RUN_TABLE)
        .where('run_id', runId)
        .update({ state: 'matching', last_heartbeat_at: new Date() });

      // Phase 2 — matching.
      switch (rule.matchStrategy) {
        case 'exact':
        case 'array_contains':
        case 'person_name_alias':
          candidateCount = await matchEqualityJoin(deps, runId, rule);
          break;
        case 'contains':
          candidateCount = await matchContainsJoin(deps, runId, rule);
          break;
        case 'regex':
          candidateCount = await matchRegex(deps, runId, rule, heartbeat);
          break;
        default:
          candidateCount = await matchEqualityJoin(deps, runId, rule);
          break;
      }
    }

    // Simulate a crash between phase 2 and phase 3: leave the scratch data in
    // place, never seal or swap. Live relations stay untouched.
    if (testHooks?.stopAfterMatching) {
      return { created: candidateCount, deleted: 0 };
    }

    // Seal: write the observed counts to the logged run row.
    await deps
      .knex(APPLY_RUN_TABLE)
      .where('run_id', runId)
      .update({
        state: 'sealed',
        source_key_count: sourceKeyCount,
        target_key_count: targetKeyCount,
        candidate_pair_count: candidateCount,
        failed_source_object_ids: JSON.stringify(failedSourceObjectIds),
        last_heartbeat_at: new Date(),
      });

    if (testHooks?.beforeSwap) {
      await testHooks.beforeSwap(runId);
    }

    // Phase 3 — sealed swap.
    const { created, deleted } = await sealedSwap(
      deps,
      runId,
      rule,
      sourceKeyCount,
      targetKeyCount,
      candidateCount,
      failedSourceObjectIds,
      workspaceId,
      testHooks,
    );

    await cleanupScratch(deps.knex, runId);
    return { created, deleted };
  } catch (err: unknown) {
    // Terminal failure: mark the run failed and drop its scratch rows. Live
    // relations are untouched unless the swap itself committed (it either fully
    // commits or fully rolls back).
    await deps
      .knex(APPLY_RUN_TABLE)
      .where('run_id', runId)
      .update({ state: 'failed', last_heartbeat_at: new Date() })
      .catch(() => undefined);
    await cleanupScratch(deps.knex, runId).catch(() => undefined);
    throw err;
  }
}
