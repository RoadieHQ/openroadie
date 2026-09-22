import type { Knex } from 'knex';
import { v4 as uuid, validate as isUuid } from 'uuid';
import type {
  Action,
  ActionParam,
  ActionStep,
  ActionVersion,
} from '@roadiehq/actions-common';
import {
  ActionRow,
  ActionVersionRow,
  rowToAction,
  rowToActionVersion,
} from './types';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';

const ACTIONS_TABLE = 'actions';
const ACTIONS_VERSION_TABLE = 'actions_version';

/** The editable, versioned fields of an action. */
export interface ActionFields {
  name: string;
  slug: string;
  description: string;
  parameters: ActionParam[];
  steps: ActionStep[];
  enabled: boolean;
}

/** Build the snake_case column values for the `actions` row, serialising jsonb. */
function actionColumns(fields: ActionFields) {
  return {
    name: fields.name,
    slug: fields.slug,
    description: fields.description,
    parameters: JSON.stringify(fields.parameters),
    steps: JSON.stringify(fields.steps),
    enabled: fields.enabled,
  };
}

export class ActionDao {
  private readonly knex: Knex;

  constructor(options: { knex: Knex }) {
    this.knex = options.knex;
  }

  private table(trx?: Knex) {
    return (trx || this.knex)<ActionRow>(ACTIONS_TABLE);
  }

  private versionTable(trx?: Knex) {
    return (trx || this.knex)<ActionVersionRow>(ACTIONS_VERSION_TABLE);
  }

  /**
   * Actions with a step configured against `integrationId`.
   *
   * Backs the integration delete guard. Integrations are workspace-scoped, so
   * the guard checks every action in the integration's owning workspace.
   */
  async findByIntegrationId(
    integrationId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Array<{ id: string; name: string; slug: string }>> {
    return this.table()
      .where('workspace_id', workspaceId)
      .whereRaw('steps @> ?::jsonb', [JSON.stringify([{ integrationId }])])
      .orderBy('name', 'asc')
      .select('id', 'name', 'slug');
  }

  async create(
    fields: ActionFields,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Action> {
    return this.knex.transaction(async trx => {
      const actionId = uuid();
      const now = new Date();
      const columns = actionColumns(fields);

      const [actionRow] = await this.table(trx)
        .insert({
          id: actionId,
          workspace_id: workspaceId,
          ...columns,
          current_version: 1,
          created_at: now,
          updated_at: now,
        })
        .returning('*');

      await this.versionTable(trx).insert({
        id: uuid(),
        action_id: actionId,
        workspace_id: workspaceId,
        version: 1,
        ...columns,
        created_at: now,
      });

      return rowToAction(actionRow);
    });
  }

  async list(options?: {
    search?: string;
    limit?: number;
    offset?: number;
    /**
     * Restrict results to actions the caller may see, by slug or id. `undefined`
     * means no restriction (the caller holds the un-narrowed `action:query`);
     * an explicit list keeps only actions whose slug or id is in it. An empty
     * list therefore matches nothing.
     */
    allowedIdentifiers?: string[];
    workspaceId?: string;
  }): Promise<{ items: Action[]; total: number }> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const search = options?.search?.trim();
    const allowedIdentifiers = options?.allowedIdentifiers;
    const workspaceId = options?.workspaceId ?? DEFAULT_WORKSPACE_ID;

    const applyFilters = (qb: Knex.QueryBuilder) => {
      qb.where('workspace_id', workspaceId);
      if (search) {
        const like = `%${search}%`;
        qb.where(inner =>
          inner.whereILike('name', like).orWhereILike('slug', like),
        );
      }
      if (allowedIdentifiers) {
        // Match by slug (text) or id, but only pass uuids to the id column so
        // Postgres never tries to cast a non-uuid slug to `uuid` (a hard error).
        const ids = allowedIdentifiers.filter(isUuid);
        qb.where(inner => {
          inner.whereIn('slug', allowedIdentifiers);
          if (ids.length) {
            inner.orWhereIn('id', ids);
          }
        });
      }
      return qb;
    };

    const [countResult] = await applyFilters(this.table()).count<
      Array<{ count: string }>
    >('* as count');

    // id breaks updated_at ties; without it, pagination across equal
    // timestamps can skip or duplicate rows.
    const rows = await applyFilters(this.table())
      .orderBy([
        { column: 'updated_at', order: 'desc' },
        { column: 'id', order: 'desc' },
      ])
      .limit(limit)
      .offset(offset);

    return {
      items: rows.map(rowToAction),
      total: Number(countResult.count),
    };
  }

  async get(
    id: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Action | undefined> {
    const row = await this.table()
      .where({ id, workspace_id: workspaceId })
      .first();
    return row ? rowToAction(row) : undefined;
  }

  async getBySlug(
    slug: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Action | undefined> {
    const row = await this.table()
      .where({ slug, workspace_id: workspaceId })
      .first();
    return row ? rowToAction(row) : undefined;
  }

  /** Resolve by id (only when it looks like a uuid) first, then by slug. */
  async getByIdOrSlug(
    idOrSlug: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Action | undefined> {
    if (isUuid(idOrSlug)) {
      const byId = await this.get(idOrSlug, workspaceId);
      if (byId) {
        return byId;
      }
    }
    return this.getBySlug(idOrSlug, workspaceId);
  }

  /**
   * Update an action. Every call bumps `current_version` and writes a snapshot
   * (unconditionally — including slug-only edits), mirroring capabilities.
   */
  async update(
    id: string,
    updates: Partial<ActionFields>,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Action | undefined> {
    return this.knex.transaction(async trx => {
      const existing = await this.table(trx)
        .where({ id, workspace_id: workspaceId })
        .first();
      if (!existing) {
        return undefined;
      }

      const merged: ActionFields = {
        name: updates.name ?? existing.name,
        slug: updates.slug ?? existing.slug,
        description: updates.description ?? existing.description,
        parameters:
          updates.parameters ??
          (typeof existing.parameters === 'string'
            ? JSON.parse(existing.parameters)
            : (existing.parameters as ActionParam[])),
        steps:
          updates.steps ??
          (typeof existing.steps === 'string'
            ? JSON.parse(existing.steps)
            : (existing.steps as ActionStep[])),
        enabled: updates.enabled ?? existing.enabled,
      };

      const newVersion = existing.current_version + 1;
      const now = new Date();
      const columns = actionColumns(merged);

      const [updatedRow] = await this.table(trx)
        .where({ id, workspace_id: workspaceId })
        .update({ ...columns, current_version: newVersion, updated_at: now })
        .returning('*');

      await this.versionTable(trx).insert({
        id: uuid(),
        action_id: id,
        workspace_id: workspaceId,
        version: newVersion,
        ...columns,
        created_at: now,
      });

      return rowToAction(updatedRow);
    });
  }

  async delete(
    id: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<number> {
    return await this.table().where({ id, workspace_id: workspaceId }).delete();
  }

  async listVersions(
    actionId: string,
    options?: { limit?: number; offset?: number; workspaceId?: string },
  ): Promise<{ items: ActionVersion[]; total: number }> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const workspaceId = options?.workspaceId ?? DEFAULT_WORKSPACE_ID;

    const [countResult] = await this.versionTable()
      .where({ action_id: actionId, workspace_id: workspaceId })
      .count<Array<{ count: string }>>('* as count');

    const rows = await this.versionTable()
      .where({ action_id: actionId, workspace_id: workspaceId })
      .orderBy('version', 'desc')
      .limit(limit)
      .offset(offset);

    return {
      items: rows.map(rowToActionVersion),
      total: Number(countResult.count),
    };
  }

  async getVersion(
    actionId: string,
    version: number,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<ActionVersion | undefined> {
    const row = await this.versionTable()
      .where('action_id', actionId)
      .andWhere('workspace_id', workspaceId)
      .andWhere('version', version)
      .first();
    return row ? rowToActionVersion(row) : undefined;
  }

  /**
   * Restore an action to a prior version's content. Forward-only: creates a new
   * version. The live `slug` is intentionally preserved (NOT taken from the
   * snapshot) so a restore can never resurrect a stale, colliding slug.
   */
  async restoreVersion(
    actionId: string,
    version: number,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Action | undefined> {
    return this.knex.transaction(async trx => {
      const snapshot = await this.versionTable(trx)
        .where('action_id', actionId)
        .andWhere('workspace_id', workspaceId)
        .andWhere('version', version)
        .first();
      if (!snapshot) {
        return undefined;
      }

      const existing = await this.table(trx)
        .where({ id: actionId, workspace_id: workspaceId })
        .first();
      if (!existing) {
        return undefined;
      }

      const restored: ActionFields = {
        ...rowToActionVersion(snapshot),
        slug: existing.slug, // keep current live slug
      };

      const newVersion = existing.current_version + 1;
      const now = new Date();
      const columns = actionColumns(restored);

      const [updatedRow] = await this.table(trx)
        .where({ id: actionId, workspace_id: workspaceId })
        .update({ ...columns, current_version: newVersion, updated_at: now })
        .returning('*');

      await this.versionTable(trx).insert({
        id: uuid(),
        action_id: actionId,
        workspace_id: workspaceId,
        version: newVersion,
        ...columns,
        created_at: now,
      });

      return rowToAction(updatedRow);
    });
  }
}
