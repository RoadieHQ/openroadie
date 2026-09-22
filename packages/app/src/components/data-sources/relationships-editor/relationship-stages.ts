import type { StepStatus } from '@roadiehq/ui/step-flow';
import { DEFAULT_INTEGRATION_CONFIG } from './integration-backed-rule-fields';
import { isAdvancedIntegrationRequestPath } from './step-list-utils';
import type { RelationshipRuleEditorState } from './use-relationship-rule-editor';

/**
 * The stepped relationship editor is a *view* over {@link RelationshipRuleEditorState}
 * — it stores no state of its own and never serializes the rule (the editor hook
 * owns seeding and save). A relationship is a fixed pipeline: a Source stage, an
 * optional Lookup (integration) stage, and a Match/Target stage. Presence of the
 * Lookup stage IS the strategy toggle: lookup present ⇔ `integration-backed`,
 * absent ⇔ `field-matching`.
 */
export type StageRole = 'source' | 'lookup' | 'match';

export interface StageDescriptor {
  role: StageRole;
  /** Stable list key. */
  key: string;
  /** Only lookup stages can be removed; Source and Match are structural. */
  removable: boolean;
}

export function stagesFromEditor(
  editor: RelationshipRuleEditorState,
): StageDescriptor[] {
  const stages: StageDescriptor[] = [
    { role: 'source', key: 'source', removable: false },
  ];
  if (editor.isIntegrationBacked) {
    stages.push({ role: 'lookup', key: 'lookup-0', removable: true });
  }
  stages.push({ role: 'match', key: 'match', removable: false });
  return stages;
}

/**
 * Adding the lookup flips the strategy to integration-backed and seeds a blank
 * config if none exists. This replaces the old strategy toggle — add/remove of
 * the lookup stage *is* the strategy switch.
 */
export function addLookupStage(editor: RelationshipRuleEditorState): void {
  editor.setStrategy('integration-backed');
  if (!editor.integrationConfig) {
    editor.setIntegrationConfig({ ...DEFAULT_INTEGRATION_CONFIG });
  }
}

/**
 * Removing the lookup returns to field-matching. `handleSave` only serializes
 * `integrationConfig` when integration-backed, so leaving it in memory is
 * harmless (and lets the user toggle back without re-entering it).
 */
export function removeLookupStage(editor: RelationshipRuleEditorState): void {
  editor.setStrategy('field-matching');
}

function lookupConfigured(editor: RelationshipRuleEditorState): boolean {
  const c = editor.integrationConfig;
  // A request path can be a literal `path` or an advanced `pathExpression`
  // (often with an empty `path`) — accept either, matching preview/save
  // readiness, so the Lookup stage doesn't read as pending for advanced rules.
  return (
    !!c?.integrationId.trim() &&
    (!!c.path.trim() || isAdvancedIntegrationRequestPath(c)) &&
    !!c.responseMatchExpression.trim()
  );
}

/**
 * Per-stage colour for the StepNode, read off the shared preview state so the
 * step list and the playground stay in sync automatically.
 */
export function stageStatus(
  role: StageRole,
  editor: RelationshipRuleEditorState,
): StepStatus {
  if (role === 'source') {
    return editor.sourceFieldExpression.trim() ? 'configured' : 'pending';
  }

  if (editor.previewError) {
    return 'error';
  }
  if (editor.previewLoading) {
    return 'running';
  }

  if (role === 'lookup') {
    return lookupConfigured(editor) ? 'configured' : 'pending';
  }

  // match
  if (editor.previewResult && !editor.previewStale) {
    return 'success';
  }
  return editor.targetFieldExpression.trim() && editor.relationshipType.trim()
    ? 'configured'
    : 'pending';
}
