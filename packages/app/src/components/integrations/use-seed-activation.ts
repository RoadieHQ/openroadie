/*
 * Copyright 2026 Larder Software Limited
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

import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWorkflows, useAlert } from '../../api';
import { dataSourceSeedsQuery, queryKeys } from '../../api/queries';
import {
  getWorkspaceScopeKey,
  workspaceQueryKeyInScope,
} from '../../api/workspace-scope';
import type { ActivateDataSourceSeedsResult } from '../../api/workflow/workflow-client';

/**
 * Whether any pre-built data source seed template targets this integration
 * slug, and whether that's still being determined. Drives whether the
 * auto-enable toggle shows in the pre-built integration editor at all.
 * `matchingSeedNames` lists the templates that activation will attempt.
 */
export function useHasMatchingDataSourceSeeds(
  integrationSlug: string | undefined,
): {
  hasMatchingSeeds: boolean;
  matchingSeedNames: string[];
  loading: boolean;
} {
  const api = useWorkflows();
  const query = useQuery({
    ...dataSourceSeedsQuery(api),
    enabled: Boolean(integrationSlug),
  });

  return useMemo(() => {
    if (!integrationSlug) {
      return {
        hasMatchingSeeds: false,
        matchingSeedNames: [],
        loading: false,
      };
    }
    if (!query.data) {
      return {
        hasMatchingSeeds: false,
        matchingSeedNames: [],
        loading: query.isLoading,
      };
    }
    const matchingSeedNames = query.data.data
      .filter(seed => seed.integrationSlug === integrationSlug)
      .map(seed => seed.name);
    return {
      hasMatchingSeeds: matchingSeedNames.length > 0,
      matchingSeedNames,
      loading: false,
    };
  }, [integrationSlug, query.data, query.isLoading]);
}

function summarizeActivation(result: ActivateDataSourceSeedsResult): {
  message: string;
  severity: 'success' | 'info' | 'error';
} {
  if (result.notReady) {
    return {
      message:
        'Data sources will be enabled automatically once this integration is fully configured.',
      severity: 'info',
    };
  }

  const activated = result.inserted + result.enabled;
  const parts: string[] = [];
  if (activated > 0) {
    parts.push(`Enabled ${activated} data source${activated === 1 ? '' : 's'}`);
  }
  if (result.failed.length > 0) {
    const failedCount = result.failed.length;
    parts.push(
      `${failedCount} data source${
        failedCount === 1 ? '' : 's'
      } failed ${failedCount === 1 ? 'its dry-run and was' : 'their dry-runs and were'} left disabled: ${result.failed
        .map(f => f.name)
        .join(', ')}`,
    );
  }

  if (parts.length === 0) {
    return { message: 'No new data sources to enable', severity: 'info' };
  }

  return {
    message: parts.join('. '),
    severity: result.failed.length > 0 ? 'info' : 'success',
  };
}

/**
 * Calls the backend's dry-run-before-enable activation endpoint for a saved,
 * pre-built integration and surfaces a transient summary alert. Shared by the
 * pre-built integration editor (after save) and the GitHub App editor (after
 * install), so both flows stay in sync with the backend's readiness/dry-run
 * sequencing instead of re-implementing it in the UI.
 */
export function useSeedActivation() {
  const api = useWorkflows();
  const alertApi = useAlert();
  const queryClient = useQueryClient();
  const [activatingIntegrationId, setActivatingIntegrationId] = useState<
    string | null
  >(null);

  const activate = useCallback(
    async (integrationId: string) => {
      const workspaceScopeKey = getWorkspaceScopeKey();
      setActivatingIntegrationId(integrationId);
      try {
        const { data } =
          await api.workflows.activateDataSourceSeedsForIntegration(
            integrationId,
          );
        const { message, severity } = summarizeActivation(data);
        alertApi.post({ message, severity, display: 'transient' });
        void queryClient.invalidateQueries({
          queryKey: workspaceQueryKeyInScope(
            queryKeys.dataIngestionWorkflows,
            workspaceScopeKey,
          ),
        });
        void queryClient.invalidateQueries({
          queryKey: workspaceQueryKeyInScope(
            queryKeys.integrationsList,
            workspaceScopeKey,
          ),
        });
        void queryClient.invalidateQueries({
          queryKey: workspaceQueryKeyInScope(
            queryKeys.dataSourceSeeds,
            workspaceScopeKey,
          ),
        });
        return data;
      } catch (error) {
        alertApi.post({
          message: `Failed to enable data sources: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
          severity: 'error',
        });
        return undefined;
      } finally {
        setActivatingIntegrationId(null);
      }
    },
    [api, alertApi, queryClient],
  );

  return {
    activate,
    isActivating: (integrationId: string) =>
      activatingIntegrationId === integrationId,
  };
}
