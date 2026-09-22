import { useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWorkflows, useActions, useDatastore } from '../../api';
import {
  integrationsListQuery,
  dataIngestionWorkflowsQuery,
  actionsListQuery,
  relationshipRulesAllQuery,
  logosCatalogQuery,
  queryKeys,
} from '../../api/queries';
import type { EntityRef, IntegrationItem, WorkflowRef } from './types';
import { toIntegrationItem } from './types';
import {
  getWorkspaceScopeKey,
  workspaceQueryKeyInScope,
} from '../../api/workspace-scope';

export function useIntegrations(options?: {
  skip?: boolean;
  /**
   * Also scan integration-backed relationship rules. Off by default: that
   * query paginates the entire rule catalog, and this hook powers the
   * integrations table and the data-sources overview alike — only the delete
   * guard needs it. Action steps are always scanned; that list is one small
   * shared-key fetch.
   */
  includeRelationshipRules?: boolean;
}) {
  const api = useWorkflows();
  const actionsApi = useActions();
  const datastore = useDatastore();
  const queryClient = useQueryClient();
  const workspaceScopeKey = getWorkspaceScopeKey();
  const skip = options?.skip ?? false;
  const includeRelationshipRules = options?.includeRelationshipRules ?? false;

  const integrationsQuery = useQuery({
    ...integrationsListQuery(api),
    enabled: !skip,
  });
  const workflowsQuery = useQuery({
    ...dataIngestionWorkflowsQuery(api),
    enabled: !skip,
  });
  const actionsQuery = useQuery({
    ...actionsListQuery(actionsApi),
    enabled: !skip,
  });
  const relationshipRulesQuery = useQuery({
    ...relationshipRulesAllQuery(datastore),
    enabled: !skip && includeRelationshipRules,
  });
  const logosQuery = useQuery(logosCatalogQuery(api));

  const integrationWorkflowMap = useMemo(() => {
    const workflows = workflowsQuery.data?.data ?? [];

    return workflows
      .filter(w => w.nodes?.length)
      .flatMap(workflow => {
        const ref: WorkflowRef = {
          id: workflow.id,
          name: workflow.name,
          icon: workflow.icon,
          color: workflow.color,
          enabled: workflow.enabled,
          nodeCount: workflow.nodes?.length,
        };
        const ids = (workflow.nodes ?? [])
          .map(
            n =>
              (n.data?.config as { integrationId?: string } | undefined)
                ?.integrationId,
          )
          .filter((id): id is string => !!id);
        return [...new Set(ids)].map(id => ({ id, ref }));
      })
      .reduce((map, { id, ref }) => {
        const existing = map.get(id) ?? [];
        existing.push(ref);
        map.set(id, existing);
        return map;
      }, new Map<string, WorkflowRef[]>());
  }, [workflowsQuery.data]);

  const integrationActionMap = useMemo(() => {
    const actions = actionsQuery.data?.items ?? [];
    return actions
      .flatMap(action => {
        const ref: EntityRef = { id: action.id, name: action.name };
        const ids = (action.steps ?? [])
          .map(step => step.integrationId)
          .filter((id): id is string => !!id);
        return [...new Set(ids)].map(id => ({ id, ref }));
      })
      .reduce((map, { id, ref }) => {
        const existing = map.get(id) ?? [];
        existing.push(ref);
        map.set(id, existing);
        return map;
      }, new Map<string, EntityRef[]>());
  }, [actionsQuery.data]);

  const integrationRuleMap = useMemo(() => {
    const rules = relationshipRulesQuery.data?.items ?? [];
    return rules
      .flatMap(rule => {
        const id = rule.integrationConfig?.integrationId;
        return id ? [{ id, ref: { id: rule.id, name: rule.name } }] : [];
      })
      .reduce((map, { id, ref }) => {
        const existing = map.get(id) ?? [];
        existing.push(ref);
        map.set(id, existing);
        return map;
      }, new Map<string, EntityRef[]>());
  }, [relationshipRulesQuery.data]);

  const integrationsData = integrationsQuery.data;
  const listLogos = logosQuery.data;

  const logoDataUriBySlug = useMemo(() => {
    return new Map(
      (listLogos ?? []).map(l => [
        l.slug,
        `data:image/svg+xml;charset=utf-8,${encodeURIComponent(l.svg)}`,
      ]),
    );
  }, [listLogos]);

  const integrations: IntegrationItem[] = useMemo(() => {
    if (!integrationsData?.data) {
      return [];
    }
    return integrationsData.data.map(i =>
      toIntegrationItem(
        i,
        integrationWorkflowMap.get(i.id) ?? [],
        logoDataUriBySlug,
        integrationActionMap.get(i.id) ?? [],
        integrationRuleMap.get(i.id) ?? [],
      ),
    );
  }, [
    integrationsData,
    integrationWorkflowMap,
    integrationActionMap,
    integrationRuleMap,
    logoDataUriBySlug,
  ]);

  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: workspaceQueryKeyInScope(
        queryKeys.integrationsList,
        workspaceScopeKey,
      ),
    });
    void queryClient.invalidateQueries({
      queryKey: workspaceQueryKeyInScope(
        queryKeys.dataIngestionWorkflows,
        workspaceScopeKey,
      ),
    });
  }, [queryClient, workspaceScopeKey]);

  return {
    integrations,
    logoDataUriBySlug,
    // When skipped, the queries are disabled and never resolve — report not-loading.
    loading: !skip && (integrationsQuery.isPending || workflowsQuery.isPending),
    error: integrationsQuery.error ?? workflowsQuery.error ?? undefined,
    refetch,
  };
}
