/*
 * Copyright 2025 Larder Software Limited
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

import { ConfirmationDialog } from '@roadiehq/ui/confirmation-dialog';
import { useState, useCallback, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQueries } from '@tanstack/react-query';
import { AlertTriangle, Plus } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { EmptyState } from '@roadiehq/ui/empty-state';
import { IntegrationIconFrame, IntegrationLogo } from '@roadiehq/ui/item-list';
import { Dialog, DialogContent, DialogTitle } from '@roadiehq/ui/dialog';
import {
  OverviewListingPageHeader,
  OverviewListingSearchField,
  OverviewListingStandaloneBody,
} from '../../common';
import { PATHS, dataSourceDetail } from '../../../config/paths';
import { useWorkflows, useDatastore, useAlert } from '../../../api';
import { invalidationKeys, queryKeys } from '../../../api/queries';
import { workspaceQueryKey } from '../../../api/workspace-scope';
import {
  useInvalidatingMutation,
  useOptimisticMutation,
} from '../../../api/query-hooks';
import { toolbarPrimaryCtaButtonClassName } from '@roadiehq/ui/toolbar';
import {
  OverviewEmptyState,
  OverviewTable,
  dataSourceLegacyTabTarget,
  useDataSourceLegacyStatusRedirect,
  useLegacyTabRedirect,
  useOverviewLoadErrorToast,
  useOverviewState,
  usePublishOverviewData,
  type OverviewStatusTone,
} from '../../overview';
import { useIntegrationSecretStatus } from '../../integrations/use-integration-secret-status';
import { useIntegrations } from '../../integrations/use-integrations';
import { isGitHubAppIntegration } from '../../integrations/types';
import {
  IntegrationFormDialog,
  GitHubIntegrationDialog,
} from '../../integrations/form';
import { useDataSources } from '../use-data-sources';
import {
  isRunAlreadyInProgress,
  RUN_ALREADY_IN_PROGRESS_MESSAGE,
} from '../run-conflict';
import { useReferenceUsage } from '../../capabilities/use-reference-usage';
import { ReferenceUsageWarning } from '../../capabilities/reference-usage-warning';
import { useContextGroups } from '../../context-groups/use-context-groups';
import {
  findContextGroupRulesForDataSource,
  type DependentRef,
} from '../data-source-dependents';
import type { DataSourceItem, IntegrationInfo } from '../types';
import { dataSourceIntegrations } from '../readiness';
import {
  getDataSourceToggleFailureVerb,
  getDataSourceToggleSuccessMessage,
  getDataSourceOverviewStatus,
} from '../data-source-status';
import { useDataSourceReadinessReason } from '../use-data-source-readiness-reason';
import { NODE_TYPES } from '../../../api/workflow/workflow-client';
import {
  DataSourcesBulkActions,
  buildBulkSelectionState,
  type DataSourcesBulkSelectionState,
} from './data-sources-bulk-actions';
import { DataSourceSeedPicker } from './data-source-seed-picker';
import { useFavoriteDataSources } from '../use-favorite-data-sources';
import { useDataSourceOverviewConfig } from './data-source-overview-config';
import {
  useDataSourceColumns,
  DataSourceRowActionsMenu,
} from './data-sources-columns';
import { DataSourceDetailDrawer } from './data-source-detail-drawer';
import { DataSourceRunDetailsDrawer } from './data-source-run-details-drawer';

export interface SetupBadgeInfo {
  label: string;
  tone: OverviewStatusTone;
  tooltip?: string;
  /** Secret readiness is still loading — render a skeleton, not the badge. */
  pending?: boolean;
  /** When set, clicking the badge calls this instead of default behaviour. */
  onResolve?: () => void;
}

function GitHubIntegrationDialogWrapper({
  targetId,
  items,
  open,
  onClose,
  onChanged,
  onRequestDelete,
}: {
  targetId: string;
  items: ReturnType<typeof useIntegrations>['integrations'];
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  onRequestDelete: () => void;
}) {
  const ghItem = items.find(i => i.id === targetId);
  if (!ghItem) return null;
  return (
    <GitHubIntegrationDialog
      open={open}
      onClose={onClose}
      integration={ghItem}
      onInstallationsChanged={onChanged}
      onSecretsChanged={onChanged}
      onRequestDelete={onRequestDelete}
    />
  );
}

const FAVORITES_STORAGE_KEY = 'roadie.data-sources.favorites';

export function DataSourceOverview() {
  const navigate = useNavigate();
  const api = useWorkflows();
  const datastoreApi = useDatastore();
  const alertApi = useAlert();

  const {
    dataSources,
    loading,
    error,
    executionsLoading,
    refetch,
    noteRunStarted,
    logoDataUriBySlug,
  } = useDataSources();

  useOverviewLoadErrorToast(error);

  const { favoriteIds, toggleFavorite, setFavorites } = useFavoriteDataSources(
    FAVORITES_STORAGE_KEY,
  );

  const integrations = useMemo<IntegrationInfo[]>(
    () =>
      Array.from(
        new Map(
          dataSources
            .flatMap(ds => dataSourceIntegrations(ds))
            .filter(
              (
                integration,
              ): integration is NonNullable<DataSourceItem['integration']> =>
                Boolean(integration?.id),
            )
            .map(integration => [integration.id as string, integration]),
        ).values(),
      ),
    [dataSources],
  );

  const integrationsForSecretStatus = useMemo(
    () =>
      integrations.filter(
        (
          integration,
        ): integration is IntegrationInfo & {
          id: string;
        } => Boolean(integration.id),
      ),
    [integrations],
  );

  const { summariesByIntegrationId, loading: secretStatusLoading } =
    useIntegrationSecretStatus(integrationsForSecretStatus);

  const awaitingSecretSummaries =
    integrationsForSecretStatus.length > 0 && secretStatusLoading;
  const tableLoading = loading || awaitingSecretSummaries;

  // URL-synced group/status/search + filtered rows and sidebar groups.
  useLegacyTabRedirect(dataSourceLegacyTabTarget);
  useDataSourceLegacyStatusRedirect();
  const config = useDataSourceOverviewConfig(
    favoriteIds,
    logoDataUriBySlug,
    summariesByIntegrationId,
    secretStatusLoading,
  );
  const { group, search, rows, groups, setSearch } = useOverviewState(
    dataSources,
    config,
  );

  const [searchParams, setSearchParams] = useSearchParams();
  const detailId = searchParams.get('detail');
  const runDataSourceId = searchParams.get('run');
  const setOpenDrawer = useCallback(
    (drawer: 'detail' | 'run', id: string) => {
      const replace = searchParams.has('detail') || searchParams.has('run');
      setSearchParams(
        previous => {
          const next = new URLSearchParams(previous);
          next.delete('detail');
          next.delete('run');
          next.set(drawer, id);
          return next;
        },
        { replace },
      );
    },
    [searchParams, setSearchParams],
  );
  const closeDrawer = useCallback(
    (drawer: 'detail' | 'run') => {
      setSearchParams(
        previous => {
          const next = new URLSearchParams(previous);
          next.delete(drawer);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const openDetail = useCallback(
    (id: string) => setOpenDrawer('detail', id),
    [setOpenDrawer],
  );
  const openRunDetails = useCallback(
    (id: string) => setOpenDrawer('run', id),
    [setOpenDrawer],
  );
  const closeDetail = useCallback(() => closeDrawer('detail'), [closeDrawer]);
  const closeRunDetails = useCallback(() => closeDrawer('run'), [closeDrawer]);
  const detailDataSource = detailId
    ? dataSources.find(ds => ds.id === detailId)
    : undefined;
  const selectedRunDataSource = runDataSourceId
    ? dataSources.find(ds => ds.id === runDataSourceId)
    : undefined;
  // Lets the drawer resolve relationship-rule endpoints (ids) to names.
  const dataSourceNameById = useMemo(
    () => new Map(dataSources.map(ds => [ds.id, ds.name])),
    [dataSources],
  );

  const enabledDataSourceIds = useMemo(
    () => new Set(dataSources.filter(ds => ds.enabled).map(ds => ds.id)),
    [dataSources],
  );

  const [deleteTarget, setDeleteTarget] = useState<Array<{
    id: string;
    name: string;
  }> | null>(null);

  // Deletion warns about what it would break: dangling `@datasource:slug`
  // tokens in capability instructions, and context-group rules that draw from
  // the source. Both only matter once the dialog is open.
  const { getReferencedTargets, loading: usageLoading } = useReferenceUsage({
    skip: !deleteTarget,
  });
  const { rules: contextGroupRules } = useContextGroups({
    skip: !deleteTarget,
  });

  // Delete targets are keyed by workflow id; references are keyed by slug.
  const slugByDataSourceId = useMemo(() => {
    const map = new Map<string, string>();
    for (const ds of dataSources) {
      if (ds.slug) map.set(ds.id, ds.slug);
    }
    return map;
  }, [dataSources]);

  const referencedDeleteTargets = useMemo(
    () =>
      getReferencedTargets(
        (deleteTarget ?? []).map(target => ({
          type: 'datasource' as const,
          name: target.name,
          slug: slugByDataSourceId.get(target.id),
        })),
      ),
    [deleteTarget, slugByDataSourceId, getReferencedTargets],
  );

  const dependentContextGroups = useMemo(() => {
    if (!deleteTarget) return [];
    const byId = new Map<string, DependentRef>();
    for (const target of deleteTarget) {
      for (const rule of findContextGroupRulesForDataSource(
        contextGroupRules,
        target.id,
      )) {
        byId.set(rule.id, rule);
      }
    }
    return [...byId.values()];
  }, [deleteTarget, contextGroupRules]);

  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [seedPickerOpen, setSeedPickerOpen] = useState(false);
  // Remount key: Radix keeps dialog content mounted through the exit
  // animation, so the picker's selection state would survive close/reopen.
  const [seedPickerSession, setSeedPickerSession] = useState(0);
  const [seedApplying, setSeedApplying] = useState(false);
  const [bulkSelection, setBulkSelection] =
    useState<DataSourcesBulkSelectionState | null>(null);

  // The full integration list is only needed for the edit dialogs, which also
  // re-fetch integrations/workflows/logos already loaded for the table. Defer it
  // until the user first opens an editor so it stays off the initial load.
  const [integrationsEnabled, setIntegrationsEnabled] = useState(false);
  const [pendingEditIntegrationId, setPendingEditIntegrationId] = useState<
    string | null
  >(null);
  const {
    integrations: fullIntegrationItems,
    loading: integrationsLoading,
    refetch: refetchIntegrations,
  } = useIntegrations({ skip: !integrationsEnabled });

  const [integrationFormOpen, setIntegrationFormOpen] = useState(false);
  const [integrationEditTarget, setIntegrationEditTarget] = useState<
    (typeof fullIntegrationItems)[number] | undefined
  >(undefined);
  const [
    resumeSeedPickerAfterIntegration,
    setResumeSeedPickerAfterIntegration,
  ] = useState(false);
  const [githubDialogOpen, setGithubDialogOpen] = useState(false);
  const [githubTargetId, setGithubTargetId] = useState<string | undefined>(
    undefined,
  );

  const openIntegrationEditor = useCallback(
    (item: (typeof fullIntegrationItems)[number]) => {
      if (isGitHubAppIntegration(item)) {
        setGithubTargetId(item.id);
        setGithubDialogOpen(true);
      } else {
        setIntegrationEditTarget(item);
        setIntegrationFormOpen(true);
      }
    },
    [],
  );

  const handleEditIntegration = useCallback(
    (integrationId: string) => {
      if (!integrationsEnabled) {
        setIntegrationsEnabled(true);
        setPendingEditIntegrationId(integrationId);
        return;
      }
      const item = fullIntegrationItems.find(i => i.id === integrationId);
      if (item) {
        setPendingEditIntegrationId(null);
        openIntegrationEditor(item);
        return;
      }
      if (integrationsLoading) {
        setPendingEditIntegrationId(integrationId);
      }
    },
    [
      integrationsEnabled,
      integrationsLoading,
      fullIntegrationItems,
      openIntegrationEditor,
    ],
  );

  useEffect(() => {
    if (
      !pendingEditIntegrationId ||
      !integrationsEnabled ||
      integrationsLoading
    ) {
      return;
    }
    const item = fullIntegrationItems.find(
      i => i.id === pendingEditIntegrationId,
    );
    if (item) openIntegrationEditor(item);
    setPendingEditIntegrationId(null);
  }, [
    pendingEditIntegrationId,
    integrationsEnabled,
    integrationsLoading,
    fullIntegrationItems,
    openIntegrationEditor,
  ]);

  const handleIntegrationFormClose = useCallback(() => {
    setIntegrationFormOpen(false);
    setIntegrationEditTarget(undefined);
    if (resumeSeedPickerAfterIntegration) {
      setSeedPickerSession(session => session + 1);
      setSeedPickerOpen(true);
      setResumeSeedPickerAfterIntegration(false);
    }
  }, [resumeSeedPickerAfterIntegration]);

  const handleIntegrationSaved = useCallback(() => {
    setIntegrationFormOpen(false);
    setIntegrationEditTarget(undefined);
    refetchIntegrations();
    refetch();
    if (resumeSeedPickerAfterIntegration) {
      setSeedPickerSession(session => session + 1);
      setSeedPickerOpen(true);
      setResumeSeedPickerAfterIntegration(false);
    }
  }, [refetchIntegrations, refetch, resumeSeedPickerAfterIntegration]);

  const handleGithubDialogClose = useCallback(() => {
    setGithubDialogOpen(false);
    setGithubTargetId(undefined);
  }, []);

  const handleGithubDialogChanged = useCallback(() => {
    refetchIntegrations();
    refetch();
  }, [refetchIntegrations, refetch]);

  const createMutation = useInvalidatingMutation({
    mutationFn: ({
      name,
      integrationId,
    }: {
      name: string;
      integrationId?: string;
    }) =>
      api.workflows.create({
        name,
        description: '',
        workflowType: 'data-ingestion',
        nodes: integrationId
          ? [
              {
                id: 'source-node',
                type: NODE_TYPES.SOURCE_INTEGRATION,
                position: { x: 250, y: 150 },
                data: {
                  label: 'HTTP/REST',
                  config: { integrationId, path: '' },
                },
              },
            ]
          : [],
        edges: [],
        enabled: false,
      }),
    invalidates: [queryKeys.dataIngestionWorkflows],
  });
  const { mutateAsync: createDataSource } = createMutation;

  const handleCreate = useCallback(
    async (integrationId?: string) => {
      const timestamp = new Date().toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      try {
        const newWorkflow = await createDataSource({
          name: `Data Source ${timestamp}`,
          integrationId,
        });
        navigate(dataSourceDetail(newWorkflow.id));
      } catch (error) {
        alertApi.post({
          message: `Failed to create data source: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
          severity: 'error',
        });
      }
    },
    [createDataSource, navigate, alertApi],
  );

  const handleDelete = useCallback((id: string, name: string) => {
    setDeleteTarget([{ id, name }]);
  }, []);

  const handleBulkDelete = useCallback(
    (items: Array<{ id: string; name: string }>) => {
      setDeleteTarget(items);
    },
    [],
  );

  const runMutation = useInvalidatingMutation({
    mutationFn: (id: string) => api.executions.execute(id),
    invalidates: invalidationKeys.dataSourceRun(),
  });
  const { mutateAsync: runDataSource } = runMutation;

  // Rows can run/toggle concurrently (bulk actions), so per-row pending Sets —
  // not the mutation's single latest-call `isPending` — drive the row spinners.
  const handleRun = useCallback(
    async (id: string) => {
      setRunningIds(prev => new Set(prev).add(id));
      try {
        await runDataSource(id);
        noteRunStarted(id);
        alertApi.post({
          message: 'Data source run scheduled',
          severity: 'success',
          display: 'transient',
        });
      } catch (error) {
        if (isRunAlreadyInProgress(error)) {
          alertApi.post({
            message: RUN_ALREADY_IN_PROGRESS_MESSAGE,
            severity: 'info',
            display: 'transient',
          });
        } else {
          alertApi.post({
            message: `Failed to run data source: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
            severity: 'error',
          });
        }
      } finally {
        setRunningIds(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [runDataSource, alertApi, noteRunStarted],
  );

  const toggleMutation = useOptimisticMutation<
    Awaited<ReturnType<typeof api.workflows.update>>,
    { id: string; enabled: boolean },
    Awaited<ReturnType<typeof api.workflows.list>>
  >({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.workflows.update(id, { enabled }),
    cacheKey: queryKeys.dataIngestionWorkflows,
    update: (current, { id, enabled }) => ({
      ...current,
      data: current.data.map(workflow =>
        workflow.id === id ? { ...workflow, enabled } : workflow,
      ),
    }),
    invalidates: (_workflow, { id }) => invalidationKeys.workflowSaved(id),
  });
  const { mutateAsync: toggleDataSource } = toggleMutation;

  const handleToggleEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      setTogglingIds(prev => new Set(prev).add(id));
      try {
        await toggleDataSource({ id, enabled });
        alertApi.post({
          message: getDataSourceToggleSuccessMessage(enabled),
          severity: 'success',
          display: 'transient',
        });
      } catch (error) {
        alertApi.post({
          message: `Failed to ${getDataSourceToggleFailureVerb(enabled)}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
          severity: 'error',
        });
      } finally {
        setTogglingIds(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [toggleDataSource, alertApi],
  );

  const handleBulkRun = useCallback(
    async (ids: string[]) => {
      await Promise.allSettled(ids.map(id => handleRun(id)));
    },
    [handleRun],
  );

  const handleBulkEnable = useCallback(
    async (ids: string[]) => {
      await Promise.allSettled(ids.map(id => handleToggleEnabled(id, true)));
    },
    [handleToggleEnabled],
  );

  const handleBulkDisable = useCallback(
    async (ids: string[]) => {
      await Promise.allSettled(ids.map(id => handleToggleEnabled(id, false)));
    },
    [handleToggleEnabled],
  );

  const handleBulkFavorite = useCallback(
    (favorited: boolean) => {
      setFavorites(
        (bulkSelection?.selectedItems ?? []).map(item => item.id),
        favorited,
      );
    },
    [bulkSelection?.selectedItems, setFavorites],
  );

  const deleteMutation = useInvalidatingMutation({
    mutationFn: async (ids: string[]) => {
      // Wipe stored objects before the workflow: if the wipe fails, the data
      // source is still there and the whole delete can be retried from the
      // dialog, rather than leaving orphaned objects with no source.
      await Promise.all(ids.map(id => datastoreApi.deleteAllObjects(id)));
      await Promise.all(ids.map(id => api.workflows.delete(id)));
    },
    invalidates: [
      queryKeys.dataIngestionWorkflows,
      ...invalidationKeys.dataSourceObjectsDeleted(),
    ],
  });
  const { mutateAsync: deleteDataSources } = deleteMutation;

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteDataSources(deleteTarget.map(target => target.id));
      alertApi.post({
        message:
          deleteTarget.length === 1
            ? 'Data source deleted successfully'
            : `${deleteTarget.length} data sources deleted successfully`,
        severity: 'success',
        display: 'transient',
      });
      setDeleteTarget(null);
    } catch (error) {
      // Keep the dialog open on failure so the user can retry or cancel; the
      // dialog swallows the rejection itself and only resets its pending state.
      alertApi.post({
        message: `Failed to delete: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        severity: 'error',
      });
    }
  }, [deleteDataSources, deleteTarget, alertApi]);

  const handleDeleteCancel = useCallback(() => {
    setDeleteTarget(null);
  }, []);

  const openSeedPicker = useCallback(() => {
    setSeedPickerSession(session => session + 1);
    setSeedPickerOpen(true);
  }, []);

  // `?new=1` deep-links to the seed-picker dialog (the datastore empty state
  // links here). Consume the param so Back or a refresh doesn't reopen it.
  useEffect(() => {
    if (!searchParams.has('new')) return;
    openSeedPicker();
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        next.delete('new');
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams, openSeedPicker]);

  const handleSeedPickerComplete = useCallback(() => {
    setSeedPickerOpen(false);
    refetch();
  }, [refetch]);

  const handleCreateCustom = useCallback(
    (integrationId?: string) => {
      setSeedPickerOpen(false);
      handleCreate(integrationId);
    },
    [handleCreate],
  );

  const handleCreateIntegration = useCallback(() => {
    setSeedPickerOpen(false);
    setIntegrationEditTarget(undefined);
    setResumeSeedPickerAfterIntegration(true);
    setIntegrationFormOpen(true);
  }, []);

  // Next-run info is fetched lazily: a row's schedule is only requested when
  // the user first opens its "next run" tooltip (preserving the previous
  // on-demand behaviour — we never eagerly hit getScheduleInfo for every
  // visible row). Requested ids drive a `useQueries` batch; React Query dedupes
  // by key, so the old in-flight ref + loading Set are gone.
  const [requestedNextRunIds, setRequestedNextRunIds] = useState<string[]>([]);

  const loadNextRunForDataSource = useCallback((dataSourceId: string) => {
    setRequestedNextRunIds(current =>
      current.includes(dataSourceId) ? current : [...current, dataSourceId],
    );
  }, []);

  const nextRunResults = useQueries({
    queries: requestedNextRunIds.map(dataSourceId => ({
      // Mirror trigger-step.tsx's schedule-info key shape.
      queryKey: workspaceQueryKey('workflows', 'scheduleInfo', dataSourceId),
      queryFn: () =>
        Promise.race([
          api.workflows.getScheduleInfo(dataSourceId),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Schedule info timeout')), 8000);
          }),
        ]),
      // The old imperative path made a single attempt and treated any
      // failure (incl. the 8s timeout) as "not scheduled"; keep that.
      retry: false,
    })),
  });

  // id -> nextRunAt for rows whose schedule query has settled. Absence means
  // "still loading" (or not requested yet); an errored/timed-out query maps to
  // null ("not scheduled"), matching the old catch behaviour.
  const nextRunByDataSourceId = useMemo(() => {
    const map: Record<string, string | null> = {};
    requestedNextRunIds.forEach((dataSourceId, index) => {
      const result = nextRunResults[`${index}`];
      if (!result) return;
      if (result.isSuccess) {
        map[`${dataSourceId}`] = result.data?.nextRunAt ?? null;
      } else if (result.isError) {
        map[`${dataSourceId}`] = null;
      }
    });
    return map;
  }, [requestedNextRunIds, nextRunResults]);

  const getNextRunTooltipLabel = useCallback(
    (dataSourceId: string) => {
      if (!Object.hasOwn(nextRunByDataSourceId, dataSourceId)) {
        return 'Next run: Loading...';
      }

      const nextRunAt = nextRunByDataSourceId[`${dataSourceId}`];
      if (!nextRunAt) {
        return 'Next run not scheduled';
      }

      return `Next run: ${new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(nextRunAt))}`;
    },
    [nextRunByDataSourceId],
  );

  const getSetupBadge = useCallback(
    (ds: DataSourceItem): SetupBadgeInfo => {
      const setup = getDataSourceOverviewStatus(
        ds,
        summariesByIntegrationId,
        secretStatusLoading,
      );

      return {
        label: setup.label,
        tone: setup.tone,
        tooltip: setup.tooltip,
        pending: setup.pending,
        onResolve: setup.unreadyIntegrationId
          ? () => handleEditIntegration(setup.unreadyIntegrationId!)
          : undefined,
      };
    },
    [summariesByIntegrationId, secretStatusLoading, handleEditIntegration],
  );

  const getReadinessReason = useDataSourceReadinessReason(
    summariesByIntegrationId,
    secretStatusLoading,
  );

  const integrationFilterOptions = useMemo(() => {
    const options = new Map<string, { label: string; logoUrl?: string }>();
    for (const dataSource of dataSources) {
      // Offer every integration involved — primary and chained sources — so the
      // facet can filter on a chained integration too.
      const list = dataSourceIntegrations(dataSource);
      if (list.length === 0) {
        options.set('__none__', { label: 'No integration' });
        continue;
      }
      for (const integration of list) {
        options.set(integration.id ?? '__none__', {
          label: integration.label,
          logoUrl: integration.logoUrl,
        });
      }
    }
    return Array.from(options, ([value, option]) => ({
      value,
      label: option.label,
      icon:
        option.logoUrl !== undefined ? (
          <IntegrationIconFrame size="group">
            <IntegrationLogo src={option.logoUrl} size={16} />
          </IntegrationIconFrame>
        ) : undefined,
    })).sort((a, b) => a.label.localeCompare(b.label));
  }, [dataSources]);

  const columns = useDataSourceColumns({
    executionsLoading,
    getSetupBadge,
    onEditIntegration: handleEditIntegration,
    getNextRunTooltipLabel,
    loadNextRunForDataSource,
    favoriteIds,
    onToggleFavorite: toggleFavorite,
    onOpenRunDetails: openRunDetails,
    setupStatuses: config.statuses ?? [],
    integrationFilterOptions,
  });

  const handleSelectionChange = useCallback(
    (selected: DataSourceItem[]) => {
      setBulkSelection(
        buildBulkSelectionState(
          selected,
          runningIds,
          togglingIds,
          summariesByIntegrationId,
          secretStatusLoading,
        ),
      );
    },
    [runningIds, togglingIds, summariesByIntegrationId, secretStatusLoading],
  );

  const getRowId = useCallback((ds: DataSourceItem) => ds.id, []);
  const renderRowActions = useCallback(
    (ds: DataSourceItem) => (
      <DataSourceRowActionsMenu
        ds={ds}
        getReadinessReason={getReadinessReason}
        runningIds={runningIds}
        togglingIds={togglingIds}
        isFavorite={favoriteIds.has(ds.id)}
        onRun={handleRun}
        onOpenRunDetails={openRunDetails}
        onToggleEnabled={handleToggleEnabled}
        onToggleFavorite={toggleFavorite}
        onDelete={handleDelete}
      />
    ),
    [
      getReadinessReason,
      runningIds,
      togglingIds,
      favoriteIds,
      handleRun,
      openRunDetails,
      handleToggleEnabled,
      toggleFavorite,
      handleDelete,
    ],
  );

  const overviewSnapshot = useMemo(
    () => ({
      routeKey: PATHS.DATA_SOURCES,
      activeGroup: group,
      groups: groups.map(g => ({
        ...g,
        href:
          g.key === 'all'
            ? PATHS.DATA_SOURCES
            : `${PATHS.DATA_SOURCES}?group=${g.key}`,
      })),
    }),
    [groups, group],
  );
  // Don't publish the empty loading snapshot — keep the sidebar showing the
  // cached counts (or, on first visit, no sub-items until counts land) so the
  // full category set reveals in one step when data lands, instead of flickering
  // All/Favorites → +counts.
  usePublishOverviewData(loading ? null : overviewSnapshot);

  const listEmpty = !loading && !error && dataSources.length === 0;

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
      <OverviewListingStandaloneBody className="flex min-h-0 flex-1 flex-col space-y-4 sm:space-y-6">
        <div className="shrink-0">
          <OverviewListingPageHeader
            title="Data Sources"
            description="Ingest data into your graph from specific endpoints."
            toolbar={
              dataSources.length > 0 ? (
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 md:gap-3">
                  <DataSourcesBulkActions
                    state={bulkSelection}
                    onRun={() => {
                      handleBulkRun(bulkSelection?.runnableIds ?? []);
                    }}
                    onEnable={() => {
                      handleBulkEnable(bulkSelection?.enableableIds ?? []);
                    }}
                    onDisable={() => {
                      handleBulkDisable(bulkSelection?.disableableIds ?? []);
                    }}
                    onAddToFavorites={() => {
                      handleBulkFavorite(true);
                    }}
                    onRemoveFromFavorites={() => {
                      handleBulkFavorite(false);
                    }}
                    onDelete={() => {
                      handleBulkDelete(bulkSelection?.selectedItems ?? []);
                    }}
                  />
                  {(bulkSelection?.selectedCount ?? 0) > 0 ? (
                    <div
                      className="hidden h-6 w-px shrink-0 bg-border sm:block"
                      aria-hidden
                    />
                  ) : null}
                  <OverviewListingSearchField
                    value={search}
                    onValueChange={setSearch}
                    placeholder="Search by name, description, or integration..."
                    ariaLabel="Filter by name, description, or integration"
                    layout="pageHeader"
                  />
                </div>
              ) : null
            }
            primaryAction={
              <Button
                size="sm"
                className={toolbarPrimaryCtaButtonClassName}
                onClick={openSeedPicker}
              >
                <Plus />
                New
              </Button>
            }
          />
        </div>

        {!loading && error ? (
          <OverviewEmptyState
            icon={AlertTriangle}
            title="Failed to load data sources"
            description={error.message}
          />
        ) : listEmpty ? (
          <DataSourceSeedPicker
            onComplete={refetch}
            onCreateCustom={handleCreate}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4 sm:gap-6">
            <OverviewTable<DataSourceItem>
              data={rows}
              columns={columns}
              columnDisplay={{ tableId: 'data-sources' }}
              getRowId={getRowId}
              loading={tableLoading}
              cellsLoading={executionsLoading}
              defaultSort={[{ id: 'setup', desc: false }]}
              selection={{
                marquee: true,
                resetKey: group,
                onChange: handleSelectionChange,
              }}
              rowActions={renderRowActions}
              onRowClick={ds => openDetail(ds.id)}
              paginationTestId="data-sources-table-pagination"
              emptyState={
                <EmptyState
                  title="No matching data sources"
                  description="Try clearing your search or filters."
                />
              }
            />
          </div>
        )}
      </OverviewListingStandaloneBody>

      <DataSourceDetailDrawer
        dataSourceId={detailId}
        dataSource={detailDataSource}
        dataSourceNameById={dataSourceNameById}
        enabledDataSourceIds={enabledDataSourceIds}
        summariesByIntegrationId={summariesByIntegrationId}
        secretStatusLoading={secretStatusLoading}
        open={detailId != null}
        listLoading={detailId != null && !detailDataSource && loading}
        onOpenChange={open => {
          if (!open) closeDetail();
        }}
      />

      <DataSourceRunDetailsDrawer
        dataSourceId={runDataSourceId}
        dataSource={selectedRunDataSource}
        open={runDataSourceId != null}
        listLoading={
          runDataSourceId != null && !selectedRunDataSource && loading
        }
        running={runDataSourceId != null && runningIds.has(runDataSourceId)}
        onRun={handleRun}
        onOpenChange={open => {
          if (!open) closeRunDetails();
        }}
      />

      <ConfirmationDialog
        open={!!deleteTarget}
        title={
          deleteTarget && deleteTarget.length > 1
            ? 'Delete data sources'
            : 'Delete data source'
        }
        contentText={
          <>
            {deleteTarget && deleteTarget.length > 1
              ? `Are you sure you want to delete ${deleteTarget.length} data sources? The datastore objects they created will also be deleted. This cannot be undone.`
              : `Are you sure you want to delete "${deleteTarget?.[0]?.name}"? The datastore objects it created will also be deleted. This cannot be undone.`}
            <ReferenceUsageWarning
              referenced={referencedDeleteTargets}
              loading={usageLoading}
              multiple={!!deleteTarget && deleteTarget.length > 1}
            />
            {dependentContextGroups.length > 0 && (
              <span className="mt-3 flex flex-col gap-1 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-warning">
                <span className="font-medium">
                  {dependentContextGroups.length === 1
                    ? 'A context group draws from this data source:'
                    : 'Context groups draw from this data source:'}
                </span>
                <span>
                  {dependentContextGroups.map(group => group.name).join(', ')}
                </span>
                <span>
                  Those groups will lose this source and stop including its
                  objects.
                </span>
              </span>
            )}
          </>
        }
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
        isDelete
        confirmButtonText="Delete"
        confirmingText="Deleting…"
      />

      <IntegrationFormDialog
        open={integrationFormOpen}
        onClose={handleIntegrationFormClose}
        onSaved={handleIntegrationSaved}
        onSecretsChanged={handleIntegrationSaved}
        integration={integrationEditTarget}
      />

      {githubTargetId != null && (
        <GitHubIntegrationDialogWrapper
          targetId={githubTargetId}
          items={fullIntegrationItems}
          open={githubDialogOpen}
          onClose={handleGithubDialogClose}
          onChanged={handleGithubDialogChanged}
          onRequestDelete={() => {
            setGithubDialogOpen(false);
            setGithubTargetId(undefined);
          }}
        />
      )}

      <Dialog
        open={seedPickerOpen}
        onOpenChange={open => {
          if (!open && seedApplying) return;
          setSeedPickerOpen(open);
        }}
      >
        <DialogContent
          hideCloseButton
          className="flex h-[min(80vh,560px)] max-w-3xl flex-col gap-0 overflow-hidden p-0"
        >
          <DialogTitle className="sr-only">New data source</DialogTitle>
          <DataSourceSeedPicker
            key={seedPickerSession}
            variant="compact"
            onComplete={handleSeedPickerComplete}
            onCreateCustom={handleCreateCustom}
            onCreateIntegration={handleCreateIntegration}
            onClose={() => setSeedPickerOpen(false)}
            onApplyingChange={setSeedApplying}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
