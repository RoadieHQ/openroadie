import { Filter } from 'lucide-react';
import { cn } from '@roadiehq/ui/utils';
import { Button } from '@roadiehq/ui/button';
import { StepConfigPanel, StepFilterPanel } from './step-config-panel';
import { RemoveLookupButton } from './step-preview-cards';
import { RunPreviewButton } from './run-preview-button';
import {
  StepCogButton,
  StepColumnShell,
  type StepPillTone,
} from './step-column-shell';
import type { StageRole } from './relationship-stages';
import type { SchemaField } from './schema-field-utils';
import type { RelationshipRuleEditorState } from './use-relationship-rule-editor';
import type { StepPreviewData } from './use-step-preview-data';

/**
 * One object column (Source / Lookup / Target) in the preview pipeline. Its
 * header carries a status pill and a cogwheel that flips the column in place
 * between its object preview and its configuration; Source/Target also get a
 * filter toggle, and the Lookup its run/remove controls. The preview card the
 * column shows when neither panel is open is injected via `previewCard`.
 */
export function StepColumn({
  role,
  label,
  editor,
  preview,
  sourceFields,
  targetFields,
  isConfig,
  isFilter,
  onToggleConfig,
  onToggleFilter,
  onRemoveLookup,
  previewCard,
}: {
  role: StageRole;
  label: string;
  editor: RelationshipRuleEditorState;
  preview: StepPreviewData;
  sourceFields: SchemaField[];
  targetFields: SchemaField[];
  isConfig: boolean;
  isFilter: boolean;
  onToggleConfig: (role: StageRole) => void;
  onToggleFilter: (role: StageRole) => void;
  onRemoveLookup: () => void;
  previewCard: React.ReactNode;
}) {
  const panelOpen = isConfig || isFilter;
  // Cogwheel dot: Source/Target show a MUTED dot when the field uses an advanced
  // expression the preview can't show; the Lookup shows a WARNING dot when its
  // config is incomplete or erroring (else a muted dot if its response match is
  // an advanced expression).
  const advancedDot = {
    className: 'bg-muted-foreground',
    label: 'Advanced expression configured',
  };
  const cogDot: { className: string; label: string } | null =
    role === 'lookup'
      ? preview.lookupConfigIncomplete
        ? {
            className: preview.lookupErroring ? 'bg-destructive' : 'bg-warning',
            label: preview.lookupErroring ? 'Request failed' : 'Setup required',
          }
        : preview.responseAdvanced
          ? advancedDot
          : null
      : (role === 'source' ? preview.sourceAdvanced : preview.targetAdvanced)
        ? advancedDot
        : null;
  // Header status pill: guides the user to complete the stage (warning), flags a
  // failed request (error), or confirms a successful lookup (success).
  const headerPill: { label: string; tone: StepPillTone } | null =
    role === 'source' && !editor.sourceFieldExpression.trim()
      ? { label: 'Pick a source property', tone: 'warning' }
      : role === 'match' && !editor.targetFieldExpression.trim()
        ? { label: 'Pick a target property', tone: 'warning' }
        : role === 'lookup'
          ? preview.lookupErroring
            ? { label: 'Request failed', tone: 'error' }
            : !preview.lookupRequestConfigured
              ? { label: 'Setup required', tone: 'warning' }
              : preview.responseSample != null
                ? { label: 'Request OK', tone: 'success' }
                : null
          : null;
  // Only Source and Target objects can carry a filter; the Lookup can't.
  const canFilter = role === 'source' || role === 'match';
  const panelLabel = isFilter
    ? `${label} — Filter`
    : isConfig
      ? `${label} — Configuration`
      : label;
  // The Lookup config is form-heavy (integration, path, tabs), so when it's open
  // it grows wider than the object-preview columns to be easy to work in.
  // Source/Target keep a constant footprint (config vs preview must not resize
  // them).
  const wideConfig = role === 'lookup' && isConfig;

  const actions = (
    <>
      {/* The lookup's run control rides this header (not just the Materialized
          section) so it stays reachable while the Lookup column shows its CONFIG
          panel — the empty-state card's run button is hidden then, so this is the
          only run affordance while you're building the request. */}
      {role === 'lookup' && (
        <>
          <RunPreviewButton editor={editor} />
          <RemoveLookupButton editor={editor} onRemoved={onRemoveLookup} />
        </>
      )}
      {canFilter && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-pressed={isFilter}
          aria-label={
            isFilter
              ? `Show ${label.toLowerCase()} preview`
              : `Filter ${label.toLowerCase()}`
          }
          title={
            isFilter
              ? `Show ${label.toLowerCase()} preview`
              : `Filter ${label.toLowerCase()}`
          }
          className={cn(
            'size-6 shrink-0 [&_svg]:size-3.5',
            isFilter
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
          onClick={() => onToggleFilter(role)}
        >
          <Filter />
        </Button>
      )}
      <StepCogButton
        active={isConfig}
        activeLabel={`Show ${label.toLowerCase()} preview`}
        inactiveLabel={`Configure ${label.toLowerCase()}`}
        dot={cogDot}
        onClick={() => onToggleConfig(role)}
      />
    </>
  );

  return (
    <StepColumnShell
      label={panelLabel}
      pill={headerPill}
      panelOpen={panelOpen}
      actions={actions}
      className={wideConfig ? 'min-w-[22rem] flex-[2]' : 'min-w-[13rem] flex-1'}
      panel={
        isFilter ? (
          <StepFilterPanel role={role} editor={editor} />
        ) : (
          <StepConfigPanel
            role={role}
            editor={editor}
            preview={preview}
            sourceFields={sourceFields}
            targetFields={targetFields}
          />
        )
      }
      preview={previewCard}
    />
  );
}
