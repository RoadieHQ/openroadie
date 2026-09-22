import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, Network, Plus } from 'lucide-react';
import { Badge } from '@roadiehq/ui/badge';
import { Button } from '@roadiehq/ui/button';
import { Card, CardContent } from '@roadiehq/ui/card';
import { EditorHeader } from '@roadiehq/ui/editor-header';
import { IntegrationIconFrame, IntegrationLogo } from '@roadiehq/ui/item-list';
import { Skeleton } from '@roadiehq/ui/skeleton';
import { EntityEditorShell } from '../../../common';
import { objectDetailQuery, queryKeys } from '../../../../api/queries';
import { workspaceQueryKeyInScope } from '../../../../api/workspace-scope';
import { useDatastore } from '../../../../api';
import {
  PATHS,
  dataSourceObjects,
  objectRelationshipEdit,
  objectRelationshipNew,
  datastoreGraphFocus,
} from '../../../../config/paths';
import type { ObjectRelationship } from '../../../../api/datastore/datastore-client';
import { useDataSources } from '../../use-data-sources';
import { ManualRelationshipEditor } from '../manual-relationship-editor';
import { resolveObjectDisplayName } from '../resolve-object-display-name';
import { ObjectIdChip } from '../object-id-chip';
import { ObjectContextGroupsSection } from './object-context-groups-section';
import { ObjectMetadataPanel } from './object-metadata-panel';
import { ObjectRelationshipsCard } from './object-relationships-card';
import { NavigationIntentLink } from '../../../common/navigation-intent-link';

const ENTITY_TYPE_KEYS = [
  'entity_type',
  'entityType',
  'type',
  'kind',
  'object_type',
  'objectType',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveEntityType(objectJson: unknown): string | null {
  if (!isRecord(objectJson)) {
    return null;
  }
  for (const key of ENTITY_TYPE_KEYS) {
    const value = firstNonEmptyString(objectJson[`${key}`]);
    if (value) {
      return value;
    }
  }
  return null;
}

function LoadingCard() {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </CardContent>
    </Card>
  );
}

export function DataSourceObjectDetailPage() {
  const { datasourceId = '', objectId = '' } = useParams<{
    datasourceId: string;
    objectId: string;
  }>();
  const navigate = useNavigate();
  const api = useDatastore();
  const { dataSources, loading: dataSourcesLoading } = useDataSources({
    skipExecutions: true,
  });
  const queryClient = useQueryClient();

  const {
    data: object,
    isPending: loading,
    error,
  } = useQuery(objectDetailQuery(api, datasourceId, objectId));

  const dataSource = dataSources.find(ds => ds.id === datasourceId);
  const dataSourceName = dataSource?.name ?? datasourceId;
  const displayName = object
    ? resolveObjectDisplayName(object.object, objectId, object.presentation)
    : null;
  // Until the object resolves, its id is the only name we have — the same
  // fallback the preview drawer uses, so opening from it doesn't retitle.
  // Everything that asks "does the rail already show the id?" reads this, not
  // `displayName`, which is null on first paint and would flip the answer.
  const headerTitle = displayName ?? objectId;
  const entityType = resolveEntityType(object?.object);
  const relationships = useMemo(
    () => object?.relationships ?? [],
    [object?.relationships],
  );

  const [addOpen, setAddOpen] = useState(false);
  // The direct outgoing edge currently being edited in the drawer (null = none).
  const [editing, setEditing] = useState<ObjectRelationship | null>(null);
  // The manual-relationship drawer portals into (and overlays) this page, so it
  // needs the positioned page element as its container — tracked in state so the
  // drawer re-renders once the ref resolves (mirrors the graph's drawer host).
  const [drawerContainer, setDrawerContainer] = useState<HTMLDivElement | null>(
    null,
  );
  return (
    <EntityEditorShell ref={setDrawerContainer} className="relative">
      <EditorHeader
        title={headerTitle}
        backTo={dataSourceObjects(datasourceId)}
        breadcrumb={[
          { label: 'Datastore', to: PATHS.DATASTORE },
          {
            label: dataSourceName,
            to: dataSourceObjects(datasourceId),
            // The name comes from a separate list fetch, so the id is all we
            // have on first paint. Once the list has settled and the source is
            // still absent (it was deleted, leaving its objects behind), the id
            // is the honest label rather than a placeholder that never resolves.
            loading: dataSourcesLoading && !dataSource,
          },
        ]}
        icon={
          <IntegrationIconFrame size="row">
            {dataSource?.logoUrl ? (
              <IntegrationLogo src={dataSource.logoUrl} size={20} />
            ) : (
              <Database className="size-4 shrink-0 text-muted-foreground" />
            )}
          </IntegrationIconFrame>
        }
        titleAdornment={
          <>
            {entityType && (
              <Badge
                variant="outline"
                className="rounded-full"
                title="Entity type"
              >
                {entityType}
              </Badge>
            )}
            {/* Most objects have no presentation title, so the display name IS
                the id and spelling it out again would print the same string
                twice — but the copy control is not the redundant part, and
                those are the objects whose id is the only handle you have. So
                the text drops, not the button. Where they differ the id can be
                90+ characters, so the chip is capped and truncates; either way
                copying yields the whole id. */}
            <ObjectIdChip
              key={objectId}
              objectId={objectId}
              iconOnly={headerTitle === objectId}
              className={headerTitle === objectId ? undefined : 'max-w-[24ch]'}
            />
          </>
        }
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <NavigationIntentLink
                to={datastoreGraphFocus(datasourceId, objectId)}
              >
                <Network className="size-4" />
                View relationship graph
              </NavigationIntentLink>
            </Button>
            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                // Both editors are non-modal drawers portalled to the same
                // spot — opening one must close the other so they can't stack.
                setEditing(null);
                setAddOpen(true);
              }}
            >
              <Plus className="size-4" />
              Create direct relationship
            </Button>
          </>
        }
      />

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
          <ObjectContextGroupsSection
            datasourceId={datasourceId}
            objectId={objectId}
          />

          {error ? (
            <Card>
              <CardContent className="p-5 text-sm text-destructive">
                {error.message}
              </CardContent>
            </Card>
          ) : loading && !object ? (
            <>
              <LoadingCard />
              <LoadingCard />
            </>
          ) : (
            <>
              <ObjectRelationshipsCard
                relationships={relationships}
                dataSources={dataSources}
                onEditRelationship={relationship => {
                  // The editor always edits from the edge's source side; for
                  // an incoming edge, open it under the source object's route.
                  if (relationship.direction === 'incoming') {
                    navigate(
                      objectRelationshipEdit(
                        relationship.sourceDatasourceId,
                        relationship.sourceObjectId,
                        relationship.id,
                      ),
                    );
                    return;
                  }
                  setAddOpen(false);
                  setEditing(relationship);
                }}
              />
              <ObjectMetadataPanel
                object={object?.object}
                createdAt={object?.createdAt}
                updatedAt={object?.updatedAt}
              />
            </>
          )}
        </div>
      </main>

      {/* Mounted only while open so each open starts from a clean editor
          (matches how the graph mounts the rule inspector). */}
      {addOpen && (
        <ManualRelationshipEditor
          open
          container={drawerContainer}
          sourceDatasourceId={datasourceId}
          sourceObjectId={objectId}
          sourceLabel={displayName ?? objectId}
          dataSources={dataSources}
          existingRelationships={relationships}
          standaloneHref={objectRelationshipNew(datasourceId, objectId)}
          onClose={() => setAddOpen(false)}
          onSaved={async workspaceScopeKey => {
            setAddOpen(false);
            await Promise.all([
              queryClient.invalidateQueries({
                queryKey: workspaceQueryKeyInScope(
                  queryKeys.objectDetailPrefix,
                  workspaceScopeKey,
                ),
              }),
              queryClient.invalidateQueries({
                queryKey: workspaceQueryKeyInScope(
                  queryKeys.directRelationshipsPrefix,
                  workspaceScopeKey,
                ),
              }),
            ]);
          }}
        />
      )}

      {/* Edit mode: keyed on the edge id so switching rows starts fresh. Save
          and Delete both flow through onSaved, so the list refreshes either way. */}
      {editing && (
        <ManualRelationshipEditor
          key={editing.id}
          open
          container={drawerContainer}
          relationship={editing}
          sourceDatasourceId={datasourceId}
          sourceObjectId={objectId}
          sourceLabel={displayName ?? objectId}
          dataSources={dataSources}
          existingRelationships={relationships}
          standaloneHref={objectRelationshipEdit(
            datasourceId,
            objectId,
            editing.id,
          )}
          onClose={() => setEditing(null)}
          onSaved={async workspaceScopeKey => {
            setEditing(null);
            await Promise.all([
              queryClient.invalidateQueries({
                queryKey: workspaceQueryKeyInScope(
                  queryKeys.objectDetailPrefix,
                  workspaceScopeKey,
                ),
              }),
              queryClient.invalidateQueries({
                queryKey: workspaceQueryKeyInScope(
                  queryKeys.directRelationshipsPrefix,
                  workspaceScopeKey,
                ),
              }),
            ]);
          }}
        />
      )}
    </EntityEditorShell>
  );
}
