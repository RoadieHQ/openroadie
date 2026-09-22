import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { RelationshipStepList } from './relationship-step-list';
import { RelationshipPlayground } from './relationship-playground';
import type { SchemaField } from './schema-field-utils';
import type { RelationshipRuleEditorState } from './use-relationship-rule-editor';

/**
 * The stepped-editor body: the Source → Lookup → Match pipeline
 * (`RelationshipStepList`) above the aggregate materialized-relationships
 * preview (`RelationshipPlayground`).
 */
export function RelationshipStepEditor({
  editor,
  sourceLabel,
  targetLabel,
  sourceLogoUrl,
  targetLogoUrl,
  sourceFields,
  targetFields,
  hasPreview,
  showEndpoints = true,
  leading,
}: {
  editor: RelationshipRuleEditorState;
  sourceLabel: string;
  targetLabel: string;
  sourceLogoUrl?: string;
  targetLogoUrl?: string;
  sourceFields: SchemaField[];
  targetFields: SchemaField[];
  hasPreview: boolean;
  // The source→target summary is redundant when the drawer header already
  // shows it; hide it here.
  showEndpoints?: boolean;
  /** Pinned at the head of the step-map (e.g. a suggestion's score badge). */
  leading?: ReactNode;
}) {
  return (
    // Flows naturally so the inspector's own overflow-auto scrolls the whole
    // body (pipeline grid + table).
    <div className="flex flex-col gap-4">
      {showEndpoints && (
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate font-semibold text-foreground">
            {sourceLabel}
          </span>
          <ArrowRight className="size-3.5 shrink-0" />
          <span className="truncate font-semibold text-foreground">
            {targetLabel}
          </span>
        </div>
      )}

      <RelationshipStepList
        editor={editor}
        sourceLabel={sourceLabel}
        targetLabel={targetLabel}
        sourceLogoUrl={sourceLogoUrl}
        targetLogoUrl={targetLogoUrl}
        sourceFields={sourceFields}
        targetFields={targetFields}
        leading={leading}
      />

      <RelationshipPlayground
        editor={editor}
        sourceLabel={sourceLabel}
        targetLabel={targetLabel}
        hasPreview={hasPreview}
        title="Generated relationships"
      />
    </div>
  );
}
