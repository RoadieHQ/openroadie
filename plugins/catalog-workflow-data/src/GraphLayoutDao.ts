import { Knex } from 'knex';
import { LoggerService } from '@roadiehq/extensions-api';
import { GraphLayoutRow } from './types';
import { parseJsonValue } from './validation';
import {
  DEFAULT_WORKSPACE_ID,
  workspaceOwnershipFields,
} from '@roadiehq/workspaces-backend';

const TABLE_NAME = 'catalog_workflow_graph_layouts';
function jsonStringify(value: unknown): string {
  return JSON.stringify(value);
}

export interface GraphLayoutNode {
  id: string;
  datasourceId: string;
  position: { x: number; y: number };
}

export interface GraphLayoutEdge {
  id: string;
  ruleId: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface GraphLayout {
  id: string;
  workspaceId: string;
  ownership: 'org' | 'workspace';
  name: string;
  nodes: GraphLayoutNode[];
  edges: GraphLayoutEdge[];
  viewport: { x: number; y: number; zoom: number } | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToLayout(row: GraphLayoutRow): GraphLayout {
  return {
    id: row.id,
    ...workspaceOwnershipFields(row.workspace_id),
    name: row.name,
    nodes: parseJsonValue<GraphLayoutNode[]>(row.nodes) ?? [],
    edges: parseJsonValue<GraphLayoutEdge[]>(row.edges) ?? [],
    viewport:
      parseJsonValue<{ x: number; y: number; zoom: number }>(row.viewport) ??
      null,
    updatedBy: row.updated_by,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export class GraphLayoutDao {
  private readonly knex: Knex;
  private readonly logger: LoggerService;

  constructor(options: { knex: Knex; logger: LoggerService }) {
    this.knex = options.knex;
    this.logger = options.logger.child({ name: 'GraphLayoutDao' });
  }

  private table(trx?: Knex) {
    return (trx || this.knex)<GraphLayoutRow>(TABLE_NAME);
  }

  async list(workspaceId = DEFAULT_WORKSPACE_ID): Promise<GraphLayout[]> {
    const rows = await this.table()
      .where('workspace_id', workspaceId)
      .select('*')
      .orderBy('name');
    return rows.map(rowToLayout);
  }

  async getByName(
    name: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<GraphLayout | undefined> {
    const row = await this.table()
      .where({ name, workspace_id: workspaceId })
      .first();
    return row ? rowToLayout(row) : undefined;
  }

  async upsert(
    name: string,
    input: {
      nodes?: GraphLayoutNode[];
      edges?: GraphLayoutEdge[];
      viewport?: { x: number; y: number; zoom: number } | null;
      updatedBy?: string;
    },
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<GraphLayout> {
    const now = new Date();
    const data: Record<string, unknown> = {
      name,
      workspace_id: workspaceId,
      updated_at: now,
    };
    if (input.nodes !== undefined) {
      data.nodes = jsonStringify(input.nodes);
    }
    if (input.edges !== undefined) {
      data.edges = jsonStringify(input.edges);
    }
    if (input.viewport !== undefined) {
      data.viewport = input.viewport ? jsonStringify(input.viewport) : null;
    }
    if (input.updatedBy !== undefined) {
      data.updated_by = input.updatedBy;
    }

    const row: Omit<GraphLayoutRow, 'id'> = {
      name,
      workspace_id: workspaceId,
      nodes: jsonStringify(input.nodes ?? []),
      edges: jsonStringify(input.edges ?? []),
      viewport: input.viewport ? jsonStringify(input.viewport) : null,
      updated_by: input.updatedBy ?? null,
      created_at: now,
      updated_at: now,
    };

    await this.table()
      .insert(row)
      .onConflict(['workspace_id', 'name'])
      .merge(data);

    const result = await this.getByName(name, workspaceId);
    if (!result) {
      throw new Error(`Failed to upsert graph layout: ${name}`);
    }
    this.logger.debug(`Upserted graph layout: ${name}`);
    return result;
  }

  async delete(
    name: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<boolean> {
    const deleted = await this.table()
      .where({ name, workspace_id: workspaceId })
      .delete();
    if (deleted > 0) {
      this.logger.info(`Deleted graph layout: ${name}`);
      return true;
    }
    return false;
  }
}
