import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { Button } from '@roadiehq/ui/button';
import { Badge } from '@roadiehq/ui/badge';
import { EditorHeader } from '@roadiehq/ui/editor-header';
import { Spinner } from '@roadiehq/ui/spinner';
import { useWorkflows, useAlert } from '../../api';
import { queryKeys } from '../../api/queries';
import { useInvalidatingMutation } from '../../api/query-hooks';
import {
  AlertCircle,
  BellRing,
  Check,
  Circle,
  GitBranch,
  Pencil,
  Plus,
  Server,
  Wand2,
} from 'lucide-react';
import { useRelationshipsCatalog } from '../data-sources/use-relationships-catalog';
import { formatErrorString } from '../../api/workflow/parse-execution-error';
import {
  getDataSourceToggleFailureVerb,
  getDataSourceToggleSuccessMessage,
} from '../data-sources/data-source-status';
import {
  DataSourcesGraphView,
  RelationshipsFilterBar,
  type RelationshipFacetValue,
  DEFAULT_EDITOR_MODE,
  type EditorMode,
  type SaveStatus,
} from '../data-sources/relationships-editor';
import { parseCsvParam } from '../common';
import {
  GhostGraphPreview,
  ghostGraphSettleAt,
  OverviewEmptyPreview,
  type GhostGraphEdge,
  type GhostGraphNode,
} from '../overview';
import { dataSourcesNewDialog, PATHS } from '../../config/paths';

const EMPTY_PREVIEW_NODES: GhostGraphNode[] = [
  {
    id: 'github',
    label: 'GitHub',
    detail: 'Source control',
    icon: GitBranch,
    x: 18,
    y: 50,
  },
  {
    id: 'kubernetes',
    label: 'Kubernetes',
    detail: 'Runtime',
    icon: Server,
    x: 50,
    y: 28,
  },
  {
    id: 'pagerduty',
    label: 'PagerDuty',
    detail: 'On-call',
    icon: BellRing,
    x: 82,
    y: 60,
  },
];

const EMPTY_PREVIEW_EDGES: GhostGraphEdge[] = [
  { source: 'github', target: 'kubernetes' },
  { source: 'kubernetes', target: 'pagerduty' },
];

// 'idle' renders nothing; 'pending' flags unsaved edits during the auto-save
// debounce window, and the rest surface the transient save outcome.
function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  switch (status) {
    case 'pending':
      return (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Circle className="size-3.5" />
          Unsaved changes
        </span>
      );
    case 'saving':
      return (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Spinner size={14} />
          Saving…
        </span>
      );
    case 'saved':
      return (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Check className="size-3.5 text-success" />
          Saved
        </span>
      );
    case 'error':
      return (
        <span className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="size-3.5" />
          Save failed
        </span>
      );
    default:
      return null;
  }
}

const MODE_CHIP = new Map<EditorMode, { label: string; icon: typeof Pencil }>([
  ['edit', { label: 'Edit', icon: Pencil }],
  ['suggest', { label: 'Suggest', icon: Wand2 }],
]);

function ModeChip({ mode }: { mode: EditorMode }) {
  const entry = MODE_CHIP.get(mode);
  if (!entry) return null;
  const { label, icon: Icon } = entry;
  return (
    <Badge variant="outlineMuted" icon={<Icon />} className="gap-1.5">
      {label}
    </Badge>
  );
}

export function RelationshipsPage() {
  const navigate = useNavigate();
  const api = useWorkflows();
  const alertApi = useAlert();
  const [searchParams, setSearchParams] = useSearchParams();
  // The object graph moved to the Datastore graph page; forward old
  // ?focus=<ds>:<obj> deep links (kept in bookmarks / shared URLs) there.
  const legacyFocus = searchParams.get('focus');

  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [editorMode, setEditorMode] = useState<EditorMode>(DEFAULT_EDITOR_MODE);
  const {
    dataSources,
    schemas,
    rules,
    loading: catalogLoading,
    error: catalogError,
  } = useRelationshipsCatalog();

  const scopedDataSourceIds = React.useMemo(
    () => parseCsvParam(searchParams.get('ds')),
    [searchParams],
  );
  const relationshipTypeFilter = React.useMemo(
    () => parseCsvParam(searchParams.get('reltype')),
    [searchParams],
  );
  const relationshipRuleFilter = React.useMemo(
    () => parseCsvParam(searchParams.get('rel')),
    [searchParams],
  );
  const focusedRelationshipRuleId = searchParams.get('relFocus');
  const catalogEmpty =
    !catalogLoading && !catalogError && dataSources.length === 0;

  const enabledDataSources = React.useMemo(
    () => dataSources.filter(ds => ds.enabled),
    [dataSources],
  );
  const scopeDatasourceIds = React.useMemo(
    () =>
      scopedDataSourceIds.length > 0
        ? new Set(scopedDataSourceIds)
        : new Set(enabledDataSources.map(ds => ds.id)),
    [enabledDataSources, scopedDataSourceIds],
  );
  const availableRelationshipRules = React.useMemo(
    () =>
      rules.filter(
        rule =>
          scopeDatasourceIds.has(rule.sourceDatasourceId) &&
          scopeDatasourceIds.has(rule.targetDatasourceId),
      ),
    [rules, scopeDatasourceIds],
  );

  useEffect(() => {
    if (catalogError) {
      alertApi.post({
        message: `Failed to load relationships: ${formatErrorString(catalogError)}`,
        severity: 'error',
      });
    }
  }, [catalogError, alertApi]);

  // Toggling `enabled` invalidates the data-ingestion workflows cache that
  // `useDataSources` (via useRelationshipsCatalog) reads, replacing the manual
  // refetchDataSources(). `mutateAsync` is wrapped so callers can still await
  // the toggle to sequence follow-up work (e.g. suggesting for a just-enabled
  // source); errors are surfaced as a toast, not rethrown, matching prior UX.
  const setEnabledMutation = useInvalidatingMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.workflows.update(id, { enabled }),
    invalidates: [queryKeys.dataIngestionWorkflows],
  });

  const handleSetDataSourceEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      try {
        await setEnabledMutation.mutateAsync({ id, enabled });
        alertApi.post({
          message: getDataSourceToggleSuccessMessage(enabled),
          severity: 'success',
          display: 'transient',
        });
      } catch (error) {
        alertApi.post({
          message: `Failed to ${getDataSourceToggleFailureVerb(enabled)}: ${formatErrorString(error)}`,
          severity: 'error',
        });
      }
    },
    [setEnabledMutation, alertApi],
  );

  // Permanent data-source deletion, invoked from the graph node toolbar (the
  // graph view owns the confirm dialog + rule/edge cleanup). Invalidates both
  // the workflows and relationship-rules caches so the graph drops the node.
  const deleteDatasourceMutation = useInvalidatingMutation({
    mutationFn: (id: string) => api.workflows.delete(id),
    invalidates: [
      queryKeys.dataIngestionWorkflows,
      queryKeys.relationshipRules,
    ],
  });

  const handleDeleteDataSource = useCallback(
    async (id: string) => {
      try {
        await deleteDatasourceMutation.mutateAsync(id);
        alertApi.post({
          message: 'Data source deleted',
          severity: 'success',
          display: 'transient',
        });
      } catch (error) {
        alertApi.post({
          message: `Failed to delete data source: ${formatErrorString(error)}`,
          severity: 'error',
        });
        throw error;
      }
    },
    [deleteDatasourceMutation, alertApi],
  );

  const handleScopedDataSourceIdsChange = useCallback(
    (ids: string[]) => {
      setSearchParams(
        params => {
          const next = new URLSearchParams(params);
          if (ids.length > 0) {
            next.set('ds', ids.join(','));
          } else {
            next.delete('ds');
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Hide a data source from the graph by scoping it out of the current view.
  // An empty scope means "all enabled shown", so hiding one there scopes to
  // every other enabled source; re-showing is done via the header filter.
  const handleHideDataSource = useCallback(
    (id: string) => {
      const nextScope =
        scopedDataSourceIds.length > 0
          ? scopedDataSourceIds.filter(dsId => dsId !== id)
          : enabledDataSources.map(ds => ds.id).filter(dsId => dsId !== id);
      // An empty scope can't represent "nothing visible" — it means "show
      // all", which would make the just-hidden source reappear. Hiding the
      // last visible source is therefore a no-op.
      if (nextScope.length === 0) {
        return;
      }
      handleScopedDataSourceIdsChange(nextScope);
    },
    [scopedDataSourceIds, enabledDataSources, handleScopedDataSourceIdsChange],
  );

  const handleRelationshipsChange = useCallback(
    ({ types, ruleIds }: RelationshipFacetValue) => {
      setSearchParams(
        params => {
          const next = new URLSearchParams(params);
          if (types.length > 0) {
            next.set('reltype', types.join(','));
          } else {
            next.delete('reltype');
          }
          if (ruleIds.length > 0) {
            next.set('rel', ruleIds.join(','));
          } else {
            next.delete('rel');
          }
          next.delete('relFocus');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const handleClearFilters = useCallback(() => {
    setSearchParams(
      params => {
        const next = new URLSearchParams(params);
        next.delete('ds');
        next.delete('reltype');
        next.delete('rel');
        next.delete('relFocus');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  if (legacyFocus) {
    const forward = new URLSearchParams({ focus: legacyFocus });
    const depth = searchParams.get('depth');
    if (depth) {
      forward.set('depth', depth);
    }
    return (
      <Navigate to={`${PATHS.DATASTORE_GRAPH}?${forward.toString()}`} replace />
    );
  }

  return (
    <div className="flex h-screen min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background">
      <EditorHeader
        title="Relationships"
        description="Visualize and edit how your data sources connect."
        actions={
          catalogEmpty ? undefined : (
            <div className="flex items-center gap-2">
              <SaveStatusIndicator status={saveStatus} />
              <ModeChip mode={editorMode} />
              <RelationshipsFilterBar
                dataSources={enabledDataSources}
                rules={availableRelationshipRules}
                scopedDataSourceIds={scopedDataSourceIds}
                relationshipTypes={relationshipTypeFilter}
                relationshipRuleIds={relationshipRuleFilter}
                onScopedDataSourceIdsChange={handleScopedDataSourceIdsChange}
                onRelationshipsChange={handleRelationshipsChange}
                onClearFilters={handleClearFilters}
              />
            </div>
          )
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {catalogEmpty ? (
          <div className="flex min-h-0 flex-1 p-4 sm:p-6">
            <OverviewEmptyPreview
              actionDelay={ghostGraphSettleAt(
                EMPTY_PREVIEW_NODES.length,
                EMPTY_PREVIEW_EDGES.length,
              )}
              title="No data sources to connect yet"
              description="Add a data source before defining or suggesting relationships between your systems."
              preview={
                <GhostGraphPreview
                  nodes={EMPTY_PREVIEW_NODES}
                  edges={EMPTY_PREVIEW_EDGES}
                />
              }
              action={
                <Button
                  variant="outline"
                  onClick={() => navigate(dataSourcesNewDialog())}
                >
                  <Plus className="size-4" />
                  New Data Source
                </Button>
              }
            />
          </div>
        ) : (
          <DataSourcesGraphView
            dataSources={dataSources}
            schemas={schemas}
            rules={rules}
            onSetDataSourceEnabled={handleSetDataSourceEnabled}
            onHideDataSource={handleHideDataSource}
            onDeleteDataSource={handleDeleteDataSource}
            onSaveStatusChange={setSaveStatus}
            onModeChange={setEditorMode}
            scopedDataSourceIds={
              scopedDataSourceIds.length > 0 ? scopedDataSourceIds : null
            }
            relationshipTypeFilter={relationshipTypeFilter}
            relationshipRuleFilter={relationshipRuleFilter}
            focusedRelationshipRuleId={focusedRelationshipRuleId}
          />
        )}
      </div>
    </div>
  );
}
