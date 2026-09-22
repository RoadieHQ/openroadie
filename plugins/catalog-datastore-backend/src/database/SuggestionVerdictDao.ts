import type { Knex } from 'knex';
import { v4 as uuid } from 'uuid';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';
import { parseJsonColumn } from './json';

const SUGGESTION_VERDICT_TABLE_NAME = 'datastore_suggestion_verdict';
export type SuggestionVerdictAction = 'approve' | 'dismiss' | 'reset';

export interface SuggestionVerdictInput {
  ruleId: string;
  action: SuggestionVerdictAction;
  actor: string;
  score: number | null;
  confidenceBand: string | null;
  evidenceSummary: unknown | null;
  /** 0-based index of the suggestion within the confidence-filtered
   * per-direction list as shown to the user at verdict time. For resets of
   * dismissed suggestions, it is the index within the dismissed list.
   * `null` for bulk actions and inverse/derived verdicts. Load-bearing for
   * Stage 7 calibration — calibration will condition on presentation
   * rank. */
  rankShown: number | null;
}

export interface SuggestionVerdict extends SuggestionVerdictInput {
  id: string;
  createdAt: string;
}

interface SuggestionVerdictRow {
  id: string;
  workspace_id: string;
  rule_id: string;
  action: string;
  actor: string;
  score: number | null;
  confidence_band: string | null;
  evidence_summary: unknown | null;
  rank_shown: number | null;
  created_at: Date;
}

function rowToVerdict(row: SuggestionVerdictRow): SuggestionVerdict {
  return {
    id: row.id,
    ruleId: row.rule_id,
    action: row.action as SuggestionVerdictAction,
    actor: row.actor,
    score: row.score,
    confidenceBand: row.confidence_band,
    evidenceSummary: parseJsonColumn(row.evidence_summary),
    rankShown: row.rank_shown,
    createdAt: row.created_at.toISOString(),
  };
}

export class SuggestionVerdictDao {
  private readonly knex: Knex;

  constructor(options: { knex: Knex }) {
    this.knex = options.knex;
  }

  private table() {
    return this.knex<SuggestionVerdictRow>(SUGGESTION_VERDICT_TABLE_NAME);
  }

  async appendVerdict(
    input: SuggestionVerdictInput,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<SuggestionVerdict> {
    const [row] = await this.table()
      .insert({
        id: uuid(),
        workspace_id: workspaceId,
        rule_id: input.ruleId,
        action: input.action,
        actor: input.actor,
        score: input.score,
        confidence_band: input.confidenceBand,
        evidence_summary:
          input.evidenceSummary === null
            ? null
            : JSON.stringify(input.evidenceSummary),
        rank_shown: input.rankShown,
      })
      .returning('*');
    return rowToVerdict(row);
  }

  async listVerdicts(options?: {
    workspaceId?: string;
    ruleId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: SuggestionVerdict[]; total: number }> {
    const base = this.table()
      .where('workspace_id', options?.workspaceId ?? DEFAULT_WORKSPACE_ID)
      .modify(qb => {
        if (options?.ruleId) {
          qb.where({ rule_id: options.ruleId });
        }
      });
    const [{ count }] = await base.clone().count({ count: '*' });
    const rows = await base
      .clone()
      .orderBy('created_at', 'desc')
      .orderBy('id', 'asc')
      .limit(options?.limit ?? 100)
      .offset(options?.offset ?? 0);
    return { items: rows.map(rowToVerdict), total: Number(count) };
  }

  /**
   * Every verdict, in a stable total order (created_at, then id as the
   * uniqueness tiebreaker created_at lacks). The calibration fit reads the
   * whole log and must be reproducible run-to-run, so ordering cannot depend
   * on Postgres's unspecified tie behaviour. No pagination: the calibrator
   * needs all labels.
   */
  async listVerdictsForCalibration(
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<SuggestionVerdict[]> {
    const rows = await this.table()
      .where('workspace_id', workspaceId)
      .select('*')
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc');
    return rows.map(rowToVerdict);
  }
}
