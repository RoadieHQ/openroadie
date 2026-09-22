import { useCallback, useState } from 'react';
import { ConfirmationDialog } from '@roadiehq/ui/confirmation-dialog';
import { dataSourceDetail } from '../../../config/paths';
import {
  useRelationshipRuleEditor,
  type RelationshipRuleEditorState,
  type RelationshipRuleInspectorProps,
} from './use-relationship-rule-editor';
import { RelationshipStepEditor } from './relationship-step-editor';
import { RelationshipEditorShell } from './relationship-editor-shell';
import { RelationshipEditorActions } from './relationship-editor-actions';
import { editorGateActionProps } from './relationship-editor-gate';
import { SuggestionEvidenceBadge } from './suggestion-evidence-badge';

// Re-exported so external callers that already import describeMatchStrategy
// from this module continue to work.
export { describeMatchStrategy } from './inspector-shared';
export type { RelationshipRuleInspectorProps };

/**
 * Body copy for the "pending retypes would be abandoned" confirmation. Shared
 * because the same warning is raised from two places — the inspector's own
 * close and the drawer stack's leave guard — which differ only in the verb.
 */
export function describePendingRetypes(count: number, verb: string): string {
  const one = count === 1;
  return `${count} direct relationship${one ? '' : 's'} could not be moved to the rule's new relationship type. If you ${verb} now, ${
    one ? 'it stays' : 'they stay'
  } under the previous type and no longer belong to this rule. Save again to retry moving ${
    one ? 'it' : 'them'
  }.`;
}

export function RelationshipRuleInspector(
  props: RelationshipRuleInspectorProps,
) {
  if (props.editor) {
    return (
      <RelationshipRuleInspectorContent props={props} editor={props.editor} />
    );
  }
  return <RelationshipRuleInspectorWithEditor props={props} />;
}

function RelationshipRuleInspectorWithEditor({
  props,
}: {
  props: RelationshipRuleInspectorProps;
}) {
  const editor = useRelationshipRuleEditor(props);
  return <RelationshipRuleInspectorContent props={props} editor={editor} />;
}

export function RelationshipRuleInspectorActions({
  editor,
  onClose,
  onApprove,
  onDelete,
  deleteLabel,
}: {
  editor: RelationshipRuleEditorState;
  /** Omit where surrounding chrome owns the close affordance. */
  onClose?: () => void;
  onApprove?: (ruleId: string) => Promise<void>;
  onDelete?: (ruleId: string) => Promise<void | boolean>;
  /** Names what `onDelete` does — "Dismiss" where it marks a suggestion
   *  inactive, the default "Delete" where it really deletes the rule. */
  deleteLabel?: string;
}) {
  // Reviewing a suggestion has ONE primary action, not a Save beside an
  // Approve: approving is what persists the review, and it saves any tweak
  // first. The label says which of the two it will be — "Approve" accepts the
  // suggestion as-is, "Create" makes the rule the reviewer reshaped.
  const isSuggestionReview = editor.isSuggestion && !!onApprove;
  const suggestionProps = isSuggestionReview
    ? {
        primaryLabel: editor.hasUnsavedChanges ? 'Create' : 'Approve',
        canSave: editor.canApprove,
        saving: editor.saving || editor.approving,
        // Reason rides the tooltip only while the button is actually blocked —
        // a directs-only review approves without a fresh preview, and showing
        // the "run a preview" nudge on an enabled button would contradict it.
        saveBlockedReason: !editor.canApprove ? editor.saveBlockedReason : null,
        onSave: () => void editor.handleApprove(),
      }
    : {};

  return (
    <RelationshipEditorActions
      {...editorGateActionProps(editor)}
      {...suggestionProps}
      createLabel="Create"
      onDelete={onDelete ? editor.handleDelete : undefined}
      deleteLabel={deleteLabel}
      onClose={onClose}
    />
  );
}

function RelationshipRuleInspectorContent({
  props,
  editor,
}: {
  props: RelationshipRuleInspectorProps;
  editor: RelationshipRuleEditorState;
}) {
  const {
    open,
    container,
    sourceLabel,
    targetLabel,
    sourceLogoUrl,
    targetLogoUrl,
    sourceFields,
    targetFields,
    onClose,
    onApprove,
    onPreview,
    variant = 'drawer',
    showHeader = true,
    standaloneHref,
    drawerResetKey,
    guardClose = true,
  } = props;
  const { busy, canSave, handleApprove, handleSave, isSuggestion } = editor;

  // Pending retypes are a half-applied save (the rule already carries the new
  // type), not ordinary unsaved edits — closing discards the only record of
  // which edges still sit under the previous type, so ask first.
  //
  // When drawer chrome owns every exit (a DrawerStack breadcrumb and close), it
  // runs this same guard once for all of them; guarding again here would
  // double-prompt.
  const [confirmDiscardRetypes, setConfirmDiscardRetypes] = useState(false);
  const pendingRetypeCount = editor.direct.pendingRetypeCount;
  const guardedClose = useCallback(() => {
    if (guardClose && pendingRetypeCount > 0) {
      setConfirmDiscardRetypes(true);
      return;
    }
    onClose();
  }, [guardClose, pendingRetypeCount, onClose]);

  const title = editor.isSuggestion
    ? 'Review Suggested Rule'
    : editor.isEdit
      ? 'Edit Relationship Rule'
      : 'New Relationship Rule';

  // Cmd/Ctrl+Enter approves a suggestion, otherwise saves (when allowed).
  const canSubmit =
    (isSuggestion && !!onApprove && editor.canApprove) || canSave;
  const onSubmit = () => {
    if (isSuggestion && onApprove) {
      void handleApprove();
    } else if (canSave) {
      void handleSave();
    }
  };

  return (
    <RelationshipEditorShell
      variant={variant}
      open={open}
      container={container}
      title={title}
      source={{
        label: sourceLabel,
        logoUrl: sourceLogoUrl,
        href: dataSourceDetail(editor.sourceDatasourceId),
      }}
      target={{
        label: targetLabel,
        logoUrl: targetLogoUrl,
        href: dataSourceDetail(editor.targetDatasourceId),
      }}
      actions={
        <RelationshipRuleInspectorActions
          editor={editor}
          onClose={guardedClose}
          onApprove={onApprove}
          onDelete={props.onDelete}
          deleteLabel={props.deleteLabel}
        />
      }
      onClose={guardedClose}
      onSubmit={onSubmit}
      canSubmit={canSubmit}
      busy={busy}
      showHeader={showHeader}
      standaloneHref={standaloneHref}
      standaloneTitle="Open rule editor in full page"
      drawerLabel="rule drawer"
      drawerResetKey={drawerResetKey}
    >
      <RelationshipStepEditor
        editor={editor}
        leading={
          editor.isSuggestion && props.existingRule ? (
            <SuggestionEvidenceBadge rule={props.existingRule} />
          ) : undefined
        }
        sourceLabel={sourceLabel}
        targetLabel={targetLabel}
        sourceLogoUrl={sourceLogoUrl}
        targetLogoUrl={targetLogoUrl}
        sourceFields={sourceFields}
        targetFields={targetFields}
        hasPreview={!!onPreview}
        // The header already shows the source→target summary; only the
        // headerless page composition needs it inline.
        showEndpoints={!showHeader}
      />
      {guardClose && (
        <ConfirmationDialog
          open={confirmDiscardRetypes}
          title="Some direct relationships kept the previous type"
          confirmButtonText="Close anyway"
          contentText={describePendingRetypes(pendingRetypeCount, 'close')}
          onConfirm={() => {
            setConfirmDiscardRetypes(false);
            onClose();
          }}
          onCancel={() => setConfirmDiscardRetypes(false)}
        />
      )}
    </RelationshipEditorShell>
  );
}
