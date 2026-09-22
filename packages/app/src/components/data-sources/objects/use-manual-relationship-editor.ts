import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useAlert, useDatastore } from '../../../api';
import {
  objectDetailQuery,
  relationshipRulesAllQuery,
} from '../../../api/queries';
import { syncContextGroupsAfterEdgeWrite } from '../../../api/context-group-sync';
import { getWorkspaceScopeKey } from '../../../api/workspace-scope';
import type {
  DatastoreObjectWithRelationships,
  ObjectRelationship,
} from '../../../api/datastore/datastore-client';
import { useZodForm } from '../../common';
import { useRelationshipTypeField } from '../relationships-editor/use-relationship-type-field';
import type { RelationshipTypeFieldState } from '../relationships-editor/relationship-type';
import type { RelationshipEditorGate } from '../relationships-editor/relationship-editor-gate';
import { resolveObjectDisplayName } from './resolve-object-display-name';

export const DUPLICATE_RELATIONSHIP_MESSAGE =
  'A direct relationship like this already exists';

// Structural only: required-ness surfaces through the ordered
// saveBlockedReason chain, not per-field validation messages.
const targetFormSchema = z.object({
  targetDatasourceId: z.string(),
  targetObjectId: z.string(),
});

export interface UseManualRelationshipEditorOptions {
  /** The object the edge originates from (fixed; the target is picked). */
  sourceDatasourceId: string;
  sourceObjectId: string;
  /** This object's relationships — combobox options + duplicate detection. */
  existingRelationships?: ObjectRelationship[];
  /** An existing outgoing manual relationship to edit; omit to create. */
  relationship?: ObjectRelationship;
  /** Called after a successful save/delete (invalidate + close/navigate). */
  onSaved: (workspaceScopeKey: string) => void | Promise<void>;
}

export interface ManualRelationshipEditorState extends RelationshipEditorGate {
  targetDatasourceId: string;
  setTargetDatasourceId: (id: string) => void;
  targetObjectId: string;
  setTargetObjectId: (id: string) => void;
  /** The slice consumed by RelationshipTypeField / ReciprocalField. */
  typeState: RelationshipTypeFieldState;
  /** The picked target object (once both ids are set), for the object preview. */
  targetObject: DatastoreObjectWithRelationships | null;
  targetObjectLoading: boolean;
  targetObjectError: unknown;
  /** Resolved display name of the target object, falling back to its id. */
  targetLabel: string;
  saveError: string | null;
}

export function useManualRelationshipEditor({
  sourceDatasourceId,
  sourceObjectId,
  existingRelationships,
  relationship,
  onSaved,
}: UseManualRelationshipEditorOptions): ManualRelationshipEditorState {
  const api = useDatastore();
  const alertApi = useAlert();
  const queryClient = useQueryClient();
  const isEdit = !!relationship;

  // The picked target lives on a form (the same value-store stack as the rule
  // editor's useRuleFormState). Seeded via defaultValues at mount: both mount
  // sites remount per editing session (the drawer mounts only while open and
  // keys on the edge id; the full page mounts per route), so no reset effect.
  const form = useZodForm({
    schema: targetFormSchema,
    defaultValues: {
      targetDatasourceId: relationship?.destinationDatasourceId ?? '',
      targetObjectId: relationship?.destinationObjectId ?? '',
    },
  });
  const { targetDatasourceId, targetObjectId } = form.watch();
  const setTargetObjectId = useCallback(
    (id: string) => form.setValue('targetObjectId', id),
    [form],
  );

  // Offer the same relationship-type vocabulary as the rule editor: the known
  // verbs (added by the type-field hook) plus every type used by an existing
  // rule, plus this object's own relationship types. Without the rule types the
  // manual list would be a narrower set than the rule editor's.
  const rulesQuery = useQuery(relationshipRulesAllQuery(api));
  const existingTypes = useMemo(() => {
    const set = new Set<string>();
    for (const rule of rulesQuery.data?.items ?? []) {
      if (rule.relationshipType) {
        set.add(rule.relationshipType);
      }
    }
    for (const relationship of existingRelationships ?? []) {
      if (relationship.relationshipType) {
        set.add(relationship.relationshipType);
      }
    }
    return [...set];
  }, [rulesQuery.data, existingRelationships]);
  const typeField = useRelationshipTypeField({
    // Manual creation starts with no verb chosen (the Match panel prompts for
    // one); only an edited edge seeds its existing type.
    initialType: relationship?.relationshipType ?? '',
    initialReciprocal: relationship?.reciprocalRelationshipType ?? undefined,
    existingTypes,
  });

  const setTargetDatasourceId = useCallback(
    (id: string) => {
      form.setValue('targetDatasourceId', id);
      // A target object from the previous data source no longer applies.
      form.setValue('targetObjectId', '');
    },
    [form],
  );

  // The picked target object — shared so the header endpoint, the step-map node
  // and the Target object preview all show the resolved name, not the raw id.
  const targetObjectQuery = useQuery({
    ...objectDetailQuery(api, targetDatasourceId, targetObjectId),
    enabled: !!targetDatasourceId && !!targetObjectId,
  });
  const targetObject = targetObjectQuery.data ?? null;
  const targetLabel = targetObject
    ? resolveObjectDisplayName(targetObject.object, targetObjectId)
    : targetObjectId;

  const isDuplicate = useMemo(() => {
    const type = typeField.relationshipType.trim();
    if (!targetDatasourceId || !targetObjectId || !type) {
      return false;
    }
    return (existingRelationships ?? []).some(
      r =>
        r.direction === 'outgoing' &&
        r.id !== relationship?.id &&
        r.destinationDatasourceId === targetDatasourceId &&
        r.destinationObjectId === targetObjectId &&
        r.relationshipType === type,
    );
  }, [
    existingRelationships,
    targetDatasourceId,
    targetObjectId,
    typeField.relationshipType,
    relationship?.id,
  ]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const workspaceScopeKey = getWorkspaceScopeKey();
      const relationshipType = typeField.relationshipType.trim();
      const reciprocal = typeField.reciprocalRelationshipType.trim();
      const input = {
        sourceDatasourceId,
        sourceObjectId,
        destinationDatasourceId: targetDatasourceId,
        destinationObjectId: targetObjectId,
        relationshipType,
        origin: 'manual',
        ...(reciprocal ? { reciprocalRelationshipType: reciprocal } : {}),
      };

      if (relationship) {
        const tupleChanged =
          input.destinationDatasourceId !==
            relationship.destinationDatasourceId ||
          input.destinationObjectId !== relationship.destinationObjectId ||
          relationshipType !== relationship.relationshipType;
        if (tupleChanged) {
          // New tuple → a distinct row. Create first so a failure can't lose
          // the existing edge, then remove the old one.
          await api.createRelationship(input);
          await api.deleteRelationship(relationship.id);
        } else {
          // Same tuple: the upsert would hit the same row and can't change the
          // reverse verb, so replace the row in place.
          await api.deleteRelationship(relationship.id);
          await api.createRelationship(input);
        }
      } else {
        await api.createRelationship(input);
      }
      return workspaceScopeKey;
    },
    // Group membership merges across direct edges, so refresh the group
    // surfaces once the backend has rebuilt them. Returned so `isPending`
    // (and the callers' onSaved) waits for the refetch to settle.
    onSuccess: workspaceScopeKey =>
      syncContextGroupsAfterEdgeWrite(
        queryClient,
        api,
        [sourceDatasourceId],
        workspaceScopeKey,
      ),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const workspaceScopeKey = getWorkspaceScopeKey();
      if (relationship) {
        await api.deleteRelationship(relationship.id);
      }
      return workspaceScopeKey;
    },
    onSuccess: workspaceScopeKey =>
      syncContextGroupsAfterEdgeWrite(
        queryClient,
        api,
        [sourceDatasourceId],
        workspaceScopeKey,
      ),
  });

  const saving = saveMutation.isPending;
  const deleting = deleteMutation.isPending;
  // Stay busy after a mutation *succeeds* too, not just while it's pending:
  // onSaved (invalidate → close/navigate) runs while the editor is still
  // mounted, and on the full page it awaits the refetch before navigating. Once
  // isPending drops, the buttons would re-enable during that window and a second
  // click would double-submit (a duplicate edge). Every onSaved ends in unmount,
  // so treating a settled success as busy is safe.
  const busy =
    saving || deleting || saveMutation.isSuccess || deleteMutation.isSuccess;

  const saveBlockedReason = !targetDatasourceId
    ? 'Select a target data source'
    : !targetObjectId
      ? 'Select a target object'
      : !typeField.relationshipType.trim()
        ? 'Enter a relationship type'
        : isDuplicate
          ? DUPLICATE_RELATIONSHIP_MESSAGE
          : null;
  // Inputs-only, per the shared gate contract: busy gates separately (the
  // action cluster and shell compose the two, and handleSave/handleDelete
  // guard re-entry themselves).
  const canSave = !saveBlockedReason;

  const handleSave = useCallback(() => {
    if (saveBlockedReason || busy) {
      return;
    }
    saveMutation.mutate(undefined, {
      onSuccess: async workspaceScopeKey => {
        alertApi.post({
          message: isEdit
            ? 'Direct relationship updated'
            : 'Direct relationship added',
          severity: 'success',
        });
        await onSaved(workspaceScopeKey);
      },
    });
  }, [saveBlockedReason, busy, saveMutation, alertApi, isEdit, onSaved]);

  const handleDelete = useCallback(() => {
    if (!relationship || busy) {
      return;
    }
    deleteMutation.mutate(undefined, {
      onSuccess: async workspaceScopeKey => {
        alertApi.post({
          message: 'Direct relationship removed',
          severity: 'success',
        });
        await onSaved(workspaceScopeKey);
      },
    });
  }, [relationship, busy, deleteMutation, alertApi, onSaved]);

  const saveError =
    saveMutation.error instanceof Error
      ? saveMutation.error.message
      : deleteMutation.error instanceof Error
        ? deleteMutation.error.message
        : null;

  const typeState: RelationshipTypeFieldState = {
    relationshipType: typeField.relationshipType,
    reciprocalRelationshipType: typeField.reciprocalRelationshipType,
    handleRelationshipTypeChange: typeField.handleRelationshipTypeChange,
    handleReciprocalChange: typeField.handleReciprocalChange,
    relationshipTypeOptions: typeField.relationshipTypeOptions,
    isDuplicate,
    isReciprocalDuplicate: false,
  };

  return {
    isEdit,
    targetDatasourceId,
    setTargetDatasourceId,
    targetObjectId,
    setTargetObjectId,
    typeState,
    targetObject,
    targetObjectLoading: targetObjectQuery.isLoading,
    targetObjectError: targetObjectQuery.error,
    targetLabel,
    canSave,
    saveBlockedReason,
    saving,
    deleting,
    busy,
    saveError,
    handleSave,
    handleDelete,
  };
}
