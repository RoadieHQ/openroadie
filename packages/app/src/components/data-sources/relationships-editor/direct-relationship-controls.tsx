import { useState } from 'react';
import { Link2, Undo2, X } from 'lucide-react';
import { useQueries } from '@tanstack/react-query';
import { Button } from '@roadiehq/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@roadiehq/ui/popover';
import { useDatastore } from '../../../api';
import { objectDetailQuery } from '../../../api/queries';
import { ObjectListPicker } from '../objects/object-list-picker';
import { resolveObjectDisplayName } from '../objects/resolve-object-display-name';
import type { DirectEdgeDraft } from './use-direct-relationships';

export interface DirectRelationshipRowControls {
  targetDatasourceId: string;
  /** Resolved display names for direct-edge targets, keyed by object id. */
  targetLabels: Map<string, string>;
  /** Buffer a new direct edge from an unmatched source. */
  onLink: (sourceObjectId: string, targetObjectId: string) => void;
  /** Buffer removal of a persisted direct edge (by relationship id). */
  onRemove: (relationshipId: string) => void;
  /** Undo a buffered addition or removal (by draft key). */
  onUndo: (key: string) => void;
  mutating: boolean;
}

/**
 * Resolves display names for direct-edge target objects. Direct edges only
 * store ids, and the preview payload knows nothing about them — each label
 * comes from the target object itself (cached per object by react-query).
 */
export function useDirectTargetLabels(
  targetDatasourceId: string,
  targetObjectIds: string[],
): Map<string, string> {
  const api = useDatastore();
  return useQueries({
    queries: targetObjectIds.map(objectId => ({
      ...objectDetailQuery(api, targetDatasourceId, objectId),
      enabled: !!targetDatasourceId && !!objectId,
    })),
    combine: results => {
      const labels = new Map<string, string>();
      results.forEach((result, index) => {
        const objectId = targetObjectIds.at(index);
        if (!objectId || !result.data) return;
        labels.set(
          objectId,
          resolveObjectDisplayName(result.data.object, objectId),
        );
      });
      return labels;
    },
  });
}

/**
 * The per-row affordance for the direct-relationship layer. Nothing is written
 * until the rule is saved — these actions edit the buffer:
 * - an unmatched row gets a "Link" action that picks a target and buffers a new
 *   direct edge;
 * - a persisted direct row gets a remove (✕) that buffers its deletion;
 * - a buffered addition or removal gets an undo.
 */
export function DirectRelationshipRowActions({
  sourceObjectId,
  sourceLabel,
  directKey,
  directStatus,
  controls,
}: {
  sourceObjectId: string;
  sourceLabel: string;
  directKey?: string;
  directStatus?: DirectEdgeDraft['status'];
  controls: DirectRelationshipRowControls;
}) {
  const [open, setOpen] = useState(false);
  const [pickedObjectId, setPickedObjectId] = useState('');

  // A buffered addition or removal can be undone before save.
  if (directKey && (directStatus === 'added' || directStatus === 'removed')) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-5 shrink-0 text-muted-foreground hover:text-foreground"
        aria-label={
          directStatus === 'added'
            ? 'Discard pending direct relationship'
            : 'Keep direct relationship'
        }
        title={
          directStatus === 'added'
            ? 'Discard pending direct relationship'
            : 'Keep direct relationship'
        }
        disabled={controls.mutating}
        onClick={() => controls.onUndo(directKey)}
      >
        <Undo2 className="size-3" />
      </Button>
    );
  }

  // A persisted direct edge — buffer its removal.
  if (directKey && directStatus === 'persisted') {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-5 shrink-0 text-muted-foreground hover:text-destructive"
        aria-label="Remove direct relationship"
        title="Remove direct relationship"
        disabled={controls.mutating}
        onClick={() => controls.onRemove(directKey)}
      >
        <X className="size-3" />
      </Button>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={next => {
        setOpen(next);
        if (!next) setPickedObjectId('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-5 shrink-0 gap-1 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
          disabled={controls.mutating}
        >
          <Link2 className="size-3" />
          Link
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <ObjectListPicker
          label={`Link ${sourceLabel} directly to`}
          datasourceId={controls.targetDatasourceId}
          objectId={pickedObjectId}
          onObjectIdChange={id => {
            setPickedObjectId(id);
            controls.onLink(sourceObjectId, id);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
