import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  useActions,
  useCapabilities,
  useDatastore,
  useMcpAudit,
  useWorkflows,
} from '../../api';
import {
  actionsListQuery,
  activeRelationshipRuleCountQuery,
  capabilitiesListQuery,
  contextGroupRuleGroupCountQuery,
  contextGroupRulesQuery,
  dataIngestionWorkflowsQuery,
  integrationsListQuery,
  mcpAuditFacetsQuery,
  objectCountsQuery,
} from '../../api/queries';
import { PATHS } from '../../config/paths';

/** How many things each sidebar row leads to, keyed by the row's route. An
 *  absent entry means "not known yet" — the row renders without a count rather
 *  than claiming zero. */
export type SidebarCounts = Readonly<Record<string, number | undefined>>;

/**
 * The counts shown beside each primary sidebar row.
 *
 * Every read goes through a `queries.ts` factory, wherever possible the same one
 * the destination page uses — so a count and the page it labels share one cache
 * entry: the sidebar warms the page's data, the page's mutations invalidate the
 * sidebar's number, and neither issues a request the other already made. Where
 * no page offers a cheap count the factory is count-only and keyed under the
 * prefix the relevant mutations already invalidate: the active-rule count (the
 * relationships catalog runs to thousands of rows) and each context-group
 * rule's group total. The agent-session facets are shared with the audit log
 * page by key.
 */
export function useSidebarCounts(): SidebarCounts {
  const workflows = useWorkflows();
  const datastore = useDatastore();
  const capabilities = useCapabilities();
  const actions = useActions();
  const mcpAudit = useMcpAudit();

  const dataSourcesQuery = useQuery(dataIngestionWorkflowsQuery(workflows));
  const integrations = useQuery(integrationsListQuery(workflows));
  const contextGroups = useQuery(contextGroupRulesQuery(datastore));
  const relationshipRules = useQuery(
    activeRelationshipRuleCountQuery(datastore),
  );
  const capabilitiesList = useQuery(capabilitiesListQuery(capabilities));
  const actionsList = useQuery(actionsListQuery(actions));
  const auditFacets = useQuery(mcpAuditFacetsQuery(mcpAudit));

  // Shares the data-sources page's entry, which is keyed on the workflow id
  // set — so the ids must come from the same query the page reads.
  const workflowIds = useMemo(
    () => (dataSourcesQuery.data?.data ?? []).map(workflow => workflow.id),
    [dataSourcesQuery.data],
  );
  const objectCounts = useQuery({
    ...objectCountsQuery(datastore, workflowIds),
    enabled: workflowIds.length > 0,
  });

  // The unscoped datastore table lists every data source's objects AND every
  // context-group rule's materialized groups, so its total is the sum of both.
  // One `limit: 1` read per rule, mirroring how the table sizes each rule's
  // section (`use-data-source-objects.ts`) — rules are a handful by nature.
  const contextGroupRules = contextGroups.data?.items;
  const groupCounts = useQueries({
    queries: (contextGroupRules ?? []).map(rule =>
      contextGroupRuleGroupCountQuery(datastore, rule.id),
    ),
  });

  const dataSourceCount = dataSourcesQuery.data?.total;
  // With no data sources there are no objects, and the counts read is skipped.
  const objectTotal =
    dataSourceCount === 0
      ? 0
      : objectCounts.data?.reduce((sum, row) => sum + row.count, 0);
  // Every rule's total must be in before the sum is publishable: a partial sum
  // is a smaller-but-plausible number, which reads as fact rather than as
  // loading.
  const groupTotal =
    contextGroupRules && groupCounts.every(query => query.data !== undefined)
      ? groupCounts.reduce((sum, query) => sum + (query.data ?? 0), 0)
      : undefined;
  const datastoreTotal =
    objectTotal === undefined || groupTotal === undefined
      ? undefined
      : objectTotal + groupTotal;

  return useMemo(
    () => ({
      [PATHS.DATASTORE]: datastoreTotal,
      [PATHS.INTEGRATIONS]: integrations.data?.total,
      [PATHS.DATA_SOURCES]: dataSourceCount,
      [PATHS.RELATIONSHIPS]: relationshipRules.data,
      [PATHS.CONTEXT_GROUPS]: contextGroups.data?.total,
      [PATHS.CAPABILITIES]: capabilitiesList.data?.total,
      [PATHS.ACTIONS]: actionsList.data?.total,
      [PATHS.ADMIN_MCP_AUDIT_LOG]: auditFacets.data?.totalSessionCount,
    }),
    [
      actionsList.data,
      auditFacets.data,
      capabilitiesList.data,
      contextGroups.data,
      dataSourceCount,
      datastoreTotal,
      integrations.data,
      relationshipRules.data,
    ],
  );
}
