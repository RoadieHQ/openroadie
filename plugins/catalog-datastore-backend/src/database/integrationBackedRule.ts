import type { Knex } from 'knex';
import type { Expression } from 'jsonata';
import { v4 as uuid } from 'uuid';
import type { LoggerService } from '@roadiehq/extensions-api';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';
import type {
  DatastoreRow,
  IntegrationRuleCaller,
  RelationshipRow,
  RelationshipRule,
} from './types';
import type { RelationshipDao } from './RelationshipDao';
import { jsonata, normalizeFieldValues, isRecord } from './evaluationHelpers';
import { parseJsonColumn } from './json';
import type { IntegrationBackedConfig } from '@roadiehq/catalog-datastore-common';

/** Evaluate a field expression over rows (and an optional filter), as the repository does. */
type EvaluateRows = (
  rows: DatastoreRow[],
  fieldExpr: Expression,
  options?: { filterExpr?: Expression },
) => Promise<{ items: Array<{ row: DatastoreRow; fieldValues: string[] }> }>;

type ObjectRelationships = Awaited<
  ReturnType<RelationshipDao['getRelationshipsForObject']>
>;

/** The row-level portion of a source's context — independent of `sourceValue`. */
type RelatedContext = {
  source: Record<string, unknown>;
  sourceObjectId: string;
  sourceDatasourceId: string;
  related: Array<Record<string, unknown>>;
};

/**
 * Per-rule-application memo. The datasource graph is static for the duration of
 * one apply, so relationship and row lookups (and the assembled related-context
 * for each source object) are fetched once and shared across every source row,
 * rather than re-queried per source. `rows` caches misses as `null` too.
 */
type ContextCaches = {
  relationships: Map<string, ObjectRelationships>;
  rows: Map<string, DatastoreRow | null>;
  relatedContext: Map<string, RelatedContext>;
};

const MAX_DRY_RUN_INTEGRATION_CALLS = 50;

/** A relationship edge a rule would create, surfaced by a dry-run without writing it. */
export interface RuleCandidateEdge {
  sourceObjectId: string;
  destinationObjectId: string;
  relationshipType: string;
  metadata: Record<string, unknown> | null;
  /**
   * The response-match value that resolved this edge (e.g. the matched login).
   * Only set for integration-backed rules; field-matching edges have none.
   */
  matchValue?: string;
  /**
   * The source-side value whose lookup produced this edge. A source object can
   * evaluate to several values; previews must attribute the edge to the value
   * that actually matched, not the first one sampled.
   */
  matchSourceValue?: string;
}

export interface ApplyRuleResult {
  created: number;
  deleted: number;
  sourceRowCount: number;
  targetRowCount: number;
  filteredSourceCount: number;
  filteredTargetCount: number;
  pairCount: number;
  // Populated only on a dry-run (no writes performed):
  /** The edges the rule would create, capped by `sampleLimit`. */
  candidates?: RuleCandidateEdge[];
  /** Source object ids skipped because a value failed (path/call/expression). */
  skippedSources?: string[];
  /** True when a row or outbound-call limit bounded the source rows processed. */
  truncated?: boolean;
  /** True when the dry-run stopped at its outbound integration-call budget. */
  callLimitReached?: boolean;
  /** Number of filtered source rows actually processed. */
  sampled?: number;
  /**
   * Object ids of the filtered source rows actually processed (dry-run). Lets a
   * preview list every evaluated source — including ones that matched nothing —
   * rather than only the sources that produced an edge (from `candidates`).
   */
  sampledSourceObjectIds?: string[];
  /** Evaluated source values for each sampled object, in expression order. */
  sampledSourceValues?: Array<{
    sourceObjectId: string;
    values: string[];
  }>;
  /** First successful response already fetched during a dry-run. */
  responseSample?: {
    sourceObjectId: string;
    sourceValue: string;
    path: string;
    data: unknown;
  };
}

/**
 * Materialize an integration-backed rule: for each source object, extract the
 * lookup value, call the integration, match the response back to a target
 * object, and write the relationship with the projected metadata. Re-runs replace
 * the rule's relationships. A failed integration call — or any per-source
 * expression evaluation error (path, response-match, metadata) — skips that
 * source, not the run; a source with any failing value keeps its existing edges
 * (the rows built from its succeeding values are discarded, since replacing a
 * source's edges with a partial set would silently drop the failed value's).
 */
export async function applyIntegrationBackedRule(deps: {
  rule: RelationshipRule;
  sourceRows: DatastoreRow[];
  targetRows: DatastoreRow[];
  callIntegration?: IntegrationRuleCaller;
  evaluateRows: EvaluateRows;
  relationshipDao: RelationshipDao;
  knex: Knex;
  logger: LoggerService;
  /** Compute candidate edges without persisting; returns them on the result. */
  dryRun?: boolean;
  /** Cap the number of filtered source rows processed (dry-run cost control). */
  sampleLimit?: number;
  /** Dry-run pagination: skip this many filtered source rows before processing. */
  offset?: number;
  /** Dry-run pagination: process at most this many filtered source rows. */
  limit?: number;
  /** Dry-run selection: process one exact source object instead of a page. */
  sourceObjectId?: string;
  workspaceId?: string;
}): Promise<ApplyRuleResult> {
  const {
    rule,
    sourceRows,
    targetRows,
    evaluateRows,
    relationshipDao,
    knex,
    logger,
    dryRun = false,
    sampleLimit,
    offset,
    limit,
    sourceObjectId,
    workspaceId = DEFAULT_WORKSPACE_ID,
  } = deps;

  if (!deps.callIntegration) {
    throw new Error(
      `Relationship rule ${rule.id} cannot be applied because no integration caller is configured`,
    );
  }
  if (!rule.integrationConfig) {
    throw new Error(
      `Relationship rule ${rule.id} cannot be applied because integrationConfig is missing`,
    );
  }
  const callIntegration = deps.callIntegration;
  const config = rule.integrationConfig;
  const method = config.method ?? 'GET';

  const responseMatchExpr = jsonata(config.responseMatchExpression);
  const metadataExpr = config.metadataExpression
    ? jsonata(config.metadataExpression)
    : undefined;
  const pathExpr = config.pathExpression
    ? jsonata(config.pathExpression)
    : null;
  const contextCaches: ContextCaches = {
    relationships: new Map(),
    rows: new Map(),
    relatedContext: new Map(),
  };

  const { items: filteredSources } = await evaluateRows(
    sourceRows,
    jsonata(rule.sourceFieldExpression),
    {
      filterExpr: rule.sourceFilterExpression
        ? jsonata(rule.sourceFilterExpression)
        : undefined,
    },
  );
  const { items: filteredTargets } = await evaluateRows(
    targetRows,
    jsonata(rule.targetFieldExpression),
    {
      filterExpr: rule.targetFilterExpression
        ? jsonata(rule.targetFilterExpression)
        : undefined,
    },
  );

  const targetByValue = new Map<string, DatastoreRow>();
  for (const target of filteredTargets) {
    for (const targetValue of target.fieldValues) {
      if (!targetByValue.has(targetValue)) {
        targetByValue.set(targetValue, target.row);
      }
    }
  }

  const responseByValue = new Map<string, unknown>();
  const failedSourceObjectIds = new Set<string>();
  const seenRelationships = new Set<string>();
  // `${sourceObjectId}:${destObjectId}` → the response-match value (and the
  // source-side value that issued the lookup) that resolved the edge, so a
  // dry-run can surface them (the row itself is a DB insert shape and must not
  // carry extra columns). Only populated on dry-runs — a real apply never
  // reads them.
  const matchValueByRelationship = new Map<string, string>();
  const sourceValueByRelationship = new Map<string, string>();
  const now = new Date();
  const rows: Array<
    Omit<RelationshipRow, 'id' | 'created_at' | 'updated_at'> & {
      id: string;
      created_at: Date;
      updated_at: Date;
    }
  > = [];

  // Dry-runs make real integration calls, so bound how many source rows are
  // processed rather than firing one call per source across the whole datasource.
  // Only ever sample on a dry-run: a real apply that processed a subset would let
  // the delete-except-sources write below wipe the unsampled sources' edges.
  let truncated = false;
  let sampledSources = filteredSources;
  if (dryRun) {
    if (sourceObjectId) {
      sampledSources = filteredSources.filter(
        source => source.row.object_id === sourceObjectId,
      );
    } else {
      const effectiveOffset = offset ?? 0;
      const effectiveLimit = limit ?? sampleLimit;
      if (effectiveLimit !== undefined) {
        const end = effectiveOffset + effectiveLimit;
        sampledSources = filteredSources.slice(effectiveOffset, end);
        truncated = filteredSources.length > end;
      } else if (effectiveOffset > 0) {
        sampledSources = filteredSources.slice(effectiveOffset);
        truncated =
          effectiveOffset + sampledSources.length < filteredSources.length;
      }
    }
  }

  let integrationCalls = 0;
  let callLimitReached = false;
  const processedSources: typeof sampledSources = [];
  let responseSample: ApplyRuleResult['responseSample'];

  for (const source of sampledSources) {
    let sourceCallFailed = false;
    let budgetExhausted = false;
    let sourceEvaluated = false;
    const sourceEdges: typeof rows = [];
    let sourceResponseSample: ApplyRuleResult['responseSample'];

    for (const sourceValue of source.fieldValues) {
      if (!sourceValue) {
        continue;
      }

      // Everything that can fail for a single source value — building the
      // request path (incl. graph traversal), the integration call, and the
      // response-match/metadata expressions — is isolated here so one bad
      // source is skipped rather than aborting the whole rule application.
      try {
        const requestPath = pathExpr
          ? await buildPathFromExpression({
              config,
              pathExpr,
              source,
              sourceValue,
              relationshipDao,
              knex,
              caches: contextCaches,
              workspaceId,
            })
          : config.path.replace(/\{value\}/g, encodeURIComponent(sourceValue));

        let responseBody: unknown;
        if (responseByValue.has(requestPath)) {
          responseBody = responseByValue.get(requestPath);
        } else {
          if (dryRun && integrationCalls >= MAX_DRY_RUN_INTEGRATION_CALLS) {
            callLimitReached = true;
            truncated = true;
            // Stop before the next call, but fall through to finalize the edges
            // and response sample already gathered for this source — otherwise a
            // source that made successful calls before the budget ran out would
            // be dropped from the preview while callLimitReached is true.
            budgetExhausted = true;
            break;
          }
          integrationCalls += 1;
          responseBody = await callIntegration({
            integrationId: config.integrationId,
            method,
            path: requestPath,
            workspaceId,
          });
          responseByValue.set(requestPath, responseBody);
        }
        // At least one value of this source was looked up (cached or fresh), so
        // it counts as evaluated even if the budget stops it partway through.
        sourceEvaluated = true;

        if (dryRun && !sourceResponseSample) {
          sourceResponseSample = {
            sourceObjectId: source.row.object_id,
            sourceValue,
            path: requestPath,
            data: responseBody ?? null,
          };
        }

        const matchValues = normalizeFieldValues(
          await responseMatchExpr.evaluate(responseBody),
        );
        // Project metadata at most once per response, and only once we know a
        // target actually matches — reused across every fanned-out edge.
        let projectedMetadata: unknown = null;
        let metadataEvaluated = false;
        for (const matchValue of matchValues) {
          const target = targetByValue.get(matchValue);
          if (!target) {
            continue;
          }
          const relationshipKey = `${source.row.object_id}:${target.object_id}`;
          if (seenRelationships.has(relationshipKey)) {
            continue;
          }
          seenRelationships.add(relationshipKey);
          if (dryRun) {
            matchValueByRelationship.set(relationshipKey, matchValue);
            sourceValueByRelationship.set(relationshipKey, sourceValue);
          }
          if (metadataExpr && !metadataEvaluated) {
            projectedMetadata = await metadataExpr.evaluate(responseBody);
            metadataEvaluated = true;
          }
          sourceEdges.push({
            id: uuid(),
            source_datasource_id: rule.sourceDatasourceId,
            source_object_id: source.row.object_id,
            destination_datasource_id: rule.targetDatasourceId,
            destination_object_id: target.object_id,
            relation_type: rule.relationshipType,
            reciprocal_relation_type: rule.reciprocalRelationshipType ?? null,
            updated_by: null,
            rule_id: rule.id,
            source_datastore_id: source.row.id,
            target_datastore_id: target.id,
            origin: 'integration-backed',
            confidence: rule.score ?? null,
            metadata: isRecord(projectedMetadata) ? projectedMetadata : null,
            created_at: now,
            updated_at: now,
          });
        }
      } catch (e: unknown) {
        sourceCallFailed = true;
        logger.warn(
          `Integration-backed relationship rule ${rule.id} failed for value ${sourceValue}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
        continue;
      }
    }

    if (budgetExhausted && !sourceEvaluated) {
      // The budget ran out before this source made a single lookup, so it was
      // never actually evaluated — stop without recording it, rather than
      // emitting it as a false "no match" (empty targets) in the preview.
      break;
    }
    processedSources.push(source);
    if (sourceCallFailed) {
      // Any failed value leaves this run's view of the source incomplete —
      // keep its existing edges instead of replacing them with a partial set.
      failedSourceObjectIds.add(source.row.object_id);
    } else {
      responseSample ??= sourceResponseSample;
      rows.push(...sourceEdges);
    }
    // The dry-run call budget ran out partway through this source; its already-
    // gathered edges/sample were finalized above, so stop sampling further.
    if (budgetExhausted) {
      break;
    }
  }

  if (dryRun) {
    return {
      created: rows.length,
      deleted: 0,
      sourceRowCount: sourceRows.length,
      targetRowCount: targetRows.length,
      filteredSourceCount: filteredSources.length,
      filteredTargetCount: filteredTargets.length,
      pairCount: rows.length,
      candidates: rows.map(row => ({
        sourceObjectId: row.source_object_id,
        destinationObjectId: row.destination_object_id,
        relationshipType: row.relation_type,
        metadata: isRecord(row.metadata) ? row.metadata : null,
        matchValue:
          matchValueByRelationship.get(
            `${row.source_object_id}:${row.destination_object_id}`,
          ) ?? '',
        matchSourceValue: sourceValueByRelationship.get(
          `${row.source_object_id}:${row.destination_object_id}`,
        ),
      })),
      skippedSources: [...failedSourceObjectIds],
      truncated,
      callLimitReached,
      sampled: processedSources.length,
      sampledSourceObjectIds: processedSources.map(s => s.row.object_id),
      sampledSourceValues: processedSources.map(source => ({
        sourceObjectId: source.row.object_id,
        values: source.fieldValues,
      })),
      responseSample,
    };
  }

  let deleted = 0;
  await knex.transaction(async trx => {
    await trx.raw(`SELECT pg_advisory_xact_lock(hashtext(?))`, [rule.id]);
    deleted = await relationshipDao.deleteByRuleIdExceptSources(
      rule.id,
      [...failedSourceObjectIds],
      trx,
      workspaceId,
    );
    await relationshipDao.insertRuleRelationships(rows, trx, workspaceId);
  });

  return {
    created: rows.length,
    deleted,
    sourceRowCount: sourceRows.length,
    targetRowCount: targetRows.length,
    filteredSourceCount: filteredSources.length,
    filteredTargetCount: filteredTargets.length,
    pairCount: rows.length,
  };
}

/** A candidate tuple as staged by the sealed apply engine's scratch table. */
export interface StagedCandidateRow {
  run_id: string;
  source_datasource_id: string;
  source_object_id: string;
  relation_type: string;
  destination_datasource_id: string;
  destination_object_id: string;
  reciprocal_relation_type: string | null;
  metadata: string | null;
}

export interface IntegrationExtractionResult {
  candidateCount: number;
  failedSourceObjectIds: string[];
}

/**
 * Streamed, bounded-memory integration-backed matching for the three-phase
 * sealed apply (sc-34106 §8). Same per-value call + memoization + graph-context
 * logic as `applyIntegrationBackedRule`, but the source side is streamed in
 * pages and matched candidates are written to the scratch candidate table
 * instead of `datastore_relation`. Failed source object ids are returned so the
 * sealed swap can preserve their existing edges (`deleteByRuleIdExceptSources`).
 *
 * The target-value lookup is built from a streamed target pass; it holds one
 * entry per distinct target value (the same footprint the retired path's
 * `targetByValue` had). Source streaming + candidate staging are what make the
 * source side O(page).
 */
export async function applyIntegrationBackedRuleStreamed(deps: {
  rule: RelationshipRule;
  knex: Knex;
  logger: LoggerService;
  callIntegration?: IntegrationRuleCaller;
  relationshipDao: RelationshipDao;
  runId: string;
  streamRows: (datasourceId: string) => AsyncGenerator<DatastoreRow[]>;
  insertCandidates: (rows: StagedCandidateRow[]) => Promise<void>;
  workspaceId?: string;
}): Promise<IntegrationExtractionResult> {
  const {
    rule,
    knex,
    logger,
    runId,
    relationshipDao,
    streamRows,
    insertCandidates,
    workspaceId = DEFAULT_WORKSPACE_ID,
  } = deps;

  if (!deps.callIntegration) {
    throw new Error(
      `Relationship rule ${rule.id} cannot be applied because no integration caller is configured`,
    );
  }
  if (!rule.integrationConfig) {
    throw new Error(
      `Relationship rule ${rule.id} cannot be applied because integrationConfig is missing`,
    );
  }
  const callIntegration = deps.callIntegration;
  const config = rule.integrationConfig;
  const method = config.method ?? 'GET';

  const responseMatchExpr = jsonata(config.responseMatchExpression);
  const metadataExpr = config.metadataExpression
    ? jsonata(config.metadataExpression)
    : undefined;
  const pathExpr = config.pathExpression
    ? jsonata(config.pathExpression)
    : null;
  const contextCaches: ContextCaches = {
    relationships: new Map(),
    rows: new Map(),
    relatedContext: new Map(),
  };

  const sourceFieldExpr = jsonata(rule.sourceFieldExpression);
  const sourceFilterExpr = rule.sourceFilterExpression
    ? jsonata(rule.sourceFilterExpression)
    : undefined;
  const targetFieldExpr = jsonata(rule.targetFieldExpression);
  const targetFilterExpr = rule.targetFilterExpression
    ? jsonata(rule.targetFilterExpression)
    : undefined;

  // Build the target-value → target row map from a streamed pass (first value
  // wins, matching the retired path).
  const targetByValue = new Map<string, DatastoreRow>();
  for await (const page of streamRows(rule.targetDatasourceId)) {
    for (const row of page) {
      const values = await evaluateRowValues(
        row,
        targetFieldExpr,
        targetFilterExpr,
      );
      for (const value of values) {
        if (!targetByValue.has(value)) {
          targetByValue.set(value, row);
        }
      }
    }
  }

  const responseByValue = new Map<string, unknown>();
  const failedSourceObjectIds = new Set<string>();
  const seenRelationships = new Set<string>();
  let candidateCount = 0;

  for await (const page of streamRows(rule.sourceDatasourceId)) {
    const batch: StagedCandidateRow[] = [];
    for (const row of page) {
      const fieldValues = await evaluateRowValues(
        row,
        sourceFieldExpr,
        sourceFilterExpr,
      );
      if (fieldValues.length === 0) {
        continue;
      }
      const source = { row, fieldValues };

      let sourceCallFailed = false;
      const sourceEdges: StagedCandidateRow[] = [];

      for (const sourceValue of fieldValues) {
        if (!sourceValue) {
          continue;
        }
        try {
          const requestPath = pathExpr
            ? await buildPathFromExpression({
                config,
                pathExpr,
                source,
                sourceValue,
                relationshipDao,
                knex,
                caches: contextCaches,
                workspaceId,
              })
            : config.path.replace(
                /\{value\}/g,
                encodeURIComponent(sourceValue),
              );

          let responseBody: unknown;
          if (responseByValue.has(requestPath)) {
            responseBody = responseByValue.get(requestPath);
          } else {
            responseBody = await callIntegration({
              integrationId: config.integrationId,
              method,
              path: requestPath,
              workspaceId,
            });
            responseByValue.set(requestPath, responseBody);
          }

          const matchValues = normalizeFieldValues(
            await responseMatchExpr.evaluate(responseBody),
          );
          let projectedMetadata: unknown = null;
          let metadataEvaluated = false;
          for (const matchValue of matchValues) {
            const target = targetByValue.get(matchValue);
            if (!target) {
              continue;
            }
            const relationshipKey = `${source.row.object_id}:${target.object_id}`;
            if (seenRelationships.has(relationshipKey)) {
              continue;
            }
            seenRelationships.add(relationshipKey);
            if (metadataExpr && !metadataEvaluated) {
              projectedMetadata = await metadataExpr.evaluate(responseBody);
              metadataEvaluated = true;
            }
            sourceEdges.push({
              run_id: runId,
              source_datasource_id: rule.sourceDatasourceId,
              source_object_id: source.row.object_id,
              relation_type: rule.relationshipType,
              destination_datasource_id: rule.targetDatasourceId,
              destination_object_id: target.object_id,
              reciprocal_relation_type: rule.reciprocalRelationshipType ?? null,
              metadata: isRecord(projectedMetadata)
                ? JSON.stringify(projectedMetadata)
                : null,
            });
          }
        } catch (e: unknown) {
          sourceCallFailed = true;
          logger.warn(
            `Integration-backed relationship rule ${rule.id} failed for value ${sourceValue}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
          continue;
        }
      }

      if (sourceCallFailed) {
        failedSourceObjectIds.add(source.row.object_id);
        continue;
      }
      batch.push(...sourceEdges);
    }
    if (batch.length > 0) {
      await insertCandidates(batch);
      candidateCount += batch.length;
    }
  }

  return {
    candidateCount,
    failedSourceObjectIds: [...failedSourceObjectIds],
  };
}

/** Evaluate a field (and optional filter) expression for a single row. */
async function evaluateRowValues(
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

async function buildPathFromExpression(args: {
  config: IntegrationBackedConfig;
  pathExpr: Expression;
  source: { row: DatastoreRow; fieldValues: string[] };
  sourceValue: string;
  relationshipDao: RelationshipDao;
  knex: Knex;
  caches: ContextCaches;
  workspaceId: string;
}): Promise<string> {
  const related = await buildRelatedContext(args);
  const context = { ...related, sourceValue: args.sourceValue };
  const rawPath = await args.pathExpr.evaluate(context);
  if (typeof rawPath !== 'string' || rawPath.trim() === '') {
    throw new Error(
      'integration-backed pathExpression must evaluate to a non-empty string',
    );
  }
  return rawPath;
}

/**
 * The row-level context for a source object (source fields + graph neighbours),
 * independent of the per-value `sourceValue`. Memoized per source object across
 * the whole rule application.
 *
 * The traversal is by hop distance and treats edges as undirected (both
 * outgoing and incoming, subject to the `relationshipTypes`/`datasourceIds`
 * filters). Each reachable object is collected exactly once — at the first edge
 * that reaches it — so the source never echoes back into its own `related` and
 * no object is duplicated when several edges lead to it.
 */
async function buildRelatedContext(args: {
  config: IntegrationBackedConfig;
  source: { row: DatastoreRow; fieldValues: string[] };
  relationshipDao: RelationshipDao;
  knex: Knex;
  caches: ContextCaches;
  workspaceId: string;
}): Promise<RelatedContext> {
  const rootKey = `${args.workspaceId}:${args.source.row.datasource_id}:${args.source.row.object_id}`;
  const cached = args.caches.relatedContext.get(rootKey);
  if (cached) {
    return cached;
  }

  const context: RelatedContext = {
    source:
      parseJsonColumn<Record<string, unknown>>(args.source.row.object) ?? {},
    sourceObjectId: args.source.row.object_id,
    sourceDatasourceId: args.source.row.datasource_id,
    related: [],
  };

  const sourceContext = args.config.sourceContext;
  if (!sourceContext) {
    args.caches.relatedContext.set(rootKey, context);
    return context;
  }

  const maxDepth = Math.max(1, sourceContext.maxDepth ?? 1);
  const queue: Array<{
    datasourceId: string;
    objectId: string;
    depth: number;
  }> = [
    {
      datasourceId: args.source.row.datasource_id,
      objectId: args.source.row.object_id,
      depth: 0,
    },
  ];
  const visited = new Set<string>([rootKey]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth >= maxDepth) {
      continue;
    }

    const relationships = await getRelationshipsCached(
      args.relationshipDao,
      args.caches,
      current.datasourceId,
      current.objectId,
      args.workspaceId,
    );
    const filteredRelationships = relationships.filter(rel => {
      if (sourceContext.relationshipTypes?.length) {
        // An edge is stored under its forward type, but from the traversing
        // object's side an incoming edge reads as the reciprocal — accept
        // either name, matching how rule ordering registers producers.
        const matchesType =
          sourceContext.relationshipTypes.includes(rel.relationshipType) ||
          (rel.reciprocalRelationshipType != null &&
            sourceContext.relationshipTypes.includes(
              rel.reciprocalRelationshipType,
            ));
        if (!matchesType) {
          return false;
        }
      }
      if (
        sourceContext.datasourceIds?.length &&
        !sourceContext.datasourceIds.includes(
          relationTargetRef(rel).datasourceId,
        )
      ) {
        return false;
      }
      return true;
    });

    const rowsByKey = await loadRowsByRefs(
      args.knex,
      args.caches,
      filteredRelationships.map(rel => relationTargetRef(rel)),
      args.workspaceId,
    );

    for (const rel of filteredRelationships) {
      const ref = relationTargetRef(rel);
      const rowKey = `${ref.datasourceId}:${ref.objectId}`;
      if (visited.has(rowKey)) {
        continue;
      }
      const relatedRow = rowsByKey.get(rowKey);
      if (!relatedRow) {
        continue;
      }
      visited.add(rowKey);
      context.related.push({
        datasourceId: ref.datasourceId,
        objectId: ref.objectId,
        relationshipType: rel.relationshipType,
        reciprocalRelationshipType: rel.reciprocalRelationshipType ?? null,
        direction: rel.direction,
        origin: rel.origin ?? 'manual',
        depth: current.depth + 1,
        metadata: rel.metadata ?? null,
        object:
          parseJsonColumn<Record<string, unknown>>(relatedRow.object) ?? {},
      });
      queue.push({
        datasourceId: ref.datasourceId,
        objectId: ref.objectId,
        depth: current.depth + 1,
      });
    }
  }

  args.caches.relatedContext.set(rootKey, context);
  return context;
}

async function getRelationshipsCached(
  relationshipDao: RelationshipDao,
  caches: ContextCaches,
  datasourceId: string,
  objectId: string,
  workspaceId: string,
): Promise<ObjectRelationships> {
  const key = `${workspaceId}:${datasourceId}:${objectId}`;
  const hit = caches.relationships.get(key);
  if (hit) {
    return hit;
  }
  const relationships = await relationshipDao.getRelationshipsForObject(
    datasourceId,
    objectId,
    workspaceId,
  );
  caches.relationships.set(key, relationships);
  return relationships;
}

async function loadRowsByRefs(
  knex: Knex,
  caches: ContextCaches,
  refs: Array<{ datasourceId: string; objectId: string }>,
  workspaceId: string,
): Promise<Map<string, DatastoreRow>> {
  const result = new Map<string, DatastoreRow>();
  const uncached: Array<{ datasourceId: string; objectId: string }> = [];
  for (const ref of refs) {
    const cacheKey = `${workspaceId}:${ref.datasourceId}:${ref.objectId}`;
    const resultKey = `${ref.datasourceId}:${ref.objectId}`;
    if (caches.rows.has(cacheKey)) {
      const row = caches.rows.get(cacheKey);
      if (row) {
        result.set(resultKey, row);
      }
    } else {
      uncached.push(ref);
    }
  }

  if (uncached.length === 0) {
    return result;
  }

  const conditions = uncached.map(ref => [ref.datasourceId, ref.objectId]);
  const rows = await knex<DatastoreRow>('datastore')
    .whereIn(['datasource_id', 'object_id'], conditions)
    .andWhere('workspace_id', workspaceId);
  const found = new Set<string>();
  for (const row of rows) {
    const cacheKey = `${workspaceId}:${row.datasource_id}:${row.object_id}`;
    const resultKey = `${row.datasource_id}:${row.object_id}`;
    caches.rows.set(cacheKey, row);
    result.set(resultKey, row);
    found.add(cacheKey);
  }
  // Cache misses as null so a shared missing ref isn't re-queried per source.
  for (const ref of uncached) {
    const cacheKey = `${workspaceId}:${ref.datasourceId}:${ref.objectId}`;
    if (!found.has(cacheKey)) {
      caches.rows.set(cacheKey, null);
    }
  }
  return result;
}

function relationTargetRef(rel: {
  direction: 'outgoing' | 'incoming';
  sourceDatasourceId: string;
  sourceObjectId: string;
  destinationDatasourceId: string;
  destinationObjectId: string;
}): { datasourceId: string; objectId: string } {
  if (rel.direction === 'outgoing') {
    return {
      datasourceId: rel.destinationDatasourceId,
      objectId: rel.destinationObjectId,
    };
  }
  return {
    datasourceId: rel.sourceDatasourceId,
    objectId: rel.sourceObjectId,
  };
}
