import {
  httpFailureReason,
  OpenRoadieHttpClient,
  type HttpResult,
} from '../../http-client';
import { ENDPOINTS } from '../../status';

/**
 * Typed wrappers over the public CRUD APIs the bundle commands drive. This is
 * the only module that talks HTTP; everything downstream works on these row
 * shapes. Unlike the interactive commands, callers here want a whole
 * multi-request operation to abort on the first failure — so these throw
 * (with the `httpFailureReason`) instead of returning `HttpResult`.
 */

export interface NodeRow {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: { label: string; config: Record<string, unknown> };
  width?: number;
  height?: number;
  selected?: boolean;
  dragging?: boolean;
}

export interface WorkflowRow {
  id: string;
  name: string;
  slug: string;
  description?: string;
  workflowType: string;
  nodes: NodeRow[];
  edges: unknown[];
  viewport?: unknown;
  enabled: boolean;
}

export interface IntegrationRow {
  id: string;
  name?: string;
  slug: string;
  type?: string;
  host?: string;
  authType?: string;
  /** Auth template with `${SECRET_REF}` placeholders — never secret values. */
  authConfig?: Record<string, unknown> | null;
  backendType?: string;
  config?: Record<string, unknown> | null;
  graphqlPath?: string | null;
  requestsPerHour?: number | null;
  requestsPerSecond?: number | null;
  burstCapacity?: number | null;
  /** Catalog logo id; `logoSvg` is derived from it server-side. */
  logoSlug?: string;
  /** `'system'` for the built-ins seeded by migration. */
  createdBy?: string;
  /** False when the integration's secret refs do not resolve on this target. */
  readyForCurrentScope?: boolean;
}

export interface RuleRow {
  id: string;
  name: string;
  description: string | null;
  sourceDatasourceId: string;
  targetDatasourceId: string;
  sourceFieldExpression: string;
  targetFieldExpression: string;
  sourceFilterExpression: string | null;
  targetFilterExpression: string | null;
  relationshipType: string;
  reciprocalRelationshipType: string | null;
  strategy: string;
  matchStrategy: string;
  integrationConfig?: Record<string, unknown> | null;
  state: string;
}

export interface FilterRow {
  datasourceId?: string;
  seedName?: string;
  filter?: string;
  status?: unknown;
  projection?: unknown;
  annotation?: unknown;
}

export interface ContextGroupRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  /**
   * One flat list. Context groups had `rootDatasources` +
   * `associatedDatasources` + `relationshipTypes` + `rootMergeRelationshipTypes`
   * until the associated-datasources removal; the read and write bodies now
   * carry only these two. `context-group-shape.test.ts` pins the field names
   * against a captured live payload, because a rename here does not break the
   * build — it makes every context group fail to export at runtime.
   */
  datasources: FilterRow[];
  mergeRelationshipTypes: string[];
  annotations: unknown[];
  includeExternalRelations: boolean;
}

export interface CapabilityRow {
  id: string;
  name: string;
  slug: string;
  description?: string;
  instructions?: string;
}

export interface ActionStepRow {
  id: string;
  integrationId: string;
  request: unknown;
}

export interface ActionRow {
  id: string;
  name: string;
  slug: string;
  description?: string;
  parameters: unknown[];
  steps: ActionStepRow[];
  enabled: boolean;
}

export interface ObjectRow {
  id: string;
  datasourceId: string;
  objectId: string;
  object: unknown;
}

export interface PortableObject {
  objectId: string;
  object: unknown;
}

export interface RelationshipRow {
  id: string;
  sourceDatasourceId: string;
  sourceObjectId: string;
  destinationDatasourceId: string;
  destinationObjectId: string;
  relationshipType: string;
  reciprocalRelationshipType?: string | null;
  ruleId?: string | null;
  origin: string;
  metadata?: Record<string, unknown> | null;
}

function requireOk<T>(res: HttpResult<T>): T {
  if (!res.ok || res.body === undefined) {
    throw new Error(httpFailureReason(res));
  }
  return res.body;
}

/** Writes may 204 / return no body; only the status matters. */
function requireOkVoid(res: HttpResult<unknown>): void {
  if (!res.ok) {
    throw new Error(httpFailureReason(res));
  }
}

const LIST_PAGE_SIZE = 500;

interface ListPage<T> {
  rows: T[];
  total?: number;
}

async function fetchListPage<T>(
  client: OpenRoadieHttpClient,
  path: string,
  limit: number,
  offset: number,
): Promise<ListPage<T>> {
  const separator = path.includes('?') ? '&' : '?';
  const body = requireOk(
    await client.get<{ data?: T[]; items?: T[]; total?: number }>(
      `${path}${separator}limit=${limit}&offset=${offset}`,
    ),
  );
  // Never default to an empty page: an envelope that carries neither key is a
  // renamed field, and silently exporting nothing is the failure mode
  // `context-group-shape.test.ts` exists to prevent.
  if (body.data === undefined && body.items === undefined) {
    throw new Error(
      `${path} returned no "data" or "items" list — the API shape changed`,
    );
  }
  return { rows: body.data ?? body.items ?? [], total: body.total };
}

/**
 * Walk offsets, merging by id. The last resort — see `getList`: an offset walk
 * over an unstably-ordered list cannot be trusted to visit every row, so the
 * caller has to reconcile the result against the reported total.
 */
async function walkRemaining<T extends { id: string }>(
  client: OpenRoadieHttpClient,
  path: string,
  startOffset: number,
  total: number | undefined,
  into: Map<string, T>,
): Promise<void> {
  let offset = startOffset;
  for (;;) {
    if (total !== undefined && offset >= total) {
      return;
    }
    const page = await fetchListPage<T>(client, path, LIST_PAGE_SIZE, offset);
    if (page.rows.length === 0) {
      return;
    }
    // Stop as soon as a page contributes nothing new. Without `total` there is
    // no other bound, so a server that ignored `offset` would otherwise loop
    // forever; with one, the caller turns the shortfall into an error.
    const before = into.size;
    for (const row of page.rows) {
      into.set(row.id, row);
    }
    if (into.size === before) {
      return;
    }
    offset += page.rows.length;
    if (total === undefined && page.rows.length < LIST_PAGE_SIZE) {
      return;
    }
  }
}

/**
 * Fetch a whole list.
 *
 * Paging these endpoints is unsound, because they order by a timestamp with no
 * id tiebreak (`updated_at desc`, or state + `created_at desc` for rules) and
 * tied timestamps are the norm for a seeded batch. Postgres may then hand the
 * same row to two pages while a third row appears on neither, and an offset walk
 * has no way to notice: deduping hides the repeat, and the walk still ends when
 * it has consumed `total` rows — one short, silently. On export that drops a rule
 * from the bundle; on import it is worse, because a rule that was missed plans as
 * `create` and duplicates a row that already exists.
 *
 * So when the list does not fit in a single page, ask for all of it in one
 * request: one query is one `ORDER BY` with no page boundaries to fall through.
 * These are configuration-scale lists (data sources, rules, groups, capabilities,
 * actions, integrations) and the caller holds every row in memory regardless, so
 * a single large response costs nothing a paged walk did not already cost. The
 * walk survives only for a server that caps its page size — and if even that ends
 * short of the total, that is an error, not a bundle quietly missing rows.
 */
async function getList<T extends { id: string }>(
  client: OpenRoadieHttpClient,
  path: string,
): Promise<T[]> {
  const first = await fetchListPage<T>(client, path, LIST_PAGE_SIZE, 0);
  const rows = new Map(first.rows.map(row => [row.id, row]));

  // No count to reconcile against. No endpoint behaves this way today; walking
  // until a short page is the best available.
  if (first.total === undefined) {
    if (first.rows.length >= LIST_PAGE_SIZE) {
      await walkRemaining(client, path, first.rows.length, undefined, rows);
    }
    return [...rows.values()];
  }

  if (rows.size >= first.total) {
    return [...rows.values()];
  }

  const whole = await fetchListPage<T>(
    client,
    path,
    // Margin so rows written since the first page still fit in this one.
    first.total + LIST_PAGE_SIZE,
    0,
  );
  for (const row of whole.rows) {
    rows.set(row.id, row);
  }
  const total = whole.total ?? first.total;
  if (rows.size >= total) {
    return [...rows.values()];
  }

  await walkRemaining(client, path, whole.rows.length, total, rows);
  if (rows.size < total) {
    throw new Error(
      `${path} returned ${rows.size} of ${total} rows — refusing to treat a truncated list as complete`,
    );
  }
  return [...rows.values()];
}

export async function fetchWorkflows(
  client: OpenRoadieHttpClient,
): Promise<WorkflowRow[]> {
  return getList<WorkflowRow>(client, ENDPOINTS.workflows);
}

export async function fetchIntegrations(
  client: OpenRoadieHttpClient,
): Promise<IntegrationRow[]> {
  return getList<IntegrationRow>(client, ENDPOINTS.integrations);
}

export async function fetchRules(
  client: OpenRoadieHttpClient,
): Promise<RuleRow[]> {
  return getList<RuleRow>(client, ENDPOINTS.relationshipRules);
}

export async function fetchContextGroups(
  client: OpenRoadieHttpClient,
): Promise<ContextGroupRow[]> {
  return getList<ContextGroupRow>(client, ENDPOINTS.contextGroupRules);
}

export async function fetchCapabilities(
  client: OpenRoadieHttpClient,
): Promise<CapabilityRow[]> {
  return getList<CapabilityRow>(client, ENDPOINTS.capabilities);
}

export async function fetchCapability(
  client: OpenRoadieHttpClient,
  idOrSlug: string,
): Promise<CapabilityRow> {
  return requireOk(
    await client.get<CapabilityRow>(
      `${ENDPOINTS.capabilities}/${encodeURIComponent(idOrSlug)}`,
    ),
  );
}

export async function fetchActions(
  client: OpenRoadieHttpClient,
): Promise<ActionRow[]> {
  return getList<ActionRow>(client, ENDPOINTS.actions);
}

export async function fetchDatasourceObjects(
  client: OpenRoadieHttpClient,
  datasourceId: string,
): Promise<PortableObject[]> {
  const rows = await getList<ObjectRow>(
    client,
    `${ENDPOINTS.objects}/${encodeURIComponent(datasourceId)}`,
  );
  return rows.map(({ objectId, object }) => ({ objectId, object }));
}

export async function fetchDirectRelationships(
  client: OpenRoadieHttpClient,
): Promise<RelationshipRow[]> {
  return getList<RelationshipRow>(
    client,
    `${ENDPOINTS.relationships}?direct=true`,
  );
}

export async function fetchRelationships(
  client: OpenRoadieHttpClient,
): Promise<RelationshipRow[]> {
  return getList<RelationshipRow>(client, ENDPOINTS.relationships);
}

export async function replaceDatasourceObjects(
  client: OpenRoadieHttpClient,
  datasourceId: string,
  items: PortableObject[],
): Promise<void> {
  requireOkVoid(
    await client.put(
      `${ENDPOINTS.objects}/${encodeURIComponent(datasourceId)}`,
      {
        items,
      },
    ),
  );
}

export async function upsertDirectRelationship(
  client: OpenRoadieHttpClient,
  body: Omit<RelationshipRow, 'id' | 'ruleId'>,
): Promise<void> {
  requireOkVoid(await client.put(ENDPOINTS.relationships, body));
}

/**
 * What the CLI sends when writing a workflow. Distinct from `WorkflowRow`:
 * ids/versions are server-assigned, and node shapes pass through unmodelled
 * (their `config` is an open record).
 */
export interface WorkflowWriteBody {
  name: string;
  slug: string;
  /** `null` clears the stored description; omitting the key leaves it as-is. */
  description?: string | null;
  workflowType: string;
  enabled: boolean;
  viewport?: unknown;
  edges: unknown[];
  nodes: unknown[];
}

export async function createWorkflow(
  client: OpenRoadieHttpClient,
  body: WorkflowWriteBody,
): Promise<WorkflowRow> {
  const res = requireOk(
    await client.post<{ data: WorkflowRow }>(ENDPOINTS.workflows, body),
  );
  return res.data;
}

export async function updateWorkflow(
  client: OpenRoadieHttpClient,
  id: string,
  body: WorkflowWriteBody,
): Promise<void> {
  requireOkVoid(await client.put(`${ENDPOINTS.workflows}/${id}`, body));
}

export async function createRule(
  client: OpenRoadieHttpClient,
  body: Record<string, unknown>,
): Promise<RuleRow> {
  return requireOk(
    await client.post<RuleRow>(ENDPOINTS.relationshipRules, body),
  );
}

export async function updateRule(
  client: OpenRoadieHttpClient,
  id: string,
  body: Record<string, unknown>,
): Promise<void> {
  requireOkVoid(await client.put(`${ENDPOINTS.relationshipRules}/${id}`, body));
}

export async function createContextGroup(
  client: OpenRoadieHttpClient,
  body: Record<string, unknown>,
): Promise<ContextGroupRow> {
  return requireOk(
    await client.post<ContextGroupRow>(ENDPOINTS.contextGroupRules, body),
  );
}

export async function updateContextGroup(
  client: OpenRoadieHttpClient,
  id: string,
  body: Record<string, unknown>,
): Promise<void> {
  requireOkVoid(await client.put(`${ENDPOINTS.contextGroupRules}/${id}`, body));
}

export async function createCapability(
  client: OpenRoadieHttpClient,
  body: Record<string, unknown>,
): Promise<CapabilityRow> {
  return requireOk(
    await client.post<CapabilityRow>(ENDPOINTS.capabilities, body),
  );
}

export async function updateCapability(
  client: OpenRoadieHttpClient,
  id: string,
  body: Record<string, unknown>,
): Promise<void> {
  requireOkVoid(await client.put(`${ENDPOINTS.capabilities}/${id}`, body));
}

export async function createIntegration(
  client: OpenRoadieHttpClient,
  body: Record<string, unknown>,
): Promise<IntegrationRow> {
  const res = requireOk(
    await client.post<{ data: IntegrationRow }>(ENDPOINTS.integrations, body),
  );
  return res.data;
}

export async function materializeContextGroup(
  client: OpenRoadieHttpClient,
  id: string,
): Promise<void> {
  requireOkVoid(
    await client.post(`${ENDPOINTS.contextGroupRules}/${id}/materialize`),
  );
}

export async function applyRelationshipRule(
  client: OpenRoadieHttpClient,
  id: string,
): Promise<void> {
  requireOkVoid(
    await client.post(`${ENDPOINTS.relationshipRules}/${id}/apply`),
  );
}

/**
 * State transitions. The rules API has no general "set state" — each verb
 * moves the rule between two specific states and 409s from anywhere else, so
 * callers must know the current state. `state` on a create/update body is
 * ignored by the update handler entirely.
 */
export type RuleTransition = 'approve' | 'dismiss' | 'disable' | 'reset';

export async function transitionRelationshipRule(
  client: OpenRoadieHttpClient,
  id: string,
  transition: RuleTransition,
): Promise<void> {
  requireOkVoid(
    await client.post(`${ENDPOINTS.relationshipRules}/${id}/${transition}`),
  );
}

export async function createAction(
  client: OpenRoadieHttpClient,
  body: Record<string, unknown>,
): Promise<ActionRow> {
  return requireOk(await client.post<ActionRow>(ENDPOINTS.actions, body));
}

export async function updateAction(
  client: OpenRoadieHttpClient,
  id: string,
  body: Record<string, unknown>,
): Promise<void> {
  requireOkVoid(await client.put(`${ENDPOINTS.actions}/${id}`, body));
}
