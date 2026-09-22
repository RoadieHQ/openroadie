import { useCallback, useId, type ReactNode } from 'react';
import { Input } from '@roadiehq/ui/input';
import {
  Autocomplete,
  type AutocompleteOption,
} from '@roadiehq/ui/autocomplete';
import { ToggleGroup } from '@roadiehq/ui/toggle-group';
import { Label } from '@roadiehq/ui/label';
import { FieldHint } from '@roadiehq/ui/field-hint';
import { splitFieldPath } from './field-expression';
import { useFieldMode, type FieldMode } from './use-field-mode';

/**
 * The shared "Field | Expression" control used wherever the editor picks a
 * JSONata field/match: a heading + optional help, a Field/Expression toggle,
 * and a full-width control beneath — a friendly field picker (leaf labels,
 * parent groups, and a truncated display so a picked field reads as a field,
 * not as the raw `$…` path) in Field mode, or a raw expression input in
 * Expression mode. The mode follows the value (see `useFieldMode`), so a plain
 * value lands on Field and an advanced expression on Expression.
 *
 * Callers supply the options (Source/Target read them from the schema, the
 * Lookup response from a sampled payload); this component owns the presentation
 * so those surfaces stay identical.
 */
export interface FieldExpressionPickerProps {
  /** Small uppercase heading (e.g. "Field", "Response field"). */
  heading: string;
  /** sr-only label for the control. */
  accessibleLabel: string;
  /** Optional data-source name shown above the heading. */
  entityLabel?: string;
  /** Optional help rendered as a FieldHint beside the heading. */
  help?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  /** Field-mode options — leaf label, parent group and trailing type. */
  options: AutocompleteOption[];
  /** Disable Field mode (e.g. no sampled response yet). */
  fieldDisabled?: boolean;
  fieldPlaceholder?: string;
  expressionPlaceholder?: string;
  /** Note shown under the control while in Field mode (empty-state hints). */
  fieldNote?: ReactNode;
}

export function FieldExpressionPicker({
  heading,
  accessibleLabel,
  entityLabel,
  help,
  value,
  onChange,
  options,
  fieldDisabled,
  fieldPlaceholder = 'Select a field',
  expressionPlaceholder = 'e.g. $.spec.owner',
  fieldNote,
}: FieldExpressionPickerProps) {
  const fieldId = useId();
  const [mode, setMode] = useFieldMode(value);
  // When Field mode is unavailable (no schema fields, or no sampled response
  // yet) force Expression so the control opens on a usable input rather than an
  // empty/disabled field picker, and ignore attempts to toggle back to Field.
  const effectiveMode: FieldMode = fieldDisabled ? 'expression' : mode;
  const handleModeChange = useCallback(
    (next: FieldMode) => {
      if (fieldDisabled && next === 'field') {
        return;
      }
      setMode(next);
    },
    [fieldDisabled, setMode],
  );

  // Typing in the expression input *is* a choice of Expression mode. Recording
  // it keeps an expression that merely arrived advanced (a loaded rule, a
  // wildcard picked in the tree) in Expression mode as the author edits it back
  // down to a plain path, instead of flipping to the field picker mid-edit.
  const handleExpressionChange = useCallback(
    (next: string) => {
      setMode('expression');
      onChange(next);
    },
    [onChange, setMode],
  );

  // Show the picked field by its leaf, not the raw `$…` path — prefer the
  // matching option's label, falling back to the path's leaf for a value that
  // isn't in the current option set (e.g. before a sample loads).
  const displayValue = useCallback(
    (v: string) =>
      v
        ? (options.find(o => o.value === v)?.label ??
          splitFieldPath(v).leaf ??
          v)
        : '',
    [options],
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      {entityLabel && (
        <div className="truncate text-sm font-semibold text-foreground">
          {entityLabel}
        </div>
      )}
      {/* Heading + help (left) and the Field/Expression toggle (right) share the
          top row; the control spans the full width beneath. */}
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {heading && (
            <span className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
              {heading}
            </span>
          )}
          {help && (
            <FieldHint ariaLabel={`${accessibleLabel} help`}>{help}</FieldHint>
          )}
        </div>
        <ToggleGroup<FieldMode>
          size="sm"
          className="h-7 shrink-0"
          value={effectiveMode}
          onValueChange={handleModeChange}
          items={[
            { value: 'field', label: 'Field' },
            { value: 'expression', label: 'Expression' },
          ]}
        />
      </div>
      <Label htmlFor={fieldId} className="sr-only">
        {accessibleLabel}
      </Label>
      {effectiveMode === 'expression' ? (
        <Input
          id={fieldId}
          className="h-9"
          placeholder={expressionPlaceholder}
          value={value}
          onChange={e => handleExpressionChange(e.target.value)}
          required
        />
      ) : (
        <Autocomplete
          id={fieldId}
          className="h-9"
          placeholder={fieldPlaceholder}
          value={value}
          onChange={onChange}
          options={options}
          displayValue={displayValue}
          disabled={fieldDisabled}
        />
      )}
      {effectiveMode === 'field' && fieldNote}
    </div>
  );
}

/** Build picker options from accessor paths (`$…`) with their value type. */
export function fieldOptionsFromPaths(
  paths: { path: string; type: string }[],
): AutocompleteOption[] {
  return paths.map(({ path, type }) => {
    const { leaf, parent } = splitFieldPath(path);
    return {
      value: path,
      label: leaf || path,
      description: parent ? `${parent}.${leaf}` : leaf,
      group: parent || undefined,
      trailing: type,
    };
  });
}
