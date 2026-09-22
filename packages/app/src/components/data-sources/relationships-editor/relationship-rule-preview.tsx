import { useMemo, type ReactNode } from 'react';
import { cn } from '@roadiehq/ui/utils';
import { Spinner } from '@roadiehq/ui/spinner';
import type {
  RelationshipRulePreviewItem,
  RelationshipRulePreviewResult,
} from '../../../api/datastore/datastore-client';
import { formatPreviewValue } from './inspector-shared';
import { formatErrorString } from '../../../api/workflow/parse-execution-error';
import {
  DirectRelationshipRowActions,
  type DirectRelationshipRowControls,
} from './direct-relationship-controls';
import type { DirectEdgeDraft } from './use-direct-relationships';

interface PreviewRelationshipRow {
  key: string;
  sourceObjectId: string;
  targetObjectId: string | null;
  sourceValue: string | undefined;
  targetValue: string | undefined;
  targetObjectLabel: string | null;
  matched: boolean;
  /** Set when this row is a direct (manually created) edge, not a rule match. */
  directKey?: string;
  directStatus?: DirectEdgeDraft['status'];
}

export type RelationshipPreviewFilter =
  | 'all'
  | 'matched'
  | 'direct'
  | 'unmatched';

export function buildPreviewRelationshipRows(
  items: RelationshipRulePreviewItem[],
  directBySourceObjectId?: Map<string, DirectEdgeDraft[]>,
): PreviewRelationshipRow[] {
  return items.flatMap<PreviewRelationshipRow>(item => {
    const sourceValue = item.sourceValue;
    const targetValue = item.targetValue;
    const matchedRows = item.targetObjectIds.map((targetObjectId, index) => {
      // The backend's object label falls back to the object id when the object
      // has no name/title, so a label that equals the id is really "no label".
      // Treat it as absent so render prefers the matched value over the bare id.
      const rawLabel = item.targetLabels?.at(index);
      return {
        key: `${item.sourceObjectId}|${targetObjectId}|${index}`,
        sourceObjectId: item.sourceObjectId,
        targetObjectId,
        sourceValue: item.matchSourceValues?.at(index) ?? item.sourceValue,
        targetValue: item.matchTargetValues?.at(index) ?? item.targetValue,
        targetObjectLabel:
          rawLabel && rawLabel !== targetObjectId ? rawLabel : null,
        matched: true,
      };
    });
    // A direct edge whose target the rule already matches adds nothing — the
    // pair is covered either way, so only render the rule row.
    const matchedTargets = new Set(item.targetObjectIds);
    const directRows = (directBySourceObjectId?.get(item.sourceObjectId) ?? [])
      .filter(draft => !matchedTargets.has(draft.targetObjectId))
      .map(draft => ({
        key: `${item.sourceObjectId}|direct|${draft.key}`,
        sourceObjectId: item.sourceObjectId,
        targetObjectId: draft.targetObjectId,
        sourceValue,
        targetValue: undefined,
        targetObjectLabel: null,
        matched: false,
        directKey: draft.key,
        directStatus: draft.status,
      }));
    if (matchedRows.length === 0 && directRows.length === 0) {
      return [
        {
          key: `${item.sourceObjectId}|none`,
          sourceObjectId: item.sourceObjectId,
          targetObjectId: null,
          sourceValue,
          targetValue,
          targetObjectLabel: null,
          matched: false,
        },
      ];
    }
    return [...matchedRows, ...directRows];
  });
}

export function countPreviewRelationshipRows(
  items: RelationshipRulePreviewItem[] | undefined,
  directBySourceObjectId?: Map<string, DirectEdgeDraft[]>,
) {
  const counts = { all: 0, matched: 0, direct: 0, unmatched: 0 };
  if (!items) return counts;
  for (const row of buildPreviewRelationshipRows(
    items,
    directBySourceObjectId,
  )) {
    counts.all += 1;
    if (row.matched) {
      counts.matched += 1;
    } else if (row.directStatus) {
      // Persisted, buffered-add and buffered-remove all count as direct rows —
      // the count matches what the "Direct" filter shows.
      counts.direct += 1;
    } else {
      counts.unmatched += 1;
    }
  }
  return counts;
}

interface ResultSummaryProps {
  result: RelationshipRulePreviewResult | null;
  loading: boolean;
  stale: boolean;
  hasInputs: boolean;
  sourceLabel: string;
}

function describeCardinality(
  items: RelationshipRulePreviewResult['items'],
): string | null {
  const matched = items.filter(i => i.targetObjectIds.length > 0);
  if (matched.length === 0) return null;
  const maxTargetsPerSource = matched.reduce(
    (n, i) => Math.max(n, i.targetObjectIds.length),
    0,
  );
  const targetIdCounts = new Map<string, number>();
  for (const i of matched) {
    for (const id of i.targetObjectIds) {
      targetIdCounts.set(id, (targetIdCounts.get(id) ?? 0) + 1);
    }
  }
  const targetReused = [...targetIdCounts.values()].some(c => c > 1);
  const sourceFanOut = maxTargetsPerSource > 1;
  if (sourceFanOut && targetReused) return 'many-to-many';
  if (sourceFanOut) return 'one-to-many';
  if (targetReused) return 'many-to-one';
  return 'one-to-one';
}

export function ResultSummary({
  result,
  loading,
  stale,
  hasInputs,
  sourceLabel,
}: ResultSummaryProps) {
  if (!hasInputs) return null;
  if (!result && loading) {
    // Compact inline indicator (same row height as the pills) so first-load
    // doesn't resize the header and shove the table below it.
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Spinner className="size-3" />
        Evaluating…
      </span>
    );
  }
  if (!result) return null;

  const matched = result.items.filter(i => i.targetObjectIds.length > 0).length;
  const cardinality = describeCardinality(result.items);
  const coverage =
    result.items.length > 0
      ? Math.round((matched / result.items.length) * 100)
      : 0;
  const previewText =
    result.total > result.items.length
      ? `${result.items.length}/${result.total} previewed`
      : `${result.items.length} previewed`;
  const coverageTitle = `${matched} of ${result.items.length} sampled ${sourceLabel} matched (${coverage}%)`;
  const cardinalityTitle = cardinality
    ? `Observed cardinality in sample: ${cardinality}`
    : 'No matched cardinality observed yet';

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-1.5 text-xs',
        stale && 'opacity-60',
      )}
      aria-live="polite"
    >
      <span
        title={coverageTitle}
        className="rounded border border-border bg-muted/30 px-1.5 py-0.5 text-muted-foreground"
      >
        {coverage}% matched
      </span>
      {cardinality && (
        <span
          title={cardinalityTitle}
          className="rounded border border-border bg-muted/30 px-1.5 py-0.5 text-muted-foreground"
        >
          {cardinality}
        </span>
      )}
      <span
        title={`Previewing ${result.items.length} of ${result.total} ${sourceLabel} records`}
        className="rounded border border-border bg-muted/30 px-1.5 py-0.5 text-muted-foreground"
      >
        {previewText}
      </span>
    </div>
  );
}

interface MatchedRelationshipsProps {
  hasInputs: boolean;
  loading: boolean;
  stale: boolean;
  error: unknown;
  result: RelationshipRulePreviewResult | null;
  sourceLabel: string;
  targetLabel: string;
  sourceFieldExpression: string;
  targetFieldExpression: string;
  filter: RelationshipPreviewFilter;
  exampleSourceObjectId?: string;
  /**
   * Prompt shown when the inputs are ready but no preview has run yet — the
   * integration-backed case, where matches must be fetched via a live lookup
   * rather than computed locally. Field-matching rules auto-run, so they never
   * pass this.
   */
  emptyPreviewPrompt?: ReactNode;
  /**
   * Enables the direct-relationship layer: unmatched rows get a "Link" action
   * that creates a manual edge, and existing manual edges between the pair
   * render as removable "direct" rows.
   */
  directControls?: DirectRelationshipRowControls;
  directBySourceObjectId?: Map<string, DirectEdgeDraft[]>;
}

export function MatchedRelationships({
  hasInputs,
  loading,
  stale,
  error,
  result,
  sourceLabel,
  targetLabel,
  sourceFieldExpression,
  targetFieldExpression,
  filter,
  exampleSourceObjectId,
  emptyPreviewPrompt,
  directControls,
  directBySourceObjectId,
}: MatchedRelationshipsProps) {
  const rows = useMemo(() => {
    if (!result) return [];
    // Matched rows first, then direct links, then unresolved sources.
    const rank = (row: PreviewRelationshipRow) =>
      row.matched ? 2 : row.directStatus ? 1 : 0;
    return buildPreviewRelationshipRows(result.items, directBySourceObjectId)
      .sort((a, b) => rank(b) - rank(a))
      .filter(row => {
        if (filter === 'matched') return row.matched;
        if (filter === 'direct') return !!row.directStatus;
        if (filter === 'unmatched') {
          return !row.matched && !row.directStatus;
        }
        return true;
      });
  }, [result, filter, directBySourceObjectId]);

  const showInitialSpinner = hasInputs && loading && !result;
  const showPreviewPrompt =
    hasInputs && !error && !result && !loading && !!emptyPreviewPrompt;
  const showResults = hasInputs && !error && result && rows.length > 0;
  const showEmpty =
    hasInputs && !error && result && result.total === 0 && !loading;
  const showFilteredEmpty =
    hasInputs && !error && result && result.total > 0 && rows.length === 0;
  const showPreviewError = hasInputs && error != null;
  const sourceField = sourceFieldExpression.trim();
  const targetField = targetFieldExpression.trim();

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      <div
        className={cn(
          'motion-opacity min-h-[14rem] flex-1 overflow-auto rounded-md border border-border bg-muted/30 p-1.5 text-xs',
          stale && 'opacity-60',
        )}
      >
        {/* Non-results states fill the card and center, so the empty, loading
            and error views occupy the same footprint as a populated table
            rather than collapsing to a short strip. */}
        {!hasInputs && (
          <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
            Fill both fields and a relationship type to preview matches.
          </div>
        )}
        {showPreviewPrompt && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            {emptyPreviewPrompt}
          </div>
        )}
        {showInitialSpinner && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <Spinner className="size-3" />
            <span>Evaluating…</span>
          </div>
        )}
        {showPreviewError && (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center text-destructive">
            <span>Preview failed</span>
            <span className="max-w-full text-2xs break-words whitespace-pre-wrap text-destructive/90">
              {formatErrorString(error)}
            </span>
          </div>
        )}
        {showEmpty && (
          <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
            No {sourceLabel} entities match this rule yet.
          </div>
        )}
        {showFilteredEmpty && (
          <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
            No{' '}
            {filter === 'matched'
              ? 'matched'
              : filter === 'direct'
                ? 'direct'
                : 'unmatched'}{' '}
            object relationships in this sample.
          </div>
        )}
        {showResults && (
          <ul className="flex flex-col gap-1">
            {rows.map(row => {
              // The join value (source/target field) is only populated for
              // field-matching rules; integration-backed rules resolve through
              // the integration, so fall back to the object identifier, which
              // is the human-meaningful thing to show (e.g. the repo full name
              // or the matched user).
              const sourceMain = row.sourceValue?.trim() || row.sourceObjectId;
              const directStatus = row.directStatus;
              const isDirect = !!directStatus;
              // Prefer a datasource label, then the matched join value (e.g.
              // the login), and only fall back to the raw object id when
              // neither exists — the id is unique but rarely human-meaningful.
              // Direct edges carry no join value; their label is resolved from
              // the target object itself.
              const targetMain = row.matched
                ? row.targetObjectLabel?.trim() ||
                  row.targetValue?.trim() ||
                  row.targetObjectId
                : isDirect && row.targetObjectId
                  ? (directControls?.targetLabels
                      .get(row.targetObjectId)
                      ?.trim() ?? row.targetObjectId)
                  : null;
              const title = [
                `Source object: ${row.sourceObjectId}`,
                row.targetObjectId
                  ? `Target object: ${row.targetObjectId}`
                  : null,
                `Source ${sourceField}: ${formatPreviewValue(row.sourceValue)}`,
                `Target ${targetField}: ${formatPreviewValue(row.targetValue)}`,
              ]
                .filter(Boolean)
                .join('\n');
              const isExample = row.sourceObjectId === exampleSourceObjectId;
              // The value the two sides joined on (e.g. the matched id). Shown
              // on the arrow whenever the target is displayed by a different
              // label (a name) — including exact matches, where it equals the
              // source value: that IS the point ("both sides share this id").
              const matchedValue = row.matched
                ? row.targetValue?.trim()
                : undefined;
              const showMatchedValue =
                !!matchedValue && matchedValue !== targetMain;
              // Label the join value with the field when both sides join on the
              // same field, so the row reads "matched on <field> = <value>".
              const joinFieldLabel =
                sourceField && sourceField === targetField
                  ? sourceField
                  : undefined;
              return (
                <li
                  key={row.key}
                  title={title}
                  className={cn(
                    'flex min-w-0 items-center gap-1.5 rounded border-l-2 border-border bg-card py-1 pr-2 pl-2 text-[11px] leading-5',
                    !row.matched &&
                      (directStatus === 'added'
                        ? 'border-dashed border-l-primary/70'
                        : directStatus === 'persisted'
                          ? 'border-l-primary/70'
                          : directStatus === 'removed'
                            ? 'border-dashed border-l-muted-foreground/40'
                            : 'border-l-warning/70'),
                    isExample && 'border-l-primary bg-primary/5',
                  )}
                >
                  <span className="flex min-w-0 flex-1 items-baseline gap-1">
                    <span className="shrink-0 text-muted-foreground">
                      {sourceLabel}:
                    </span>
                    <span className="min-w-0 truncate font-medium text-foreground">
                      {sourceMain}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                    {showMatchedValue && (
                      <span
                        className="rounded bg-muted px-1 font-mono text-[10px]"
                        title={
                          joinFieldLabel
                            ? `matched on ${joinFieldLabel}`
                            : 'matched value'
                        }
                      >
                        {joinFieldLabel
                          ? `${joinFieldLabel}: ${matchedValue}`
                          : matchedValue}
                      </span>
                    )}
                    →
                  </span>
                  <span className="flex min-w-0 flex-1 items-baseline gap-1">
                    <span className="shrink-0 text-muted-foreground">
                      {targetLabel}:
                    </span>
                    {targetMain ? (
                      <span
                        className={cn(
                          'min-w-0 truncate font-semibold text-foreground',
                          directStatus === 'removed' &&
                            'text-muted-foreground line-through',
                        )}
                      >
                        {targetMain}
                      </span>
                    ) : (
                      <span className="truncate text-muted-foreground">
                        no match
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded px-1.5 py-px text-[10px] font-medium',
                      row.matched
                        ? 'bg-success/10 text-success'
                        : directStatus === 'removed'
                          ? 'bg-destructive/10 text-destructive'
                          : isDirect
                            ? 'bg-primary/10 text-primary'
                            : 'bg-warning/10 text-warning',
                    )}
                  >
                    {row.matched
                      ? 'matched'
                      : directStatus === 'added'
                        ? 'pending'
                        : directStatus === 'persisted'
                          ? 'direct'
                          : directStatus === 'removed'
                            ? 'removing'
                            : 'no match'}
                  </span>
                  {isExample && (
                    <span className="shrink-0 rounded bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">
                      example
                    </span>
                  )}
                  {directControls && !row.matched && (
                    <DirectRelationshipRowActions
                      sourceObjectId={row.sourceObjectId}
                      sourceLabel={sourceMain}
                      directKey={row.directKey}
                      directStatus={row.directStatus}
                      controls={directControls}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
