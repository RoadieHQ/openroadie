import { useMemo } from 'react';
import { Play } from 'lucide-react';
import { cn } from '@roadiehq/ui/utils';
import { Button } from '@roadiehq/ui/button';
import { Spinner } from '@roadiehq/ui/spinner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@roadiehq/ui/select';
import { FieldHint } from '@roadiehq/ui/field-hint';
import { RuleSection } from './relationship-rule-form';
import { RunPreviewButton } from './run-preview-button';
import {
  countPreviewRelationshipRows,
  MatchedRelationships,
  ResultSummary,
} from './relationship-rule-preview';
import { useDirectTargetLabels } from './direct-relationship-controls';
import type { RelationshipRuleEditorState } from './use-relationship-rule-editor';

/**
 * The live preview for the stepped editor. It drives the SAME preview state as
 * the step list (`editor.previewResult` etc.), so stage colouring stays in sync
 * with no extra plumbing: field-matching auto-runs via the hook's query;
 * integration-backed is button-run via `editor.handleIntegrationPreview`.
 */
export function RelationshipPlayground({
  editor,
  sourceLabel,
  targetLabel,
  hasPreview,
  exampleSourceObjectId,
  title = 'Generated Relationships',
}: {
  editor: RelationshipRuleEditorState;
  sourceLabel: string;
  targetLabel: string;
  hasPreview: boolean;
  /** Highlights the wizard's example source row in the preview list. */
  exampleSourceObjectId?: string;
  /** Section heading. Pass '' to drop it when the caller already labels the
   * section (e.g. a tab trigger). */
  title?: string;
}) {
  // The direct-relationship layer: manual edges between the pair sharing the
  // rule's type, buffered on `editor.direct` and flushed on save. Lets unmatched
  // preview rows be resolved by hand (a "Link" action) and shows/removes direct
  // links alongside rule matches.
  const direct = editor.direct;
  const directEnabled =
    !!editor.relationshipType.trim() &&
    !!editor.sourceDatasourceId &&
    !!editor.targetDatasourceId;
  // Only sampled sources' direct edges render, so only their targets need a
  // resolved label.
  const directTargetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of editor.previewResult?.items ?? []) {
      for (const draft of direct.directBySourceObjectId.get(
        item.sourceObjectId,
      ) ?? []) {
        ids.add(draft.targetObjectId);
      }
    }
    return [...ids];
  }, [editor.previewResult, direct.directBySourceObjectId]);
  const directTargetLabels = useDirectTargetLabels(
    editor.targetDatasourceId,
    directTargetIds,
  );

  // Counts merged with the direct layer — a source resolved by a direct link
  // no longer counts as unmatched.
  const filterCounts = useMemo(
    () =>
      countPreviewRelationshipRows(
        editor.previewResult?.items,
        direct.directBySourceObjectId,
      ),
    [editor.previewResult, direct.directBySourceObjectId],
  );

  // The filter only earns its keep when the sample actually contains rows
  // beyond plain matches — otherwise "All" and "Matched" are the same set, so
  // we collapse to a single "Matched" count.
  const hasExtraRows = filterCounts.unmatched > 0 || filterCounts.direct > 0;
  const filterOptions = hasExtraRows
    ? ([
        ['all', 'All', filterCounts.all] as const,
        ['matched', 'Matched', filterCounts.matched] as const,
        ...(filterCounts.direct > 0
          ? [['direct', 'Direct relationships', filterCounts.direct] as const]
          : []),
        ...(filterCounts.unmatched > 0
          ? [['unmatched', 'No match', filterCounts.unmatched] as const]
          : []),
      ] as const)
    : ([['matched', 'Matched', filterCounts.matched] as const] as const);
  // Coerce to a visible option: while collapsed (or when the selected
  // category emptied out) the stored filter may not be rendered, which would
  // leave no selected control — or hide every row.
  const activeFilter = filterOptions.some(
    ([value]) => value === editor.relationshipFilter,
  )
    ? editor.relationshipFilter
    : 'matched';
  const filterButtons = filterOptions.map(([value, label, count]) => (
    <Button
      key={value}
      type="button"
      variant={activeFilter === value ? 'default' : 'outline'}
      size="sm"
      className="h-6 gap-1 px-2 text-2xs"
      onClick={() => editor.setRelationshipFilter(value)}
      aria-pressed={activeFilter === value}
      title={
        value === 'direct'
          ? 'Direct relationships — created by hand between these data sources, not materialized by this rule'
          : undefined
      }
    >
      {label}
      <span
        className={cn(
          'rounded px-1 font-mono text-[10px]',
          activeFilter === value
            ? 'bg-primary-foreground/20'
            : 'bg-muted text-muted-foreground',
        )}
      >
        {count}
      </span>
    </Button>
  ));

  // Integration-backed rules resolve matches through a live lookup, so nothing
  // materializes until a preview is run — mirror the Lookup step's empty state
  // (a centered run control + prompt) rather than an empty box.
  // Until a response field is set there's nothing to match on, so the run only
  // fetches the response (to pick a field from); the prompt says so.
  const needsResponseField =
    editor.isIntegrationBacked &&
    !editor.integrationConfig?.responseMatchExpression?.trim();
  const previewPrompt = editor.isIntegrationBacked ? (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 px-3 text-xs"
        disabled={!editor.canRunPreview || editor.previewLoading}
        onClick={editor.handleIntegrationPreview}
      >
        {editor.previewLoading ? (
          <Spinner className="size-3" />
        ) : (
          <Play className="size-3" />
        )}
        Run preview
      </Button>
      <p className="max-w-xs text-2xs text-muted-foreground">
        {needsResponseField
          ? 'Run to fetch a sample response, then pick a Response field in the Lookup step to match on.'
          : 'This rule resolves matches through a live lookup. Run the preview to see the relationships it generates.'}
      </p>
    </>
  ) : undefined;

  // The sample-size select + run/refresh button sit on the LEFT next to the
  // title; the summary pills + filter sit on the right. The row has a fixed
  // min height so preview loading states can't resize the header and shove the
  // table below it (which read as a flicker).
  const sampleSizeSelect = editor.isIntegrationBacked ? (
    <>
      <FieldHint ariaLabel="Sample size help">
        How many {sourceLabel} to sample for this preview. Each one makes a live
        lookup call, so a larger sample is slower.
      </FieldHint>
      <Select
        value={String(editor.integrationSampleLimit)}
        onValueChange={value => editor.setIntegrationSampleLimit(Number(value))}
      >
        <SelectTrigger
          aria-label="Preview sample size"
          className="h-6 w-24 text-2xs"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[5, 10, 25, 50].map(value => (
            <SelectItem key={value} value={String(value)}>
              {value} samples
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  ) : null;

  return (
    <RuleSection className="min-h-0 flex-1">
      <div className="flex h-full min-h-0 flex-col gap-2">
        {/* Title (left) · metrics + filter (centered) · sample size + run
            control (far right). */}
        <div className="flex min-h-6 shrink-0 items-center gap-2">
          {title && (
            <div className="shrink-0 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {title}
            </div>
          )}
          {hasPreview && (
            <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5">
              <ResultSummary
                hasInputs={editor.canRunPreview}
                loading={editor.previewLoading}
                stale={editor.previewStale}
                result={editor.previewResult}
                sourceLabel={sourceLabel}
              />
              {editor.previewResult && (
                <div className="flex items-center gap-1">{filterButtons}</div>
              )}
            </div>
          )}
          {hasPreview && editor.isIntegrationBacked && (
            <div className="flex shrink-0 items-center gap-1.5">
              {editor.previewStale &&
                editor.previewLoading &&
                editor.previewResult && (
                  <Spinner
                    className="size-3 shrink-0 text-muted-foreground"
                    aria-label="Updating preview"
                  />
                )}
              {sampleSizeSelect}
              {/* Single persistent re-run control. Before the first run the
                  centered empty-state button (below) is the sole affordance, so
                  this only appears once a result exists. */}
              {editor.previewResult && <RunPreviewButton editor={editor} />}
            </div>
          )}
        </div>
        {hasPreview ? (
          <>
            <div className="min-h-0 flex-1">
              <MatchedRelationships
                hasInputs={editor.canRunPreview}
                loading={editor.previewLoading}
                stale={editor.previewStale}
                error={editor.previewError}
                result={editor.previewResult}
                sourceLabel={sourceLabel}
                targetLabel={targetLabel}
                sourceFieldExpression={editor.sourceFieldExpression}
                targetFieldExpression={editor.targetFieldExpression}
                filter={activeFilter}
                exampleSourceObjectId={exampleSourceObjectId}
                emptyPreviewPrompt={previewPrompt}
                directBySourceObjectId={direct.directBySourceObjectId}
                directControls={
                  directEnabled
                    ? {
                        targetDatasourceId: editor.targetDatasourceId,
                        targetLabels: directTargetLabels,
                        onLink: direct.addDirect,
                        onRemove: direct.markRemoval,
                        onUndo: direct.undoDirect,
                        mutating: direct.flushing || direct.loading,
                      }
                    : undefined
                }
              />
            </div>
            {/* Truncation / failed-source notices sit below the table. */}
            {editor.isIntegrationBacked && editor.previewResult?.truncated && (
              <div className="shrink-0 text-xs text-warning">
                {editor.previewResult.callLimitReached
                  ? 'Preview stopped at the live lookup call limit.'
                  : 'Preview sample was truncated. Increase the sample size to inspect more sources.'}
              </div>
            )}
            {editor.isIntegrationBacked &&
              (editor.previewResult?.skippedSources?.length ?? 0) > 0 && (
                <div className="shrink-0 text-xs text-destructive">
                  {editor.previewResult?.skippedSources?.length} source calls
                  failed during preview.
                </div>
              )}
          </>
        ) : (
          <div className="py-2 text-center text-xs text-muted-foreground">
            Preview is not available for this rule.
          </div>
        )}
      </div>
    </RuleSection>
  );
}
