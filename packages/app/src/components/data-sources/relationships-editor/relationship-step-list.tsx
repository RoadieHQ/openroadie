import { useId, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { motionTransitions } from '@roadiehq/ui/motion';
import type { SchemaField } from './schema-field-utils';
import type { StageRole } from './relationship-stages';
import type { RelationshipRuleEditorState } from './use-relationship-rule-editor';
import { useStepPanels } from './use-step-panels';
import { useStepPreviewData } from './use-step-preview-data';
import { StepMap } from './step-map';
import { StepColumn } from './step-column';
import { MatchColumn } from './match-column';
import { SourceCard, LookupCard, TargetCard } from './step-preview-cards';

/**
 * The stepped relationship pipeline: Source → optional Lookup → Match, laid out
 * as a step map above a live per-part preview — each stage's configuration
 * flipping in place with a real sampled object / lookup request. The Lookup
 * column is the integration config when the rule is integration-backed, else an
 * "add lookup step" affordance in the map (its presence IS the strategy toggle).
 * Fixed stages (Source, Match) can't be removed. (The aggregate materialized-
 * relationships table lives outside this component, in RelationshipStepEditor.)
 *
 * This component is the orchestrator: it wires the panel-visibility and
 * preview-data hooks to the map and the column components. Each column carries a
 * cogwheel that flips it between its object preview and its configuration — or
 * its filter (Source/Target) — and the connector column between the last object
 * and the target flips between the join summary and the match strategy.
 */
export function RelationshipStepList({
  editor,
  sourceLabel,
  targetLabel,
  sourceLogoUrl,
  targetLogoUrl,
  sourceFields,
  targetFields,
  leading,
}: {
  editor: RelationshipRuleEditorState;
  sourceLabel: string;
  targetLabel: string;
  sourceLogoUrl?: string;
  targetLogoUrl?: string;
  sourceFields: SchemaField[];
  targetFields: SchemaField[];
  leading?: ReactNode;
}) {
  const panels = useStepPanels(editor.isEdit);
  const preview = useStepPreviewData(editor);
  const prefersReducedMotion = useReducedMotion();
  const pipelineId = useId();

  // Fixed preview columns so every stage's cards — and their header labels —
  // line up in the same vertical tracks. Each stage fills a leading prefix;
  // trailing slots stay empty. The connector is a fixed, unlabelled track.
  const previewCols: { key: string; label: string | null }[] =
    editor.isIntegrationBacked
      ? [
          { key: 'source', label: 'Source' },
          { key: 'lookup', label: 'HTTP Lookup' },
          { key: 'connector', label: null },
          { key: 'target', label: 'Target' },
        ]
      : [
          { key: 'source', label: 'Source' },
          { key: 'connector', label: null },
          { key: 'target', label: 'Target' },
        ];

  const closeLookupConfig = () => panels.closeConfig('lookup');

  return (
    <div className="flex flex-col gap-4">
      <StepMap
        editor={editor}
        sourceLabel={sourceLabel}
        targetLabel={targetLabel}
        sourceLogoUrl={sourceLogoUrl}
        targetLogoUrl={targetLogoUrl}
        resolvedLookupPath={preview.resolvedLookupPath}
        configRoles={panels.configRoles}
        toggleConfig={panels.toggleConfig}
        openConfig={panels.openConfig}
        closeConfig={panels.closeConfig}
        expanded={panels.expanded}
        onToggleExpanded={() => panels.setExpanded(v => !v)}
        pipelineId={pipelineId}
        leading={leading}
      />
      <AnimatePresence initial={false}>
        {panels.expanded ? (
          <motion.div
            id={pipelineId}
            key="pipeline"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={
              prefersReducedMotion
                ? motionTransitions.instant
                : motionTransitions.sidebarDisclosure
            }
            className="overflow-hidden"
          >
            <div className="flex h-80 items-stretch gap-3 overflow-x-auto">
              {previewCols.map(col => {
                if (col.key === 'connector') {
                  return (
                    <MatchColumn
                      key="connector"
                      editor={editor}
                      preview={preview}
                      matchConfigOpen={panels.matchConfigOpen}
                      onToggleMatchConfig={() =>
                        panels.setMatchConfigOpen(v => !v)
                      }
                    />
                  );
                }
                const role: StageRole =
                  col.key === 'source'
                    ? 'source'
                    : col.key === 'lookup'
                      ? 'lookup'
                      : 'match';
                const previewCard =
                  col.key === 'source' ? (
                    <SourceCard editor={editor} preview={preview} />
                  ) : col.key === 'lookup' ? (
                    <LookupCard editor={editor} preview={preview} />
                  ) : (
                    <TargetCard editor={editor} preview={preview} />
                  );
                return (
                  <StepColumn
                    key={col.key}
                    role={role}
                    label={col.label ?? ''}
                    editor={editor}
                    preview={preview}
                    sourceFields={sourceFields}
                    targetFields={targetFields}
                    isConfig={panels.configRoles.has(role)}
                    isFilter={panels.filterRoles.has(role)}
                    onToggleConfig={panels.toggleConfig}
                    onToggleFilter={panels.toggleFilter}
                    onRemoveLookup={closeLookupConfig}
                    previewCard={previewCard}
                  />
                );
              })}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
