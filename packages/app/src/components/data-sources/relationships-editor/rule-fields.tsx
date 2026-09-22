import { useId, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Autocomplete } from '@roadiehq/ui/autocomplete';
import { Label } from '@roadiehq/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@roadiehq/ui/select';
import { FieldHint } from '@roadiehq/ui/field-hint';
import { JsonataExpressionField } from '../data-source-editor/jsonata-expression-field';
import {
  MATCH_STRATEGIES,
  describeMatchStrategy,
  isMatchStrategy,
} from './inspector-shared';
import { type RelationshipRuleEditorState } from './use-relationship-rule-editor';
import {
  DUPLICATE_RULE_MESSAGE,
  type RelationshipTypeFieldState,
} from './relationship-type';

/**
 * The relationship-type Autocomplete plus its duplicate-collision error. Shared
 * by the stepped editor's Match column, the integration Request tab, and the
 * legacy flat form so the wording, error state, and a11y wiring stay identical.
 */
export function RelationshipTypeField({
  editor,
  duplicateMessage = DUPLICATE_RULE_MESSAGE,
}: {
  editor: RelationshipTypeFieldState;
  duplicateMessage?: string;
}) {
  const fieldId = useId();
  const errorId = useId();
  return (
    <div>
      <Label
        htmlFor={fieldId}
        className="mb-1 block text-xs font-medium text-muted-foreground"
      >
        Relationship type
      </Label>
      <Autocomplete
        id={fieldId}
        className={editor.isDuplicate ? 'border-destructive' : ''}
        value={editor.relationshipType}
        onChange={editor.handleRelationshipTypeChange}
        options={editor.relationshipTypeOptions}
        aria-invalid={editor.isDuplicate}
        aria-describedby={editor.isDuplicate ? errorId : undefined}
        required
      />
      {editor.isDuplicate && (
        <p id={errorId} className="mt-1 text-xs text-destructive">
          {duplicateMessage}
        </p>
      )}
    </div>
  );
}

/**
 * The match-strategy Select (field-matching only). `helpVariant` chooses where
 * the strategy description shows: `hint` places a `FieldHint` beside the label
 * (compact step editor); `description` renders it as a paragraph below the
 * control (legacy flat form).
 */
export function MatchStrategyField({
  editor,
  helpVariant = 'description',
}: {
  editor: RelationshipRuleEditorState;
  helpVariant?: 'hint' | 'description';
}) {
  const fieldId = useId();
  const descriptionId = useId();
  const select = (
    <Select
      value={editor.matchStrategy}
      onValueChange={val => {
        if (isMatchStrategy(val)) {
          editor.setMatchStrategy(val);
        }
      }}
    >
      <SelectTrigger id={fieldId} aria-describedby={descriptionId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {MATCH_STRATEGIES.map(s => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );

  if (helpVariant === 'hint') {
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <Label
            htmlFor={fieldId}
            className="text-xs font-medium text-muted-foreground"
          >
            Match strategy
          </Label>
          <FieldHint ariaLabel="Match strategy help">
            <span id={descriptionId}>
              {describeMatchStrategy(editor.matchStrategy)}
            </span>
          </FieldHint>
        </div>
        {select}
      </div>
    );
  }

  return (
    <div>
      <Label
        htmlFor={fieldId}
        className="mb-1 block text-xs font-medium text-muted-foreground"
      >
        Match strategy
      </Label>
      {select}
      <p id={descriptionId} className="mt-1 text-xs text-muted-foreground">
        {describeMatchStrategy(editor.matchStrategy)}
      </p>
    </div>
  );
}

/**
 * One side's optional JSONata object filter. Shared by the flat form's Filters
 * section, the integration Filters tab, and the stepped editor's per-column
 * filter panel (which passes `compact`).
 */
export function RelationshipFilterField({
  editor,
  side,
  compact = false,
}: {
  editor: RelationshipRuleEditorState;
  side: 'source' | 'target';
  compact?: boolean;
}) {
  if (side === 'source') {
    return (
      <JsonataExpressionField
        label="Source filter"
        compact={compact}
        value={editor.sourceFilterExpression}
        onChange={editor.setSourceFilterExpression}
        placeholder="$.active = true"
        helperText="Optional JSONata expression. Source objects must evaluate to true."
        transformType="filter"
      />
    );
  }
  return (
    <JsonataExpressionField
      label="Target filter"
      compact={compact}
      value={editor.targetFilterExpression}
      onChange={editor.setTargetFilterExpression}
      placeholder="$.archived = false"
      helperText="Optional JSONata expression. Target objects must evaluate to true."
      transformType="filter"
    />
  );
}

/**
 * The "Request failed · HTTP {status}" header plus the integration's error
 * message. Rendered inside a bordered box on the integration Request tab and in
 * the Lookup preview card's error state; `requestLine` slots the resolved
 * request between the header and the message where a caller wants to show it.
 */
export function LookupRequestErrorNotice({
  error,
  requestLine,
}: {
  error: { status?: number; message?: string };
  requestLine?: ReactNode;
}) {
  return (
    <>
      <div className="flex items-center gap-1.5 font-medium text-destructive">
        <AlertTriangle className="size-3.5 shrink-0" />
        <span>
          Request failed
          {error.status != null ? ` · HTTP ${error.status}` : ''}
        </span>
      </div>
      {requestLine}
      <p className="break-words whitespace-pre-wrap text-destructive/90">
        {error.message ?? 'The lookup request failed.'}
      </p>
    </>
  );
}
