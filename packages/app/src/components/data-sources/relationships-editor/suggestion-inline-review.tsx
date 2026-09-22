import { useCallback } from 'react';
import type {
  RelationshipRule,
  RelationshipRuleInput,
} from '../../../api/datastore/datastore-client';
import type { SchemaField } from './schema-field-utils';
import {
  useRelationshipRuleEditor,
  type RelationshipRuleInspectorProps,
} from './use-relationship-rule-editor';
import { RelationshipRuleInspectorActions } from './relationship-rule-inspector';
import { RelationshipStepEditor } from './relationship-step-editor';

/**
 * The review editor inlined into an expanded suggestion card: evidence, the
 * editable step pipeline + generated-relationships preview, and the
 * approve/dismiss action cluster. One instance is mounted at a time (the
 * panel enforces a single expanded card) because each editor auto-runs a
 * debounced live preview.
 *
 * No score badge here: the card's own summary row above already carries it.
 * The drawer mounts the same editor with one, having no summary row.
 */
export function SuggestionInlineReview({
  rule,
  rank,
  rules,
  sourceLabel,
  targetLabel,
  sourceFields,
  targetFields,
  onSave,
  onApprove,
  onDismiss,
  onPreview,
  onCollapse,
}: {
  rule: RelationshipRule;
  /** The row's 0-based position in the sorted, confidence-filtered
   *  per-direction list — the same value the collapsed quick-buttons pass —
   *  so approving/dismissing from the expanded review records the same
   *  calibration rank rather than `undefined`. */
  rank?: number;
  rules: RelationshipRule[];
  sourceLabel: string;
  targetLabel: string;
  sourceFields: SchemaField[];
  targetFields: SchemaField[];
  onSave: (
    input: RelationshipRuleInput,
  ) => Promise<RelationshipRule | undefined>;
  onApprove: (ruleId: string, rankShown?: number) => Promise<void>;
  onDismiss: (ruleId: string, rankShown?: number) => Promise<void>;
  onPreview: RelationshipRuleInspectorProps['onPreview'];
  onCollapse: () => void;
}) {
  // useRelationshipRuleEditor/RelationshipRuleInspectorActions only pass the
  // ruleId through to their onApprove/onDelete; close over `rank` here so it
  // still reaches the write.
  const handleApprove = useCallback(
    (ruleId: string) => onApprove(ruleId, rank),
    [onApprove, rank],
  );
  const handleDismiss = useCallback(
    (ruleId: string) => onDismiss(ruleId, rank),
    [onDismiss, rank],
  );

  const editor = useRelationshipRuleEditor({
    open: true,
    sourceDatasourceId: rule.sourceDatasourceId,
    targetDatasourceId: rule.targetDatasourceId,
    sourceLabel,
    targetLabel,
    sourceFields,
    targetFields,
    existingRule: rule,
    existingRules: rules,
    onClose: onCollapse,
    onSave,
    onDelete: handleDismiss,
    onApprove: handleApprove,
    onPreview,
  });

  return (
    <div
      className="mt-3 flex flex-col gap-4 border-t border-border pt-3"
      // The card wrapper is clickable (collapse toggle); edits inside the
      // editor must not re-toggle it.
      onClick={e => e.stopPropagation()}
      onKeyDown={e => e.stopPropagation()}
      role="presentation"
    >
      <RelationshipStepEditor
        editor={editor}
        sourceLabel={sourceLabel}
        targetLabel={targetLabel}
        sourceFields={sourceFields}
        targetFields={targetFields}
        hasPreview={!!onPreview}
        showEndpoints={false}
      />
      <div className="flex items-center justify-end gap-1">
        <RelationshipRuleInspectorActions
          editor={editor}
          onClose={onCollapse}
          onApprove={handleApprove}
          onDelete={handleDismiss}
          deleteLabel="Dismiss"
        />
      </div>
    </div>
  );
}
