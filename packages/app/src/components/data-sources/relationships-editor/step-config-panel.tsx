import { FieldColumn } from './field-column';
import { RelationshipFilterField } from './rule-fields';
import { IntegrationBackedRuleFields } from './integration-backed-rule-fields';
import type { RelationshipRuleEditorState } from './use-relationship-rule-editor';
import type { StageRole } from './relationship-stages';
import type { SchemaField } from './schema-field-utils';
import type { StepPreviewData } from './use-step-preview-data';

/**
 * A step's configuration panel — the endpoint concern for that stage. Source and
 * Target are just their join field (their filter lives in a separate filter
 * panel); Lookup renders the integration request/response fields. Edge semantics
 * (relationship type, reciprocal, match strategy) are NOT here — they live on the
 * Match column, since they describe the join, not either endpoint.
 */
export function StepConfigPanel({
  role,
  editor,
  preview,
  sourceFields,
  targetFields,
}: {
  role: StageRole;
  editor: RelationshipRuleEditorState;
  preview: StepPreviewData;
  sourceFields: SchemaField[];
  targetFields: SchemaField[];
}) {
  if (role === 'source') {
    return (
      <FieldColumn
        heading="Field"
        accessibleLabel="Source field"
        fields={sourceFields}
        value={editor.sourceFieldExpression}
        onChange={editor.setSourceFieldExpression}
      />
    );
  }

  if (role === 'lookup') {
    return (
      <IntegrationBackedRuleFields
        editor={editor}
        showRelationshipFields={false}
        layout="tabs"
        responseSample={preview.responseSample}
        responseSampleReady={preview.responseSampleReady}
        resolvedPathPreview={preview.resolvedLookupPath}
        requestError={preview.lookupRequestError}
      />
    );
  }

  // match → the Target endpoint's join field (its filter has its own panel).
  return (
    <FieldColumn
      heading="Field"
      accessibleLabel="Target field"
      fields={targetFields}
      value={editor.targetFieldExpression}
      onChange={editor.setTargetFieldExpression}
    />
  );
}

/**
 * A step's filter panel — an optional JSONata gate on Source / Target objects.
 * Opened from the filter icon in the column header (Lookup has none).
 */
export function StepFilterPanel({
  role,
  editor,
}: {
  role: StageRole;
  editor: RelationshipRuleEditorState;
}) {
  return (
    <RelationshipFilterField
      editor={editor}
      side={role === 'source' ? 'source' : 'target'}
      compact
    />
  );
}
