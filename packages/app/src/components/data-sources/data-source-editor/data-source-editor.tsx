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

import React, {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import { useNavigate, useParams } from 'react-router';
import { invalidationKeys, queryKeys } from '../../../api/queries';
import { useReferenceUsage } from '../../capabilities/use-reference-usage';
import { useReferenceRename } from '../../capabilities/use-reference-rename';
import { ReferenceUsageWarning } from '../../capabilities/reference-usage-warning';
import { isValidSlug } from '../../capabilities/editor/references';
import {
  UnreferenceableSlugIcon,
  slugTriggerTooltip,
} from '../../capabilities/unreferenceable-slug';
import { useInvalidatingMutation } from '../../../api/query-hooks';
import { useIntegrationDetail } from './use-integration-detail';
import type { JsonValue } from '../../../types';
import { useAlert, useDatastore, type AlertApi } from '../../../api';
import { FlaskConical, Hash } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { Input } from '@roadiehq/ui/input';
import { Label } from '@roadiehq/ui/label';
import { Popover, PopoverTrigger, PopoverContent } from '@roadiehq/ui/popover';
import { Spinner } from '@roadiehq/ui/spinner';
import { StatusDot } from '@roadiehq/ui/status-indicator';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@roadiehq/ui/tooltip';
import { cn } from '@roadiehq/ui/utils';
import { EntityEditorHeader, UnsavedChangesBlocker } from '../../common';
import { ConfirmationDialog } from '@roadiehq/ui/confirmation-dialog';
import { PipelineEditorLayout } from '../../common/pipeline-editor';
import { PATHS, dataSourceDetail } from '../../../config/paths';
import { DataSourceEditorActions } from './data-source-editor-actions';
import {
  DataSourceEditorContext,
  useDataSourceEditorContext,
} from './data-source-editor-context';
import { ExecutionInspectorDrawer } from './execution-inspector-drawer';
import { TriggerStep } from './trigger-step';
import { SourceStep } from './source-step';
import { TransformSteps } from './transform-steps';
import { SinkSteps } from './sink-steps';
import { NodeDetailsPanel } from './node-details-panel';
import { SpacebarStepToggle } from './spacebar-step-toggle';
import { useDataSourceState } from '../use-data-source-state';
import { useDataSourceBuilder } from '../use-data-source-builder';
import { useDataSourceExecution } from '../use-data-source-execution';
import { useWorkflows } from '../../../api';
import { useWorkflow } from '../use-workflow';
import { useExecutionList } from '../use-execution-list';
import {
  isRunAlreadyInProgress,
  RUN_ALREADY_IN_PROGRESS_MESSAGE,
} from '../run-conflict';
import { ErrorDisplay } from './error-display';
import {
  getDataSourceActionAvailability,
  getDataSourceReadinessReason,
} from '../readiness';
import {
  getDataSourceLifecycleLabel,
  getDataSourceLifecycleStatus,
  getDataSourceStatusIndicatorStyle,
  getDataSourceToggleFailureVerb,
  getDataSourceToggleSuccessMessage,
} from '../data-source-status';
import { READINESS_REASON } from '../../overview';
import { useIntegrationSecretStatus } from '../../integrations/use-integration-secret-status';
import { useLogoResolver } from '../use-resolved-logo';

function useSourceIntegrationLogoUrl(): string {
  const { sourceConfig, workflowApi } = useDataSourceEditorContext();
  const resolveLogoUrl = useLogoResolver();
  const integrationId = sourceConfig.integrationId
    ? String(sourceConfig.integrationId)
    : undefined;
  const { data: integration } = useIntegrationDetail(
    workflowApi,
    integrationId,
  );

  return resolveLogoUrl(integration ?? undefined);
}

function DataSourceEditorHeader(
  props: Omit<
    React.ComponentProps<typeof EntityEditorHeader>,
    'section' | 'logoUrl'
  >,
) {
  const logoUrl = useSourceIntegrationLogoUrl();
  return (
    <EntityEditorHeader section="data-sources" logoUrl={logoUrl} {...props} />
  );
}

export function DataSourceEditor() {
  const { dataSourceId } = useParams<{ dataSourceId: string }>();
  const api = useWorkflows();
  const alertApi = useAlert();
  const navigate = useNavigate();

  const { workflow, loading, error, save, saving, execute } =
    useWorkflow(dataSourceId);

  if (loading) {
    return (
      <div
        className="flex min-h-[40vh] w-full min-w-0 flex-1 items-center justify-center"
        data-testid="data-source-editor-loading"
      >
        <Spinner size={24} />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="w-full min-w-0 flex-1 p-4"
        data-testid="data-source-editor-error"
      >
        <ErrorDisplay error={error} title="Failed to load data source" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
      <DataSourceEditorContent
        key={dataSourceId || 'new'}
        workflow={workflow}
        onSave={save}
        saving={saving}
        onExecute={execute}
        workflowApi={api}
        alertApi={alertApi}
        onAfterDelete={() => navigate(PATHS.DATA_SOURCES)}
      />
    </div>
  );
}

export interface DataSourceEditorContentProps {
  workflow: ReturnType<typeof useWorkflow>['workflow'];
  onSave: ReturnType<typeof useWorkflow>['save'];
  saving: boolean;
  onExecute: ReturnType<typeof useWorkflow>['execute'];
  workflowApi: ReturnType<typeof useWorkflows>;
  alertApi: AlertApi;
  onAfterDelete?: () => void;
}

export function DataSourceEditorContent({
  workflow,
  onSave,
  saving,
  onExecute,
  workflowApi,
  alertApi,
  onAfterDelete,
}: DataSourceEditorContentProps) {
  const navigate = useNavigate();
  const state = useDataSourceState({ workflow });
  const { setWorkflowName } = state;
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [selectedExecutionId, setSelectedExecutionId] = useState<
    string | undefined
  >(undefined);
  const [runMode, setRunMode] = useState<'dry-run' | 'run' | null>(null);

  const [isEnabled, setIsEnabled] = useState(workflow?.enabled ?? false);
  const [secretRefreshNonce, setSecretRefreshNonce] = useState(0);
  const bumpSecretRefresh = useCallback(() => {
    setSecretRefreshNonce(n => n + 1);
  }, []);
  const [scheduleRefreshNonce, setScheduleRefreshNonce] = useState(0);
  const bumpScheduleRefresh = useCallback(() => {
    setScheduleRefreshNonce(n => n + 1);
  }, []);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [slug, setSlug] = useState(workflow?.slug ?? '');
  const [slugPopoverOpen, setSlugPopoverOpen] = useState(false);
  // Optimistic local copy for the inline header description (like name/slug).
  const [description, setDescription] = useState(workflow?.description ?? '');
  const [accumulatedSchema, setAccumulatedSchema] = useState<JsonValue | null>(
    null,
  );
  const allowPostMutationNavigationRef = useRef(false);
  const selectedIntegrationId =
    typeof state.sourceConfig.integrationId === 'string'
      ? state.sourceConfig.integrationId
      : undefined;
  useEffect(() => {
    setIsEnabled(workflow?.enabled ?? false);
  }, [workflow?.enabled]);

  useEffect(() => {
    setSlug(workflow?.slug ?? '');
  }, [workflow?.slug]);

  // The slug is a single inline field in a popover rather than a form, which
  // `forms.md` exempts from useZodForm — so it validates by hand against the
  // same grammar the backend enforces.
  const slugError = useMemo(() => {
    const trimmed = slug.trim();
    if (!trimmed) return 'Slug is required';
    if (!isValidSlug(trimmed)) {
      return 'Use lowercase letters, numbers and single hyphens';
    }
    return null;
  }, [slug]);

  // Which capabilities carry an `@datasource:<slug>` token — the delete dialog
  // warns about them, and the rename guard offers to rewrite them.
  const { getReferencedTargets, loading: usageLoading } = useReferenceUsage({
    skip: !deleteDialogOpen,
  });
  const renameGuard = useReferenceRename({ skip: !slugPopoverOpen });
  const referencedDeleteTargets = useMemo(
    () =>
      getReferencedTargets([
        {
          type: 'datasource',
          name: state.workflowName,
          slug: workflow?.slug,
        },
      ]),
    [getReferencedTargets, state.workflowName, workflow?.slug],
  );

  // Description is owned locally (like name) so a concurrent workflow refetch
  // cannot clobber an optimistic header edit. The editor remounts on
  // dataSourceId, so initial load still picks up the server value.

  // secretRefreshNonce in the key: refetch so `readyForCurrentScope` reflects
  // a just-saved secret without needing a page reload.
  const selectedIntegrationQuery = useIntegrationDetail(
    workflowApi,
    selectedIntegrationId,
    { refreshNonce: secretRefreshNonce },
  );
  const selectedIntegration = selectedIntegrationQuery.data ?? undefined;
  const selectedIntegrationLoading = selectedIntegrationQuery.isLoading;

  const { summariesByIntegrationId, loading: secretStatusLoading } =
    useIntegrationSecretStatus(
      selectedIntegration ? [selectedIntegration] : [],
    );

  const getSelectedIntegrationReadinessReason = useCallback(() => {
    if (!selectedIntegrationId) {
      return undefined;
    }
    if (selectedIntegrationLoading) {
      return undefined;
    }
    if (!selectedIntegration?.id) {
      return 'Selected integration is unavailable';
    }
    return getDataSourceReadinessReason(
      {
        integrationId: selectedIntegrationId,
        integration: {
          id: selectedIntegration.id,
          backendType: selectedIntegration.backendType,
          config: selectedIntegration.config,
          readyForCurrentScope: selectedIntegration.readyForCurrentScope,
        },
        sourceConfig: state.sourceConfig,
      },
      summariesByIntegrationId,
      secretStatusLoading,
    );
  }, [
    selectedIntegrationId,
    selectedIntegration,
    selectedIntegrationLoading,
    state.sourceConfig,
    summariesByIntegrationId,
    secretStatusLoading,
  ]);

  const toggleMutation = useInvalidatingMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      workflowApi.workflows.update(id, { enabled }),
    invalidates: (_workflow, { id }) => invalidationKeys.workflowSaved(id),
  });
  const toggling = toggleMutation.isPending;
  const { mutateAsync: toggleWorkflow } = toggleMutation;

  const handleToggleEnabled = useCallback(async () => {
    if (!workflow?.id) {
      return;
    }
    const newEnabled = !isEnabled;
    try {
      await toggleWorkflow({
        id: workflow.id,
        enabled: newEnabled,
      });
      setIsEnabled(newEnabled);
      alertApi.post({
        message: getDataSourceToggleSuccessMessage(newEnabled),
        severity: 'success',
        display: 'transient',
      });
    } catch (err) {
      alertApi.post({
        message: `Failed to ${getDataSourceToggleFailureVerb(newEnabled)}: ${
          err instanceof Error ? err.message : 'Unknown error'
        }`,
        severity: 'error',
      });
    }
  }, [workflow?.id, isEnabled, toggleWorkflow, alertApi]);

  const runMutation = useInvalidatingMutation({
    mutationFn: (id: string) => workflowApi.executions.execute(id),
    invalidates: (_result, id) => invalidationKeys.dataSourceRun(id),
  });
  const running = runMutation.isPending;
  const { mutateAsync: runDataSource } = runMutation;

  const handleManualRun = useCallback(async () => {
    if (!workflow?.id) {
      return;
    }
    try {
      const result = await runDataSource(workflow.id);
      setSelectedExecutionId(result.executionId);
      setInspectorOpen(true);
      alertApi.post({
        message: 'Data source run scheduled',
        severity: 'success',
        display: 'transient',
      });
    } catch (err) {
      if (isRunAlreadyInProgress(err)) {
        alertApi.post({
          message: RUN_ALREADY_IN_PROGRESS_MESSAGE,
          severity: 'info',
          display: 'transient',
        });
        return;
      }
      alertApi.post({
        message: `Failed to run data source: ${
          err instanceof Error ? err.message : 'Unknown error'
        }`,
        severity: 'error',
      });
    }
  }, [workflow?.id, runDataSource, alertApi]);

  const datastoreApi = useDatastore();
  const deleteMutation = useInvalidatingMutation({
    mutationFn: async (id: string) => {
      // Wipe stored objects before the workflow: if the wipe fails, the data
      // source is still there and the whole delete can be retried from the
      // dialog, rather than leaving orphaned objects with no source.
      await datastoreApi.deleteAllObjects(id);
      await workflowApi.workflows.delete(id);
    },
    // Workflow list only (plus the wiped objects): the detail query is still
    // actively subscribed (useWorkflow) until onAfterDelete navigates away, so
    // invalidating/removing it here would refetch a just-deleted workflow.
    invalidates: [
      queryKeys.dataIngestionWorkflows,
      ...invalidationKeys.dataSourceObjectsDeleted(),
    ],
  });
  const { mutateAsync: deleteDataSource } = deleteMutation;

  const handleDeleteConfirm = useCallback(async () => {
    if (!workflow?.id) {
      return;
    }
    try {
      await deleteDataSource(workflow.id);
      alertApi.post({
        message: 'Data source deleted successfully',
        severity: 'success',
        display: 'transient',
      });
      setDeleteDialogOpen(false);
      if (onAfterDelete) {
        allowPostMutationNavigationRef.current = true;
        onAfterDelete();
      }
    } catch (err) {
      // Keep the dialog open on failure so the user can retry or cancel; the
      // dialog swallows the rejection itself and only resets its pending state.
      alertApi.post({
        message: `Failed to delete: ${
          err instanceof Error ? err.message : 'Unknown error'
        }`,
        severity: 'error',
      });
      throw err;
    }
  }, [workflow?.id, deleteDataSource, alertApi, onAfterDelete]);

  const { buildWorkflowNodes, buildWorkflowEdges } = useDataSourceBuilder({
    triggerType: state.triggerType,
    triggerConfig: state.triggerConfig,
    sourceType: state.sourceType,
    sourceConfig: state.sourceConfig,
    transforms: state.transforms,
    sinks: state.sinks,
    confirmedSinkSchema: state.confirmedSinkSchema,
  });

  const { handleSave: handleSaveWorkflow, handleRun } = useDataSourceExecution({
    workflowApi,
    workflowName: state.workflowName,
    buildWorkflowNodes,
    buildWorkflowEdges,
    onSave,
    onExecute,
    streamCleanupRef: state.streamCleanupRef,
    setPreviewLoading: state.setPreviewLoading,
    setPreviewError: state.setPreviewError,
    setNodeOutputs: state.setNodeOutputs,
    setNodeErrors: state.setNodeErrors,
    setRunningNodes: state.setRunningNodes,
    setIsPreviewRun: state.setIsPreviewRun,
    setPreviewRequestLogs: state.setPreviewRequestLogs,
    setPreviewLogs: state.setPreviewLogs,
    setPreviewExecutionId: state.setPreviewExecutionId,
    setHasRunPreview: state.setHasRunPreview,
    clearIsDirty: state.clearIsDirty,
  });
  const {
    executions: executionHistory,
    loading: executionHistoryLoading,
    retry: refreshExecutionHistory,
  } = useExecutionList(workflow?.id, { limit: 20 });
  // Don't pass ephemeral dry-run execution IDs to the inspector — they
  // aren't persisted to the database so the GET /executions/:id fetch
  // would 404 and flash a red "not found" error.
  const activeExecutionId =
    state.previewLoading && !state.isPreviewRun
      ? state.previewExecutionId
      : undefined;
  const monitorExecutionId =
    activeExecutionId ?? selectedExecutionId ?? executionHistory[0]?.id;

  const shouldSelectNewestRef = useRef(false);
  useEffect(() => {
    if (!selectedExecutionId && executionHistory.length > 0) {
      setSelectedExecutionId(executionHistory[0].id);
    } else if (shouldSelectNewestRef.current && executionHistory.length > 0) {
      setSelectedExecutionId(executionHistory[0].id);
      shouldSelectNewestRef.current = false;
    }
  }, [selectedExecutionId, executionHistory]);

  const prevPreviewLoadingRef = useRef(state.previewLoading);
  useEffect(() => {
    if (prevPreviewLoadingRef.current && !state.previewLoading) {
      shouldSelectNewestRef.current = true;
      refreshExecutionHistory();
    }
    prevPreviewLoadingRef.current = state.previewLoading;
  }, [state.previewLoading, refreshExecutionHistory]);

  const handleOpenInspector = useCallback(() => {
    if (!monitorExecutionId) {
      return;
    }
    setInspectorOpen(true);
  }, [monitorExecutionId]);

  useEffect(() => {
    if (!state.previewLoading) {
      setRunMode(null);
    }
  }, [state.previewLoading]);

  const handleToolbarRun = useCallback(
    async (dryRun: boolean) => {
      setRunMode(dryRun ? 'dry-run' : 'run');
      const allStepIds = [
        ...(state.triggerType ? ['trigger'] : []),
        'source',
        ...state.transforms.map(t => t.id),
        ...state.sinks.map(s => s.id),
      ];
      state.setSelectedSteps(allStepIds);
      await handleRun(dryRun);
    },
    [handleRun, state],
  );

  // Inline field saves (name/slug) mirror the toggle/delete mutations' cache
  // invalidation: refresh the list entry and this workflow's detail.
  const updateNameMutation = useInvalidatingMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      workflowApi.workflows.update(id, { name }),
    invalidates: (_workflow, { id }) => invalidationKeys.workflowSaved(id),
  });
  const savingName = updateNameMutation.isPending;
  const { mutateAsync: updateWorkflowName } = updateNameMutation;

  const updateSlugMutation = useInvalidatingMutation({
    mutationFn: ({ id, slug: nextSlug }: { id: string; slug: string }) =>
      workflowApi.workflows.update(id, { slug: nextSlug }),
    invalidates: (_workflow, { id }) => invalidationKeys.workflowSaved(id),
  });
  const savingSlug = updateSlugMutation.isPending;
  const { mutateAsync: updateWorkflowSlug } = updateSlugMutation;

  const updateDescriptionMutation = useInvalidatingMutation({
    mutationFn: ({
      id,
      description: nextDescription,
    }: {
      id: string;
      description: string;
    }) => workflowApi.workflows.update(id, { description: nextDescription }),
    invalidates: (_workflow, { id }) => invalidationKeys.workflowSaved(id),
  });
  const { mutateAsync: updateWorkflowDescription } = updateDescriptionMutation;

  const handleWorkflowNameChange = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      const previousName = state.workflowName;
      if (!trimmed || trimmed === previousName) {
        setWorkflowName(previousName);
        return;
      }
      setWorkflowName(trimmed);
      if (!workflow?.id) {
        return;
      }
      // mutateAsync so we can sequence the optimistic-revert / toast off the
      // result; wrapped in try/catch as the standard requires.
      try {
        await updateWorkflowName({
          id: workflow.id,
          name: trimmed,
        });
        alertApi.post({
          message: 'Name updated',
          severity: 'success',
          display: 'transient',
        });
      } catch (err) {
        setWorkflowName(previousName);
        alertApi.post({
          message: `Failed to update name: ${
            err instanceof Error ? err.message : 'Unknown error'
          }`,
          severity: 'error',
        });
      }
    },
    [
      setWorkflowName,
      state.workflowName,
      workflow?.id,
      updateWorkflowName,
      alertApi,
    ],
  );

  // Each commit gets a monotonic id (identity per commit, not per value — the
  // same text can be recommitted) so a settled response can tell whether it is
  // still the newest edit. persisted tracks the newest value the server has
  // acknowledged; the in-flight count lets us defer the revert until every
  // outstanding write has drained.
  const descriptionCommitIdRef = useRef(0);
  const persistedDescriptionRef = useRef<{ commitId: number; value: string }>({
    commitId: 0,
    value: workflow?.description ?? '',
  });
  const descriptionInFlightRef = useRef(0);
  const descriptionErrorRef = useRef<unknown>(undefined);

  // Unlike name, an empty description is a valid save (it clears it).
  // Compare against local state (not the query cache) so a stale
  // workflow.description cannot skip a real save after an optimistic edit.
  const handleWorkflowDescriptionChange = useCallback(
    async (next: string) => {
      const trimmed = next.trim();
      if (trimmed === description) {
        setDescription(description);
        return;
      }
      setDescription(trimmed);
      if (!workflow?.id) {
        return;
      }
      const commitId = ++descriptionCommitIdRef.current;
      descriptionInFlightRef.current += 1;
      try {
        await updateWorkflowDescription({
          id: workflow.id,
          description: trimmed,
        });
        if (commitId > persistedDescriptionRef.current.commitId) {
          persistedDescriptionRef.current = { commitId, value: trimmed };
        }
        // Only the newest commit toasts success — a stale success is invisible.
        if (commitId === descriptionCommitIdRef.current) {
          alertApi.post({
            message: 'Description updated',
            severity: 'success',
            display: 'transient',
          });
        }
      } catch (err) {
        // Stash the error for the drain step below, but only if this is still
        // the newest commit — an older failure is irrelevant once superseded.
        if (commitId === descriptionCommitIdRef.current) {
          descriptionErrorRef.current = err;
        }
      }

      // Reconcile only once every outstanding write has settled. Reverting on
      // each failure snapshots `persisted` too early: a newer edit could fail
      // while an older request is still in flight and would then advance
      // `persisted` — reverting immediately would strand the UI on a value the
      // server never keeps (and toast an error over it). Draining first lets a
      // slower older success supersede a newer failure.
      if (--descriptionInFlightRef.current > 0) {
        return;
      }
      const persisted = persistedDescriptionRef.current;
      setDescription(persisted.value);
      // If the newest commit is not the one the server acknowledged, it failed:
      // surface that (the value shown is now the last value the server kept).
      if (persisted.commitId !== descriptionCommitIdRef.current) {
        const err = descriptionErrorRef.current;
        alertApi.post({
          message: `Failed to update description: ${
            err instanceof Error ? err.message : 'Unknown error'
          }`,
          severity: 'error',
        });
      }
      descriptionErrorRef.current = undefined;
    },
    [description, workflow?.id, updateWorkflowDescription, alertApi],
  );

  const handleSlugSave = useCallback(async () => {
    if (savingSlug) {
      return;
    }
    const trimmed = slug.trim();
    const previousSlug = workflow?.slug ?? '';
    if (!trimmed || trimmed === previousSlug) {
      setSlug(previousSlug);
      setSlugPopoverOpen(false);
      return;
    }
    if (!workflow?.id) {
      setSlugPopoverOpen(false);
      return;
    }

    const workflowId = workflow.id;
    const commit = async () => {
      try {
        await updateWorkflowSlug({ id: workflowId, slug: trimmed });
      } catch (err) {
        setSlug(previousSlug);
        // Re-thrown so the rename guard can report it and keep its dialog open.
        throw err;
      }
      alertApi.post({
        message: 'Slug updated',
        severity: 'success',
        display: 'transient',
      });
    };

    // A rename breaks every `@datasource:<old-slug>` token; hand off to the
    // guard, which confirms and optionally rewrites them.
    if (
      renameGuard.interceptRename({
        type: 'datasource',
        fromSlug: previousSlug,
        toSlug: trimmed,
        commit,
      })
    ) {
      setSlugPopoverOpen(false);
      return;
    }

    try {
      await commit();
      setSlugPopoverOpen(false);
    } catch (err) {
      alertApi.post({
        message: `Failed to update slug: ${
          err instanceof Error ? err.message : 'Unknown error'
        }`,
        severity: 'error',
      });
    }
  }, [
    savingSlug,
    slug,
    workflow?.id,
    workflow?.slug,
    updateWorkflowSlug,
    alertApi,
    renameGuard,
  ]);

  const handleSave = useCallback(async () => {
    let enabledOverride: boolean | undefined;

    if (isEnabled && selectedIntegrationId) {
      const readinessReason = getSelectedIntegrationReadinessReason();
      if (readinessReason) {
        enabledOverride = false;
      }
    }

    const wasDraft = !workflow?.id;
    const saved = await handleSaveWorkflow(
      enabledOverride === undefined ? undefined : { enabled: enabledOverride },
    );

    if (saved instanceof Error) {
      alertApi.post({
        message: `Failed to save: ${saved.message}`,
        severity: 'error',
      });
      return;
    }

    bumpScheduleRefresh();

    if (enabledOverride === false) {
      setIsEnabled(false);
      alertApi.post({
        message:
          'Data source was saved, but still needs setup before it can be enabled',
        severity: 'warning',
      });
    } else {
      alertApi.post({
        message: wasDraft ? 'Data source created' : 'Changes saved',
        severity: 'success',
        display: 'transient',
      });
    }

    if (wasDraft && saved?.id) {
      allowPostMutationNavigationRef.current = true;
      navigate(dataSourceDetail(saved.id), { replace: true });
    }
  }, [
    alertApi,
    handleSaveWorkflow,
    getSelectedIntegrationReadinessReason,
    isEnabled,
    selectedIntegrationId,
    workflow?.id,
    navigate,
    bumpScheduleRefresh,
  ]);

  const selectedIntegrationReadinessReason =
    getSelectedIntegrationReadinessReason();
  const lifecycleStatus = getDataSourceLifecycleStatus({
    enabled: isEnabled,
  });
  const lifecycleLabel = getDataSourceLifecycleLabel(lifecycleStatus);
  const statusIndicatorStyle =
    getDataSourceStatusIndicatorStyle(lifecycleStatus);

  // "Fully configured" spans both the integration (secrets/scope) and the
  // source endpoint; the editor tracks the latter separately in editor state.
  const dataSourceReadinessReason =
    selectedIntegrationReadinessReason ??
    (state.isSourceConfigured
      ? undefined
      : (state.sourceMissingReason ??
        READINESS_REASON.sourceEndpointNotConfigured));
  const { canRun, canToggle, runTooltip, toggleTooltip } =
    getDataSourceActionAvailability({
      enabled: isEnabled,
      readinessReason: dataSourceReadinessReason,
      isRunning: running,
      isToggling: toggling,
    });

  let lifecycleTooltip = 'Enable to start scheduling';
  if (selectedIntegrationReadinessReason) {
    lifecycleTooltip = selectedIntegrationReadinessReason;
  } else if (isEnabled) {
    lifecycleTooltip = 'Disable to pause scheduling';
  }

  const contextValue = {
    triggerType: state.triggerType,
    setTriggerType: state.setTriggerType,
    triggerConfig: state.triggerConfig,
    setTriggerConfig: state.setTriggerConfig,
    sourceType: state.sourceType,
    setSourceType: state.setSourceType,
    sourceConfig: state.sourceConfig,
    setSourceConfig: state.setSourceConfig,
    transforms: state.transforms,
    setTransforms: state.setTransforms,
    sinks: state.sinks,
    setSinks: state.setSinks,
    selectedSteps: state.selectedSteps,
    setSelectedSteps: state.setSelectedSteps,
    expandedStep: state.expandedStep,
    setExpandedStep: state.setExpandedStep,
    nodeOutputs: state.nodeOutputs,
    setNodeOutputs: state.setNodeOutputs,
    nodeErrors: state.nodeErrors,
    setNodeErrors: state.setNodeErrors,
    runningNodes: state.runningNodes,
    setRunningNodes: state.setRunningNodes,
    searchQuery: state.searchQuery,
    setSearchQuery: state.setSearchQuery,
    isSourceConfigured: state.isSourceConfigured,
    sourceOutput: state.sourceOutput,
    finalOutput: state.finalOutput,
    previewLoading: state.previewLoading,
    previewError: state.previewError,
    isPreviewRun: state.isPreviewRun,
    previewRequestLogs: state.previewRequestLogs,
    previewLogs: state.previewLogs,
    previewExecutionId: state.previewExecutionId,
    hasRunPreview: state.hasRunPreview,
    confirmedSinkSchema: state.confirmedSinkSchema,
    setConfirmedSinkSchema: state.setConfirmedSinkSchema,
    workflowApi,
    handleAddTrigger: state.handleAddTrigger,
    handleTriggerConfigChange: state.handleTriggerConfigChange,
    handleSourceConfigChange: state.handleSourceConfigChange,
    handleAddTransform: state.handleAddTransform,
    handleAddChainedSource: state.handleAddChainedSource,
    handleUpdateTransform: state.handleUpdateTransform,
    handleDeleteTransform: state.handleDeleteTransform,
    handleUpdateSink: state.handleUpdateSink,
    handleDeleteSink: state.handleDeleteSink,
    handleRun,
    markChanged: state.markChanged,
    sourceSchemaVersion: state.sourceSchemaVersion,
    bumpSourceSchemaVersion: state.bumpSourceSchemaVersion,
    accumulatedSchema,
    setAccumulatedSchema,
    workflowId: workflow?.id,
    isEnabled,
    secretRefreshNonce,
    bumpSecretRefresh,
    scheduleRefreshNonce,
    allStepIds: state.allStepIds,
    handleStepClick: state.handleStepClick,
  };

  return (
    <DataSourceEditorContext.Provider value={contextValue}>
      <UnsavedChangesBlocker
        when={state.isDirty}
        allowNavigationRef={allowPostMutationNavigationRef}
        contentText="Your edits to this data source have not been saved and will be lost."
      />
      <TooltipProvider delayDuration={300}>
        <SpacebarStepToggle />
        <PipelineEditorLayout
          detailsPanelOpen={!!state.expandedStep}
          detailsPanel={<NodeDetailsPanel />}
          canvas={
            <>
              <TriggerStep />
              <SourceStep />
              {state.isSourceConfigured && (
                <>
                  <TransformSteps />
                  <SinkSteps />
                </>
              )}
            </>
          }
          renderBottomDrawer={canvasEl =>
            inspectorOpen && monitorExecutionId ? (
              <ExecutionInspectorDrawer
                open
                container={canvasEl}
                executionId={monitorExecutionId}
                dryRunInProgress={state.previewLoading && state.isPreviewRun}
                executions={executionHistory}
                executionsLoading={executionHistoryLoading}
                selectedExecutionId={monitorExecutionId}
                onSelectExecution={setSelectedExecutionId}
                onRefreshExecutions={refreshExecutionHistory}
                onRun={handleManualRun}
                onRetry={handleManualRun}
                runPending={running}
                onClose={() => setInspectorOpen(false)}
              />
            ) : null
          }
          header={
            <DataSourceEditorHeader
              title={state.workflowName}
              onTitleChange={handleWorkflowNameChange}
              editable
              description={description}
              editableDescription={!!workflow?.id}
              onDescriptionChange={handleWorkflowDescriptionChange}
              saveState="manual"
              saveButtonTestId="pipeline-save-button"
              onSave={handleSave}
              saving={saving || savingName}
              isDirty={state.isDirty}
              saveDisabled={!state.isDirty || state.previewLoading}
              saveLabel="Save"
              savingLabel="Saving..."
              titleAdornment={
                workflow?.id ? (
                  <Popover
                    open={slugPopoverOpen}
                    onOpenChange={nextOpen => {
                      if (nextOpen) {
                        setSlug(workflow?.slug ?? '');
                      }
                      setSlugPopoverOpen(nextOpen);
                    }}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <PopoverTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-auto gap-1.5 px-1.5 py-0 font-mono text-2xs"
                            data-testid="data-source-slug-trigger"
                          >
                            <Hash className="size-3.5" />
                            {workflow.slug}
                            <UnreferenceableSlugIcon
                              type="datasource"
                              slug={workflow.slug}
                            />
                          </Button>
                        </PopoverTrigger>
                      </TooltipTrigger>
                      <TooltipContent>
                        {slugTriggerTooltip(
                          'datasource',
                          workflow.slug,
                          'Edit reference slug',
                        )}
                      </TooltipContent>
                    </Tooltip>
                    <PopoverContent align="end" className="w-80 space-y-2">
                      <Label htmlFor="data-source-slug">Slug</Label>
                      <Input
                        id="data-source-slug"
                        value={slug}
                        disabled={savingSlug}
                        aria-invalid={!!slugError}
                        onChange={e => setSlug(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (!slugError) handleSlugSave();
                          }
                        }}
                        placeholder="e.g., sentry-projects"
                      />
                      {slugError ? (
                        <p role="alert" className="text-xs text-destructive">
                          {slugError}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Reference this data source in a capability with{' '}
                          <code>@datasource:{slug || 'slug'}</code>
                        </p>
                      )}
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          onClick={handleSlugSave}
                          // Saving while the capability list is still loading
                          // would silently skip the rename guard.
                          disabled={!!slugError || renameGuard.checking}
                          loading={savingSlug}
                          loadingText="Saving..."
                        >
                          Save
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                ) : undefined
              }
              actions={
                workflow?.id ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className="flex shrink-0 items-center gap-1.5"
                        data-testid="data-source-enabled-indicator"
                      >
                        <StatusDot
                          tone={statusIndicatorStyle.tone}
                          className="size-1.5"
                        />
                        <span
                          className={cn(
                            'text-2xs font-medium',
                            statusIndicatorStyle.text,
                          )}
                        >
                          {lifecycleLabel}
                        </span>
                        {toggling && <Spinner size={12} />}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>{lifecycleTooltip}</TooltipContent>
                  </Tooltip>
                ) : undefined
              }
              trailingActions={
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleToolbarRun(true)}
                          disabled={!state.isSourceConfigured}
                          loading={
                            state.previewLoading && runMode === 'dry-run'
                          }
                          loadingText="Running..."
                          data-testid="pipeline-test-button"
                          className="gap-1.5"
                        >
                          <FlaskConical className="size-3.5" />
                          Dry run
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {state.sourceMissingReason ?? 'Run without saving'}
                    </TooltipContent>
                  </Tooltip>
                  {workflow?.id && (
                    <DataSourceEditorActions
                      enabled={isEnabled}
                      canRun={canRun}
                      canToggle={canToggle}
                      isRunning={running}
                      runTooltip={runTooltip}
                      toggleTooltip={toggleTooltip}
                      canDelete
                      canOpenInspector={!!monitorExecutionId}
                      onRun={handleManualRun}
                      onToggleEnabled={handleToggleEnabled}
                      onDelete={() => setDeleteDialogOpen(true)}
                      onOpenInspector={handleOpenInspector}
                    />
                  )}
                </>
              }
            />
          }
        >
          <ConfirmationDialog
            open={deleteDialogOpen}
            title="Delete data source"
            contentText={
              <>
                {`Are you sure you want to delete "${state.workflowName}"? The datastore objects it created will also be deleted. This cannot be undone.`}
                <ReferenceUsageWarning
                  referenced={referencedDeleteTargets}
                  loading={usageLoading}
                />
              </>
            }
            onConfirm={handleDeleteConfirm}
            onCancel={() => setDeleteDialogOpen(false)}
            isDelete
            confirmButtonText="Delete"
            confirmingText="Deleting…"
          />

          {renameGuard.dialog}
        </PipelineEditorLayout>
      </TooltipProvider>
    </DataSourceEditorContext.Provider>
  );
}
