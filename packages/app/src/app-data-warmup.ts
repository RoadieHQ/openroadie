import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { ApiClients } from './api';
import { getAppWarmupTier, type AppWarmupTier } from './app-warmup-policy';
import type { WarmupPriority } from './warmup-priority';
import {
  actionsListQuery,
  capabilitiesListQuery,
  contextGroupRulesQuery,
  dataIngestionNodeTypesQuery,
  dataIngestionWorkflowsQuery,
  integrationsListQuery,
  logosCatalogQuery,
} from './api/queries';
import { getWorkspaceScopeKey } from './api/workspace-scope';

export const APP_DATA_WARMUP_ITEM_LIMIT = 5_000;
export const APP_DATA_WARMUP_COMPLETE_MARK = 'openroadie:data-warmup-complete';

interface Page<T> {
  items: T[];
  total: number;
}

async function warmBoundedCollection<T>({
  queryClient,
  queryKey,
  probe,
  loadAll,
  maxItems,
  priority,
  workspaceKey,
}: {
  queryClient: QueryClient;
  queryKey: QueryKey;
  probe: () => Promise<Page<T>>;
  loadAll: () => Promise<void>;
  maxItems: number;
  priority?: WarmupPriority;
  workspaceKey: string;
}) {
  const scopedProbe = () =>
    getWorkspaceScopeKey() === workspaceKey
      ? probe()
      : Promise.resolve<Page<T> | null>(null);
  const page = await (
    priority ? priority.run(scopedProbe) : scopedProbe()
  ).catch(() => null);
  if (
    !page ||
    page.total > maxItems ||
    getWorkspaceScopeKey() !== workspaceKey
  ) {
    return;
  }
  if (page.items.length === page.total) {
    queryClient.setQueryData(queryKey, page);
    return;
  }
  const scopedLoadAll = () =>
    getWorkspaceScopeKey() === workspaceKey ? loadAll() : Promise.resolve();
  await (priority ? priority.run(scopedLoadAll) : scopedLoadAll());
  if (getWorkspaceScopeKey() !== workspaceKey) {
    queryClient.removeQueries({ queryKey, exact: true });
  }
}

async function runWarmup<T>(
  priority: WarmupPriority | undefined,
  workspaceKey: string,
  queryClient: QueryClient,
  queryKey: QueryKey,
  task: () => Promise<T>,
) {
  const run = async () => {
    if (getWorkspaceScopeKey() !== workspaceKey) {
      return;
    }
    await task();
    if (getWorkspaceScopeKey() !== workspaceKey) {
      queryClient.removeQueries({ queryKey, exact: true });
    }
  };
  return priority ? priority.run(run) : run();
}

function runSharedWarmup<T>(
  priority: WarmupPriority | undefined,
  task: () => Promise<T>,
) {
  return priority ? priority.run(task) : task();
}

export async function warmAppData({
  apis,
  queryClient,
  maxCollectionItems = APP_DATA_WARMUP_ITEM_LIMIT,
  tier = 'full',
  priority,
}: {
  apis: ApiClients;
  queryClient: QueryClient;
  maxCollectionItems?: number;
  tier?: Exclude<AppWarmupTier, 'off'>;
  priority?: WarmupPriority;
}) {
  const workspaceKey = getWorkspaceScopeKey();
  const logosQuery = logosCatalogQuery(apis.workflows);
  const integrationsQuery = integrationsListQuery(apis.workflows);
  const workflowsQuery = dataIngestionWorkflowsQuery(apis.workflows);
  const nodeTypesQuery = dataIngestionNodeTypesQuery(apis.workflows);
  await Promise.all([
    runSharedWarmup(priority, () => queryClient.prefetchQuery(logosQuery)),
    runWarmup(
      priority,
      workspaceKey,
      queryClient,
      integrationsQuery.queryKey,
      () => queryClient.prefetchQuery(integrationsQuery),
    ),
    runWarmup(
      priority,
      workspaceKey,
      queryClient,
      workflowsQuery.queryKey,
      () => queryClient.prefetchQuery(workflowsQuery),
    ),
    runSharedWarmup(priority, () => queryClient.prefetchQuery(nodeTypesQuery)),
  ]);

  if (tier === 'primary') {
    return;
  }

  const actionsQuery = actionsListQuery(apis.actions);
  const capabilitiesQuery = capabilitiesListQuery(apis.capabilities);
  const contextGroupRules = contextGroupRulesQuery(apis.datastore);
  await Promise.all([
    warmBoundedCollection({
      queryClient,
      queryKey: actionsQuery.queryKey,
      probe: () =>
        apis.actions.list({ limit: maxCollectionItems + 1, offset: 0 }),
      loadAll: () => queryClient.prefetchQuery(actionsQuery),
      maxItems: maxCollectionItems,
      priority,
      workspaceKey,
    }),
    warmBoundedCollection({
      queryClient,
      queryKey: capabilitiesQuery.queryKey,
      probe: () =>
        apis.capabilities.list({
          limit: maxCollectionItems + 1,
          offset: 0,
        }),
      loadAll: () => queryClient.prefetchQuery(capabilitiesQuery),
      maxItems: maxCollectionItems,
      priority,
      workspaceKey,
    }),
    warmBoundedCollection({
      queryClient,
      queryKey: contextGroupRules.queryKey,
      probe: () =>
        apis.datastore.listContextGroupRules({
          limit: maxCollectionItems + 1,
          offset: 0,
        }),
      loadAll: () => queryClient.prefetchQuery(contextGroupRules),
      maxItems: maxCollectionItems,
      priority,
      workspaceKey,
    }),
  ]);
}

export function scheduleAppDataWarmup(options: {
  apis: ApiClients;
  queryClient: QueryClient;
  priority?: WarmupPriority;
}) {
  let cancelled = false;
  let idleCallbackId: number | undefined;
  let timeoutId: number | undefined;

  const warm = () => {
    if (cancelled) {
      return;
    }
    const tier = getAppWarmupTier();
    const warming =
      tier === 'off' ? Promise.resolve() : warmAppData({ ...options, tier });
    void warming.then(() => {
      if (!cancelled) {
        performance.mark(APP_DATA_WARMUP_COMPLETE_MARK);
      }
    });
  };

  if (typeof window.requestIdleCallback === 'function') {
    idleCallbackId = window.requestIdleCallback(warm, { timeout: 5_000 });
  } else {
    timeoutId = window.setTimeout(warm, 2_500);
  }

  return () => {
    cancelled = true;
    if (
      idleCallbackId !== undefined &&
      typeof window.cancelIdleCallback === 'function'
    ) {
      window.cancelIdleCallback(idleCallbackId);
    }
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  };
}
