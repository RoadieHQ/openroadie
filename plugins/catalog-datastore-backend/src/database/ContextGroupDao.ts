import type { Knex } from 'knex';
import { v4 as uuid, validate as isUuid } from 'uuid';
import {
  checkSourceConfigured,
  parseFilterConditions,
  objectMatchesFilters,
  resolveObjectPresentation,
  type ObjectPresentation,
  applyProjection,
  type Annotation,
  type FilterCondition,
  CONTEXT_GROUP_MATERIALIZE_LOCK_NS,
} from '@roadiehq/catalog-datastore-common';
import type {
  CatalogWorkflowClient,
  WorkflowDefinition,
} from '@roadiehq/catalog-workflow-common';
import type { IntegrationClient } from '@roadiehq/integrations-node';
import { InputError } from '@roadiehq/errors';
import { SLUG_RE } from '@roadiehq/scopes';
import {
  ContextGroupRuleRow,
  ContextGroupRule,
  ContextGroupRow,
  ContextGroup,
  ContextGroupMemberRow,
  ContextGroupMember,
  ContextGroupMembership,
  DatasourceFilter,
  ContextGroupDatasourceStatus,
} from './types';
import { deriveObjectLabel } from './object-label';
import { escapeIlike, parseSearchQuery } from './search-query';
import {
  DEFAULT_WORKSPACE_ID,
  workspaceOwnershipFields,
} from '@roadiehq/workspaces-backend';
import {
  renderLiquidSafe,
  type LiquidDataFunctions,
  type LiquidRenderBudget,
} from '@roadiehq/liquid-safe';
import {
  assertValidViewName,
  assertValidViewTemplate,
  DEFAULT_VIEW_DESCRIPTION,
  DEFAULT_VIEW_NAME,
  DEFAULT_VIEW_TEMPLATE,
  ViewNotFoundError,
  ViewValidationError,
  rowToView,
  type ContextGroupView,
  type ContextGroupViewRow,
} from './contextGroupViews';

const RULE_TABLE = 'context_group_rule';
const VIEW_TABLE = 'context_group_view';
const GROUP_TABLE = 'context_group';
const MEMBER_TABLE = 'context_group_member';
const DATASTORE_TABLE = 'datastore';
const RELATIONSHIP_TABLE = 'datastore_relation';
const ACTIVITY_TABLE = 'datasource_activity';
const INDEX_TABLE = 'datastore_index';
const INDEX_CONFIGURATION_TABLE = 'datastore_index_configuration';
const WORKFLOW_PAGE_SIZE = 1000;
// Group rows have 4 columns and member rows 6, so a large rule can push a
// single INSERT past PostgreSQL's 65535-parameter limit; stay well under it.
// Overflowing does not report the limit — the wire protocol counts parameters
// in an int16, so it wraps and fails as an opaque "bind message has N
// parameter formats but 0 parameters".
const MATERIALIZE_BATCH_SIZE = 1000;
// Bounds for the view render path: members loaded into the template
// document, and relationship targets returned per `related` call.
const RENDER_MEMBER_LIMIT = 200;
const RELATED_TARGET_LIMIT = 200;

/**
 * Split a `datasourceId:objectId` member key on the FIRST colon only —
 * object ids can themselves contain colons (e.g. MS Graph channel ids like
 * `19:...@thread.tacv2`), which a plain split(':') would truncate.
 */
function splitMemberKey(key: string): [string, string] {
  const i = key.indexOf(':');
  return [key.slice(0, i), key.slice(i + 1)];
}

function parseJsonbField<T>(value: string | T): T {
  if (typeof value === 'string') {
    return JSON.parse(value) as T;
  }
  return value;
}

/** Derive a URL-safe slug from a name, matching the shared `SLUG_RE`. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function rowToRule(row: ContextGroupRuleRow): ContextGroupRule {
  return {
    id: row.id,
    ...workspaceOwnershipFields(row.workspace_id ?? DEFAULT_WORKSPACE_ID),
    name: row.name,
    slug: row.slug,
    description: row.description,
    datasources: parseJsonbField<DatasourceFilter[]>(row.datasources),
    mergeRelationshipTypes: parseJsonbField<string[]>(row.merge_relation_types),
    annotations:
      row.annotations == null
        ? []
        : parseJsonbField<Annotation[]>(row.annotations),
    includeExternalRelations: row.include_external_relations ?? true,
    seedVersion: row.seed_version ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function rowToGroup(row: ContextGroupRow, workspaceId: string): ContextGroup {
  return {
    id: row.id,
    ...workspaceOwnershipFields(workspaceId),
    ruleId: row.rule_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function rowToMember(
  row: ContextGroupMemberRow,
  workspaceId: string,
): ContextGroupMember {
  return {
    id: row.id,
    ...workspaceOwnershipFields(workspaceId),
    contextGroupId: row.context_group_id,
    datasourceId: row.datasource_id,
    objectId: row.object_id,
    createdAt: row.created_at.toISOString(),
  };
}

function uniqueDatasourceIds(candidates: DatasourceFilter[]): string[] {
  return [
    ...new Set(
      candidates
        .map(c => c.datasourceId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
}

function findSourceNode(workflow: WorkflowDefinition) {
  return workflow.nodes.find(node =>
    ['source-integration', 'source-chained', 'source-datastore'].includes(
      node.type,
    ),
  );
}

function sourceNodeIsConfigured(
  workflow: WorkflowDefinition,
  integrationBackendType?: string,
): boolean {
  const sourceNode = findSourceNode(workflow);
  // Delegates to the shared check in catalog-datastore-common so context-group
  // status/materialization agrees with the frontend's "Needs setup" logic —
  // notably AWS cloud-control (resource-type) sources like ECR, which the old
  // local copy wrongly treated as unconfigured.
  return checkSourceConfigured(
    sourceNode?.type,
    sourceNode?.data?.config as Record<string, unknown> | undefined,
    integrationBackendType,
  );
}

interface IntegrationStatus {
  id: string;
  readyForCurrentScope?: boolean;
  backendType?: string;
}

interface DatasourcePresence {
  hasActivity: boolean;
  objectCount: number;
}

interface DatasourceResolutionContext {
  workflowsById: Map<string, WorkflowDefinition>;
  workflowsByName: Map<string, WorkflowDefinition>;
  workflowsBySlug: Map<string, WorkflowDefinition>;
  integrationsById: Map<string, IntegrationStatus>;
  presence: Map<string, DatasourcePresence>;
}

interface PresentedObject {
  datasourceId: string;
  objectId: string;
  object: unknown;
  presentation: ObjectPresentation;
}

type ContextRelationshipEndpoint = PresentedObject;

interface ContextBundleRelationship {
  id: string;
  source: ContextRelationshipEndpoint;
  destination: ContextRelationshipEndpoint;
  relationshipType: string;
  reciprocalRelationshipType?: string | null;
  direction?: 'outgoing' | 'incoming' | 'internal';
}

interface ContextGroupRelationshipRow {
  id: string;
  source_datasource_id: string;
  source_object_id: string;
  destination_datasource_id: string;
  destination_object_id: string;
  relation_type: string;
  reciprocal_relation_type: string | null;
}

interface ContextGroupBundleOptions {
  memberLimit?: number;
  relationshipLimit?: number;
  // Optional datasource slice for the projected `datasources`/`externalRelations`
  // view (progressive agent loading); leaves the drawer's member lists untouched.
  datasourceIds?: string[];
}

export interface CreateRuleInput {
  name: string;
  slug?: string;
  description?: string;
  datasources: DatasourceFilter[];
  mergeRelationshipTypes?: string[];
  annotations?: Annotation[];
  includeExternalRelations?: boolean;
  seedVersion?: number;
}

export interface UpdateRuleInput {
  name?: string;
  slug?: string;
  description?: string;
  datasources?: DatasourceFilter[];
  mergeRelationshipTypes?: string[];
  annotations?: Annotation[];
  includeExternalRelations?: boolean;
  seedVersion?: number | null;
}

export interface CreateViewInput {
  name: string;
  description?: string;
  template: string;
  isDefault?: boolean;
}

export interface UpdateViewInput {
  name?: string;
  description?: string | null;
  template?: string;
  /** Only `true` is meaningful — promote this view to default. The
   *  default is switched by promoting another, never unset. */
  isDefault?: boolean;
}

/** One member entry in the render document: identity plus the object data.
 *  The `related`/`object` data functions consume and produce this shape, so
 *  templates can chain them. */
export interface ContextGroupDocumentMember {
  datasourceId: string;
  objectId: string;
  data: unknown;
}

/** The document a view template renders against. `members` is keyed by the
 *  datasource's slug; a datasource without a resolvable slug (removed from
 *  the workflow service) is omitted. */
export interface ContextGroupDocument {
  group: { id: string; name: string };
  rule: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
  };
  members: Record<string, ContextGroupDocumentMember[]>;
}

export interface RenderBundleOptions {
  /** View name to render; omitted means the rule's default. */
  view?: string;
  memberLimit?: number;
  budget?: LiquidRenderBudget;
}

export interface RenderedBundle {
  groupId: string;
  workspaceId: string;
  ownership: 'org' | 'workspace';
  ruleId: string;
  ruleName: string;
  group: ContextGroupDocument['group'];
  rule: ContextGroupDocument['rule'];
  view: { name: string; description: string | null };
  availableViews: Array<{
    name: string;
    description: string | null;
    isDefault: boolean;
  }>;
  rendered: string;
}

export class ContextGroupDao {
  private readonly knex: Knex;
  private readonly catalogWorkflowClient?: CatalogWorkflowClient;
  private readonly integrationClient?: IntegrationClient;

  constructor(options: {
    knex: Knex;
    catalogWorkflowClient?: CatalogWorkflowClient;
    integrationClient?: IntegrationClient;
  }) {
    this.knex = options.knex;
    this.catalogWorkflowClient = options.catalogWorkflowClient;
    this.integrationClient = options.integrationClient;
  }

  private ruleTable(trx?: Knex) {
    return (trx || this.knex)<ContextGroupRuleRow>(RULE_TABLE);
  }

  private groupTable(trx?: Knex) {
    return (trx || this.knex)<ContextGroupRow>(GROUP_TABLE);
  }

  private memberTable(trx?: Knex) {
    return (trx || this.knex)<ContextGroupMemberRow>(MEMBER_TABLE);
  }

  private viewTable(trx?: Knex) {
    return (trx || this.knex)<ContextGroupViewRow>(VIEW_TABLE);
  }

  private async loadPresentedObjects(
    keys: Array<{ datasourceId: string; objectId: string }>,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Map<string, PresentedObject>> {
    const result = new Map<string, PresentedObject>();
    if (keys.length === 0) {
      return result;
    }

    const uniqueKeys = [
      ...new Map(
        keys.map(key => [`${key.datasourceId}:${key.objectId}`, key]),
      ).values(),
    ];

    const rows = await this.knex(DATASTORE_TABLE)
      .where('workspace_id', workspaceId)
      .where(function () {
        for (const key of uniqueKeys) {
          this.orWhere({
            datasource_id: key.datasourceId,
            object_id: key.objectId,
          });
        }
      })
      .select('id', 'datasource_id', 'object_id', 'object');

    const indexRows = await this.knex(`${INDEX_TABLE} as idx`)
      .join(
        `${INDEX_CONFIGURATION_TABLE} as cfg`,
        'idx.datastore_index_configuration_id',
        '=',
        'cfg.id',
      )
      .where('cfg.workspace_id', workspaceId)
      .whereIn(
        'idx.datastore_id',
        rows.map(row => row.id),
      )
      .whereIn('cfg.purpose', ['title', 'subtitle', 'image'])
      .select<
        Array<{
          datastore_id: string;
          purpose: 'title' | 'subtitle' | 'image';
          value: string;
        }>
      >('idx.datastore_id', 'cfg.purpose', 'idx.value');

    const configuredById = new Map<string, Partial<ObjectPresentation>>();
    for (const row of indexRows) {
      const current = configuredById.get(row.datastore_id) ?? {};
      current[row.purpose] = row.value;
      configuredById.set(row.datastore_id, current);
    }

    for (const row of rows) {
      const object =
        typeof row.object === 'string' ? JSON.parse(row.object) : row.object;
      const key = `${row.datasource_id}:${row.object_id}`;
      result.set(key, {
        datasourceId: row.datasource_id,
        objectId: row.object_id,
        object,
        presentation: resolveObjectPresentation(
          object,
          row.object_id,
          configuredById.get(row.id),
        ),
      });
    }

    return result;
  }

  private async getContextTitles(
    groupIds: string[],
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Map<string, string>> {
    if (groupIds.length === 0) {
      return new Map();
    }

    const rootRows = await this.memberTable()
      .whereIn('context_group_id', groupIds)
      .select('context_group_id', 'datasource_id', 'object_id')
      .orderBy('created_at', 'asc');

    const objects = await this.loadPresentedObjects(
      rootRows.map(row => ({
        datasourceId: row.datasource_id,
        objectId: row.object_id,
      })),
      workspaceId,
    );

    const titles = new Map<string, string>();
    for (const row of rootRows) {
      if (titles.has(row.context_group_id)) {
        continue;
      }
      const object = objects.get(`${row.datasource_id}:${row.object_id}`);
      titles.set(
        row.context_group_id,
        object?.presentation.title ?? row.object_id,
      );
    }
    return titles;
  }

  private async listAllWorkflows(
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<WorkflowDefinition[]> {
    if (!this.catalogWorkflowClient) {
      return [];
    }
    const workflows: WorkflowDefinition[] = [];
    for (let offset = 0; ; offset += WORKFLOW_PAGE_SIZE) {
      const page = await this.catalogWorkflowClient.list({
        workflowType: 'data-ingestion',
        limit: WORKFLOW_PAGE_SIZE,
        offset,
        workspaceId,
      });
      workflows.push(...page.data);
      if (page.data.length === 0 || workflows.length >= page.total) {
        return workflows;
      }
    }
  }

  private async listIntegrations(
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Map<string, IntegrationStatus>> {
    if (!this.integrationClient) {
      return new Map();
    }
    const integrations =
      await this.integrationClient.listIntegrations(workspaceId);
    return new Map(
      integrations.map(integration => [integration.id, integration]),
    );
  }

  private async getDatasourcePresence(
    datasourceIds: string[],
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Map<string, DatasourcePresence>> {
    const result = new Map<string, DatasourcePresence>();
    for (const id of datasourceIds) {
      result.set(id, { hasActivity: false, objectCount: 0 });
    }
    if (datasourceIds.length === 0) {
      return result;
    }

    const activityRows = await this.knex(ACTIVITY_TABLE)
      .where('workspace_id', workspaceId)
      .whereIn('datasource_id', datasourceIds)
      .select('datasource_id');
    for (const row of activityRows) {
      const current = result.get(row.datasource_id);
      if (current) {
        current.hasActivity = true;
      }
    }

    const objectRows = await this.knex(DATASTORE_TABLE)
      .where('workspace_id', workspaceId)
      .whereIn('datasource_id', datasourceIds)
      .select('datasource_id')
      .count<Array<{ datasource_id: string; count: string }>>('* as count')
      .groupBy('datasource_id');
    for (const row of objectRows) {
      const current = result.get(row.datasource_id);
      if (current) {
        current.objectCount = Number(row.count);
      }
    }

    return result;
  }

  private async buildDatasourceResolutionContext(
    candidates: DatasourceFilter[],
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<DatasourceResolutionContext> {
    const workflows = await this.listAllWorkflows(workspaceId);
    const workflowsById = new Map(
      workflows.map(workflow => [workflow.id, workflow]),
    );
    const workflowsByName = new Map(
      workflows.map(workflow => [workflow.name, workflow]),
    );
    const workflowsBySlug = new Map(
      workflows.map(workflow => [workflow.slug, workflow]),
    );
    const idsFromCandidates = uniqueDatasourceIds(candidates);
    const idsFromSeeds = candidates
      .map(candidate => {
        if (!candidate.seedName) return undefined;
        const workflow =
          workflowsByName.get(candidate.seedName) ??
          workflowsBySlug.get(slugify(candidate.seedName));
        return workflow?.id;
      })
      .filter((id): id is string => Boolean(id));
    const datasourceIds = [...new Set([...idsFromCandidates, ...idsFromSeeds])];
    const [presence, integrationsById] = await Promise.all([
      this.getDatasourcePresence(datasourceIds, workspaceId),
      this.listIntegrations(workspaceId),
    ]);

    return {
      workflowsById,
      workflowsByName,
      workflowsBySlug,
      integrationsById,
      presence,
    };
  }

  async resolveDatasourceStatuses(
    candidates: DatasourceFilter[],
    context?: DatasourceResolutionContext,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<ContextGroupDatasourceStatus[]> {
    const resolutionContext =
      context ??
      (await this.buildDatasourceResolutionContext(candidates, workspaceId));
    const {
      workflowsById,
      workflowsByName,
      workflowsBySlug,
      integrationsById,
      presence,
    } = resolutionContext;

    return candidates.map(candidate => {
      const workflow =
        (candidate.datasourceId
          ? workflowsById.get(candidate.datasourceId)
          : undefined) ??
        (candidate.seedName
          ? (workflowsByName.get(candidate.seedName) ??
            workflowsBySlug.get(slugify(candidate.seedName)))
          : undefined);
      const datasourceId = candidate.datasourceId ?? workflow?.id;
      if (!datasourceId) {
        return {
          live: false,
          seedName: candidate.seedName,
          inactiveReason: 'Data source not found',
        };
      }

      if (this.catalogWorkflowClient && !workflow) {
        return {
          live: false,
          datasourceId,
          seedName: candidate.seedName,
          inactiveReason: 'Data source not found',
        };
      }

      const displayName = workflow?.name ?? candidate.seedName ?? datasourceId;

      if (workflow && !workflow.enabled) {
        return {
          live: false,
          datasourceId,
          seedName: candidate.seedName,
          displayName,
          inactiveReason: 'Data source disabled',
        };
      }

      const sourceNode = workflow ? findSourceNode(workflow) : undefined;
      const integrationId = sourceNode?.data?.config?.integrationId as
        | string
        | undefined;
      const integration = integrationId
        ? integrationsById.get(integrationId)
        : undefined;

      if (integrationId && this.integrationClient && !integration) {
        return {
          live: false,
          datasourceId,
          seedName: candidate.seedName,
          displayName,
          inactiveReason: 'Selected integration is unavailable',
        };
      }

      if (integration?.readyForCurrentScope === false) {
        return {
          live: false,
          datasourceId,
          seedName: candidate.seedName,
          displayName,
          inactiveReason: 'Integration setup required',
        };
      }

      if (
        workflow &&
        !sourceNodeIsConfigured(workflow, integration?.backendType)
      ) {
        return {
          live: false,
          datasourceId,
          seedName: candidate.seedName,
          displayName,
          inactiveReason: 'Source endpoint not configured',
        };
      }

      const datasourcePresence = presence.get(datasourceId);
      if (
        !datasourcePresence ||
        (!datasourcePresence.hasActivity &&
          datasourcePresence.objectCount === 0)
      ) {
        return {
          live: false,
          datasourceId,
          seedName: candidate.seedName,
          displayName,
          inactiveReason: 'No successful sync yet',
        };
      }

      return {
        live: true,
        datasourceId,
        seedName: candidate.seedName,
        displayName,
      };
    });
  }

  async enrichRule(
    rule: ContextGroupRule,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<ContextGroupRule> {
    const resolutionContext = await this.buildDatasourceResolutionContext(
      rule.datasources,
      workspaceId,
    );
    return this.enrichRuleWithContext(rule, resolutionContext);
  }

  async enrichRules(
    rules: ContextGroupRule[],
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<ContextGroupRule[]> {
    if (rules.length === 0) {
      return [];
    }

    const resolutionContext = await this.buildDatasourceResolutionContext(
      rules.flatMap(rule => rule.datasources),
      workspaceId,
    );

    return Promise.all(
      rules.map(rule => this.enrichRuleWithContext(rule, resolutionContext)),
    );
  }

  private async enrichRuleWithContext(
    rule: ContextGroupRule,
    resolutionContext: DatasourceResolutionContext,
  ): Promise<ContextGroupRule> {
    const statuses = await this.resolveDatasourceStatuses(
      rule.datasources,
      resolutionContext,
    );

    return {
      ...rule,
      datasources: rule.datasources.map((candidate, index) => ({
        ...candidate,
        status: statuses[index],
      })),
    };
  }

  async getLiveDatasourceFilters(
    candidates: DatasourceFilter[],
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Array<DatasourceFilter & { datasourceId: string }>> {
    const statuses = await this.resolveDatasourceStatuses(
      candidates,
      undefined,
      workspaceId,
    );
    return candidates.flatMap((candidate, index) => {
      const status = statuses[index];
      const datasourceId = status?.live
        ? (status.datasourceId ?? candidate.datasourceId)
        : undefined;
      if (!datasourceId) {
        return [];
      }
      return [
        {
          ...candidate,
          datasourceId,
          status,
        },
      ];
    });
  }

  private async getReferencedDatasourceIds(
    candidates: DatasourceFilter[],
    context?: DatasourceResolutionContext,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<string[]> {
    const statuses = await this.resolveDatasourceStatuses(
      candidates,
      context,
      workspaceId,
    );
    return [
      ...new Set([
        ...uniqueDatasourceIds(candidates),
        ...statuses
          .map(status => status.datasourceId)
          .filter((id): id is string => Boolean(id)),
      ]),
    ];
  }

  async createRule(
    input: CreateRuleInput,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<ContextGroupRule> {
    const slug = input.slug?.trim() || slugify(input.name);
    // Guards the non-HTTP callers (seeds, future services) the controller's
    // own check can't reach — a slug off the grammar is unreferenceable.
    if (!SLUG_RE.test(slug)) {
      throw new InputError(`Invalid context group slug "${slug}"`);
    }
    return this.knex.transaction(async trx => {
      const [row] = await this.ruleTable(trx)
        .insert({
          id: uuid(),
          workspace_id: workspaceId,
          name: input.name,
          slug,
          description: input.description || null,
          datasources: JSON.stringify(input.datasources),
          merge_relation_types: JSON.stringify(
            input.mergeRelationshipTypes ?? [],
          ),
          annotations: JSON.stringify(input.annotations ?? []),
          include_external_relations: input.includeExternalRelations ?? true,
          seed_version: input.seedVersion ?? null,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning('*');
      // Every rule always has exactly one default view (the invariant
      // the bundle render path relies on), created with the rule itself.
      await this.viewTable(trx).insert({
        id: uuid(),
        rule_id: row.id,
        name: DEFAULT_VIEW_NAME,
        description: DEFAULT_VIEW_DESCRIPTION,
        template: DEFAULT_VIEW_TEMPLATE,
        is_default: true,
        created_at: new Date(),
        updated_at: new Date(),
      });
      return rowToRule(row);
    });
  }

  async getRule(
    id: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<ContextGroupRule | undefined> {
    const row = await this.ruleTable()
      .where({ id, workspace_id: workspaceId })
      .first();
    return row ? rowToRule(row) : undefined;
  }

  async getRuleByName(
    name: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<ContextGroupRule | undefined> {
    const row = await this.ruleTable()
      .where({ name, workspace_id: workspaceId })
      .first();
    return row ? rowToRule(row) : undefined;
  }

  async getRuleBySlug(
    slug: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<ContextGroupRule | undefined> {
    const row = await this.ruleTable()
      .where({ slug, workspace_id: workspaceId })
      .first();
    return row ? rowToRule(row) : undefined;
  }

  async listRules(options?: {
    workspaceId?: string;
    limit?: number;
    offset?: number;
    /**
     * Restrict to context groups the caller may see, by slug (or id).
     * `undefined` means no restriction; an empty list matches nothing.
     */
    allowedIdentifiers?: string[];
  }): Promise<{ items: ContextGroupRule[]; total: number }> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const allowedIdentifiers = options?.allowedIdentifiers;
    const workspaceId = options?.workspaceId ?? DEFAULT_WORKSPACE_ID;

    const applyFilters = (qb: Knex.QueryBuilder) => {
      qb.where('workspace_id', workspaceId);
      if (allowedIdentifiers) {
        // A context group is identified by its slug; also honour a grant that
        // names the uuid id, passing only uuids to the id column.
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

    const [countResult] = await applyFilters(this.ruleTable()).count<
      Array<{ count: string }>
    >('* as count');

    const rows = await applyFilters(this.ruleTable())
      .orderBy('name', 'asc')
      .limit(limit)
      .offset(offset);

    return {
      items: rows.map(rowToRule),
      total: Number(countResult.count),
    };
  }

  async updateRule(
    id: string,
    input: UpdateRuleInput,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<ContextGroupRule | undefined> {
    const updates: Partial<ContextGroupRuleRow> = {
      updated_at: new Date(),
    };

    if (input.name !== undefined) {
      updates.name = input.name;
    }
    if (input.slug !== undefined) {
      const nextSlug = input.slug.trim();
      if (!SLUG_RE.test(nextSlug)) {
        throw new InputError(`Invalid context group slug "${nextSlug}"`);
      }
      updates.slug = nextSlug;
    }
    if (input.description !== undefined) {
      updates.description = input.description;
    }
    if (input.datasources !== undefined) {
      updates.datasources = JSON.stringify(input.datasources);
    }
    if (input.mergeRelationshipTypes !== undefined) {
      updates.merge_relation_types = JSON.stringify(
        input.mergeRelationshipTypes,
      );
    }
    if (input.annotations !== undefined) {
      updates.annotations = JSON.stringify(input.annotations);
    }
    if (input.includeExternalRelations !== undefined) {
      updates.include_external_relations = input.includeExternalRelations;
    }
    updates.seed_version = input.seedVersion ?? null;

    return this.knex.transaction(async trx => {
      await trx.raw(`SELECT pg_advisory_xact_lock(hashtext(?))`, [
        `${CONTEXT_GROUP_MATERIALIZE_LOCK_NS}${id}`,
      ]);
      const [row] = await this.ruleTable(trx)
        .where({ id, workspace_id: workspaceId })
        .update(updates)
        .returning('*');

      return row ? rowToRule(row) : undefined;
    });
  }

  async deleteRule(
    id: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<void> {
    await this.knex.transaction(async trx => {
      await trx.raw(`SELECT pg_advisory_xact_lock(hashtext(?))`, [
        `${CONTEXT_GROUP_MATERIALIZE_LOCK_NS}${id}`,
      ]);
      const rule = await this.ruleTable(trx)
        .where({ id, workspace_id: workspaceId })
        .first();
      if (!rule) {
        return;
      }
      const groupIds = await this.groupTable(trx)
        .where('rule_id', id)
        .select('id');
      const ids = groupIds.map(g => g.id);
      if (ids.length > 0) {
        await this.memberTable(trx).whereIn('context_group_id', ids).delete();
        await this.groupTable(trx).whereIn('id', ids).delete();
      }
      await this.ruleTable(trx)
        .where({ id, workspace_id: workspaceId })
        .delete();
    });
  }

  /** Views for a rule, default first, then by name. */
  async listViews(
    ruleId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<ContextGroupView[]> {
    const rows = await this.viewTable()
      .where('rule_id', ruleId)
      .whereIn(
        'rule_id',
        this.ruleTable().where('workspace_id', workspaceId).select('id'),
      )
      .orderBy([
        { column: 'is_default', order: 'desc' },
        { column: 'name', order: 'asc' },
      ]);
    return rows.map(row => rowToView(row, workspaceId));
  }

  async getView(
    id: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<ContextGroupView | undefined> {
    const row = await this.viewTable()
      .where('id', id)
      .whereIn(
        'rule_id',
        this.ruleTable().where('workspace_id', workspaceId).select('id'),
      )
      .first();
    return row ? rowToView(row, workspaceId) : undefined;
  }

  async getViewByName(
    ruleId: string,
    name: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<ContextGroupView | undefined> {
    const row = await this.viewTable()
      .where({ rule_id: ruleId, name })
      .whereIn(
        'rule_id',
        this.ruleTable().where('workspace_id', workspaceId).select('id'),
      )
      .first();
    return row ? rowToView(row, workspaceId) : undefined;
  }

  async createView(
    ruleId: string,
    input: CreateViewInput,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<ContextGroupView> {
    assertValidViewName(input.name);
    assertValidViewTemplate(input.template);
    return this.knex.transaction(async trx => {
      const rule = await this.ruleTable(trx)
        .where({ id: ruleId, workspace_id: workspaceId })
        .first();
      if (!rule) {
        throw new InputError(`Context group rule ${ruleId} not found`);
      }
      if (input.isDefault) {
        await this.viewTable(trx)
          .where('rule_id', ruleId)
          .update({ is_default: false });
      }
      const [row] = await this.viewTable(trx)
        .insert({
          id: uuid(),
          rule_id: ruleId,
          name: input.name,
          description: input.description ?? null,
          template: input.template,
          is_default: input.isDefault ?? false,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning('*');
      return rowToView(row, workspaceId);
    });
  }

  async updateView(
    id: string,
    input: UpdateViewInput,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<ContextGroupView | undefined> {
    if (input.name !== undefined) {
      assertValidViewName(input.name);
    }
    if (input.template !== undefined) {
      assertValidViewTemplate(input.template);
    }
    return this.knex.transaction(async trx => {
      const existing = await this.viewTable(trx)
        .where('id', id)
        .whereIn(
          'rule_id',
          this.ruleTable(trx).where('workspace_id', workspaceId).select('id'),
        )
        .first();
      if (!existing) {
        return undefined;
      }
      if (input.isDefault === false && existing.is_default) {
        throw new ViewValidationError([
          {
            message:
              'A rule always has a default view; promote another view instead of unsetting this one',
          },
        ]);
      }
      const updates: Partial<ContextGroupViewRow> = {
        updated_at: new Date(),
      };
      if (input.name !== undefined) updates.name = input.name;
      if (input.description !== undefined) {
        updates.description = input.description;
      }
      if (input.template !== undefined) updates.template = input.template;
      if (input.isDefault === true && !existing.is_default) {
        await this.viewTable(trx)
          .where('rule_id', existing.rule_id)
          .update({ is_default: false });
        updates.is_default = true;
      }
      const [row] = await this.viewTable(trx)
        .where('id', id)
        .update(updates)
        .returning('*');
      return row ? rowToView(row, workspaceId) : undefined;
    });
  }

  async deleteView(
    id: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<void> {
    const existing = await this.getView(id, workspaceId);
    if (!existing) {
      return;
    }
    if (existing.isDefault) {
      throw new ViewValidationError([
        {
          message:
            'The default view cannot be deleted; promote another view to default first',
        },
      ]);
    }
    await this.viewTable().where({ id, rule_id: existing.ruleId }).delete();
  }

  async listGroups(options?: {
    workspaceId?: string;
    ruleId?: string;
    limit?: number;
    offset?: number;
    /**
     * Restrict to groups whose parent rule's slug is in this list. `undefined`
     * means no restriction; an empty list matches nothing. Matched via a
     * subquery on the rule table (not a join) to avoid column collisions.
     */
    allowedRuleSlugs?: string[];
  }): Promise<{ items: ContextGroup[]; total: number }> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const workspaceId = options?.workspaceId ?? DEFAULT_WORKSPACE_ID;

    const scopedRuleIds = this.ruleTable()
      .where('workspace_id', workspaceId)
      .select('id');
    const q = this.groupTable().whereIn('rule_id', scopedRuleIds);
    if (options?.ruleId) {
      q.where('rule_id', options.ruleId);
    }
    if (options?.allowedRuleSlugs) {
      q.whereIn(
        'rule_id',
        this.ruleTable()
          .where('workspace_id', workspaceId)
          .whereIn('slug', options.allowedRuleSlugs)
          .select('id'),
      );
    }

    const [countResult] = await q
      .clone()
      .count<Array<{ count: string }>>('* as count');

    // id breaks created_at ties; without it, pagination across equal
    // timestamps can skip or duplicate rows.
    const rows = await q
      .orderBy([
        { column: 'created_at', order: 'desc' },
        { column: 'id', order: 'desc' },
      ])
      .limit(limit)
      .offset(offset);

    return {
      items: rows.map(row => rowToGroup(row, workspaceId)),
      total: Number(countResult.count),
    };
  }

  async getGroup(
    id: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<ContextGroup | undefined> {
    const row = await this.groupTable()
      .where('id', id)
      .whereIn(
        'rule_id',
        this.ruleTable().where('workspace_id', workspaceId).select('id'),
      )
      .first();
    return row ? rowToGroup(row, workspaceId) : undefined;
  }

  /**
   * Resolve the slug of the rule that produced a group, for scope checks on the
   * group's materialised output. Returns undefined when the group is unknown.
   */
  async getRuleSlugForGroup(
    groupId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<string | undefined> {
    const row = await this.groupTable()
      .join(RULE_TABLE, `${GROUP_TABLE}.rule_id`, '=', `${RULE_TABLE}.id`)
      .where(`${GROUP_TABLE}.id`, groupId)
      .andWhere(`${RULE_TABLE}.workspace_id`, workspaceId)
      .select(`${RULE_TABLE}.slug as slug`)
      .first<{ slug: string } | undefined>();
    return row?.slug;
  }

  async listGroupMembers(
    groupId: string,
    options?: {
      workspaceId?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<{ items: ContextGroupMember[]; total: number }> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const workspaceId = options?.workspaceId ?? DEFAULT_WORKSPACE_ID;
    const q = this.memberTable()
      .where('context_group_id', groupId)
      .whereIn(
        'context_group_id',
        this.groupTable()
          .whereIn(
            'rule_id',
            this.ruleTable().where('workspace_id', workspaceId).select('id'),
          )
          .select('id'),
      );

    const [countResult] = await q
      .clone()
      .count<Array<{ count: string }>>('* as count');

    const rows = await q
      .orderBy('created_at', 'asc')
      .limit(limit)
      .offset(offset);

    return {
      items: rows.map(row => rowToMember(row, workspaceId)),
      total: Number(countResult.count),
    };
  }

  /**
   * The outgoing relationship types actually present on a group's members, per
   * data source. Feeds the view builder's "expand related objects"
   * control — a template author would otherwise have to guess type names, and
   * a typed `related` call for a type nothing has renders an empty list with
   * no error.
   */
  async listGroupRelationTypes(
    groupId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<
    Array<{
      datasourceId: string;
      relationshipType: string;
      targetDatasourceId: string;
      count: number;
    }>
  > {
    // `datastore_relation` stores datasource ids as `uuid` while
    // `context_group_member` stores them as `text`, so the join and the
    // projected columns are cast explicitly — Postgres has no implicit
    // uuid/text comparison and errors out rather than coercing.
    const rows = await this.knex(RELATIONSHIP_TABLE)
      .join(
        MEMBER_TABLE,
        this.knex.raw(
          '??.source_datasource_id::text = ??.datasource_id and ??.source_object_id = ??.object_id',
          [RELATIONSHIP_TABLE, MEMBER_TABLE, RELATIONSHIP_TABLE, MEMBER_TABLE],
        ),
      )
      .where(`${MEMBER_TABLE}.context_group_id`, groupId)
      .andWhere(`${RELATIONSHIP_TABLE}.workspace_id`, workspaceId)
      .whereIn(
        `${MEMBER_TABLE}.context_group_id`,
        this.groupTable()
          .whereIn(
            'rule_id',
            this.ruleTable().where('workspace_id', workspaceId).select('id'),
          )
          .select('id'),
      )
      .groupBy(
        `${RELATIONSHIP_TABLE}.source_datasource_id`,
        `${RELATIONSHIP_TABLE}.relation_type`,
        `${RELATIONSHIP_TABLE}.destination_datasource_id`,
      )
      .select(
        this.knex.raw('??.source_datasource_id::text as datasource_id', [
          RELATIONSHIP_TABLE,
        ]),
        `${RELATIONSHIP_TABLE}.relation_type as relationship_type`,
        this.knex.raw(
          '??.destination_datasource_id::text as target_datasource_id',
          [RELATIONSHIP_TABLE],
        ),
      )
      .count<
        Array<{
          datasource_id: string;
          relationship_type: string;
          target_datasource_id: string;
          count: string;
        }>
      >('* as count');

    return rows.map(row => ({
      datasourceId: row.datasource_id,
      relationshipType: row.relationship_type,
      targetDatasourceId: row.target_datasource_id,
      count: Number(row.count),
    }));
  }

  async findGroupsByMember(
    datasourceId: string,
    objectId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<ContextGroupMembership[]> {
    const rows = await this.memberTable()
      .join(
        GROUP_TABLE,
        `${MEMBER_TABLE}.context_group_id`,
        '=',
        `${GROUP_TABLE}.id`,
      )
      .join(RULE_TABLE, `${GROUP_TABLE}.rule_id`, '=', `${RULE_TABLE}.id`)
      .where(`${MEMBER_TABLE}.datasource_id`, datasourceId)
      .where(`${MEMBER_TABLE}.object_id`, objectId)
      .andWhere(`${RULE_TABLE}.workspace_id`, workspaceId)
      .select<
        Array<{
          group_id: string;
          rule_id: string;
          rule_name: string;
          rule_slug: string;
        }>
      >(`${GROUP_TABLE}.id as group_id`, `${GROUP_TABLE}.rule_id as rule_id`, `${RULE_TABLE}.name as rule_name`, `${RULE_TABLE}.slug as rule_slug`);

    const titles = await this.getContextTitles(
      rows.map(row => row.group_id),
      workspaceId,
    );

    return rows.map(row => ({
      groupId: row.group_id,
      ruleId: row.rule_id,
      ruleName: row.rule_name,
      ruleSlug: row.rule_slug,
      title: `${row.rule_name}: ${titles.get(row.group_id) ?? row.group_id}`,
    }));
  }

  async findGroupsForObjects(
    objects: Array<{ datasourceId: string; objectId: string }>,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<
    Map<
      string,
      Array<{
        groupId: string;
        ruleName: string;
        ruleId: string;
        title: string;
      }>
    >
  > {
    if (objects.length === 0) {
      return new Map();
    }

    const memberRows = await this.memberTable()
      .join(
        GROUP_TABLE,
        `${MEMBER_TABLE}.context_group_id`,
        '=',
        `${GROUP_TABLE}.id`,
      )
      .join(RULE_TABLE, `${GROUP_TABLE}.rule_id`, '=', `${RULE_TABLE}.id`)
      .where(`${RULE_TABLE}.workspace_id`, workspaceId)
      .where(function () {
        for (const obj of objects) {
          this.orWhere({
            datasource_id: obj.datasourceId,
            object_id: obj.objectId,
          });
        }
      })
      .select(
        `${MEMBER_TABLE}.context_group_id`,
        `${MEMBER_TABLE}.datasource_id`,
        `${MEMBER_TABLE}.object_id`,
      );

    if (memberRows.length === 0) {
      const result = new Map<
        string,
        Array<{
          groupId: string;
          ruleName: string;
          ruleId: string;
          title: string;
        }>
      >();
      for (const obj of objects) {
        result.set(`${obj.datasourceId}:${obj.objectId}`, []);
      }
      return result;
    }

    const groupIds = [...new Set(memberRows.map(m => m.context_group_id))];
    const groupRows = await this.groupTable().whereIn('id', groupIds);

    const ruleIds = [...new Set(groupRows.map(g => g.rule_id))];
    const ruleRows = await this.ruleTable()
      .where('workspace_id', workspaceId)
      .whereIn('id', ruleIds);

    const ruleMap = new Map<string, string>();
    for (const rule of ruleRows) {
      ruleMap.set(rule.id, rule.name);
    }

    const groupRuleMap = new Map<
      string,
      { ruleId: string; ruleName: string }
    >();
    for (const group of groupRows) {
      groupRuleMap.set(group.id, {
        ruleId: group.rule_id,
        ruleName: ruleMap.get(group.rule_id) ?? 'Unknown',
      });
    }

    const result = new Map<
      string,
      Array<{
        groupId: string;
        ruleName: string;
        ruleId: string;
        title: string;
      }>
    >();
    for (const obj of objects) {
      result.set(`${obj.datasourceId}:${obj.objectId}`, []);
    }

    const titles = await this.getContextTitles(groupIds, workspaceId);

    for (const member of memberRows) {
      const key = `${member.datasource_id}:${member.object_id}`;
      const refs = result.get(key);
      const groupInfo = groupRuleMap.get(member.context_group_id);
      if (refs && groupInfo) {
        const exists = refs.some(r => r.groupId === member.context_group_id);
        if (!exists) {
          refs.push({
            groupId: member.context_group_id,
            ruleName: groupInfo.ruleName,
            ruleId: groupInfo.ruleId,
            title: `${groupInfo.ruleName}: ${
              titles.get(member.context_group_id) ?? member.context_group_id
            }`,
          });
        }
      }
    }

    return result;
  }

  async listGroupTitlesForDatasource(
    datasourceId: string,
    options?: {
      workspaceId?: string;
      q?: string;
      limit?: number;
      allowedRuleSlugs?: string[];
    },
  ): Promise<string[]> {
    const q = options?.q?.trim().toLocaleLowerCase() ?? '';
    const limit = options?.limit ?? 20;
    const workspaceId = options?.workspaceId ?? DEFAULT_WORKSPACE_ID;

    const groupIdQuery = this.memberTable()
      .distinct(`${MEMBER_TABLE}.context_group_id`)
      .where(`${MEMBER_TABLE}.datasource_id`, datasourceId)
      .join(
        GROUP_TABLE,
        `${MEMBER_TABLE}.context_group_id`,
        '=',
        `${GROUP_TABLE}.id`,
      )
      .join(RULE_TABLE, `${GROUP_TABLE}.rule_id`, '=', `${RULE_TABLE}.id`);
    groupIdQuery.where(`${RULE_TABLE}.workspace_id`, workspaceId);

    if (options?.allowedRuleSlugs) {
      groupIdQuery.whereIn(`${RULE_TABLE}.slug`, options.allowedRuleSlugs);
    }

    const groupIds = (
      await groupIdQuery.select<{ context_group_id: string }[]>(
        `${MEMBER_TABLE}.context_group_id`,
      )
    ).map(row => row.context_group_id);

    if (groupIds.length === 0) {
      return [];
    }

    const groupRows = await this.groupTable().whereIn('id', groupIds);
    const ruleRows = await this.ruleTable()
      .where('workspace_id', workspaceId)
      .whereIn('id', [...new Set(groupRows.map(row => row.rule_id))]);
    const ruleNames = new Map(ruleRows.map(row => [row.id, row.name]));
    const titles = await this.getContextTitles(groupIds, workspaceId);

    return [
      ...new Set(
        groupRows
          .map(group => {
            const ruleName = ruleNames.get(group.rule_id);
            if (!ruleName) {
              return undefined;
            }
            return `${ruleName}: ${titles.get(group.id) ?? group.id}`;
          })
          .filter((title): title is string => Boolean(title)),
      ),
    ]
      .filter(title => (q ? title.toLocaleLowerCase().includes(q) : true))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, limit);
  }

  async getGroupWithMembers(
    groupId: string,
    options?: ContextGroupBundleOptions & { workspaceId?: string },
  ): Promise<{
    id: string;
    workspaceId: string;
    ownership: 'org' | 'workspace';
    ruleId: string;
    ruleName: string;
    ruleDescription: string | null;
    title: string;
    totalMembers: number;
    totalInternalRelationships: number;
    totalExternalRelationships: number;
    datasourceIds: string[];
    members: PresentedObject[];
    internalRelationships: ContextBundleRelationship[];
    externalRelationships: ContextBundleRelationship[];
    annotations: Annotation[];
    datasources: Array<{
      datasourceId: string;
      annotation?: Annotation;
      objects: Array<{ objectId: string; data: unknown }>;
    }>;
    externalRelations?: Array<{
      fromDatasourceId: string;
      fromObjectId: string;
      toDatasourceId: string;
      toObjectId: string;
      relationshipType: string;
    }>;
  } | null> {
    const workspaceId = options?.workspaceId ?? DEFAULT_WORKSPACE_ID;
    const groupRow = await this.groupTable()
      .where('id', groupId)
      .whereIn(
        'rule_id',
        this.ruleTable().where('workspace_id', workspaceId).select('id'),
      )
      .first();
    if (!groupRow) {
      return null;
    }

    const ruleRow = await this.ruleTable()
      .where({ id: groupRow.rule_id, workspace_id: workspaceId })
      .first();
    const rule = ruleRow ? rowToRule(ruleRow) : null;

    // Per-datasource projection/annotation from the rule, keyed by the resolved
    // datasource id (a filter may only carry its id via `status`). Drives the
    // read-time projection + annotation on the `datasources` view below.
    const datasourceConfig = new Map<
      string,
      { projection?: DatasourceFilter['projection']; annotation?: Annotation }
    >();
    for (const filter of rule?.datasources ?? []) {
      const dsId = filter.datasourceId || filter.status?.datasourceId;
      if (dsId) {
        datasourceConfig.set(dsId, {
          projection: filter.projection,
          annotation: filter.annotation,
        });
      }
    }

    // Optional datasource slice for the projected `datasources`/`externalRelations`
    // view (progressive agent loading); does not affect the drawer member lists.
    const datasourceFilter = options?.datasourceIds
      ? new Set(options.datasourceIds)
      : undefined;

    const memberQuery = this.memberTable()
      .where('context_group_id', groupId)
      .select('datasource_id', 'object_id')
      .orderBy('created_at', 'asc');

    if (options?.memberLimit !== undefined) {
      memberQuery.limit(options.memberLimit);
    }

    const [memberCountRow, datasourceRows, memberRows] = await Promise.all([
      this.memberTable()
        .where('context_group_id', groupId)
        .count<Array<{ count: string }>>('* as count')
        .first(),
      this.memberTable()
        .where('context_group_id', groupId)
        .distinct('datasource_id'),
      memberQuery,
    ]);

    const memberKeySet = new Set(
      memberRows.map(m => `${m.datasource_id}:${m.object_id}`),
    );
    const memberObjects = await this.loadPresentedObjects(
      memberRows.map(m => ({
        datasourceId: m.datasource_id,
        objectId: m.object_id,
      })),
      workspaceId,
    );

    const members = memberRows.map(m => {
      const object = memberObjects.get(`${m.datasource_id}:${m.object_id}`);
      return {
        datasourceId: m.datasource_id,
        objectId: m.object_id,
        object: object?.object ?? {},
        presentation:
          object?.presentation ?? resolveObjectPresentation({}, m.object_id),
      };
    });

    // Projected, datasource-grouped view (agent bundle): apply each datasource's
    // read-time projection + annotation, optionally sliced by `datasourceIds`.
    const groupsByDatasource = new Map<
      string,
      {
        datasourceId: string;
        annotation?: Annotation;
        objects: Array<{ objectId: string; data: unknown }>;
      }
    >();
    for (const m of memberRows) {
      if (datasourceFilter && !datasourceFilter.has(m.datasource_id)) {
        continue;
      }
      let group = groupsByDatasource.get(m.datasource_id);
      if (!group) {
        const config = datasourceConfig.get(m.datasource_id);
        group = {
          datasourceId: m.datasource_id,
          annotation: config?.annotation,
          objects: [],
        };
        groupsByDatasource.set(m.datasource_id, group);
      }
      const object =
        memberObjects.get(`${m.datasource_id}:${m.object_id}`)?.object ?? {};
      group.objects.push({
        objectId: m.object_id,
        data: applyProjection(
          object,
          datasourceConfig.get(m.datasource_id)?.projection,
        ),
      });
    }

    const datasources = [...groupsByDatasource.values()].sort((a, b) =>
      a.datasourceId.localeCompare(b.datasourceId),
    );

    let internalRelationships: ContextBundleRelationship[] = [];
    let externalRelationships: ContextBundleRelationship[] = [];
    let totalInternalRelationships = 0;
    let totalExternalRelationships = 0;

    const knex = this.knex;
    const sourceMemberSubquery = () =>
      knex
        .select(knex.raw('1'))
        .from(`${MEMBER_TABLE} as source_member`)
        .where('source_member.context_group_id', groupId)
        .whereRaw(
          'source_member.datasource_id = CAST(rel.source_datasource_id AS text)',
        )
        .whereRaw(
          'source_member.object_id = CAST(rel.source_object_id AS text)',
        );
    const destinationMemberSubquery = () =>
      knex
        .select(knex.raw('1'))
        .from(`${MEMBER_TABLE} as destination_member`)
        .where('destination_member.context_group_id', groupId)
        .whereRaw(
          'destination_member.datasource_id = CAST(rel.destination_datasource_id AS text)',
        )
        .whereRaw(
          'destination_member.object_id = CAST(rel.destination_object_id AS text)',
        );
    const linkedRelationshipQuery = () =>
      knex(`${RELATIONSHIP_TABLE} as rel`)
        .where('rel.workspace_id', workspaceId)
        .where(builder => {
          builder
            .whereExists(sourceMemberSubquery())
            .orWhereExists(destinationMemberSubquery());
        });
    const internalRelationshipQuery = () =>
      knex(`${RELATIONSHIP_TABLE} as rel`)
        .where('rel.workspace_id', workspaceId)
        .whereExists(sourceMemberSubquery())
        .whereExists(destinationMemberSubquery());

    const [linkedCountRow, internalCountRow] = await Promise.all([
      linkedRelationshipQuery()
        .countDistinct<Array<{ count: string }>>('rel.id as count')
        .first(),
      internalRelationshipQuery()
        .countDistinct<Array<{ count: string }>>('rel.id as count')
        .first(),
    ]);

    const totalLinkedRelationships = Number(linkedCountRow?.count ?? 0);
    totalInternalRelationships = Number(internalCountRow?.count ?? 0);
    totalExternalRelationships =
      totalLinkedRelationships - totalInternalRelationships;

    if (totalLinkedRelationships > 0) {
      const selectRelationshipColumns = (query: Knex.QueryBuilder) =>
        query
          .select(
            'rel.id',
            'rel.source_datasource_id',
            'rel.source_object_id',
            'rel.destination_datasource_id',
            'rel.destination_object_id',
            'rel.relation_type',
            'rel.reciprocal_relation_type',
          )
          .orderBy('rel.id', 'asc');
      const externalRelationshipQuery = () =>
        linkedRelationshipQuery().whereNot(builder => {
          builder
            .whereExists(sourceMemberSubquery())
            .whereExists(destinationMemberSubquery());
        });

      const relationshipRows: ContextGroupRelationshipRow[] =
        options?.relationshipLimit !== undefined
          ? [
              ...((await selectRelationshipColumns(
                internalRelationshipQuery(),
              ).limit(
                options.relationshipLimit,
              )) as ContextGroupRelationshipRow[]),
              ...((await selectRelationshipColumns(
                externalRelationshipQuery(),
              ).limit(
                options.relationshipLimit,
              )) as ContextGroupRelationshipRow[]),
            ]
          : ((await selectRelationshipColumns(
              linkedRelationshipQuery(),
            )) as ContextGroupRelationshipRow[]);

      const relationshipEndpointKeys: Array<{
        datasourceId: string;
        objectId: string;
      }> = [
        ...new Map<
          string,
          {
            datasourceId: string;
            objectId: string;
          }
        >(
          relationshipRows.flatMap(
            (
              r,
            ): Array<
              [
                string,
                {
                  datasourceId: string;
                  objectId: string;
                },
              ]
            > => [
              [
                `${r.source_datasource_id}:${r.source_object_id}`,
                {
                  datasourceId: r.source_datasource_id,
                  objectId: r.source_object_id,
                },
              ],
              [
                `${r.destination_datasource_id}:${r.destination_object_id}`,
                {
                  datasourceId: r.destination_datasource_id,
                  objectId: r.destination_object_id,
                },
              ],
            ],
          ),
        ).values(),
      ];
      const relationshipMemberRows =
        relationshipEndpointKeys.length > 0
          ? await this.memberTable()
              .where('context_group_id', groupId)
              .where(function () {
                for (const key of relationshipEndpointKeys) {
                  this.orWhere({
                    datasource_id: key.datasourceId,
                    object_id: key.objectId,
                  });
                }
              })
              .select('datasource_id', 'object_id')
          : [];
      const relationshipMemberKeySet = new Set(
        relationshipMemberRows.map(
          row => `${row.datasource_id}:${row.object_id}`,
        ),
      );
      const relationshipObjects = await this.loadPresentedObjects(
        relationshipEndpointKeys,
        workspaceId,
      );
      const endpointFor = (datasourceId: string, objectId: string) => {
        const key = `${datasourceId}:${objectId}`;
        return (
          memberObjects.get(key) ??
          relationshipObjects.get(key) ?? {
            datasourceId,
            objectId,
            object: {},
            presentation: resolveObjectPresentation({}, objectId),
          }
        );
      };
      const relationships: ContextBundleRelationship[] = relationshipRows.map(
        r => {
          const sourceKey = `${r.source_datasource_id}:${r.source_object_id}`;
          const destinationKey = `${r.destination_datasource_id}:${r.destination_object_id}`;
          const sourceIsMember = relationshipMemberKeySet.has(sourceKey);
          const destinationIsMember =
            relationshipMemberKeySet.has(destinationKey);
          return {
            id: r.id,
            source: endpointFor(r.source_datasource_id, r.source_object_id),
            destination: endpointFor(
              r.destination_datasource_id,
              r.destination_object_id,
            ),
            relationshipType: r.relation_type,
            reciprocalRelationshipType: r.reciprocal_relation_type,
            direction:
              sourceIsMember && destinationIsMember
                ? ('internal' as const)
                : sourceIsMember
                  ? ('outgoing' as const)
                  : ('incoming' as const),
          };
        },
      );
      internalRelationships = relationships.filter(
        (relationship: ContextBundleRelationship) =>
          relationship.direction === 'internal',
      );
      externalRelationships = relationships.filter(
        (relationship: ContextBundleRelationship) =>
          relationship.direction !== 'internal',
      );
    }

    // Simple outgoing external relations (agent bundle), gated by the rule flag
    // and sliced by `datasourceIds`. Distinct from the rich `externalRelationships`.
    let externalRelations:
      | Array<{
          fromDatasourceId: string;
          fromObjectId: string;
          toDatasourceId: string;
          toObjectId: string;
          relationshipType: string;
        }>
      | undefined;

    if (rule?.includeExternalRelations && memberRows.length > 0) {
      const outgoingRows = await this.knex(RELATIONSHIP_TABLE)
        .where('workspace_id', workspaceId)
        .where(function () {
          for (const m of memberRows) {
            this.orWhere({
              source_datasource_id: m.datasource_id,
              source_object_id: m.object_id,
            });
          }
        })
        .select(
          'source_datasource_id',
          'source_object_id',
          'destination_datasource_id',
          'destination_object_id',
          'relation_type',
        );

      externalRelations = outgoingRows
        .filter(r => {
          const targetKey = `${r.destination_datasource_id}:${r.destination_object_id}`;
          if (memberKeySet.has(targetKey)) return false;
          // When slicing to specific datasources, only keep relations whose
          // source is in the requested slice.
          return (
            !datasourceFilter || datasourceFilter.has(r.source_datasource_id)
          );
        })
        .map(r => ({
          fromDatasourceId: r.source_datasource_id,
          fromObjectId: r.source_object_id,
          toDatasourceId: r.destination_datasource_id,
          toObjectId: r.destination_object_id,
          relationshipType: r.relation_type,
        }));
    }

    const memberTitle = members[0]?.presentation.title ?? groupRow.id;
    const ruleName = rule?.name ?? 'Unknown';

    return {
      id: groupRow.id,
      ...workspaceOwnershipFields(workspaceId),
      ruleId: groupRow.rule_id,
      ruleName,
      ruleDescription: rule?.description ?? null,
      title: `${ruleName}: ${memberTitle}`,
      totalMembers: Number(memberCountRow?.count ?? 0),
      totalInternalRelationships,
      totalExternalRelationships,
      datasourceIds: datasourceRows.map(row => row.datasource_id),
      members,
      internalRelationships,
      externalRelationships,
      annotations: rule?.annotations ?? [],
      datasources,
      externalRelations,
    };
  }

  /**
   * The document key each of the rule's datasources renders under
   * (`members[<key>]`), in the rule's datasource order. The key IS the data
   * source's slug — every datasource has one, and slugs are unique. A
   * datasource the workflow service can't resolve to a slug is excluded
   * entirely; a workflow listing failure propagates rather than rendering
   * wrong keys. Shared by the render-time group document and the design-time
   * view schema so the builder addresses exactly the keys templates see.
   */
  async getRuleDocumentKeys(
    rule: ContextGroupRule,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<Array<{ datasourceId: string; key: string }>> {
    const slugByDatasourceId = new Map<string, string>();
    for (const workflow of await this.listAllWorkflows(workspaceId)) {
      if (workflow.slug) {
        slugByDatasourceId.set(workflow.id, workflow.slug);
      }
    }
    const entries: Array<{ datasourceId: string; key: string }> = [];
    for (const filter of rule.datasources ?? []) {
      const datasourceId = filter.datasourceId || filter.status?.datasourceId;
      if (
        !datasourceId ||
        entries.some(entry => entry.datasourceId === datasourceId)
      ) {
        continue;
      }
      const key = slugByDatasourceId.get(datasourceId);
      if (key) {
        entries.push({ datasourceId, key });
      }
    }
    return entries;
  }

  /**
   * The oldest group under the rule containing a member from the datasource —
   * the per-source sample the view schema reads relationship types from, since
   * no single group need span every datasource.
   */
  async findSampleGroupIdForDatasource(
    ruleId: string,
    datasourceId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<string | undefined> {
    const row = await this.memberTable()
      .join(
        GROUP_TABLE,
        `${MEMBER_TABLE}.context_group_id`,
        '=',
        `${GROUP_TABLE}.id`,
      )
      .where(`${GROUP_TABLE}.rule_id`, ruleId)
      .whereIn(
        `${GROUP_TABLE}.rule_id`,
        this.ruleTable().where('workspace_id', workspaceId).select('id'),
      )
      .where(`${MEMBER_TABLE}.datasource_id`, datasourceId)
      .orderBy(`${GROUP_TABLE}.created_at`, 'asc')
      .select<{ group_id: string }>(`${GROUP_TABLE}.id as group_id`)
      .first();
    return row?.group_id;
  }

  /**
   * Build the document a view template renders against: group identity,
   * rule identity, and member objects grouped under the datasource's slug
   * (`members['github-members'][0].data`). Members are wrapped with their
   * identity so the `related`/`object` data functions can chain from them.
   */
  async getGroupDocument(
    groupId: string,
    options?: { memberLimit?: number; workspaceId?: string },
  ): Promise<ContextGroupDocument | null> {
    const workspaceId = options?.workspaceId ?? DEFAULT_WORKSPACE_ID;
    const groupRow = await this.groupTable()
      .where('id', groupId)
      .whereIn(
        'rule_id',
        this.ruleTable().where('workspace_id', workspaceId).select('id'),
      )
      .first();
    if (!groupRow) {
      return null;
    }
    const ruleRow = await this.ruleTable()
      .where({ id: groupRow.rule_id, workspace_id: workspaceId })
      .first();
    const rule = ruleRow ? rowToRule(ruleRow) : null;

    const memberQuery = this.memberTable()
      .where('context_group_id', groupId)
      .select('datasource_id', 'object_id')
      .orderBy('created_at', 'asc');
    if (options?.memberLimit !== undefined) {
      memberQuery.limit(options.memberLimit);
    }
    const memberRows = await memberQuery;
    const objects = await this.loadPresentedObjects(
      memberRows.map(m => ({
        datasourceId: m.datasource_id,
        objectId: m.object_id,
      })),
      workspaceId,
    );

    const keyByDatasourceId = new Map<string, string>();
    if (rule) {
      for (const entry of await this.getRuleDocumentKeys(rule, workspaceId)) {
        keyByDatasourceId.set(entry.datasourceId, entry.key);
      }
    }

    const members: Record<string, ContextGroupDocumentMember[]> = {};
    for (const m of memberRows) {
      // Only datasources with a slug render. A member whose datasource is no
      // longer on the rule (or has no slug) is omitted — re-materialization
      // prunes such members anyway.
      const key = keyByDatasourceId.get(m.datasource_id);
      if (!key) {
        continue;
      }
      const object = objects.get(`${m.datasource_id}:${m.object_id}`);
      (members[`${key}`] ??= []).push({
        datasourceId: m.datasource_id,
        objectId: m.object_id,
        data: object?.object ?? {},
      });
    }

    const first = memberRows[0];
    const firstPresented = first
      ? objects.get(`${first.datasource_id}:${first.object_id}`)
      : undefined;

    return {
      group: {
        id: groupRow.id,
        name: firstPresented?.presentation.title ?? groupRow.id,
      },
      rule: {
        id: groupRow.rule_id,
        name: rule?.name ?? 'Unknown',
        slug: rule?.slug ?? '',
        description: rule?.description ?? null,
      },
      members,
    };
  }

  /** Data functions exposed to view templates as Liquid filters.
   *  `related` follows outgoing relationships only. Called without a type it
   *  returns lightweight references grouped by relationship type — so
   *  templates can show *how* targets are related without paying for their
   *  data; expanding a reference is an explicit `object` call. With a type
   *  argument it returns a flat list of full member wrappers, which chain
   *  into further `related`/`object` calls. */
  private viewDataFunctions(workspaceId: string): LiquidDataFunctions {
    const asMemberIdentity = (
      value: unknown,
    ): { datasourceId: string; objectId: string } | undefined => {
      if (value === null || typeof value !== 'object') return undefined;
      const record = value as Record<string, unknown>;
      const datasourceId = record.datasourceId;
      const objectId = record.objectId;
      return typeof datasourceId === 'string' && typeof objectId === 'string'
        ? { datasourceId, objectId }
        : undefined;
    };

    // Lazy per-render datasource id → slug map for `related` references;
    // falls back to the raw id when the workflow service can't resolve one.
    let slugByDatasourceId: Map<string, string> | undefined;
    const resolveDatasourceSlug = async (
      datasourceId: string,
    ): Promise<string> => {
      if (!slugByDatasourceId) {
        slugByDatasourceId = new Map();
        try {
          for (const workflow of await this.listAllWorkflows(workspaceId)) {
            if (workflow.slug) {
              slugByDatasourceId.set(workflow.id, workflow.slug);
            }
          }
        } catch {
          // Best-effort; the raw-id fallback below still applies.
        }
      }
      return slugByDatasourceId.get(datasourceId) ?? datasourceId;
    };

    return {
      related: async (...args: unknown[]) => {
        const relationshipType =
          typeof args[1] === 'string' ? args[1] : undefined;
        const member = asMemberIdentity(args[0]);
        if (!member) return relationshipType ? [] : {};
        const query = this.knex(RELATIONSHIP_TABLE)
          .where('workspace_id', workspaceId)
          .where({
            source_datasource_id: member.datasourceId,
            source_object_id: member.objectId,
          })
          .select(
            'destination_datasource_id',
            'destination_object_id',
            'relation_type',
          )
          .orderBy('id', 'asc')
          .limit(RELATED_TARGET_LIMIT);
        if (relationshipType) {
          query.where('relation_type', relationshipType);
        }
        const rows = await query;

        if (relationshipType) {
          // Typed: full member wrappers, chainable into further data calls.
          const targets = await this.loadPresentedObjects(
            rows.map(r => ({
              datasourceId: r.destination_datasource_id,
              objectId: r.destination_object_id,
            })),
            workspaceId,
          );
          return rows.map(r => {
            const key = `${r.destination_datasource_id}:${r.destination_object_id}`;
            return {
              datasourceId: r.destination_datasource_id,
              objectId: r.destination_object_id,
              data: targets.get(key)?.object ?? {},
            };
          });
        }

        // Untyped: identity references only, grouped by relationship type.
        // `count` is the true per-type total, so it stays honest when `items`
        // is truncated by the target limit.
        const countRows = await this.knex(RELATIONSHIP_TABLE)
          .where('workspace_id', workspaceId)
          .where({
            source_datasource_id: member.datasourceId,
            source_object_id: member.objectId,
          })
          .select('relation_type')
          .count<Array<{ relation_type: string; count: string }>>('* as count')
          .groupBy('relation_type');
        const grouped: Record<
          string,
          {
            count: number;
            items: Array<{
              datasourceId: string;
              datasourceSlug: string;
              objectId: string;
            }>;
          }
        > = {};
        for (const countRow of countRows) {
          grouped[`${countRow.relation_type}`] = {
            count: Number(countRow.count),
            items: [],
          };
        }
        for (const row of rows) {
          grouped[`${row.relation_type}`]?.items.push({
            datasourceId: row.destination_datasource_id,
            datasourceSlug: await resolveDatasourceSlug(
              row.destination_datasource_id,
            ),
            objectId: row.destination_object_id,
          });
        }
        return grouped;
      },
      object: async (...args: unknown[]) => {
        const [datasourceId, objectId] = args;
        if (typeof datasourceId !== 'string' || typeof objectId !== 'string') {
          return null;
        }
        const loaded = await this.loadPresentedObjects(
          [{ datasourceId, objectId }],
          workspaceId,
        );
        const hit = loaded.get(`${datasourceId}:${objectId}`);
        return hit ? { datasourceId, objectId, data: hit.object } : null;
      },
    };
  }

  /**
   * Render an ad-hoc (draft) template against a real group — the editor's
   * preview path. Parse-validates first so authors get positioned errors, then
   * renders with the same data functions and budget as the real bundle.
   * Returns null for an unknown group.
   */
  async renderTemplate(
    groupId: string,
    template: string,
    options?: {
      memberLimit?: number;
      budget?: LiquidRenderBudget;
      workspaceId?: string;
    },
  ): Promise<{ rendered: string } | null> {
    const workspaceId = options?.workspaceId ?? DEFAULT_WORKSPACE_ID;
    assertValidViewTemplate(template);
    const document = await this.getGroupDocument(groupId, {
      memberLimit: options?.memberLimit ?? RENDER_MEMBER_LIMIT,
      workspaceId,
    });
    if (!document) {
      return null;
    }
    const rendered = await renderLiquidSafe(template, document, {
      data: this.viewDataFunctions(workspaceId),
      budget: options?.budget,
    });
    return { rendered };
  }

  /**
   * Render a group through one of its rule's named views (the default
   * when none is requested). Throws ViewNotFoundError for an unknown
   * view name; returns null for an unknown group.
   */
  async renderBundle(
    groupId: string,
    options?: RenderBundleOptions & { workspaceId?: string },
  ): Promise<RenderedBundle | null> {
    const workspaceId = options?.workspaceId ?? DEFAULT_WORKSPACE_ID;
    const groupRow = await this.getGroup(groupId, workspaceId);
    if (!groupRow) {
      return null;
    }

    const views = await this.listViews(groupRow.ruleId, workspaceId);
    let chosen: ContextGroupView | undefined;
    if (options?.view) {
      chosen = views.find(p => p.name === options.view);
      if (!chosen) {
        throw new ViewNotFoundError(options.view);
      }
    } else {
      chosen = views.find(p => p.isDefault) ?? views[0];
    }

    const document = await this.getGroupDocument(groupId, {
      memberLimit: options?.memberLimit ?? RENDER_MEMBER_LIMIT,
      workspaceId,
    });
    if (!document) {
      return null;
    }

    const rendered = await renderLiquidSafe(
      // Rules predating the views migration have no rows; the built-in
      // full-dump default keeps them renderable.
      chosen?.template ?? DEFAULT_VIEW_TEMPLATE,
      document,
      {
        data: this.viewDataFunctions(workspaceId),
        budget: options?.budget,
      },
    );

    return {
      groupId: groupRow.id,
      ...workspaceOwnershipFields(workspaceId),
      ruleId: groupRow.ruleId,
      ruleName: document.rule.name,
      group: document.group,
      rule: document.rule,
      view: chosen
        ? { name: chosen.name, description: chosen.description }
        : {
            name: DEFAULT_VIEW_NAME,
            description: DEFAULT_VIEW_DESCRIPTION,
          },
      availableViews: views.map(p => ({
        name: p.name,
        description: p.description,
        isDefault: p.isDefault,
      })),
      rendered,
    };
  }

  async getGroupsWithMembers(
    ruleId: string,
    options?: {
      workspaceId?: string;
      limit?: number;
      offset?: number;
      q?: string;
    },
  ): Promise<{
    groups: Array<{
      id: string;
      name: string;
      members: Array<{
        datasourceId: string;
        objectId: string;
        displayName: string;
        object: unknown;
      }>;
    }>;
    totalGroups: number;
  }> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const q = options?.q?.trim();
    const workspaceId = options?.workspaceId ?? DEFAULT_WORKSPACE_ID;
    const scopedRuleIds = this.ruleTable()
      .where('workspace_id', workspaceId)
      .select('id');

    // A text query keeps a group when ANY member's object matches, using the
    // same `search_text` grammar as the object search (shared via
    // parseSearchQuery) so the two agree on what "matches" means. The member
    // table stores datasource_id as text while the datastore stores a uuid, so
    // the join casts the uuid side (casting the text side would throw on any
    // non-uuid value).
    const parsedSearch = q ? parseSearchQuery(q) : null;
    const withMemberSearch = <TRecord extends object, TResult>(
      query: Knex.QueryBuilder<TRecord, TResult>,
    ): Knex.QueryBuilder<TRecord, TResult> => {
      if (!parsedSearch) {
        return query;
      }
      const memberMatch = [
        ...parsedSearch.include.map(() => `search_object.search_text ILIKE ?`),
        ...parsedSearch.exclude.map(
          () => `search_object.search_text NOT ILIKE ?`,
        ),
      ].join(' and ');
      const patterns = [...parsedSearch.include, ...parsedSearch.exclude].map(
        pattern => `%${escapeIlike(pattern)}%`,
      );
      return query.whereRaw(
        `exists (
           select 1
           from ${MEMBER_TABLE} as search_member
           join ${DATASTORE_TABLE} as search_object
             on search_member.datasource_id = search_object.datasource_id::text
            and search_member.object_id = search_object.object_id
           where search_member.context_group_id = ${GROUP_TABLE}.id
             and search_object.workspace_id = ?
             and ${memberMatch}
         )`,
        [workspaceId, ...patterns],
      );
    };

    const [countResult] = await withMemberSearch(
      this.groupTable()
        .where('rule_id', ruleId)
        .whereIn('rule_id', scopedRuleIds),
    ).count<Array<{ count: string }>>('* as count');
    const totalGroups = Number(countResult.count);

    const groupRows = await withMemberSearch(
      this.groupTable()
        .where('rule_id', ruleId)
        .whereIn('rule_id', scopedRuleIds),
    )
      .orderBy('created_at', 'asc')
      .limit(limit)
      .offset(offset);

    if (groupRows.length === 0) {
      return { groups: [], totalGroups };
    }

    const groupIds = groupRows.map(g => g.id);

    const memberRows = await this.memberTable()
      .whereIn('context_group_id', groupIds)
      .select('context_group_id', 'datasource_id', 'object_id');

    const objectKeys = memberRows.map(m => `${m.datasource_id}:${m.object_id}`);
    const uniqueKeys = [...new Set(objectKeys)];

    const objectData = new Map<string, unknown>();
    if (uniqueKeys.length > 0) {
      const conditions = uniqueKeys.map(key => {
        const [dsId, objId] = splitMemberKey(key);
        return { datasource_id: dsId, object_id: objId };
      });

      const dataRows = await this.knex(DATASTORE_TABLE)
        .where('workspace_id', workspaceId)
        .where(function () {
          for (const cond of conditions) {
            this.orWhere(cond);
          }
        })
        .select('datasource_id', 'object_id', 'object');

      for (const row of dataRows) {
        const key = `${row.datasource_id}:${row.object_id}`;
        const parsed =
          typeof row.object === 'string' ? JSON.parse(row.object) : row.object;
        objectData.set(key, parsed);
      }
    }

    const groups = groupRows.map(g => {
      const members = memberRows
        .filter(m => m.context_group_id === g.id)
        .map(m => {
          const object =
            objectData.get(`${m.datasource_id}:${m.object_id}`) ?? {};
          return {
            datasourceId: m.datasource_id,
            objectId: m.object_id,
            displayName: deriveObjectLabel(object) ?? m.object_id,
            object,
          };
        });

      return {
        id: g.id,
        name: members[0]?.displayName ?? 'Unknown',
        members,
      };
    });

    return { groups, totalGroups };
  }

  async materializeRule(
    ruleId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<void> {
    await this.knex.transaction(async trx => {
      // A rebuild is delete-then-insert of the rule's whole group set. Under
      // read committed a concurrent rebuild's DELETE cannot see this
      // transaction's uncommitted inserts, so two overlapping rebuilds both
      // commit their sets and every object lands in two groups. The per-rule
      // lock makes the second rebuild wait until the first commits, so its
      // DELETE sees (and replaces) the committed set.
      await trx.raw(`SELECT pg_advisory_xact_lock(hashtext(?))`, [
        `${CONTEXT_GROUP_MATERIALIZE_LOCK_NS}${ruleId}`,
      ]);
      const ruleRow = await this.ruleTable(trx)
        .where({ id: ruleId, workspace_id: workspaceId })
        .first();
      if (!ruleRow) {
        throw new Error(`Rule ${ruleId} not found`);
      }
      const rule = rowToRule(ruleRow);
      const datasources = await this.getLiveDatasourceFilters(
        rule.datasources,
        workspaceId,
      );
      await this.groupTable(trx).where('rule_id', ruleId).delete();

      const datasourceIds = datasources.map(s => s.datasourceId);
      if (datasourceIds.length === 0) {
        return;
      }

      const filtersByDatasource = new Map<string, FilterCondition[]>();
      for (const ds of datasources) {
        filtersByDatasource.set(
          ds.datasourceId,
          parseFilterConditions(ds.filter),
        );
      }

      const allRows = await trx(DATASTORE_TABLE)
        .where('workspace_id', workspaceId)
        .whereIn('datasource_id', datasourceIds)
        .select('datasource_id', 'object_id', 'object');

      const objects = allRows.filter(row => {
        const filters = filtersByDatasource.get(row.datasource_id) ?? [];
        if (filters.length === 0) return true;
        try {
          const obj =
            typeof row.object === 'string'
              ? JSON.parse(row.object)
              : row.object;
          return objectMatchesFilters(obj, filters);
        } catch {
          return false;
        }
      });

      if (objects.length === 0) {
        return;
      }

      const objectToGroup = new Map<string, string>();
      const groupMembers = new Map<
        string,
        Array<{ datasourceId: string; objectId: string }>
      >();

      for (const obj of objects) {
        const groupId = uuid();
        const key = `${obj.datasource_id}:${obj.object_id}`;
        objectToGroup.set(key, groupId);
        groupMembers.set(groupId, [
          { datasourceId: obj.datasource_id, objectId: obj.object_id },
        ]);
      }

      if (rule.mergeRelationshipTypes.length > 0) {
        const relationships = await trx(RELATIONSHIP_TABLE)
          .where('workspace_id', workspaceId)
          .whereIn('source_datasource_id', datasourceIds)
          .whereIn('destination_datasource_id', datasourceIds)
          // Either name: reciprocal_relation_type is the same edge read from
          // the other side, and the merge is direction-agnostic anyway.
          .where(builder =>
            builder
              .whereIn('relation_type', rule.mergeRelationshipTypes)
              .orWhereIn(
                'reciprocal_relation_type',
                rule.mergeRelationshipTypes,
              ),
          )
          .select(
            'source_datasource_id',
            'source_object_id',
            'destination_datasource_id',
            'destination_object_id',
          );

        for (const rel of relationships) {
          const sourceKey = `${rel.source_datasource_id}:${rel.source_object_id}`;
          const destKey = `${rel.destination_datasource_id}:${rel.destination_object_id}`;

          const sourceGroup = objectToGroup.get(sourceKey);
          const destGroup = objectToGroup.get(destKey);

          if (sourceGroup && destGroup && sourceGroup !== destGroup) {
            const destMembers = groupMembers.get(destGroup) || [];
            const sourceMembers = groupMembers.get(sourceGroup) || [];

            for (const member of destMembers) {
              objectToGroup.set(
                `${member.datasourceId}:${member.objectId}`,
                sourceGroup,
              );
            }
            sourceMembers.push(...destMembers);
            groupMembers.set(sourceGroup, sourceMembers);
            groupMembers.delete(destGroup);
          }
        }
      }

      const uniqueGroupIds = [...new Set(objectToGroup.values())];

      if (uniqueGroupIds.length > 0) {
        const groupRows = uniqueGroupIds.map(groupId => ({
          id: groupId,
          rule_id: ruleId,
          created_at: new Date(),
          updated_at: new Date(),
        }));

        for (let i = 0; i < groupRows.length; i += MATERIALIZE_BATCH_SIZE) {
          await trx(GROUP_TABLE).insert(
            groupRows.slice(i, i + MATERIALIZE_BATCH_SIZE),
          );
        }

        const memberRows: Array<{
          id: string;
          context_group_id: string;
          datasource_id: string;
          object_id: string;
          created_at: Date;
        }> = [];

        for (const [key, groupId] of objectToGroup.entries()) {
          const [datasourceId, objectId] = splitMemberKey(key);
          memberRows.push({
            id: uuid(),
            context_group_id: groupId,
            datasource_id: datasourceId,
            object_id: objectId,
            created_at: new Date(),
          });
        }

        for (let i = 0; i < memberRows.length; i += MATERIALIZE_BATCH_SIZE) {
          await trx(MEMBER_TABLE).insert(
            memberRows.slice(i, i + MATERIALIZE_BATCH_SIZE),
          );
        }
      }
    });
  }

  async materializeForDatasource(
    datasourceId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<void> {
    const rules = await this.getRulesForDatasource(datasourceId, workspaceId);

    for (const rule of rules) {
      await this.materializeRule(rule.id, workspaceId);
    }
  }

  async getRulesForDatasource(
    datasourceId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<ContextGroupRule[]> {
    const rows = await this.ruleTable().where('workspace_id', workspaceId);
    const rules = rows.map(rowToRule);

    if (rules.length === 0) {
      return [];
    }

    const resolutionContext = await this.buildDatasourceResolutionContext(
      rules.flatMap(rule => rule.datasources),
      workspaceId,
    );

    const result: ContextGroupRule[] = [];
    for (const rule of rules) {
      const allDatasourceIds = await this.getReferencedDatasourceIds(
        rule.datasources,
        resolutionContext,
        workspaceId,
      );

      if (allDatasourceIds.includes(datasourceId)) {
        result.push(rule);
      }
    }

    return result;
  }

  async previewRule(
    input: CreateRuleInput,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<{
    groups: Array<{
      id: string;
      name: string;
      members: Array<{
        datasourceId: string;
        objectId: string;
        object: unknown;
      }>;
    }>;
    totalGroups: number;
  }> {
    const datasources = await this.getLiveDatasourceFilters(
      input.datasources,
      workspaceId,
    );
    const datasourceIds = datasources.map(s => s.datasourceId);
    if (datasourceIds.length === 0) {
      return { groups: [], totalGroups: 0 };
    }

    const filtersByDatasource = new Map<string, FilterCondition[]>();
    for (const ds of datasources) {
      filtersByDatasource.set(
        ds.datasourceId,
        parseFilterConditions(ds.filter),
      );
    }

    const allRows = await this.knex(DATASTORE_TABLE)
      .where('workspace_id', workspaceId)
      .whereIn('datasource_id', datasourceIds)
      .select('datasource_id', 'object_id', 'object');

    const objects = allRows.filter(row => {
      const filters = filtersByDatasource.get(row.datasource_id) ?? [];
      if (filters.length === 0) return true;
      try {
        const obj =
          typeof row.object === 'string' ? JSON.parse(row.object) : row.object;
        return objectMatchesFilters(obj, filters);
      } catch {
        return false;
      }
    });

    if (objects.length === 0) {
      return { groups: [], totalGroups: 0 };
    }

    const objectToGroup = new Map<string, string>();
    const groupMembers = new Map<
      string,
      Array<{ datasourceId: string; objectId: string; object: unknown }>
    >();

    for (const obj of objects) {
      const groupId = uuid();
      const key = `${obj.datasource_id}:${obj.object_id}`;
      const parsedObj =
        typeof obj.object === 'string' ? JSON.parse(obj.object) : obj.object;
      objectToGroup.set(key, groupId);
      groupMembers.set(groupId, [
        {
          datasourceId: obj.datasource_id,
          objectId: obj.object_id,
          object: parsedObj,
        },
      ]);
    }

    const mergeRelationshipTypes = input.mergeRelationshipTypes ?? [];
    if (mergeRelationshipTypes.length > 0) {
      const relationships = await this.knex(RELATIONSHIP_TABLE)
        .where('workspace_id', workspaceId)
        .whereIn('source_datasource_id', datasourceIds)
        .whereIn('destination_datasource_id', datasourceIds)
        // Either name — must stay in step with materializeRule's merge query.
        .where(builder =>
          builder
            .whereIn('relation_type', mergeRelationshipTypes)
            .orWhereIn('reciprocal_relation_type', mergeRelationshipTypes),
        )
        .select(
          'source_datasource_id',
          'source_object_id',
          'destination_datasource_id',
          'destination_object_id',
        );

      for (const rel of relationships) {
        const sourceKey = `${rel.source_datasource_id}:${rel.source_object_id}`;
        const destKey = `${rel.destination_datasource_id}:${rel.destination_object_id}`;

        const sourceGroup = objectToGroup.get(sourceKey);
        const destGroup = objectToGroup.get(destKey);

        if (sourceGroup && destGroup && sourceGroup !== destGroup) {
          const destMembers = groupMembers.get(destGroup) || [];
          const sourceMembers = groupMembers.get(sourceGroup) || [];

          for (const member of destMembers) {
            objectToGroup.set(
              `${member.datasourceId}:${member.objectId}`,
              sourceGroup,
            );
          }
          sourceMembers.push(...destMembers);
          groupMembers.set(sourceGroup, sourceMembers);
          groupMembers.delete(destGroup);
        }
      }
    }

    const groups = [...groupMembers.entries()]
      .map(([groupId, members]) => ({
        id: groupId,
        name: members[0]?.objectId ?? 'Unknown',
        members,
      }))
      .slice(0, 100);
    return { groups, totalGroups: groupMembers.size };
  }
}
