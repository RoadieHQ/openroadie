import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDatastore } from '../../api';
import type { IntegrationSecretSummary } from '../integrations/use-integration-secret-status';
import { useDataSourceReadinessReason } from './use-data-source-readiness-reason';
import type { DataSourceItem } from './types';
import { workspaceQueryKey } from '../../api/workspace-scope';

export interface DataSourcesSummary {
  configuredIntegrationsCount: number;
  liveDataSourceCount: number;
  catalogObjectTotal: number | null;
  catalogError: Error | null;
  dataSourcesLoading: boolean;
  catalogLoading: boolean;
}

export function useDataSourcesSummary(params: {
  dataSources: DataSourceItem[];
  dataSourcesLoading: boolean;
  summariesByIntegrationId: Map<string, IntegrationSecretSummary>;
  secretStatusLoading: boolean;
}): DataSourcesSummary {
  const {
    dataSources,
    dataSourcesLoading,
    summariesByIntegrationId,
    secretStatusLoading,
  } = params;
  const datastore = useDatastore();

  const getReadinessReason = useDataSourceReadinessReason(
    summariesByIntegrationId,
    secretStatusLoading,
  );

  const configuredIntegrationsCount = useMemo(() => {
    const uniqueIds = new Set<string>();
    for (const ds of dataSources) {
      if (ds.integration?.id) {
        uniqueIds.add(ds.integration.id);
      }
    }
    return uniqueIds.size;
  }, [dataSources]);

  const liveDataSourceCount = useMemo(() => {
    let live = 0;
    for (const ds of dataSources) {
      if (ds.enabled && !getReadinessReason(ds)) {
        live += 1;
      }
    }
    return live;
  }, [dataSources, getReadinessReason]);

  const catalogQuery = useQuery({
    queryKey: workspaceQueryKey('datastore', 'objects', 'catalogTotal'),
    queryFn: async () => {
      const { total } = await datastore.queryAllObjects({
        limit: 0,
        offset: 0,
      });
      return total;
    },
  });

  return {
    configuredIntegrationsCount,
    liveDataSourceCount,
    catalogObjectTotal: catalogQuery.data ?? null,
    catalogError: catalogQuery.error ?? null,
    dataSourcesLoading,
    catalogLoading: catalogQuery.isPending,
  };
}
