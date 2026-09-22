import type { Knex } from 'knex';
import { RelationshipRule, RelationshipRuleRow } from './types';
import { v4 as uuid } from 'uuid';
import {
  RelationshipRuleInput,
  RelationshipRuleState,
  type IntegrationBackedConfig,
} from '@roadiehq/catalog-datastore-common';
import { parseJsonColumn } from './json';
import {
  DEFAULT_WORKSPACE_ID,
  workspaceOwnershipFields,
} from '@roadiehq/workspaces-backend';

const RELATIONSHIP_RULE_TABLE_NAME = 'datastore_relationship_rule';
function rowToRelationshipRule(row: RelationshipRuleRow): RelationshipRule {
  return {
    id: row.id,
    ...workspaceOwnershipFields(row.workspace_id ?? DEFAULT_WORKSPACE_ID),
    name: row.name,
    description: row.description,
    sourceDatasourceId: row.source_datasource_id,
    targetDatasourceId: row.target_datasource_id,
    sourceFieldExpression: row.source_field_expression,
    targetFieldExpression: row.target_field_expression,
    sourceFilterExpression: row.source_filter_expression,
    targetFilterExpression: row.target_filter_expression,
    relationshipType: row.relation_type,
    reciprocalRelationshipType: row.reciprocal_relation_type,
    strategy: row.strategy ?? 'field-matching',
    matchStrategy: row.match_strategy,
    integrationConfig: parseJsonColumn<IntegrationBackedConfig>(
      row.integration_config,
    ),
    origin: row.origin,
    state: row.state,
    suggestionKind: row.suggestion_kind,
    score: row.score,
    confidenceBand: row.confidence_band,
    evidenceSummary:
      typeof row.evidence_summary === 'string'
        ? JSON.parse(row.evidence_summary)
        : row.evidence_summary,
    reviewReason: row.review_reason,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class RelationshipRuleDao {
  private readonly knex: Knex;

  constructor(options: { knex: Knex }) {
    this.knex = options.knex;
  }

  private relationshipRuleTable(trx?: Knex) {
    return (trx || this.knex)<RelationshipRuleRow>(
      RELATIONSHIP_RULE_TABLE_NAME,
    );
  }

  /**
   * Integration-backed relationship rules configured against `integrationId`.
   *
   * Backs the integration delete guard. Unfiltered by `state`: a `suggested`
   * rule would break just as badly once approved.
   */
  async findByIntegrationId(
    integrationId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Array<{ id: string; name: string }>> {
    return this.relationshipRuleTable()
      .where('workspace_id', workspaceId)
      .whereRaw("integration_config ->> 'integrationId' = ?", [integrationId])
      .orderBy('name', 'asc')
      .select('id', 'name');
  }

  async createRelationshipRule(
    input: RelationshipRuleInput,
    options?: {
      workspaceId?: string;
      origin?: string;
      state?: RelationshipRuleState;
    },
  ): Promise<RelationshipRule> {
    const origin = options?.origin ?? input.origin ?? '';
    const state =
      options?.state ?? (options !== undefined ? 'active' : 'suggested');

    return this.knex.transaction(async trx => {
      const [row] = await this.relationshipRuleTable(trx)
        .insert({
          id: uuid(),
          workspace_id: options?.workspaceId ?? DEFAULT_WORKSPACE_ID,
          name: input.name,
          description: input.description ?? null,
          source_datasource_id: input.sourceDatasourceId,
          target_datasource_id: input.targetDatasourceId,
          source_field_expression: input.sourceFieldExpression,
          target_field_expression: input.targetFieldExpression,
          source_filter_expression: input.sourceFilterExpression ?? null,
          target_filter_expression: input.targetFilterExpression ?? null,
          relation_type: input.relationshipType,
          reciprocal_relation_type: input.reciprocalRelationshipType ?? null,
          strategy: input.strategy ?? 'field-matching',
          match_strategy: input.matchStrategy ?? 'exact',
          integration_config: input.integrationConfig ?? null,
          origin,
          state,
          suggestion_kind: input.suggestionKind ?? null,
          score: input.score ?? null,
          confidence_band: input.confidenceBand ?? null,
          evidence_summary: input.evidenceSummary ?? null,
          review_reason: input.reviewReason ?? null,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning('*');

      return rowToRelationshipRule(row);
    });
  }

  async updateRelationshipRule(
    id: string,
    input: Partial<RelationshipRuleInput>,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<RelationshipRule | undefined> {
    return this.knex.transaction(async trx => {
      const updates: Partial<RelationshipRuleRow> = { updated_at: new Date() };
      if (input.name !== undefined) {
        updates.name = input.name;
      }
      if (input.description !== undefined) {
        updates.description = input.description ?? null;
      }
      if (input.sourceDatasourceId !== undefined) {
        updates.source_datasource_id = input.sourceDatasourceId;
      }
      if (input.targetDatasourceId !== undefined) {
        updates.target_datasource_id = input.targetDatasourceId;
      }
      if (input.sourceFieldExpression !== undefined) {
        updates.source_field_expression = input.sourceFieldExpression;
      }
      if (input.targetFieldExpression !== undefined) {
        updates.target_field_expression = input.targetFieldExpression;
      }
      if (input.sourceFilterExpression !== undefined) {
        updates.source_filter_expression = input.sourceFilterExpression ?? null;
      }
      if (input.targetFilterExpression !== undefined) {
        updates.target_filter_expression = input.targetFilterExpression ?? null;
      }
      if (input.relationshipType !== undefined) {
        updates.relation_type = input.relationshipType;
      }
      if (input.reciprocalRelationshipType !== undefined) {
        updates.reciprocal_relation_type =
          input.reciprocalRelationshipType ?? null;
      }
      if (input.matchStrategy !== undefined) {
        updates.match_strategy = input.matchStrategy;
      }
      if (input.strategy !== undefined) {
        updates.strategy = input.strategy;
      }
      if (input.integrationConfig !== undefined) {
        updates.integration_config = input.integrationConfig ?? null;
      }
      if (input.suggestionKind !== undefined) {
        updates.suggestion_kind = input.suggestionKind ?? null;
      }
      if (input.score !== undefined) {
        updates.score = input.score ?? null;
      }
      if (input.confidenceBand !== undefined) {
        updates.confidence_band = input.confidenceBand ?? null;
      }
      if (input.evidenceSummary !== undefined) {
        updates.evidence_summary = input.evidenceSummary ?? null;
      }
      if (input.reviewReason !== undefined) {
        updates.review_reason = input.reviewReason ?? null;
      }

      const [row] = await this.relationshipRuleTable(trx)
        .where({ id, workspace_id: workspaceId })
        .update(updates)
        .returning('*');
      if (!row) return undefined;

      return rowToRelationshipRule(row);
    });
  }

  async findExistingRule(opts: {
    workspaceId?: string;
    sourceDatasourceId: string;
    targetDatasourceId: string;
    sourceFieldExpression: string;
    targetFieldExpression: string;
  }): Promise<RelationshipRule | undefined> {
    const row = await this.relationshipRuleTable()
      .where('workspace_id', opts.workspaceId ?? DEFAULT_WORKSPACE_ID)
      .where('source_datasource_id', opts.sourceDatasourceId)
      .andWhere('target_datasource_id', opts.targetDatasourceId)
      .andWhere('source_field_expression', opts.sourceFieldExpression)
      .andWhere('target_field_expression', opts.targetFieldExpression)
      .first();
    if (!row) return undefined;
    return rowToRelationshipRule(row);
  }

  async deleteRelationshipRule(
    id: string,
    trx?: Knex,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<number> {
    return this.relationshipRuleTable(trx)
      .where({ id, workspace_id: workspaceId })
      .delete();
  }

  async getRelationshipRule(
    id: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<RelationshipRule | undefined> {
    const row = await this.relationshipRuleTable()
      .where({ id, workspace_id: workspaceId })
      .first();
    if (!row) return undefined;
    return rowToRelationshipRule(row);
  }

  /**
   * Transitions a rule's state. When `expectedState` is given this is a
   * compare-and-swap: the UPDATE also matches on `state = expectedState`, so a
   * row a concurrent transition already moved out of that state matches zero
   * rows and returns `undefined`. Callers that pass `expectedState` MUST treat
   * `undefined` as a lost race (409), not a no-op — it closes the same-row
   * double-transition window between a caller's read and its write. Without
   * `expectedState` the update is unconditional (recovery/rollback paths).
   */
  async updateRelationshipRuleState(
    id: string,
    state: RelationshipRuleState,
    options?: {
      workspaceId?: string;
      reviewReason?: string | null;
      expectedState?: RelationshipRuleState;
    },
  ): Promise<RelationshipRule | undefined> {
    const query = this.relationshipRuleTable().where({
      id,
      workspace_id: options?.workspaceId ?? DEFAULT_WORKSPACE_ID,
    });
    if (options?.expectedState !== undefined) {
      query.where('state', options.expectedState);
    }
    const [row] = await query
      .update({
        state,
        review_reason:
          options?.reviewReason !== undefined
            ? options.reviewReason
            : undefined,
        updated_at: new Date(),
      })
      .returning('*');
    if (!row) return undefined;
    return rowToRelationshipRule(row);
  }

  /**
   * Approve-path flip that serializes an entire mirror pair inside one
   * transaction. The plain CAS in `updateRelationshipRuleState` closes only the
   * *same-row* double-transition; it cannot stop two callers approving opposite
   * directions of a mirror pair (A→B and B→A are different rows, so both CASes
   * succeed and both go `active`).
   *
   * This locks `id` and *every* suggested mirror (`blockingMirrorIds`,
   * discovered unlocked by the caller) together with `FOR UPDATE`, ordered by id
   * so an A-approve and a B-approve acquire their locks in the *same* order and
   * serialize instead of deadlocking. Locking the whole inverse set — not just
   * one row — is what closes the duplicate-mirror hole: with two suggested rows
   * per direction (e.g. an inactive-then-reset copy alongside a live one) a
   * single-row lock lets two approves pick disjoint (self, mirror) pairs and
   * both win. Once locked it re-checks, on the freshly locked rows, that `id` is
   * still in `expectedState` and no mirror has gone `active`; only then does it
   * CAS-flip. The second approver blocks on the shared lock until the first
   * commits, then sees the now-active mirror and loses.
   *
   * Returns `{ status: 'updated', rule }` on success, or `{ status: 'conflict' }`
   * with a machine-readable `reason` the caller maps to a 409. The heavy
   * `applyRelationshipRule` deliberately runs *after* this returns (outside the
   * lock) — holding a row lock across its page-streaming materialization would
   * stall every mirrored approve behind one datastore's rematerialization.
   */
  async transitionStateWithPairLock(params: {
    id: string;
    toState: RelationshipRuleState;
    expectedState: RelationshipRuleState;
    reviewReason?: string | null;
    blockingMirrorIds?: string[];
    workspaceId?: string;
  }): Promise<
    | { status: 'updated'; rule: RelationshipRule }
    | { status: 'conflict'; reason: 'stale-self' | 'mirror-active' }
  > {
    const mirrorIds = params.blockingMirrorIds ?? [];
    // Dedupe so a mirror id that coincides with `id` (or a repeated mirror)
    // doesn't widen the whereIn needlessly; ordering is imposed in SQL.
    const lockIds = [...new Set([params.id, ...mirrorIds])];

    return this.knex.transaction(async trx => {
      // ORDER BY id fixes the lock-acquisition order across transactions, so
      // opposite-direction approves of the same pair can't deadlock.
      const lockedRows = await this.relationshipRuleTable(trx)
        .where('workspace_id', params.workspaceId ?? DEFAULT_WORKSPACE_ID)
        .whereIn('id', lockIds)
        .orderBy('id')
        .forUpdate();
      const byId = new Map(lockedRows.map(row => [row.id, row]));

      const self = byId.get(params.id);
      if (!self || self.state !== params.expectedState) {
        return { status: 'conflict', reason: 'stale-self' };
      }
      // Any locked mirror having reached `active` means the opposite direction
      // already won — refuse rather than materialize the same edge twice.
      const mirrorWentActive = mirrorIds.some(
        mirrorId => byId.get(mirrorId)?.state === 'active',
      );
      if (mirrorWentActive) {
        return { status: 'conflict', reason: 'mirror-active' };
      }

      const [row] = await this.relationshipRuleTable(trx)
        .where({
          id: params.id,
          workspace_id: params.workspaceId ?? DEFAULT_WORKSPACE_ID,
        })
        .where('state', params.expectedState)
        .update({
          state: params.toState,
          review_reason:
            params.reviewReason !== undefined ? params.reviewReason : undefined,
          updated_at: new Date(),
        })
        .returning('*');
      if (!row) return { status: 'conflict', reason: 'stale-self' };
      return { status: 'updated', rule: rowToRelationshipRule(row) };
    });
  }

  async listRelationshipRules(options?: {
    workspaceId?: string;
    limit?: number;
    offset?: number;
    origin?: string;
    state?: string;
    reviewReason?: string;
  }): Promise<{ items: RelationshipRule[]; total: number }> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const q = this.relationshipRuleTable().where(
      `${RELATIONSHIP_RULE_TABLE_NAME}.workspace_id`,
      options?.workspaceId ?? DEFAULT_WORKSPACE_ID,
    );
    if (options?.origin) {
      q.where(`${RELATIONSHIP_RULE_TABLE_NAME}.origin`, options.origin);
    }
    if (options?.state) {
      q.where(`${RELATIONSHIP_RULE_TABLE_NAME}.state`, options.state);
    }
    if (options?.reviewReason) {
      q.where(
        `${RELATIONSHIP_RULE_TABLE_NAME}.review_reason`,
        options.reviewReason,
      );
    }

    const [countResult] = await q
      .clone()
      .count<Array<{ count: string }>>('* as count');

    const rows = await q
      .orderByRaw(
        "CASE state WHEN 'active' THEN 0 WHEN 'suggested' THEN 1 ELSE 2 END",
      )
      // id breaks created_at ties within a state; without it, pagination across
      // equal timestamps can skip or duplicate rows — and a seeded batch shares
      // timestamps, so ties are the norm rather than the exception here.
      .orderBy([
        { column: 'created_at', order: 'desc' },
        { column: 'id', order: 'desc' },
      ])
      .limit(limit)
      .offset(offset);

    return {
      items: rows.map(rowToRelationshipRule),
      total: Number(countResult.count),
    };
  }

  async listRelationshipRulesByDatasourceId(
    datasourceId: string,
    options?: { workspaceId?: string; state?: string },
  ): Promise<RelationshipRule[]> {
    const q = this.relationshipRuleTable()
      .where('workspace_id', options?.workspaceId ?? DEFAULT_WORKSPACE_ID)
      .where(function filterByDatasource() {
        this.where('source_datasource_id', datasourceId).orWhere(
          'target_datasource_id',
          datasourceId,
        );
      });
    if (options?.state) {
      q.andWhere('state', options.state);
    }
    const rows = await q;
    return rows.map(rowToRelationshipRule);
  }

  async listRelationshipRulesByDatasourceIds(
    datasourceIds: string[],
    options?: { workspaceId?: string; state?: string },
  ): Promise<RelationshipRule[]> {
    if (datasourceIds.length === 0) return [];
    const q = this.relationshipRuleTable()
      .where('workspace_id', options?.workspaceId ?? DEFAULT_WORKSPACE_ID)
      .where(function filterByDatasources() {
        this.whereIn('source_datasource_id', datasourceIds).orWhereIn(
          'target_datasource_id',
          datasourceIds,
        );
      });
    if (options?.state) {
      q.andWhere('state', options.state);
    }
    const rows = await q;
    return rows.map(rowToRelationshipRule);
  }

  async summarizeRules(workspaceId = DEFAULT_WORKSPACE_ID): Promise<{
    total: number;
    byState: Record<string, number>;
    byOrigin: Record<string, number>;
    byStateAndOrigin: Array<{ state: string; origin: string; count: number }>;
  }> {
    const [totalRow] = await this.relationshipRuleTable()
      .where('workspace_id', workspaceId)
      .count<Array<{ count: string | number }>>('* as count');
    const byStateRows = await this.relationshipRuleTable()
      .where('workspace_id', workspaceId)
      .select('state')
      .count<Array<{ state: string; count: string | number }>>('* as count')
      .groupBy('state');
    const byOriginRows = await this.relationshipRuleTable()
      .where('workspace_id', workspaceId)
      .select('origin')
      .count<Array<{ origin: string; count: string | number }>>('* as count')
      .groupBy('origin');
    const byStateAndOriginRows = await this.relationshipRuleTable()
      .where('workspace_id', workspaceId)
      .select('state', 'origin')
      .count<
        Array<{ state: string; origin: string; count: string | number }>
      >('* as count')
      .groupBy('state', 'origin');

    const byState: Record<string, number> = {};
    for (const row of byStateRows) {
      byState[row.state] = Number(row.count);
    }

    const byOrigin: Record<string, number> = {};
    for (const row of byOriginRows) {
      byOrigin[row.origin] = Number(row.count);
    }

    return {
      total: Number(totalRow.count),
      byState,
      byOrigin,
      byStateAndOrigin: byStateAndOriginRows.map(row => ({
        state: row.state,
        origin: row.origin,
        count: Number(row.count),
      })),
    };
  }
}
