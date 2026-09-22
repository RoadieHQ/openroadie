import { useMemo } from 'react';
import type {
  RelationshipRule,
  RelationshipRuleInput,
  RelationshipRulePreviewInput,
  RelationshipRulePreviewOptions,
  RelationshipRulePreviewResult,
} from '../../../api/datastore/datastore-client';
import type { SchemaField } from './schema-field-utils';
import { useDirectRelationships } from './use-direct-relationships';
import { useRuleFormState } from './use-rule-form-state';
import { useRulePreview } from './use-rule-preview';
import { useRuleActions } from './use-rule-actions';

// Re-exported from their shared home so existing imports from this module keep
// working; the manual single-edge editor imports them from './relationship-type'.
export {
  deriveReciprocal,
  DUPLICATE_RULE_MESSAGE,
  type RelationshipTypeFieldState,
} from './relationship-type';

export interface RelationshipRuleInspectorProps {
  open: boolean;
  container: HTMLElement | null;
  variant?: 'drawer' | 'page';
  showHeader?: boolean;
  editor?: RelationshipRuleEditorState;
  standaloneHref?: string;
  /** Whether this editor guards its own close against discarding pending
   *  retypes. Set `false` when drawer chrome owns every exit and runs the
   *  guard once for all of them. Defaults to `true`. */
  guardClose?: boolean;
  drawerResetKey?: string | number | null;
  sourceDatasourceId: string;
  targetDatasourceId: string;
  sourceLabel: string;
  targetLabel: string;
  /** Resolved logo for the source/target data source, shown in the drawer header. */
  sourceLogoUrl?: string;
  targetLogoUrl?: string;
  sourceFields: SchemaField[];
  targetFields: SchemaField[];
  existingRule?: RelationshipRule;
  existingRules?: RelationshipRule[];
  initialSourceField?: string;
  initialTargetField?: string;
  onClose: () => void;
  /** Persists the rule. Returns the saved rule so the editor can flush direct
   *  relationships against its id (a new rule's id isn't known until then). */
  onSave: (
    input: RelationshipRuleInput,
  ) => Promise<RelationshipRule | undefined>;
  /** Resolving `false` means the delete did NOT happen (e.g. the user
   *  cancelled a confirmation the callback opened) — the editor stays open. */
  onDelete?: (ruleId: string) => Promise<void | boolean>;
  /** Label for the `onDelete` control — pass "Dismiss" where it dismisses a
   *  suggestion rather than deleting the rule. */
  deleteLabel?: string;
  onApprove?: (ruleId: string) => Promise<void>;
  onPreview?: (
    input: RelationshipRulePreviewInput,
    options?: RelationshipRulePreviewOptions,
  ) => Promise<RelationshipRulePreviewResult>;
}

type UseRelationshipRuleEditorOptions = Omit<
  RelationshipRuleInspectorProps,
  'container' | 'showHeader' | 'editor'
>;

/**
 * Composes the rule editor from its three concerns — the form values
 * ({@link useRuleFormState}), the preview engines ({@link useRulePreview}),
 * and the write actions ({@link useRuleActions}) — plus the direct-edge
 * buffer, and owns the cross-cutting save gating that joins them.
 */
export function useRelationshipRuleEditor({
  open,
  sourceDatasourceId,
  targetDatasourceId,
  sourceFields,
  targetFields,
  existingRule,
  existingRules,
  initialSourceField,
  initialTargetField,
  onClose,
  onSave,
  onDelete,
  onApprove,
  onPreview,
}: UseRelationshipRuleEditorOptions) {
  const isEdit = !!existingRule;
  const isSuggestion = existingRule?.state === 'suggested';

  const formState = useRuleFormState({
    open,
    sourceDatasourceId,
    targetDatasourceId,
    sourceFields,
    targetFields,
    existingRule,
    existingRules,
    initialSourceField,
    initialTargetField,
  });

  // The direct-relationship layer: manual edges resolved by hand in the preview
  // for rows the rule can't match. Buffered here and flushed on save so the
  // editor stays atomic (closing without saving discards them).
  const direct = useDirectRelationships({
    sourceDatasourceId,
    targetDatasourceId,
    relationshipType: formState.relationshipType,
    reciprocalRelationshipType: formState.reciprocalRelationshipType,
    // The saved type seeds the persisted direct layer; editing the type keeps
    // edges visible and re-types them on flush. The direct hook advances its
    // own fetch anchor after flush so a stay-open retry still sees moved edges
    // even if this prop stays stale for a beat.
    persistedRelationshipType: existingRule?.relationshipType,
    // The rule id, or a new-rule slot keyed on the pair alone — narrower than
    // the form's seed key, which also includes the initial fields: direct
    // edges are object-to-object and don't depend on the picked field
    // expressions, so re-dragging a connection on the same pair keeps them.
    // Null when closed so the buffer clears.
    resetKey: open
      ? (existingRule?.id ?? `new:${sourceDatasourceId}|${targetDatasourceId}`)
      : null,
  });

  const preview = useRulePreview({
    open,
    existingRuleId: existingRule?.id,
    sourceDatasourceId,
    targetDatasourceId,
    isIntegrationBacked: formState.isIntegrationBacked,
    sourceFieldExpression: formState.sourceFieldExpression,
    targetFieldExpression: formState.targetFieldExpression,
    sourceFilterExpression: formState.sourceFilterExpression,
    targetFilterExpression: formState.targetFilterExpression,
    relationshipType: formState.relationshipType,
    reciprocalRelationshipType: formState.reciprocalRelationshipType,
    matchStrategy: formState.matchStrategy,
    integrationConfig: formState.integrationConfig,
    currentSignature: formState.currentSignature,
    onPreview,
  });

  const isValid =
    preview.hasPreviewInputs &&
    !formState.isDuplicate &&
    !formState.isReciprocalDuplicate;
  // Staged direct edges are unsaved work even when no rule field changed —
  // saving is what flushes them, so they have to count as "dirty" here.
  const hasUnsavedChanges = formState.isDirty || direct.hasPendingChanges;
  // An existing rule with nothing changed has nothing to save; a new one is
  // unsaved by definition (and may be valid straight from its seeded fields).
  const canSave =
    isValid && preview.previewFresh && (!isEdit || hasUnsavedChanges);

  const { isIntegrationBacked } = formState;
  const {
    previewError,
    integrationPreviewFullyFailed,
    previewLoading,
    previewStale,
    previewHasResult,
  } = preview;
  const saveBlockedReason = useMemo(() => {
    if (!isValid || !onPreview) {
      return null;
    }
    // Problem states ("resolve X") surface whether or not the rule has been
    // edited — an existing rule whose sources now all fail is still not safe to
    // re-save.
    if (previewError) {
      return `Resolve the preview error before ${
        isEdit ? 'saving' : 'creating'
      } this rule.`;
    }
    if (integrationPreviewFullyFailed) {
      return 'Resolve the failed source calls before saving this rule.';
    }
    // The "run / finish a preview" nudge is only for a rule the author is
    // actively changing; inspecting an untouched, healthy rule instead says
    // why its Save is dead.
    if (!hasUnsavedChanges) {
      return isEdit ? 'No changes to save.' : null;
    }
    if (previewLoading || previewStale || !previewHasResult) {
      const action = isEdit ? 'Save' : 'Create';
      return isIntegrationBacked
        ? `${action} is available after you run a preview.`
        : `${action} is available after the latest preview finishes.`;
    }
    return null;
  }, [
    hasUnsavedChanges,
    isValid,
    onPreview,
    previewError,
    integrationPreviewFullyFailed,
    previewLoading,
    previewStale,
    previewHasResult,
    isEdit,
    isIntegrationBacked,
  ]);

  // Mirror what handleApprove actually requires: a dirty FORM must be
  // saveable (tweak-and-approve persists it first), but staged direct edges
  // flush with the approval regardless — they never need a fresh preview, so
  // they must not gate the button. Gating on hasUnsavedChanges here would
  // disable Approve for a directs-only review that handleApprove would
  // happily perform.
  const canApprove = !formState.isDirty || canSave;

  const actions = useRuleActions({
    canSave,
    isEdit,
    isDirty: formState.isDirty,
    existingRuleId: existingRule?.id,
    onClose,
    onSave,
    onDelete,
    onApprove,
    buildRuleInput: formState.buildRuleInput,
    flushDirect: direct.flush,
  });

  const busy =
    actions.saving || actions.deleting || actions.approving || direct.flushing;

  return {
    isEdit,
    isSuggestion,
    direct,
    sourceDatasourceId,
    targetDatasourceId,
    sourceFieldExpression: formState.sourceFieldExpression,
    setSourceFieldExpression: formState.setSourceFieldExpression,
    targetFieldExpression: formState.targetFieldExpression,
    setTargetFieldExpression: formState.setTargetFieldExpression,
    sourceFilterExpression: formState.sourceFilterExpression,
    setSourceFilterExpression: formState.setSourceFilterExpression,
    targetFilterExpression: formState.targetFilterExpression,
    setTargetFilterExpression: formState.setTargetFilterExpression,
    relationshipType: formState.relationshipType,
    handleRelationshipTypeChange: formState.handleRelationshipTypeChange,
    strategy: formState.strategy,
    setStrategy: formState.setStrategy,
    isIntegrationBacked: formState.isIntegrationBacked,
    integrationConfig: formState.integrationConfig,
    setIntegrationConfig: formState.setIntegrationConfig,
    matchStrategy: formState.matchStrategy,
    setMatchStrategy: formState.setMatchStrategy,
    reciprocalRelationshipType: formState.reciprocalRelationshipType,
    handleReciprocalChange: formState.handleReciprocalChange,
    relationshipFilter: preview.relationshipFilter,
    setRelationshipFilter: preview.setRelationshipFilter,
    saving: actions.saving,
    deleting: actions.deleting,
    approving: actions.approving,
    previewLoading: preview.previewLoading,
    previewError: preview.previewError,
    previewResult: preview.previewResult,
    integrationSampleLimit: preview.integrationSampleLimit,
    setIntegrationSampleLimit: preview.setIntegrationSampleLimit,
    previewSourceObjectId: preview.previewSourceObjectId,
    setPreviewSourceObjectId: preview.setPreviewSourceObjectId,
    lastPreviewSourceObjectId: preview.lastPreviewSourceObjectId,
    handleIntegrationPreview: preview.handleIntegrationPreview,
    hasPreviewInputs: preview.hasPreviewInputs,
    canRunPreview: preview.canRunPreview,
    responseSampleArmed: preview.responseSampleArmed,
    responseSampleRunId: preview.responseSampleRunId,
    previewBlockedReason: preview.previewBlockedReason,
    previewStale: preview.previewStale,
    relationshipFilterCounts: preview.relationshipFilterCounts,
    relationshipTypeOptions: formState.relationshipTypeOptions,
    isDuplicate: formState.isDuplicate,
    isReciprocalDuplicate: formState.isReciprocalDuplicate,
    canSave,
    canApprove,
    hasUnsavedChanges,
    saveBlockedReason,
    handleSave: actions.handleSave,
    handleDelete: actions.handleDelete,
    handleApprove: actions.handleApprove,
    busy,
  };
}

export type RelationshipRuleEditorState = ReturnType<
  typeof useRelationshipRuleEditor
>;
