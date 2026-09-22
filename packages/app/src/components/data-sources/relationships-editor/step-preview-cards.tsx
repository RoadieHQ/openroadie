import { AlertTriangle, Link2, Trash2 } from 'lucide-react';
import { cn } from '@roadiehq/ui/utils';
import { Button } from '@roadiehq/ui/button';
import type { RelationshipRuleMatchStrategy } from '../../../api/datastore/datastore-client';
import { ChainCard, MatchStepper, PreviewState } from './step-chain-card';
import { ObjectPropertyTree } from './object-property-tree';
import { SampleObjectControls } from './sample-object-controls';
import { RunPreviewButton } from './run-preview-button';
import { removeLookupStage } from './relationship-stages';
import {
  MATCH_STRATEGIES,
  ruleSummaryPhraseForMatchStrategy,
} from './inspector-shared';
import type { RelationshipRuleEditorState } from './use-relationship-rule-editor';
import type { StepPreviewData } from './use-step-preview-data';

const matchStrategyLabel = (strategy: RelationshipRuleMatchStrategy): string =>
  MATCH_STRATEGIES.find(s => s.value === strategy)?.label ?? strategy;

/** A joined value as a monospace token; the value both sides matched on. */
function MatchValueToken({
  value,
  muted = false,
}: {
  value: string;
  muted?: boolean;
}) {
  return (
    <span
      className={cn(
        'max-w-full truncate rounded bg-muted px-1.5 py-0.5 font-mono text-2xs',
        muted ? 'text-muted-foreground' : 'text-foreground',
      )}
      title={value}
    >
      {value}
    </span>
  );
}

/** Removes the lookup stage (flips back to field-matching) and closes its
 * config panel. Shared by the step map and the Lookup column header. */
export function RemoveLookupButton({
  editor,
  onRemoved,
}: {
  editor: RelationshipRuleEditorState;
  onRemoved: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-6 shrink-0 text-muted-foreground hover:text-destructive [&_svg]:size-3.5"
      aria-label="Remove lookup step"
      onClick={() => {
        removeLookupStage(editor);
        onRemoved();
      }}
    >
      <Trash2 />
    </Button>
  );
}

export function SourceCard({
  editor,
  preview,
}: {
  editor: RelationshipRuleEditorState;
  preview: StepPreviewData;
}) {
  const sampleControls = (
    <SampleObjectControls
      datasourceId={editor.sourceDatasourceId}
      filter={preview.sampleFilter}
      onFilterChange={preview.selectSampleFilter}
      counts={preview.counts}
      position={preview.candidatePosition}
      total={preview.candidateTotal}
      onPrev={() => preview.stepSample(-1)}
      onNext={() => preview.stepSample(1)}
      pinnedId={preview.pinnedSourceId}
      onPin={preview.selectSourceObject}
      onClearPin={() => preview.selectSourceObject(null)}
      pendingEvaluationLabel={preview.pendingEvaluationLabel}
      fieldEmpty={preview.sampleFieldEmpty}
      fieldLabel={preview.sourceFieldLeaf}
    />
  );
  return (
    <ChainCard header={sampleControls}>
      <PreviewState
        loading={preview.sourceSample.loading}
        error={preview.sourceSample.error}
        emptyText={
          preview.sourceSample.object
            ? undefined
            : 'No objects in this data source.'
        }
      >
        <ObjectPropertyTree
          value={preview.sourceSample.object}
          highlightPath={preview.sourceHighlightPath}
          advanced={preview.sourceAdvanced}
          onPick={editor.setSourceFieldExpression}
        />
      </PreviewState>
    </ChainCard>
  );
}

export function TargetCard({
  editor,
  preview,
}: {
  editor: RelationshipRuleEditorState;
  preview: StepPreviewData;
}) {
  // When the selected source matched several targets, page through them here —
  // otherwise the target column silently shows only the first match.
  const header =
    preview.targetMatchCount > 1 ? (
      <MatchStepper
        label="Matched target"
        position={preview.targetPosition}
        total={preview.targetMatchCount}
        onPrev={() => preview.stepTarget(-1)}
        onNext={() => preview.stepTarget(1)}
      />
    ) : preview.targetShowingExample ? (
      <span className="text-2xs font-medium text-muted-foreground">
        {preview.sourceEvaluationState === 'needs-preview'
          ? 'Target example · source not evaluated'
          : 'Target example'}
      </span>
    ) : undefined;
  return (
    <ChainCard header={header}>
      <PreviewState
        loading={preview.targetSample.loading}
        error={preview.targetSample.error}
        emptyText={preview.targetEmptyText}
      >
        <ObjectPropertyTree
          value={preview.targetSample.object}
          highlightPath={preview.targetHighlightPath}
          advanced={preview.targetAdvanced}
          onPick={editor.setTargetFieldExpression}
        />
      </PreviewState>
    </ChainCard>
  );
}

/**
 * The lookup preview mirrors the source/target object cards: just the sampled
 * integration response, with the value the match expression selects highlighted
 * in-tree. The request path and match expression live in the config beside it,
 * so they're not repeated here. Before a preview has fetched a response, the run
 * control sits centered with the prompt.
 */
export function LookupCard({
  editor,
  preview,
}: {
  editor: RelationshipRuleEditorState;
  preview: StepPreviewData;
}) {
  const response = preview.responseSample;
  return (
    <ChainCard>
      {preview.lookupLoading ? (
        <PreviewState loading />
      ) : preview.lookupErroring ? (
        // Surface the real failure — HTTP status + the message the integration
        // returned (a 404 body, an auth error, etc.) plus the request it made —
        // so the author can tell what actually went wrong, not just "failed".
        <div className="flex h-full min-h-0 flex-col gap-2 overflow-auto text-2xs">
          <div className="flex items-center gap-1.5 font-medium text-destructive">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span>
              Request failed
              {preview.lookupRequestError?.status != null
                ? ` · HTTP ${preview.lookupRequestError.status}`
                : ''}
            </span>
          </div>
          {preview.resolvedLookupPath && (
            <div className="font-mono break-all text-muted-foreground">
              {preview.lookupMethod} {preview.resolvedLookupPath}
            </div>
          )}
          <p className="break-words whitespace-pre-wrap text-destructive/90">
            {preview.lookupRequestError?.message ??
              'The lookup request failed.'}
          </p>
        </div>
      ) : response != null ? (
        // Keep the fetched response on screen while you pick/edit the match —
        // it only re-fetches when the request itself changes, not the match.
        <ObjectPropertyTree
          value={response}
          highlightPath={preview.responseMatchPath}
          advanced={preview.responseAdvanced}
          onPick={preview.pickResponseMatch}
        />
      ) : !preview.responseSampleArmed ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <RunPreviewButton editor={editor} />
          <p className="text-2xs text-muted-foreground">
            Run to fetch a sample response, then pick a field from it.
          </p>
        </div>
      ) : (
        <PreviewState
          emptyText={preview.lookupUnavailableReason ?? 'No response.'}
        />
      )}
    </ChainCard>
  );
}

/**
 * The join indicator between the last object column and the target: how the two
 * sides connect (the match strategy) and the concrete value they joined on for
 * the current sample. An integration lookup always joins by exact equality, so
 * it shows "Equality" rather than a configurable strategy. Non-exact strategies
 * compare distinct source/target values, so both are shown with the strategy's
 * phrase between them; exact/equality carry the same value, shown once.
 */
export function MatchConnector({
  editor,
  preview,
}: {
  editor: RelationshipRuleEditorState;
  preview: StepPreviewData;
}) {
  const isIntegration = editor.isIntegrationBacked;
  const label = isIntegration
    ? 'Equality'
    : matchStrategyLabel(editor.matchStrategy);
  const sourceValue = preview.sourceMatchValue;
  const targetValue = preview.targetMatchValue;
  const showBothSides =
    !isIntegration &&
    editor.matchStrategy !== 'exact' &&
    !!sourceValue &&
    sourceValue !== targetValue;
  const singleValue = targetValue ?? sourceValue;

  return (
    <div className="relative flex h-full min-w-0 flex-col items-center justify-center gap-2 px-1 text-center">
      {/* A wire across the track ties the two flanking object columns together,
          so the join reads as a link rather than a floating label. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-border to-transparent"
      />

      <span className="relative max-w-full truncate rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>

      <div className="relative flex max-w-full min-w-0 flex-col items-center gap-1 rounded-md border border-border bg-card px-2 py-1.5">
        {showBothSides ? (
          <>
            <MatchValueToken value={sourceValue} />
            <span className="text-[10px] text-muted-foreground">
              {ruleSummaryPhraseForMatchStrategy(editor.matchStrategy)}
            </span>
            <MatchValueToken value={targetValue ?? ''} muted />
          </>
        ) : singleValue ? (
          <div className="flex max-w-full min-w-0 items-center gap-1.5">
            <Link2 className="size-3 shrink-0 text-muted-foreground" />
            <MatchValueToken value={singleValue} />
          </div>
        ) : (
          <span className="text-[10px] text-muted-foreground/60">
            {preview.matchEmptyText}
          </span>
        )}
      </div>
    </div>
  );
}
