import { useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Network } from 'lucide-react';
import { EditorHeader } from '@roadiehq/ui/editor-header';
import { Skeleton } from '@roadiehq/ui/skeleton';
import { useDatastore } from '../../../api';
import { objectDetailQuery, queryKeys } from '../../../api/queries';
import { workspaceQueryKeyInScope } from '../../../api/workspace-scope';
import { objectDetail } from '../../../config/paths';
import {
  isDirectRelationship,
  type DatastoreObjectWithRelationships,
  type ObjectRelationship,
} from '../../../api/datastore/datastore-client';
import { useDataSources } from '../use-data-sources';
import type { DataSourceItem } from '../types';
import { resolveObjectDisplayName } from './resolve-object-display-name';
import {
  ManualRelationshipActions,
  ManualRelationshipEditor,
} from './manual-relationship-editor';
import { useManualRelationshipEditor } from './use-manual-relationship-editor';

/**
 * Full-page manual-relationship editor body, shared by the New and Edit pages —
 * the standalone counterpart to the detail-page drawer (mirrors the rule
 * editor's `/relationships/rules/:id/edit` page). Reached via the drawer's "pop
 * out" link or a direct URL. `relationship` seeds edit mode; omit it to create.
 */
function ManualRelationshipEditorPageBody({
  datasourceId,
  objectId,
  dataSources,
  object,
  relationship,
}: {
  datasourceId: string;
  objectId: string;
  dataSources: DataSourceItem[];
  object: DatastoreObjectWithRelationships | null | undefined;
  relationship?: ObjectRelationship;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const relationships = useMemo(
    () => object?.relationships ?? [],
    [object?.relationships],
  );
  const displayName = object
    ? resolveObjectDisplayName(object.object, objectId)
    : objectId;
  const backHref = objectDetail(datasourceId, objectId);
  const close = () => navigate(backHref);

  const editor = useManualRelationshipEditor({
    sourceDatasourceId: datasourceId,
    sourceObjectId: objectId,
    existingRelationships: relationships,
    relationship,
    // Invalidate before returning so the detail list reflects the change even
    // when its query is still within staleTime (the hook itself never invalidates).
    onSaved: async workspaceScopeKey => {
      await Promise.all([
        // The whole detail prefix: a direct edge touches two objects, and the
        // user may have arrived from the destination side (incoming edit).
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
      // Replace, not push: after a save/delete this editor's URL is dead (the
      // edge is gone or has a new id), so it must not linger as a Back target
      // that would re-mount into the not-found redirect.
      navigate(backHref, { replace: true });
    },
  });
  const title = editor.isEdit
    ? 'Edit direct relationship'
    : 'New direct relationship';

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <EditorHeader
        title={title}
        icon={<Network className="size-5" />}
        backTo={backHref}
        actions={<ManualRelationshipActions editor={editor} onClose={close} />}
      />
      <div className="min-h-0 flex-1 overflow-hidden p-4">
        <ManualRelationshipEditor
          variant="page"
          showHeader={false}
          open
          editor={editor}
          sourceDatasourceId={datasourceId}
          sourceObjectId={objectId}
          sourceLabel={displayName}
          dataSources={dataSources}
          existingRelationships={relationships}
          onClose={close}
          onSaved={close}
        />
      </div>
    </div>
  );
}

/**
 * Header chrome + a body skeleton shown while the edit page loads the object it
 * needs to seed the editor (loading-states.md: keep the chrome, skeleton the
 * body — no spinner). The route-level Suspense fallback is separate.
 */
function ManualRelationshipEditorPageLoading({
  title,
  backHref,
}: {
  title: string;
  backHref: string;
}) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <EditorHeader
        title={title}
        icon={<Network className="size-5" />}
        backTo={backHref}
      />
      <div className="min-h-0 flex-1 overflow-hidden p-4">
        <div className="flex h-full flex-col gap-4">
          <Skeleton className="h-16 w-full" />
          <div className="flex flex-1 gap-3">
            <Skeleton className="h-full flex-1" />
            <Skeleton className="h-full flex-1" />
            <Skeleton className="h-full flex-1" />
            <Skeleton className="h-full flex-1" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Create a new manual relationship from this object (full page). */
export function ObjectRelationshipNewPage() {
  const { datasourceId = '', objectId = '' } = useParams<{
    datasourceId: string;
    objectId: string;
  }>();
  const api = useDatastore();
  const { dataSources } = useDataSources({ skipExecutions: true });

  // Object is only needed for the source label + duplicate list; render
  // immediately and let it fill in (create doesn't seed from an existing edge).
  const { data: object } = useQuery(
    objectDetailQuery(api, datasourceId, objectId),
  );

  return (
    <ManualRelationshipEditorPageBody
      datasourceId={datasourceId}
      objectId={objectId}
      dataSources={dataSources}
      object={object}
    />
  );
}

/** Edit an existing manual, outgoing relationship of this object (full page). */
export function ObjectRelationshipEditPage() {
  const {
    datasourceId = '',
    objectId = '',
    relationshipId = '',
  } = useParams<{
    datasourceId: string;
    objectId: string;
    relationshipId: string;
  }>();
  const api = useDatastore();
  const navigate = useNavigate();
  const { dataSources } = useDataSources({ skipExecutions: true });

  const { data: object, isPending } = useQuery(
    objectDetailQuery(api, datasourceId, objectId),
  );

  // Only this object's own direct, outgoing edges are editable.
  const relationship = useMemo(
    () =>
      (object?.relationships ?? []).find(
        r =>
          r.id === relationshipId &&
          r.direction === 'outgoing' &&
          isDirectRelationship(r),
      ),
    [object?.relationships, relationshipId],
  );

  const backHref = objectDetail(datasourceId, objectId);

  // Once the query settles with no editable edge — whether the edge is gone, the
  // object 404s, or the fetch errored — return to the object page (which renders
  // the load error itself) rather than sit on the skeleton forever.
  useEffect(() => {
    if (!isPending && !relationship) {
      navigate(backHref, { replace: true });
    }
  }, [isPending, relationship, navigate, backHref]);

  // The editor hook seeds its state from `relationship` via useState initializers,
  // so only mount the body once the edge is resolved.
  if (!relationship) {
    return (
      <ManualRelationshipEditorPageLoading
        title="Edit direct relationship"
        backHref={backHref}
      />
    );
  }

  return (
    <ManualRelationshipEditorPageBody
      key={relationship.id}
      datasourceId={datasourceId}
      objectId={objectId}
      dataSources={dataSources}
      object={object}
      relationship={relationship}
    />
  );
}
