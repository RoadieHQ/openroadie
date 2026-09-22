import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import { Plus, Receipt, ShoppingCart, User } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { useAlert, useDatastore } from '../../../../api';
import { OBJECT_GRAPH_PATHS_MAX_DEPTH } from '../../../../api/datastore/datastore-client';
import {
  normalizeGraphFilters,
  rootedObjectGraphQuery,
} from '../../../../api/queries';
import { formatErrorString } from '../../../../api/workflow/parse-execution-error';
import { dataSourcesNewDialog } from '../../../../config/paths';
import { useDetailDrawer } from '../../../common';
import {
  GhostGraphPreview,
  ghostGraphSettleAt,
  OverviewEmptyPreview,
  type GhostGraphEdge,
  type GhostGraphNode,
} from '../../../overview';
import { useDataSources } from '../../use-data-sources';
import { ContextGroupInstanceDrawer } from '../context-group-instance-drawer';
import { DatastoreViewHeader } from '../datastore-view-header';
import { ObjectDetailDrawer } from '../object-detail-drawer';
import {
  objectDrawerParam,
  parseObjectDrawerParam,
} from '../object-drawer-param';
import { usePersistedDatastoreViewParams } from '../use-persisted-view-param';
import {
  objectGraphNodeId,
  ROOTED_OBJECT_GRAPH_NODE_LIMIT,
  type ObjectGraphDepth,
  type ObjectGraphFocus,
} from './object-graph-focus';
import {
  EgoGraphContainer,
  type ObjectModeRestore,
  type ObjectModeSnapshot,
} from './ego';
import {
  SavedViewsMenu,
  useSavedGraphViews,
  type SavedGraphView,
} from './saved-views';
import type { GraphCamera, GraphViewportHandle } from './svg';
import { PathEndpointPickers, PathsGraphView, useObjectPaths } from './paths';
import { GraphCanvasStatus } from './svg';
import { GraphModeSwitcher } from './graph-mode-switcher';
import {
  GraphFiltersToolbar,
  type GraphEdgeFilterState,
} from './graph-filters-toolbar';
import { ObjectSearchPicker } from './object-search-picker';
import { RelationshipDetailDrawer } from './relationship-detail-drawer';
import {
  isGroupSelectedEndpoint,
  type GraphSelectedRelationship,
} from './graph-selection';
import { useRelationshipTypes } from './use-relationship-types';
import {
  EXPAND_GROUPS_PARAM_VALUE,
  MODE_PARAMS,
  graphUrlStateToParams,
  parseGraphUrlState,
  type GraphViewMode,
} from './graph-url-state';

const EMPTY_PREVIEW_NODES: GhostGraphNode[] = [
  {
    id: 'customer',
    label: 'Ada Lovelace',
    detail: 'Customer',
    icon: User,
    x: 18,
    y: 50,
  },
  {
    id: 'order',
    label: 'Order #1042',
    detail: 'Order',
    icon: ShoppingCart,
    x: 50,
    y: 28,
  },
  {
    id: 'invoice',
    label: 'Invoice #882',
    detail: 'Invoice',
    icon: Receipt,
    x: 82,
    y: 60,
  },
];

const EMPTY_PREVIEW_EDGES: GhostGraphEdge[] = [
  { source: 'customer', target: 'order' },
  { source: 'order', target: 'invoice' },
];

interface GraphRestore {
  nonce: number;
  camera: GraphCamera | null;
  objectState?: ObjectModeSnapshot;
}

export function DatastoreGraphPage() {
  const navigate = useNavigate();
  const alertApi = useAlert();
  const datastoreApi = useDatastore();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  // The graph remembers its own scope, mode and context-group collapse choice.
  // The table's free-text search doesn't apply here, so leave it alone.
  usePersistedDatastoreViewParams({
    scope: 'graph',
    view: true,
    groups: true,
    search: false,
  });
  const {
    dataSources,
    loading: dataSourcesLoading,
    error: dataSourcesError,
  } = useDataSources({ skipExecutions: true });

  const state = useMemo(() => parseGraphUrlState(searchParams), [searchParams]);
  const { types: availableTypes } = useRelationshipTypes(state.ds);
  const graphFilters = useMemo(
    () =>
      normalizeGraphFilters({
        datasourceIds: state.ds,
        relationshipTypes: state.types,
        direction: state.dir,
      }),
    [state.ds, state.types, state.dir],
  );
  const prefetchGraphFocus = useCallback(
    (focus: ObjectGraphFocus) => {
      void queryClient.prefetchQuery(
        rootedObjectGraphQuery(datastoreApi, {
          datasourceId: focus.datasourceId,
          objectId: focus.objectId,
          depth: state.depth,
          filters: graphFilters,
          nodeLimit: ROOTED_OBJECT_GRAPH_NODE_LIMIT,
        }),
      );
    },
    [datastoreApi, graphFilters, queryClient, state.depth],
  );

  // Same facet population as the table view, so the shared header control
  // offers the same choices on both.
  const pickerDataSources = useMemo(
    () => dataSources.filter(ds => (ds.objectCount ?? 0) > 0),
    [dataSources],
  );

  useEffect(() => {
    if (dataSourcesError) {
      alertApi.post({
        message: `Failed to load data sources: ${formatErrorString(dataSourcesError)}`,
        severity: 'error',
      });
    }
  }, [dataSourcesError, alertApi]);

  // Saved-view machinery: the shared viewport handle captures the camera of
  // whichever mode is showing; the object mode registers a snapshot getter
  // for its expansion state; applying a view seeds both back via a nonce.
  const viewportRef = useRef<GraphViewportHandle>(null);
  const objectSnapshotRef = useRef<(() => ObjectModeSnapshot) | null>(null);
  const [restore, setRestore] = useState<GraphRestore | null>(null);
  const { views, saveView, deleteView } = useSavedGraphViews();

  const updateParams = useCallback(
    (mutate: (next: URLSearchParams) => void, options?: { push?: boolean }) => {
      // Any user-driven param change ends a saved-view restore, so a mode
      // remount can't re-apply a stale camera.
      setRestore(null);
      setSearchParams(
        params => {
          const next = new URLSearchParams(params);
          mutate(next);
          return next;
        },
        { replace: !options?.push },
      );
    },
    [setSearchParams],
  );

  const handleSaveCurrentView = useCallback(
    (name: string) => {
      saveView({
        name,
        params: Object.fromEntries(graphUrlStateToParams(state).entries()),
        objectState:
          state.view === 'object'
            ? (objectSnapshotRef.current?.() ?? undefined)
            : undefined,
        camera: viewportRef.current?.getCamera() ?? null,
      });
    },
    [saveView, state],
  );

  const handleApplyView = useCallback(
    (view: SavedGraphView) => {
      // One navigation (push, so Back undoes the apply)…
      setSearchParams(() => new URLSearchParams(view.params));
      // …plus the state the URL can't carry, applied once per nonce.
      setRestore(previous => ({
        nonce: (previous?.nonce ?? 0) + 1,
        camera: view.camera,
        objectState: view.objectState,
      }));
    },
    [setSearchParams],
  );

  // Node click → the shared object summary drawer (same `?object=` param as
  // the Datastore table). Group-node click → the context-group drawer. Edge
  // click → the relationship drawer (both local state: the payload is
  // captured from the loaded graph at click time). Only one of the three is
  // open at once.
  const {
    openId: openObjectId,
    open: openObject,
    close: closeObject,
  } = useDetailDrawer('object');
  const drawerObject = openObjectId
    ? parseObjectDrawerParam(openObjectId)
    : null;
  const [selectedRelationship, setSelectedRelationship] =
    useState<GraphSelectedRelationship | null>(null);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);

  const handleNodeSelect = useCallback(
    (focus: ObjectGraphFocus) => {
      setSelectedRelationship(null);
      setOpenGroupId(null);
      openObject(objectDrawerParam(focus.datasourceId, focus.objectId));
    },
    [openObject],
  );

  const handleGroupSelect = useCallback(
    (groupId: string) => {
      setSelectedRelationship(null);
      closeObject();
      setOpenGroupId(groupId);
    },
    [closeObject],
  );

  const handleEdgeSelect = useCallback(
    (relationship: GraphSelectedRelationship) => {
      closeObject();
      setOpenGroupId(null);
      setSelectedRelationship(relationship);
    },
    [closeObject],
  );

  const handleModeChange = useCallback(
    (mode: GraphViewMode) => {
      setSelectedRelationship(null);
      updateParams(next => {
        if (mode === 'object') {
          next.delete('view');
        } else {
          next.set('view', mode);
        }
        // Leaving a mode clears its params so a stale focus/pair doesn't
        // resurface on the next visit.
        for (const [owner, params] of Object.entries(MODE_PARAMS)) {
          if (owner !== mode) {
            for (const param of params) {
              next.delete(param);
            }
          }
        }
      });
    },
    [updateParams],
  );

  const handleScopeChange = useCallback(
    (ids: string[]) => {
      updateParams(next => {
        if (ids.length > 0) {
          next.set('ds', ids.join(','));
        } else {
          next.delete('ds');
        }
      });
    },
    [updateParams],
  );

  const handleExpandGroupsChange = useCallback(
    (expand: boolean) => {
      updateParams(next => {
        if (expand) {
          next.set('groups', EXPAND_GROUPS_PARAM_VALUE);
        } else {
          next.delete('groups');
        }
      });
    },
    [updateParams],
  );

  const handleFiltersChange = useCallback(
    (filters: GraphEdgeFilterState) => {
      updateParams(next => {
        if (filters.types.length > 0) {
          next.set('types', filters.types.join(','));
        } else {
          next.delete('types');
        }
        if (filters.dir !== 'both') {
          next.set('dir', filters.dir);
        } else {
          next.delete('dir');
        }
      });
    },
    [updateParams],
  );

  const handleFocusChange = useCallback(
    (focus: ObjectGraphFocus | null) => {
      updateParams(
        next => {
          if (focus) {
            next.set(
              'focus',
              objectGraphNodeId(focus.datasourceId, focus.objectId),
            );
          } else {
            next.delete('focus');
          }
        },
        // Picking a focus pushes so Back returns to the previous focus (or
        // the search-first empty state).
        { push: focus !== null },
      );
    },
    [updateParams],
  );

  const handleDepthChange = useCallback(
    (depth: ObjectGraphDepth) => {
      updateParams(next => {
        next.set('depth', String(depth));
      });
    },
    [updateParams],
  );

  const filterState = useMemo<GraphEdgeFilterState>(
    () => ({ types: state.types, dir: state.dir }),
    [state.types, state.dir],
  );

  const handleShowPaths = useCallback(
    (a: ObjectGraphFocus, b: ObjectGraphFocus) => {
      setSelectedRelationship(null);
      updateParams(
        next => {
          next.set('view', 'paths');
          // Leaving the object mode clears its params, like the switcher.
          for (const param of MODE_PARAMS.object) {
            next.delete(param);
          }
          next.set('a', objectGraphNodeId(a.datasourceId, a.objectId));
          next.set('b', objectGraphNodeId(b.datasourceId, b.objectId));
        },
        // Push so Back returns to the object view the pair was picked in.
        { push: true },
      );
    },
    [updateParams],
  );

  const handlePathEndpointChange = useCallback(
    (param: 'a' | 'b', focus: ObjectGraphFocus | null) => {
      updateParams(next => {
        if (focus) {
          next.set(
            param,
            objectGraphNodeId(focus.datasourceId, focus.objectId),
          );
        } else {
          next.delete(param);
        }
      });
    },
    [updateParams],
  );

  const handlePathSwap = useCallback(() => {
    updateParams(next => {
      const a = next.get('a');
      const b = next.get('b');
      if (b) {
        next.set('a', b);
      } else {
        next.delete('a');
      }
      if (a) {
        next.set('b', a);
      } else {
        next.delete('b');
      }
    });
  }, [updateParams]);

  const handleHopLimitChange = useCallback(
    (hopLimit: number | null) => {
      updateParams(next => {
        if (hopLimit === null) {
          next.delete('pathDepth');
        } else {
          next.set('pathDepth', String(hopLimit));
        }
      });
    },
    [updateParams],
  );

  const pathsState = useObjectPaths({
    a: state.view === 'paths' ? state.a : null,
    b: state.view === 'paths' ? state.b : null,
    // "Shortest" mode searches as deep as allowed and the view keeps only
    // the minimum-hop tier; an explicit pick bounds the search itself.
    maxDepth: state.pathDepth ?? OBJECT_GRAPH_PATHS_MAX_DEPTH,
    filters: {
      datasourceIds: state.ds,
      relationshipTypes: state.types,
    },
  });

  const dataSourceNames = useMemo(
    () => new Map(dataSources.map(ds => [ds.id, ds.name])),
    [dataSources],
  );

  const selectedNodeKey = drawerObject
    ? objectGraphNodeId(drawerObject.datasourceId, drawerObject.objectId)
    : null;
  const selectedEdgeId = selectedRelationship?.id ?? null;
  const catalogEmpty =
    !dataSourcesLoading && !dataSourcesError && dataSources.length === 0;

  const objectRestore = useMemo<ObjectModeRestore | null>(
    () =>
      restore
        ? {
            nonce: restore.nonce,
            expandedKeys: restore.objectState?.expandedKeys ?? [],
            revealCounts: restore.objectState?.revealCounts ?? {},
            camera: restore.camera,
          }
        : null,
    [restore],
  );
  const restoredCamera = restore?.camera ?? null;

  const searchSlot =
    state.view === 'object' ? (
      <ObjectSearchPicker
        value={state.focus}
        onChange={handleFocusChange}
        onIntent={prefetchGraphFocus}
        datasourceIds={state.ds}
        dataSources={dataSources}
        className="w-56 [&_input]:h-8"
        placeholder="Search objects…"
        aria-label="Search objects"
      />
    ) : null;

  let body: React.ReactNode;
  if (catalogEmpty) {
    body = (
      <OverviewEmptyPreview
        actionDelay={ghostGraphSettleAt(
          EMPTY_PREVIEW_NODES.length,
          EMPTY_PREVIEW_EDGES.length,
        )}
        title="No objects to explore yet"
        description="Run a data source to populate the datastore, then explore how its objects connect here."
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
    );
  } else if (state.view === 'object') {
    body = (
      <EgoGraphContainer
        focus={state.focus}
        depth={state.depth}
        filters={{
          datasourceIds: state.ds,
          relationshipTypes: state.types,
          direction: state.dir,
        }}
        dataSources={dataSources}
        expandGroups={state.expandGroups}
        onFocusChange={handleFocusChange}
        onFocusIntent={prefetchGraphFocus}
        onDepthChange={handleDepthChange}
        onNodeSelect={handleNodeSelect}
        onGroupSelect={handleGroupSelect}
        onEdgeSelect={handleEdgeSelect}
        onShowPaths={handleShowPaths}
        selectedNodeKey={selectedNodeKey}
        selectedGroupId={openGroupId}
        selectedEdgeId={selectedEdgeId}
        restore={objectRestore}
        snapshotRef={objectSnapshotRef}
        viewportHandleRef={viewportRef}
      />
    );
  } else {
    body = (
      <div className="flex h-full min-h-0 flex-col gap-3">
        <PathEndpointPickers
          a={state.a}
          b={state.b}
          hopLimit={state.pathDepth}
          datasourceIds={state.ds}
          dataSources={dataSources}
          onChangeA={focus => handlePathEndpointChange('a', focus)}
          onChangeB={focus => handlePathEndpointChange('b', focus)}
          onSwap={handlePathSwap}
          onHopLimitChange={handleHopLimitChange}
        />
        <div className="relative min-h-0 flex-1">
          {state.a && state.b ? (
            <PathsGraphView
              nodes={pathsState.nodes}
              relationships={pathsState.relationships}
              paths={pathsState.paths}
              sourceKey={objectGraphNodeId(
                state.a.datasourceId,
                state.a.objectId,
              )}
              targetKey={objectGraphNodeId(
                state.b.datasourceId,
                state.b.objectId,
              )}
              hopLimit={state.pathDepth}
              collapseGroups={!state.expandGroups}
              dataSourceNames={dataSourceNames}
              loading={pathsState.loading}
              refreshing={pathsState.refreshing}
              error={pathsState.error}
              truncated={pathsState.truncated}
              viewportHandleRef={viewportRef}
              initialCamera={restoredCamera}
              onHopLimitChange={handleHopLimitChange}
              onNodeSelect={node =>
                handleNodeSelect({
                  datasourceId: node.datasourceId,
                  objectId: node.objectId,
                })
              }
              onGroupSelect={handleGroupSelect}
              onEdgeSelect={handleEdgeSelect}
              selectedNodeKey={selectedNodeKey}
              selectedGroupId={openGroupId}
              selectedEdgeId={selectedEdgeId}
            />
          ) : (
            <div className="relative h-full overflow-hidden rounded-xl border border-border bg-background">
              <GraphCanvasStatus>
                Pick two objects to see every path connecting them.
              </GraphCanvasStatus>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background">
      {/* Same gutters as the table view's OverviewListingStandaloneBody
          (px-4 py-4 sm:px-6 + space-y-4 sm:space-y-6) so the shared header's
          controls sit in exactly the same spot on both views. */}
      <div className="w-full min-w-0 shrink-0 px-4 pt-4 sm:px-6">
        <DatastoreViewHeader
          title="Datastore graph"
          description="Explore ingested objects and how they relate."
          dataSources={pickerDataSources}
          scopedDataSourceIds={state.ds}
          onScopeChange={handleScopeChange}
          hideToolbar={catalogEmpty}
          searchSlot={searchSlot}
          extraToolbar={
            <>
              <GraphFiltersToolbar
                mode={state.view}
                availableTypes={availableTypes}
                value={filterState}
                onChange={handleFiltersChange}
                expandGroups={state.expandGroups}
                onExpandGroupsChange={handleExpandGroupsChange}
              />
              <GraphModeSwitcher
                value={state.view}
                onChange={handleModeChange}
              />
              <SavedViewsMenu
                views={views}
                onApply={handleApplyView}
                onSaveCurrent={handleSaveCurrentView}
                onDelete={deleteView}
              />
            </>
          }
        />
      </div>
      {/* Clicks inside the canvas region swap the drawers' contents (node /
          edge handlers own the selection) and pan/zoom must not dismiss
          them, so the whole region keeps the drawers open. */}
      <div
        className="relative mt-4 min-h-0 flex-1 overflow-hidden px-4 pb-4 sm:mt-6 sm:px-6"
        data-graph-drawer-keep-open
      >
        {body}
      </div>
      <ObjectDetailDrawer
        datasourceId={drawerObject?.datasourceId}
        objectId={drawerObject?.objectId}
        open={openObjectId !== null}
        onOpenChange={open => {
          if (!open) {
            closeObject();
          }
        }}
        keepOpenSelector="[data-graph-drawer-keep-open]"
      />
      <RelationshipDetailDrawer
        relationship={selectedRelationship}
        open={selectedRelationship !== null}
        onOpenChange={open => {
          if (!open) {
            setSelectedRelationship(null);
          }
        }}
        dataSourceNames={dataSourceNames}
        onOpenObject={endpoint => {
          if (!isGroupSelectedEndpoint(endpoint)) {
            handleNodeSelect({
              datasourceId: endpoint.datasourceId,
              objectId: endpoint.objectId,
            });
          }
        }}
        onOpenGroup={handleGroupSelect}
        keepOpenSelector="[data-graph-drawer-keep-open]"
      />
      <ContextGroupInstanceDrawer
        groupId={openGroupId ?? undefined}
        open={openGroupId !== null}
        onOpenChange={open => {
          if (!open) {
            setOpenGroupId(null);
          }
        }}
        keepOpenSelector="[data-graph-drawer-keep-open]"
      />
    </div>
  );
}

export { parseObjectGraphFocus } from './graph-url-state';
