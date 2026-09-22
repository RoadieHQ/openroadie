/*
 * Copyright 2025 Larder Software Limited
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

import { Knex } from 'knex';
import { v4 as uuid } from 'uuid';
import { DateTime } from 'luxon';
import { NotFoundError, ConflictError, InputError } from '@roadiehq/errors';
import { SLUG_RE } from '@roadiehq/scopes-common';
import { LoggerService } from '@roadiehq/extensions-api';
import {
  DEFAULT_WORKSPACE_ID,
  workspaceOwnershipFields,
} from '@roadiehq/workspaces-backend';
import {
  WorkflowDefinition,
  CreateWorkflowInput,
  UpdateWorkflowInput,
  WorkflowNode,
  WorkflowType,
  isWorkflowType,
} from '@roadiehq/catalog-workflow-common';
import { WorkflowRow } from './types';
import {
  parseJsonValue,
  isWorkflowNodeArray,
  isWorkflowEdgeArray,
  isWorkflowViewport,
} from './validation';

const TABLE_NAME = 'catalog_workflows';
/** Derive a URL-safe slug from a name, matching the shared `SLUG_RE`. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Node fields that describe where a node sits on the canvas rather than what it
 * does. They are owned by whoever last opened the graph editor, not by whoever
 * last wrote the workflow's configuration.
 */
const PRESENTATIONAL_NODE_KEYS = ['position', 'width', 'height'] as const;

/**
 * Carry a node's canvas placement across a write that omits it.
 *
 * `nodes` is a whole-array replacement, so a client that only cares about the
 * semantic graph — a config-management tool reading its desired state out of
 * version control — cannot express "leave the layout alone" by omitting a key
 * the way it can for `viewport`. Without this, every such write would reset the
 * canvas to the origin, and conversely every drag in the UI would look like a
 * configuration change to that client.
 *
 * A node with no counterpart in `existing` is new and gets the origin; the
 * editor assigns it a real position the first time a human opens the graph.
 */
function preserveNodeLayout(
  incoming: WorkflowNode[],
  existing: WorkflowNode[],
): WorkflowNode[] {
  const existingById = new Map(existing.map(node => [node.id, node]));
  return incoming.map(node => {
    const previous = existingById.get(node.id);
    const merged: WorkflowNode = { ...node };
    for (const key of PRESENTATIONAL_NODE_KEYS) {
      if (
        merged[`${key}`] === undefined &&
        previous?.[`${key}`] !== undefined
      ) {
        // Same key on both sides of the assignment, so the union of their value
        // types is the field's own type.
        Object.assign(merged, { [key]: previous[`${key}`] });
      }
    }
    merged.position ??= { x: 0, y: 0 };
    return merged;
  });
}

function rowToWorkflow(row: WorkflowRow): WorkflowDefinition {
  const nodes = parseJsonValue(row.nodes);
  const edges = parseJsonValue(row.edges);
  const viewport = parseJsonValue(row.viewport);
  const workflowType = row.workflow_type;

  if (!isWorkflowNodeArray(nodes)) {
    throw new Error(`Invalid nodes data for workflow ${row.id}`);
  }
  if (!isWorkflowEdgeArray(edges)) {
    throw new Error(`Invalid edges data for workflow ${row.id}`);
  }
  if (viewport !== undefined && !isWorkflowViewport(viewport)) {
    throw new Error(`Invalid viewport data for workflow ${row.id}`);
  }
  if (!isWorkflowType(workflowType)) {
    throw new Error(
      `Invalid workflow type for workflow ${row.id}: ${workflowType}`,
    );
  }

  return {
    id: row.id,
    ...workspaceOwnershipFields(row.workspace_id ?? DEFAULT_WORKSPACE_ID),
    name: row.name,
    slug: row.slug,
    description: row.description ?? undefined,
    workflowType,
    nodes,
    edges,
    viewport,
    enabled: row.enabled,
    version: row.version,
    createdBy: row.created_by,
    createdAt: DateTime.fromJSDate(row.created_at).toISO()!,
    updatedAt: DateTime.fromJSDate(row.updated_at).toISO()!,
  };
}

export class WorkflowDao {
  private readonly knex: Knex;
  private readonly logger: LoggerService;

  constructor(options: { knex: Knex; logger: LoggerService }) {
    this.knex = options.knex;
    this.logger = options.logger.child({ name: 'WorkflowDao' });
  }

  private table(trx?: Knex | Knex.Transaction) {
    return (trx || this.knex)<WorkflowRow>(TABLE_NAME);
  }

  /**
   * Data sources with a node configured against `integrationId`.
   *
   * Backs the integration delete guard. Deliberately unfiltered by `enabled`:
   * a disabled data source still holds the reference and would break the
   * moment it were re-enabled.
   */
  async findByIntegrationId(
    integrationId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Array<{ id: string; name: string; slug: string }>> {
    return this.table()
      .where('workspace_id', workspaceId)
      .whereRaw(
        `exists (
           select 1 from jsonb_array_elements(nodes) as node
           where node -> 'data' -> 'config' ->> 'integrationId' = ?
         )`,
        [integrationId],
      )
      .orderBy('name', 'asc')
      .select('id', 'name', 'slug');
  }

  async list(options?: {
    enabled?: boolean;
    search?: string;
    limit?: number;
    offset?: number;
    workflowType?: WorkflowType;
    workspaceId?: string;
  }): Promise<{ workflows: WorkflowDefinition[]; total: number }> {
    const {
      enabled,
      search,
      limit = 50,
      offset = 0,
      workflowType,
      workspaceId,
    } = options ?? {};

    let query = this.table();

    if (workspaceId !== undefined) {
      query = query.where('workspace_id', workspaceId);
    }

    if (enabled !== undefined) {
      query = query.where('enabled', enabled);
    }

    if (workflowType !== undefined) {
      query = query.where('workflow_type', workflowType);
    }

    if (search) {
      const sanitized = search.replace(/[%_\\]/g, '\\$&');
      query = query.where(builder => {
        builder
          .whereILike('name', `%${sanitized}%`)
          .orWhereILike('description', `%${sanitized}%`);
      });
    }

    const countResult = await query
      .clone()
      .count<{ count: string | number }[]>('id as count');
    const total = Number(countResult[0]?.count ?? 0);

    // id breaks updated_at ties; without it, pagination across equal
    // timestamps can skip or duplicate rows.
    const rows = await query
      .orderBy([
        { column: 'updated_at', order: 'desc' },
        { column: 'id', order: 'desc' },
      ])
      .limit(limit)
      .offset(offset);

    return {
      workflows: rows.map(rowToWorkflow),
      total,
    };
  }

  async listAcrossWorkspaces(options?: {
    enabled?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ workflows: WorkflowDefinition[]; total: number }> {
    const { enabled, limit = 50, offset = 0 } = options ?? {};
    let query = this.table();
    if (enabled !== undefined) {
      query = query.where('enabled', enabled);
    }
    const countResult = await query
      .clone()
      .count<{ count: string | number }[]>('id as count');
    const total = Number(countResult[0]?.count ?? 0);
    const rows = await query
      .orderBy([
        { column: 'updated_at', order: 'desc' },
        { column: 'id', order: 'desc' },
      ])
      .limit(limit)
      .offset(offset);
    return { workflows: rows.map(rowToWorkflow), total };
  }

  async getById(
    id: string,
    trx?: Knex | Knex.Transaction,
    workspaceId?: string,
  ): Promise<WorkflowDefinition> {
    let query = this.table(trx).where({ id });
    if (workspaceId !== undefined) {
      query = query.where('workspace_id', workspaceId);
    }
    const row = await query.first();

    if (!row) {
      throw new NotFoundError(`Workflow not found: ${id}`);
    }

    return rowToWorkflow(row);
  }

  async getByName(
    name: string,
    trx?: Knex | Knex.Transaction,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<WorkflowDefinition | undefined> {
    const row = await this.table(trx)
      .where({ name, workspace_id: workspaceId })
      .first();
    return row ? rowToWorkflow(row) : undefined;
  }

  async getBySlug(
    slug: string,
    trx?: Knex | Knex.Transaction,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<WorkflowDefinition | undefined> {
    const row = await this.table(trx)
      .where({ slug, workspace_id: workspaceId })
      .first();
    return row ? rowToWorkflow(row) : undefined;
  }

  async create(
    input: CreateWorkflowInput,
    trx?: Knex | Knex.Transaction,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<WorkflowDefinition> {
    const id = input.id ?? uuid();
    const now = new Date();

    const existing = await this.getByName(input.name, trx, workspaceId);
    if (existing) {
      throw new ConflictError(
        `Workflow with name "${input.name}" already exists`,
      );
    }

    const slug = input.slug?.trim() || slugify(input.name);
    if (!slug) {
      throw new InputError(
        `Could not derive a slug from workflow name "${input.name}"; provide a slug`,
      );
    }
    // A slug that doesn't match the grammar can never be `@datasource:`-referenced,
    // so it is malformed input rather than a conflict.
    if (!SLUG_RE.test(slug)) {
      throw new InputError(
        `Invalid slug "${slug}": use lowercase letters, numbers and single hyphens`,
      );
    }
    const slugConflict = await this.getBySlug(slug, trx, workspaceId);
    if (slugConflict) {
      throw new ConflictError(`Workflow with slug "${slug}" already exists`);
    }

    const row: WorkflowRow = {
      id,
      workspace_id: workspaceId,
      name: input.name,
      slug,
      description: input.description ?? null,
      workflow_type: input.workflowType,
      nodes: JSON.stringify(input.nodes),
      edges: JSON.stringify(input.edges),
      viewport: input.viewport ? JSON.stringify(input.viewport) : null,
      enabled: input.enabled ?? false,
      version: 1,
      created_by: input.createdBy,
      created_at: now,
      updated_at: now,
    };

    await this.table(trx).insert(row);
    this.logger.info(`Created workflow: ${input.name} (${id})`);

    return this.getById(id, trx, workspaceId);
  }

  async update(
    id: string,
    input: UpdateWorkflowInput,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<WorkflowDefinition> {
    return this.knex.transaction(async trx => {
      const row = await this.table(trx)
        .where({ id, workspace_id: workspaceId })
        .forUpdate()
        .first();

      if (!row) {
        throw new NotFoundError(`Workflow not found: ${id}`);
      }

      const existing = rowToWorkflow(row);

      if (input.name && input.name !== existing.name) {
        const nameConflict = await this.table(trx)
          .where({ name: input.name, workspace_id: workspaceId })
          .first();
        if (nameConflict) {
          throw new ConflictError(
            `Workflow with name "${input.name}" already exists`,
          );
        }
      }

      // The slug only changes when an explicit, non-empty slug is supplied — a
      // rename never silently re-slugs, so existing @-references stay valid.
      let nextSlug: string | undefined;
      if (input.slug !== undefined) {
        nextSlug = input.slug.trim();
        if (!nextSlug) {
          throw new InputError('Workflow slug cannot be empty');
        }
        if (!SLUG_RE.test(nextSlug)) {
          throw new InputError(
            `Invalid slug "${nextSlug}": use lowercase letters, numbers and single hyphens`,
          );
        }
        if (nextSlug !== existing.slug) {
          const slugConflict = await this.table(trx)
            .where({ slug: nextSlug, workspace_id: workspaceId })
            .first();
          if (slugConflict) {
            throw new ConflictError(
              `Workflow with slug "${nextSlug}" already exists`,
            );
          }
        }
      }

      const updates: Partial<WorkflowRow> = {
        updated_at: new Date(),
        version: existing.version + 1,
      };

      if (input.name !== undefined) {
        updates.name = input.name;
      }
      if (nextSlug !== undefined) {
        updates.slug = nextSlug;
      }
      if (input.description !== undefined) {
        updates.description = input.description;
      }
      if (input.workflowType !== undefined) {
        updates.workflow_type = input.workflowType;
      }
      if (input.nodes !== undefined) {
        updates.nodes = JSON.stringify(
          preserveNodeLayout(input.nodes, existing.nodes),
        );
      }
      if (input.edges !== undefined) {
        updates.edges = JSON.stringify(input.edges);
      }
      if (input.viewport !== undefined) {
        updates.viewport = input.viewport
          ? JSON.stringify(input.viewport)
          : null;
      }
      if (input.enabled !== undefined) {
        updates.enabled = input.enabled;
      }

      await this.table(trx)
        .where({ id, workspace_id: workspaceId })
        .update(updates);
      this.logger.info(
        `Updated workflow: ${existing.name} (${id}), version ${updates.version}`,
      );

      const updated = await this.table(trx)
        .where({ id, workspace_id: workspaceId })
        .first();
      return rowToWorkflow(updated!);
    });
  }

  async delete(id: string, workspaceId = DEFAULT_WORKSPACE_ID): Promise<void> {
    const workflow = await this.getById(id, undefined, workspaceId);
    await this.table().where({ id, workspace_id: workspaceId }).delete();
    this.logger.info(`Deleted workflow: ${workflow.name} (${id})`);
  }
}
