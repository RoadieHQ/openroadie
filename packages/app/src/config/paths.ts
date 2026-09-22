export const PATHS = {
  ROOT: '/',
  GETTING_STARTED: '/getting-started',
  ADMIN: '/admin',
  ADMIN_WORKSPACES: '/admin/workspaces',
  ADMIN_TEAMS: '/admin/teams',
  ADMIN_SECRETS: '/admin/secrets',
  ADMIN_INTEGRATIONS: '/admin/integrations',
  ADMIN_AI_PROVIDERS: '/admin/ai-providers',
  ADMIN_WEBHOOKS: '/admin/webhooks',
  ADMIN_MCP_SERVERS: '/admin/mcp-servers',
  ADMIN_MCP_AUDIT_LOG: '/admin/mcp-audit-log',
  DATA_SOURCES: '/data-sources',
  DATA_SOURCES_NEW: '/data-sources/new',
  DATASTORE: '/datastore',
  DATASTORE_GRAPH: '/datastore/graph',
  ENTITY_BUILDER: '/entity-builder',
  ENTITY_COMPOSER: '/entity-composer',
  INTEGRATION_SCHEMAS: '/integrations/schemas',
  INTEGRATIONS: '/integrations',
  INTEGRATIONS_NEW: '/integrations/new',
  RELATIONSHIPS: '/relationships',
  RELATIONSHIPS_SUGGESTIONS: '/relationships/suggestions',
  CAPABILITIES: '/capabilities',
  ACTIONS: '/actions',
  ACTIONS_NEW: '/actions/new',
  CONTEXT_GROUPS: '/context-groups',
  CONTEXT_GROUPS_NEW: '/context-groups/new',
} as const;

export const dataSourceDetail = (id: string) => `/data-sources/${id}`;
// Deep link that opens the "New data source" dialog on the data sources
// overview (the datastore empty state links here). The overview consumes the
// param on arrival.
export const dataSourcesNewDialog = () => `${PATHS.DATA_SOURCES}?new=1`;
export const dataSourceObjects = (dataSourceId: string) =>
  `/datastore?dataSourceId=${encodeURIComponent(dataSourceId)}`;
export const datastoreGraphFocus = (datasourceId: string, objectId: string) =>
  `${PATHS.DATASTORE_GRAPH}?view=object&focus=${encodeURIComponent(datasourceId)}:${encodeURIComponent(objectId)}`;

export interface RelationshipsScope {
  /** Data source ids to show; everything else is hidden. */
  dataSourceIds?: string[];
  /** Relationship-type strings to keep edges for. */
  relationshipTypes?: string[];
  /** Individual relationship-rule ids to keep edges for. */
  relationshipRuleIds?: string[];
  /** A single relationship-rule id to center the viewport on. */
  focusRelationshipId?: string;
}

// Builds a deep link into the relationships editor scoped to a set of data
// sources and/or relationships. Empty parts are omitted so a call with no
// scope just returns the bare route. Values are comma-joined into `ds` /
// `reltype` / `rel` and encoded by URLSearchParams.
export const relationshipsScoped = ({
  dataSourceIds,
  relationshipTypes,
  relationshipRuleIds,
  focusRelationshipId,
}: RelationshipsScope = {}): string => {
  const params = new URLSearchParams();
  const clean = (values: string[]) =>
    values.map(value => value.trim()).filter(Boolean);
  const setList = (key: string, values: string[] | undefined) => {
    if (!values) return;
    const cleaned = clean(values);
    if (cleaned.length > 0) {
      params.set(key, cleaned.join(','));
    }
  };
  setList('ds', dataSourceIds);
  setList('reltype', relationshipTypes);
  setList('rel', relationshipRuleIds);
  if (focusRelationshipId?.trim()) {
    params.set('relFocus', focusRelationshipId.trim());
  }
  const query = params.toString();
  return query ? `${PATHS.RELATIONSHIPS}?${query}` : PATHS.RELATIONSHIPS;
};

// Convenience for linking a single relationship: shows just its two endpoints
// and centers the viewport on the edge.
export const relationshipBetween = (
  sourceDatasourceId: string,
  targetDatasourceId: string,
  ruleId: string,
) =>
  relationshipsScoped({
    dataSourceIds: [sourceDatasourceId, targetDatasourceId],
    relationshipRuleIds: [ruleId],
    focusRelationshipId: ruleId,
  });

export const objectDetail = (datasourceId: string, objectId: string) =>
  `/datastore/${encodeURIComponent(datasourceId)}/${encodeURIComponent(objectId)}`;
export const objectRelationshipNew = (datasourceId: string, objectId: string) =>
  `${objectDetail(datasourceId, objectId)}/relationships/new`;
export const objectRelationshipEdit = (
  datasourceId: string,
  objectId: string,
  relationshipId: string,
) =>
  `${objectDetail(datasourceId, objectId)}/relationships/${encodeURIComponent(relationshipId)}/edit`;
export const relationshipRuleEdit = (id: string) =>
  `/relationships/rules/${encodeURIComponent(id)}/edit`;
export const integrationDetail = (id: string) => `/integrations/${id}`;
export const capabilityDetail = (id: string) => `/capabilities/${id}`;
export const actionDetail = (id: string) => `/actions/${id}`;
export const contextGroupEdit = (id: string) => `/context-groups/${id}`;
export const contextGroupDetail = (id: string) =>
  `/context-groups/details/${encodeURIComponent(id)}`;
export const contextGroupInstance = (id: string) =>
  `/context-groups/groups/${encodeURIComponent(id)}`;
