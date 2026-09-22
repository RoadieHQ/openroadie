import type { Knex } from 'knex';
import { v4 as uuid } from 'uuid';
import { workspaceOwnershipFields } from '@roadiehq/workspaces-backend';

const TABLE = 'mcp_session_events';
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

interface SessionTelemetryRow {
  id: string;
  workspace_id: string;
  session_id: string;
  harness: string;
  event_type: string;
  customer_id: string | null;
  model: string | null;
  tool_name: string | null;
  prompt_id: string | null;
  agent_id: string | null;
  agent_type: string | null;
  payload: Record<string, unknown> | string | null;
  created_at: string;
}

export interface SessionTelemetryEvent {
  id: string;
  workspaceId: string;
  ownership: 'org' | 'workspace';
  sessionId: string;
  harness: string;
  eventType: string;
  customerId?: string;
  model?: string;
  toolName?: string;
  promptId?: string;
  agentId?: string;
  agentType?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface SessionTelemetryInsert {
  sessionId: string;
  harness: string;
  eventType: string;
  customerId?: string;
  model?: string;
  toolName?: string;
  promptId?: string;
  agentId?: string;
  agentType?: string;
  payload?: Record<string, unknown>;
}

export interface SessionTelemetryQueryParams {
  page: number;
  pageSize: number;
  harness: string;
  sessionId: string;
  eventType: string;
  customerId: string;
  model: string;
  from: string;
  to: string;
}

export interface SessionTelemetryFacets {
  harnesses: string[];
  eventTypes: string[];
  models: string[];
  users: string[];
  totalCount: number;
}

export class SessionTelemetryStore {
  private lastCleanup = 0;

  constructor(
    private readonly knex: Knex,
    private readonly retentionDays: number,
  ) {}

  async insert(
    event: SessionTelemetryInsert,
    workspaceId: string,
  ): Promise<void> {
    await this.knex(TABLE).insert({
      id: uuid(),
      workspace_id: workspaceId,
      session_id: event.sessionId,
      harness: event.harness,
      event_type: event.eventType,
      customer_id: event.customerId ?? null,
      model: event.model ?? null,
      tool_name: event.toolName ?? null,
      prompt_id: event.promptId ?? null,
      agent_id: event.agentId ?? null,
      agent_type: event.agentType ?? null,
      payload: event.payload ? JSON.stringify(event.payload) : null,
      created_at: new Date().toISOString(),
    });

    await this.maybeCleanup();
  }

  async query(
    params: SessionTelemetryQueryParams,
    workspaceId: string,
  ): Promise<{ items: SessionTelemetryEvent[]; totalCount: number }> {
    const filtered = () =>
      this.applyFilters(
        this.knex<SessionTelemetryRow>(TABLE),
        params,
        workspaceId,
      );

    const [{ count }] = await filtered().count('id as count');
    const totalCount = Number(count);

    const rows: SessionTelemetryRow[] = await filtered()
      .select('*')
      .orderBy('created_at', 'desc')
      .limit(params.pageSize)
      .offset(params.page * params.pageSize);

    return { items: rows.map(r => this.mapRow(r)), totalCount };
  }

  async queryBySession(
    sessionId: string,
    workspaceId: string,
  ): Promise<SessionTelemetryEvent[]> {
    const rows: SessionTelemetryRow[] = await this.knex<SessionTelemetryRow>(
      TABLE,
    )
      .where('workspace_id', workspaceId)
      .where('session_id', sessionId)
      .orderBy('created_at', 'asc');

    return rows.map(r => this.mapRow(r));
  }

  async facets(workspaceId: string): Promise<SessionTelemetryFacets> {
    const [harnesses, eventTypes, models, users, totalResult] =
      await Promise.all([
        this.knex<SessionTelemetryRow>(TABLE)
          .where('workspace_id', workspaceId)
          .distinct('harness')
          .orderBy('harness')
          .then(rows => rows.map(r => r.harness)),
        this.knex<SessionTelemetryRow>(TABLE)
          .where('workspace_id', workspaceId)
          .distinct('event_type')
          .orderBy('event_type')
          .then(rows => rows.map(r => r.event_type)),
        this.knex<SessionTelemetryRow>(TABLE)
          .where('workspace_id', workspaceId)
          .distinct('model')
          .whereNotNull('model')
          .orderBy('model')
          .then(rows => rows.map(r => r.model!)),
        this.knex<SessionTelemetryRow>(TABLE)
          .where('workspace_id', workspaceId)
          .distinct('customer_id')
          .whereNotNull('customer_id')
          .orderBy('customer_id')
          .then(rows => rows.map(r => r.customer_id!)),
        this.knex(TABLE)
          .where('workspace_id', workspaceId)
          .count('id as count')
          .first(),
      ]);

    return {
      harnesses,
      eventTypes,
      models,
      users,
      totalCount: Number(totalResult?.count ?? 0),
    };
  }

  private applyFilters(
    q: Knex.QueryBuilder,
    params: SessionTelemetryQueryParams,
    workspaceId: string,
  ): Knex.QueryBuilder {
    q = q.where('workspace_id', workspaceId);
    if (params.harness) q = q.where('harness', params.harness);
    if (params.sessionId) q = q.where('session_id', params.sessionId);
    if (params.eventType) q = q.where('event_type', params.eventType);
    if (params.customerId) q = q.where('customer_id', params.customerId);
    if (params.model) q = q.where('model', params.model);
    if (params.from) q = q.where('created_at', '>=', params.from);
    if (params.to) q = q.where('created_at', '<=', params.to);
    return q;
  }

  private mapRow(row: SessionTelemetryRow): SessionTelemetryEvent {
    let payload: Record<string, unknown> | undefined;
    if (row.payload != null) {
      payload =
        typeof row.payload === 'string'
          ? (JSON.parse(row.payload) as Record<string, unknown>)
          : row.payload;
    }

    return {
      id: row.id,
      ...workspaceOwnershipFields(row.workspace_id),
      sessionId: row.session_id,
      harness: row.harness,
      eventType: row.event_type,
      customerId: row.customer_id ?? undefined,
      model: row.model ?? undefined,
      toolName: row.tool_name ?? undefined,
      promptId: row.prompt_id ?? undefined,
      agentId: row.agent_id ?? undefined,
      agentType: row.agent_type ?? undefined,
      payload,
      createdAt: row.created_at,
    };
  }

  private async maybeCleanup(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCleanup < CLEANUP_INTERVAL_MS) return;
    this.lastCleanup = now;

    const cutoff = new Date(
      now - this.retentionDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    await this.knex(TABLE).where('created_at', '<', cutoff).del();
  }
}
