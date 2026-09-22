import { useCallback } from 'react';
import type { IntegrationSecretSummary } from '../integrations/use-integration-secret-status';
import { resolveDataSourceReadinessReason } from './readiness';
import type { DataSourceItem } from './types';

export function useDataSourceReadinessReason(
  summariesByIntegrationId: Map<string, IntegrationSecretSummary>,
  secretStatusLoading: boolean,
) {
  return useCallback(
    (ds: DataSourceItem) =>
      resolveDataSourceReadinessReason(
        ds,
        summariesByIntegrationId,
        secretStatusLoading,
      ),
    [secretStatusLoading, summariesByIntegrationId],
  );
}
