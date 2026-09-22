import { MatchConnector } from './step-preview-cards';
import { ReciprocalField } from './reciprocal-field';
import { MatchStrategyField, RelationshipTypeField } from './rule-fields';
import { StepCogButton, StepColumnShell } from './step-column-shell';
import type { RelationshipRuleEditorState } from './use-relationship-rule-editor';
import type { StepPreviewData } from './use-step-preview-data';

/**
 * The Match column between the last object and the target: the edge itself. Like
 * the other steps it has a header and a cogwheel that flips it between its join
 * summary and a config panel. The config owns everything about the relationship
 * — its type, the reverse verb, and (field-matching only) the comparison
 * strategy — since those describe the join, not either endpoint. An integration
 * lookup always joins by exact equality, so it hides the strategy but still owns
 * the relationship type.
 */
export function MatchColumn({
  editor,
  preview,
  matchConfigOpen,
  onToggleMatchConfig,
}: {
  editor: RelationshipRuleEditorState;
  preview: StepPreviewData;
  matchConfigOpen: boolean;
  onToggleMatchConfig: () => void;
}) {
  const open = matchConfigOpen;

  return (
    <StepColumnShell
      label={open ? 'Match — Configuration' : 'Match'}
      panelOpen={open}
      className={open ? 'min-w-[18rem] flex-1' : 'w-28 shrink-0'}
      actions={
        <StepCogButton
          active={open}
          activeLabel="Show match summary"
          inactiveLabel="Configure match"
          onClick={onToggleMatchConfig}
        />
      }
      panel={
        <div className="flex min-w-0 flex-col gap-4">
          <RelationshipTypeField editor={editor} />
          {/* Match strategy only applies to stored-value matching; an
              integration lookup always joins by exact equality. */}
          {!editor.isIntegrationBacked && (
            <MatchStrategyField editor={editor} helpVariant="hint" />
          )}
          <ReciprocalField editor={editor} />
        </div>
      }
      preview={<MatchConnector editor={editor} preview={preview} />}
    />
  );
}
