import type { Knex } from 'knex';
import { v4 as uuid, validate as isUuid } from 'uuid';
import type {
  CapabilityRow,
  Capability,
  CapabilityVersionRow,
  CapabilityVersion,
} from './types';
import {
  DEFAULT_WORKSPACE_ID,
  workspaceOwnershipFields,
} from '@roadiehq/workspaces-backend';

const CAPABILITIES_TABLE = 'capabilities';
const CAPABILITIES_VERSION_TABLE = 'capabilities_version';

/** Escape LIKE/ILIKE metacharacters so a query is matched literally. */
function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function rowToCapability(row: CapabilityRow): Capability {
  return {
    id: row.id,
    ...workspaceOwnershipFields(row.workspace_id),
    slug: row.slug,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    currentVersion: row.current_version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function rowToCapabilityVersion(row: CapabilityVersionRow): CapabilityVersion {
  return {
    id: row.id,
    capabilityId: row.capability_id,
    ...workspaceOwnershipFields(row.workspace_id),
    slug: row.slug,
    version: row.version,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    createdAt: row.created_at.toISOString(),
  };
}

export class CapabilityDao {
  private readonly knex: Knex;

  constructor(options: { knex: Knex }) {
    this.knex = options.knex;
  }

  private table(trx?: Knex) {
    return (trx || this.knex)<CapabilityRow>(CAPABILITIES_TABLE);
  }

  private versionTable(trx?: Knex) {
    return (trx || this.knex)<CapabilityVersionRow>(CAPABILITIES_VERSION_TABLE);
  }

  async create(
    name: string,
    description: string,
    instructions: string,
    slug: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Capability> {
    return this.knex.transaction(async trx => {
      const capabilityId = uuid();
      const now = new Date();

      const [capabilityRow] = await this.table(trx)
        .insert({
          id: capabilityId,
          workspace_id: workspaceId,
          slug,
          name,
          description,
          instructions,
          current_version: 1,
          created_at: now,
          updated_at: now,
        })
        .returning('*');

      await this.versionTable(trx).insert({
        id: uuid(),
        capability_id: capabilityId,
        workspace_id: workspaceId,
        slug,
        version: 1,
        name,
        description,
        instructions,
        created_at: now,
      });

      return rowToCapability(capabilityRow);
    });
  }

  async list(options?: {
    limit?: number;
    offset?: number;
    /**
     * Restrict to capabilities the caller may see, by slug or id. `undefined`
     * means no restriction; an empty list matches nothing.
     */
    allowedIdentifiers?: string[];
    workspaceId?: string;
  }): Promise<{ items: Capability[]; total: number }> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const allowedIdentifiers = options?.allowedIdentifiers;
    const workspaceId = options?.workspaceId ?? DEFAULT_WORKSPACE_ID;

    const applyFilters = (qb: Knex.QueryBuilder) => {
      qb.where('workspace_id', workspaceId);
      if (allowedIdentifiers) {
        // Match by slug (text) or id, but only pass uuids to the id column so
        // Postgres never tries to cast a non-uuid slug to `uuid`.
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
      items: rows.map(rowToCapability),
      total: Number(countResult.count),
    };
  }

  async get(
    id: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Capability | undefined> {
    const row = await this.table()
      .where({ id, workspace_id: workspaceId })
      .first();
    return row ? rowToCapability(row) : undefined;
  }

  async getBySlug(
    slug: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Capability | undefined> {
    const row = await this.table()
      .where({ slug, workspace_id: workspaceId })
      .first();
    return row ? rowToCapability(row) : undefined;
  }

  /** Resolve by id (only when it looks like a uuid) first, then by slug. */
  async getByIdOrSlug(
    idOrSlug: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Capability | undefined> {
    if (isUuid(idOrSlug)) {
      const byId = await this.get(idOrSlug, workspaceId);
      if (byId) {
        return byId;
      }
    }
    return this.getBySlug(idOrSlug, workspaceId);
  }

  /**
   * Trigram search across a capability's slug, name, description and
   * instructions. Uses `pg_trgm`-indexed `ILIKE` for substring matching and
   * ranks results by the greatest `similarity()` of the query to any field.
   */
  async search(
    query: string,
    options?: {
      limit?: number;
      offset?: number;
      allowedIdentifiers?: string[];
      workspaceId?: string;
    },
  ): Promise<{ items: Capability[]; total: number }> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const allowedIdentifiers = options?.allowedIdentifiers;
    const workspaceId = options?.workspaceId ?? DEFAULT_WORKSPACE_ID;
    const q = query.trim();
    if (!q) {
      return { items: [], total: 0 };
    }

    const pattern = `%${escapeIlike(q)}%`;

    const rows = await this.table()
      .select('*')
      .select(
        this.knex.raw(
          `GREATEST(similarity(slug, ?), similarity(name, ?), similarity(description, ?), similarity(instructions, ?)) as rank`,
          [q, q, q, q],
        ),
        this.knex.raw(`count(*) OVER() as total_count`),
      )
      .where('workspace_id', workspaceId)
      .andWhere(builder =>
        builder
          .whereRaw(`slug ILIKE ?`, [pattern])
          .orWhereRaw(`name ILIKE ?`, [pattern])
          .orWhereRaw(`description ILIKE ?`, [pattern])
          .orWhereRaw(`instructions ILIKE ?`, [pattern]),
      )
      .modify(qb => {
        if (allowedIdentifiers) {
          const ids = allowedIdentifiers.filter(isUuid);
          qb.where(inner => {
            inner.whereIn('slug', allowedIdentifiers);
            if (ids.length) {
              inner.orWhereIn('id', ids);
            }
          });
        }
      })
      .orderByRaw(`rank desc, updated_at desc, id desc`)
      .limit(limit)
      .offset(offset);

    const total =
      rows.length > 0
        ? Number(
            (rows[0] as CapabilityRow & { total_count: string }).total_count,
          )
        : 0;

    return {
      items: rows.map(rowToCapability),
      total,
    };
  }

  async update(
    id: string,
    updates: {
      name?: string;
      slug?: string;
      description?: string;
      instructions?: string;
    },
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Capability | undefined> {
    return this.knex.transaction(async trx => {
      const existingCapability = await this.table(trx)
        .where({ id, workspace_id: workspaceId })
        .first();
      if (!existingCapability) {
        return undefined;
      }

      const newVersion = existingCapability.current_version + 1;
      const newName = updates.name ?? existingCapability.name;
      const newSlug = updates.slug ?? existingCapability.slug;
      const newDescription =
        updates.description ?? existingCapability.description;
      const newInstructions =
        updates.instructions ?? existingCapability.instructions;
      const now = new Date();

      const [updatedRow] = await this.table(trx)
        .where({ id, workspace_id: workspaceId })
        .update({
          name: newName,
          slug: newSlug,
          description: newDescription,
          instructions: newInstructions,
          current_version: newVersion,
          updated_at: now,
        })
        .returning('*');

      await this.versionTable(trx).insert({
        id: uuid(),
        capability_id: id,
        workspace_id: workspaceId,
        slug: newSlug,
        version: newVersion,
        name: newName,
        description: newDescription,
        instructions: newInstructions,
        created_at: now,
      });

      return rowToCapability(updatedRow);
    });
  }

  async delete(
    id: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<number> {
    return await this.table().where({ id, workspace_id: workspaceId }).delete();
  }

  async listVersions(
    capabilityId: string,
    options?: { limit?: number; offset?: number; workspaceId?: string },
  ): Promise<{ items: CapabilityVersion[]; total: number }> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const workspaceId = options?.workspaceId ?? DEFAULT_WORKSPACE_ID;

    const [countResult] = await this.versionTable()
      .where({ capability_id: capabilityId, workspace_id: workspaceId })
      .count<Array<{ count: string }>>('* as count');

    const rows = await this.versionTable()
      .where({ capability_id: capabilityId, workspace_id: workspaceId })
      .orderBy('version', 'desc')
      .limit(limit)
      .offset(offset);

    return {
      items: rows.map(rowToCapabilityVersion),
      total: Number(countResult.count),
    };
  }

  async getVersion(
    capabilityId: string,
    version: number,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<CapabilityVersion | undefined> {
    const row = await this.versionTable()
      .where('capability_id', capabilityId)
      .andWhere('workspace_id', workspaceId)
      .andWhere('version', version)
      .first();
    return row ? rowToCapabilityVersion(row) : undefined;
  }

  async restoreVersion(
    capabilityId: string,
    version: number,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Capability | undefined> {
    return this.knex.transaction(async trx => {
      const versionToRestore = await this.versionTable(trx)
        .where('capability_id', capabilityId)
        .andWhere('workspace_id', workspaceId)
        .andWhere('version', version)
        .first();

      if (!versionToRestore) {
        return undefined;
      }

      const existingCapability = await this.table(trx)
        .where({ id: capabilityId, workspace_id: workspaceId })
        .first();
      if (!existingCapability) {
        return undefined;
      }

      const newVersion = existingCapability.current_version + 1;
      const now = new Date();
      // Keep the current live slug (NOT the snapshot's) so a restore can never
      // resurrect a stale, colliding slug — mirrors actions.
      const slug = existingCapability.slug;

      const [updatedRow] = await this.table(trx)
        .where({ id: capabilityId, workspace_id: workspaceId })
        .update({
          name: versionToRestore.name,
          slug,
          description: versionToRestore.description,
          instructions: versionToRestore.instructions,
          current_version: newVersion,
          updated_at: now,
        })
        .returning('*');

      await this.versionTable(trx).insert({
        id: uuid(),
        capability_id: capabilityId,
        workspace_id: workspaceId,
        slug,
        version: newVersion,
        name: versionToRestore.name,
        description: versionToRestore.description,
        instructions: versionToRestore.instructions,
        created_at: now,
      });

      return rowToCapability(updatedRow);
    });
  }
}
