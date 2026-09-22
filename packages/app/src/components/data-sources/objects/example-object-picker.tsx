import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@roadiehq/ui/button';
import { Spinner } from '@roadiehq/ui/spinner';
import { cn } from '@roadiehq/ui/utils';
import { useDatastore } from '../../../api';
import type {
  DatastoreObjectWithRelationships,
  ExampleRelationshipPatternCandidate,
} from '../../../api/datastore/datastore-client';
import type { DataSourceItem } from '../types';
import { DataSourcePicker } from '../data-source-picker';
import { ObjectListPicker, flattenPreviewFields } from './object-list-picker';
import { workspaceQueryKey } from '../../../api/workspace-scope';

interface ExampleObjectSelection {
  sourceDatasourceId: string;
  sourceObjectId: string;
  targetDatasourceId: string;
  targetObjectId: string;
  sourceObject: DatastoreObjectWithRelationships;
  targetObject: DatastoreObjectWithRelationships;
}

interface ExampleObjectPickerProps {
  dataSources: DataSourceItem[];
  initialSourceDatasourceId: string;
  initialSourceObjectId: string;
  candidates: ExampleRelationshipPatternCandidate[];
  inferLoading?: boolean;
  onInfer: (selection: ExampleObjectSelection) => void;
  onExampleChange?: () => void;
}

function JsonObjectCard({
  title,
  object,
  highlightedFields,
}: {
  title: string;
  object: unknown;
  highlightedFields: Set<string>;
}) {
  const rows = useMemo(() => flattenPreviewFields(object), [object]);
  return (
    <div className="min-w-0 rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2 text-xs font-semibold text-muted-foreground">
        {title}
      </div>
      <div className="max-h-72 overflow-auto p-2">
        {rows.length === 0 ? (
          <div className="px-1 py-2 text-xs text-muted-foreground">
            No scalar fields.
          </div>
        ) : (
          <ul className="space-y-1">
            {rows.map(row => {
              const highlighted = highlightedFields.has(row.path);
              return (
                <li
                  key={row.path}
                  className={cn(
                    'grid grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)] gap-2 rounded px-2 py-1 text-xs',
                    highlighted && 'bg-primary/10 text-primary',
                  )}
                >
                  <span className="truncate font-mono">{row.path}</span>
                  <span className="truncate text-foreground">{row.value}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export function ExampleObjectPicker({
  dataSources,
  initialSourceDatasourceId,
  initialSourceObjectId,
  candidates,
  inferLoading = false,
  onInfer,
  onExampleChange,
}: ExampleObjectPickerProps) {
  const api = useDatastore();
  const [sourceDatasourceId, setSourceDatasourceId] = useState(
    initialSourceDatasourceId,
  );
  const [sourceObjectId, setSourceObjectId] = useState(initialSourceObjectId);
  // Cross-source relationships are the common case, so the target side seeds
  // with a data source other than the source's; same-source only when there is
  // no other one to offer.
  const initialTargetDatasourceId = useMemo(
    () =>
      dataSources.find(ds => ds.id !== initialSourceDatasourceId)?.id ??
      initialSourceDatasourceId,
    [dataSources, initialSourceDatasourceId],
  );
  const [targetDatasourceId, setTargetDatasourceId] = useState(
    initialTargetDatasourceId,
  );
  const [targetObjectId, setTargetObjectId] = useState('');
  const hasTrackedSelection = useRef(false);

  // Re-seeding for a new example must reset both sides. When the picker is
  // reused without a remount, resetting only the source would leave the previous
  // target selection stale on screen; the loaded objects derive from the query
  // below, so clearing the target id blanks them.
  useEffect(() => {
    setSourceObjectId(initialSourceObjectId);
    setSourceDatasourceId(initialSourceDatasourceId);
    setTargetDatasourceId(initialTargetDatasourceId);
    setTargetObjectId('');
  }, [
    initialSourceDatasourceId,
    initialSourceObjectId,
    initialTargetDatasourceId,
  ]);

  const bothSelected = !!sourceObjectId && !!targetObjectId;
  const objectsQuery = useQuery({
    queryKey: workspaceQueryKey(
      'datasourceObjects',
      'examplePair',
      sourceDatasourceId,
      sourceObjectId,
      targetDatasourceId,
      targetObjectId,
    ),
    queryFn: async () => {
      const [source, target] = await Promise.all([
        api.getObject(sourceDatasourceId, sourceObjectId),
        api.getObject(targetDatasourceId, targetObjectId),
      ]);
      return { source, target };
    },
    enabled: bothSelected,
  });
  const sourceObject = objectsQuery.data?.source ?? null;
  const targetObject = objectsQuery.data?.target ?? null;
  const loadingObjects = bothSelected && objectsQuery.isFetching;
  const error = objectsQuery.error
    ? objectsQuery.error instanceof Error
      ? objectsQuery.error.message
      : 'Failed to load objects'
    : null;

  useEffect(() => {
    if (!hasTrackedSelection.current) {
      hasTrackedSelection.current = true;
      return;
    }
    onExampleChange?.();
  }, [
    onExampleChange,
    sourceDatasourceId,
    sourceObjectId,
    targetDatasourceId,
    targetObjectId,
  ]);

  const sourceHighlights = new Set(
    candidates.map(c => c.sourceFieldExpression),
  );
  const targetHighlights = new Set(
    candidates.map(c => c.targetFieldExpression),
  );

  const inferDisabled =
    !sourceObject || !targetObject || loadingObjects || inferLoading;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <DataSourcePicker
            dataSources={dataSources}
            value={sourceDatasourceId}
            onChange={id => {
              setSourceDatasourceId(id);
              setSourceObjectId('');
            }}
            ariaLabel="Source data source"
            placeholder="Select data source"
          />
          <ObjectListPicker
            label="Source object"
            datasourceId={sourceDatasourceId}
            objectId={sourceObjectId}
            onObjectIdChange={setSourceObjectId}
          />
        </div>
        <div className="space-y-2">
          <DataSourcePicker
            dataSources={dataSources}
            value={targetDatasourceId}
            onChange={id => {
              setTargetDatasourceId(id);
              setTargetObjectId('');
            }}
            ariaLabel="Target data source"
            placeholder="Select data source"
          />
          <ObjectListPicker
            label="Target object"
            datasourceId={targetDatasourceId}
            objectId={targetObjectId}
            onObjectIdChange={setTargetObjectId}
          />
        </div>
      </div>

      {error && <div className="text-xs text-destructive">{error}</div>}

      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          disabled={inferDisabled}
          onClick={() => {
            if (sourceObject && targetObject) {
              onInfer({
                sourceDatasourceId,
                sourceObjectId,
                targetDatasourceId,
                targetObjectId,
                sourceObject,
                targetObject,
              });
            }
          }}
        >
          {(loadingObjects || inferLoading) && (
            <Spinner className="mr-2 size-3" />
          )}
          Propose pattern
        </Button>
      </div>

      {sourceObject && targetObject && (
        <div className="grid gap-3 md:grid-cols-2">
          <JsonObjectCard
            title="Source fields"
            object={sourceObject.object}
            highlightedFields={sourceHighlights}
          />
          <JsonObjectCard
            title="Target fields"
            object={targetObject.object}
            highlightedFields={targetHighlights}
          />
        </div>
      )}
    </div>
  );
}
