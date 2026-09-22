/*
 * Copyright 2025 Larder Software Ltd.
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
import { Router } from 'express';
import { SCOPES, type ScopeService } from '@roadiehq/scopes';
import type { Knex } from 'knex';
import {
  workspaceOwnershipFields,
  type WorkspaceService,
} from '@roadiehq/workspaces-backend';

// Escalations are the integration-request tools; \_ keeps SQL LIKE literal
// and the hyphenated prefix still matches pre-namespacing audit rows.
const escalationToolMatcher = (qb: Knex.QueryBuilder) =>
  qb
    .whereRaw("tool like 'integrations\\_request%' escape '\\'")
    .orWhere('tool', 'like', 'integration-request%');

const TABLE = 'mcp_tool_call_log';

interface AuditLogRow {
  id: string;
  workspace_id: string;
  correlation_id: string;
  service: string;
  tool: string;
  status: string;
  duration_ms: number;
  customer_id: string | null;
  tool_input: Record<string, unknown> | string | null;
  tool_output: unknown;
  input_tokens: number | null;
  output_tokens: number | null;
  error_message: string | null;
  created_at: string;
}

function stringParam(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

interface ParsedParams {
  page: number;
  pageSize: number;
  search: string;
  service: string;
  tool: string;
  status: string;
  customerId: string;
  correlationId: string;
  hasEscalation: string;
  from: string;
  to: string;
}

function parseParams(query: Record<string, unknown>): ParsedParams {
  return {
    page: Math.max(0, Number(query.page) || 0),
    pageSize: Math.min(200, Math.max(1, Number(query.pageSize) || 25)),
    search: stringParam(query.search),
    service: stringParam(query.service),
    tool: stringParam(query.tool),
    status: stringParam(query.status),
    customerId: stringParam(query.customerId),
    correlationId: stringParam(query.correlationId),
    hasEscalation: stringParam(query.hasEscalation),
    from: stringParam(query.from),
    to: stringParam(query.to),
  };
}

function applyFilters(
  q: Knex.QueryBuilder,
  params: ParsedParams,
  knexInstance: Knex,
  workspaceId: string,
): Knex.QueryBuilder {
  q = q.where('workspace_id', workspaceId);
  if (params.search) {
    const like = `%${params.search}%`;
    q = q.where(function (this: Knex.QueryBuilder) {
      this.whereILike('tool', like)
        .orWhereILike('service', like)
        .orWhereILike('correlation_id', like)
        .orWhereILike('customer_id', like);
    });
  }
  if (params.service) q = q.where('service', params.service);
  if (params.tool) q = q.where('tool', params.tool);
  if (params.status === 'success' || params.status === 'error') {
    q = q.where('status', params.status);
  }
  if (params.customerId) q = q.where('customer_id', params.customerId);
  if (params.correlationId) {
    q = q.where('correlation_id', params.correlationId);
  }
  if (params.hasEscalation === 'true' || params.hasEscalation === 'false') {
    const escalationSubquery = knexInstance(TABLE)
      .distinct('correlation_id')
      .where('workspace_id', workspaceId)
      .where(escalationToolMatcher);
    if (params.hasEscalation === 'true') {
      q = q.whereIn('correlation_id', escalationSubquery);
    } else {
      q = q.whereNotIn('correlation_id', escalationSubquery);
    }
  }
  if (params.from) q = q.where('created_at', '>=', params.from);
  if (params.to) q = q.where('created_at', '<=', params.to);
  return q;
}

function mapRow(row: AuditLogRow) {
  return {
    id: row.id,
    ...workspaceOwnershipFields(row.workspace_id),
    correlationId: row.correlation_id,
    service: row.service,
    tool: row.tool,
    status: row.status,
    durationMs: row.duration_ms,
    customerId: row.customer_id ?? undefined,
    toolInput: row.tool_input
      ? ((typeof row.tool_input === 'string'
          ? JSON.parse(row.tool_input)
          : row.tool_input) as Record<string, unknown>)
      : undefined,
    toolOutput:
      row.tool_output != null
        ? typeof row.tool_output === 'string'
          ? JSON.parse(row.tool_output)
          : row.tool_output
        : undefined,
    inputTokens: row.input_tokens ?? undefined,
    outputTokens: row.output_tokens ?? undefined,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
  };
}

export function createAuditLogRouter(
  knex: Knex,
  scopeService: ScopeService,
  workspaceService: WorkspaceService,
): Router {
  const router = Router();
  const requireScopes = scopeService.requireScopes;

  // Distinct values for filter dropdowns + escalation stats
  router.get('/facets', requireScopes(SCOPES.mcp.query), async (req, res) => {
    const workspaceId = await workspaceService.resolveWorkspaceId(req);
    const [services, tools, users, escResult, totalResult] = await Promise.all([
      knex<AuditLogRow>(TABLE)
        .where('workspace_id', workspaceId)
        .distinct('service')
        .orderBy('service')
        .then(rows => rows.map(r => r.service)),
      knex<AuditLogRow>(TABLE)
        .where('workspace_id', workspaceId)
        .distinct('tool')
        .orderBy('tool')
        .then(rows => rows.map(r => r.tool)),
      knex<AuditLogRow>(TABLE)
        .where('workspace_id', workspaceId)
        .distinct('customer_id')
        .whereNotNull('customer_id')
        .orderBy('customer_id')
        .then(rows => rows.map(r => r.customer_id!)),
      knex(TABLE)
        .countDistinct('correlation_id as count')
        .where('workspace_id', workspaceId)
        .where(escalationToolMatcher)
        .first(),
      knex(TABLE)
        .where('workspace_id', workspaceId)
        .countDistinct('correlation_id as count')
        .first(),
    ]);
    res.json({
      services,
      tools,
      users,
      escalationCount: Number(escResult?.count ?? 0),
      totalSessionCount: Number(totalResult?.count ?? 0),
    });
  });

  router.get('/', requireScopes(SCOPES.mcp.query), async (req, res) => {
    const params = parseParams(req.query as Record<string, unknown>);
    const workspaceId = await workspaceService.resolveWorkspaceId(req);

    const filtered = () =>
      applyFilters(knex<AuditLogRow>(TABLE), params, knex, workspaceId);

    const [{ count }] = await filtered().countDistinct(
      'correlation_id as count',
    );
    const totalCount = Number(count);

    const sessionRows = await filtered()
      .select('correlation_id')
      .max('created_at as latest')
      .groupBy('correlation_id')
      .orderBy('latest', 'desc')
      .limit(params.pageSize)
      .offset(params.page * params.pageSize);

    const sessionIds = sessionRows.map(
      (r: { correlation_id: string }) => r.correlation_id,
    );

    // Fetch all rows for the selected sessions (complete, unfiltered by row-level criteria)
    const rows =
      sessionIds.length > 0
        ? await knex<AuditLogRow>(TABLE)
            .where('workspace_id', workspaceId)
            .whereIn('correlation_id', sessionIds)
            .orderBy('created_at', 'desc')
        : [];

    res.json({ items: rows.map(mapRow), totalCount });
  });

  return router;
}
