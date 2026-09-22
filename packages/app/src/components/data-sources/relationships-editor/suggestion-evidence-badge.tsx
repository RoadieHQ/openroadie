import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@roadiehq/ui/tooltip';
import { Button } from '@roadiehq/ui/button';
import { cn } from '@roadiehq/ui/utils';
import type {
  RelationshipRule,
  RelationshipSuggestionEvidenceSummary,
  RelationshipSuggestionFieldStats,
  RelationshipSuggestionGateEvidence,
  RelationshipSuggestionWaterfallEntry,
} from '../../../api/datastore/datastore-client';
import { getConfidenceClassesForBand } from './suggested-rules-utils';

type RescueEvidence = NonNullable<
  RelationshipSuggestionEvidenceSummary['rescue']
>;

function statsText(stats: RelationshipSuggestionFieldStats): string {
  const traits = [
    stats.isIdentifierLike ? 'identifier-like' : null,
    stats.looksEnumLike ? 'enum-like' : null,
  ]
    .filter(Boolean)
    .join(', ');
  return `${stats.distinctCount} distinct · ${Math.round(
    stats.rowCoverage * 100,
  )}% coverage · cardinality ${stats.cardinalityRatio.toFixed(2)}${
    traits ? ` · ${traits}` : ''
  }`;
}

function EvidenceRow({ label, children }: { label: string; children: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 font-mono break-words">{children}</span>
    </div>
  );
}

// Fired: marker follows the weight's sign. Not fired: '·' regardless of sign
// — the entry still ran, it just didn't contribute in either direction.
function waterfallMarker(entry: RelationshipSuggestionWaterfallEntry): string {
  if (!entry.fired) return '·';
  return entry.weight >= 0 ? '+' : '−';
}

function signedWeight(weight: number): string {
  return weight > 0 ? `+${weight.toFixed(3)}` : weight.toFixed(3);
}

function WaterfallList({
  entries,
}: {
  entries: RelationshipSuggestionWaterfallEntry[];
}) {
  return (
    <div className="flex gap-2">
      <span className="w-24 shrink-0 text-muted-foreground">Waterfall</span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 font-mono">
        {entries.map(entry => (
          <div
            key={entry.signal}
            className="flex flex-wrap items-baseline gap-x-2"
          >
            <span aria-hidden className="w-3 shrink-0 text-center">
              {waterfallMarker(entry)}
            </span>
            <span className="min-w-0 flex-1 truncate">{entry.signal}</span>
            <span className="shrink-0 tabular-nums">
              {signedWeight(entry.weight)}
            </span>
            {entry.detail && (
              <span className="w-full pl-5 text-muted-foreground">
                {entry.detail}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Only the fields the gate that ran actually measured are present — render
// exactly those, in no particular clamp or percent form (containment can
// legitimately exceed 1).
function gateText(gate: RelationshipSuggestionGateEvidence): string {
  const parts: string[] = [];
  if (gate.containment != null) {
    parts.push(
      `containment ${gate.containment.toFixed(2)}${
        gate.containmentVerified ? ' (verified against full table)' : ''
      }`,
    );
  } else if (gate.containmentVerified) {
    parts.push('verified against full table');
  }
  if (gate.containmentDirection) {
    parts.push(gate.containmentDirection);
  }
  if (gate.referencedCardinalityRatio != null) {
    parts.push(
      `referenced cardinality ${gate.referencedCardinalityRatio.toFixed(2)}`,
    );
  }
  return parts.join(' · ');
}

function rescueText(rescue: RescueEvidence): string {
  const original = rescue.originalField ? ` (was ${rescue.originalField})` : '';
  return `${rescue.kind}: ${rescue.detail}${original}`;
}

/**
 * The suggester's evidence as a single score badge with the detail on hover.
 * It reads as scoring metadata about the rule rather than part of the rule, so
 * it sits at the head of the step-map — one line instead of the nine-row block
 * that used to push the pipeline and its preview below the fold.
 */
export function SuggestionEvidenceBadge({ rule }: { rule: RelationshipRule }) {
  const evidence = rule.evidenceSummary;
  if (!evidence && !rule.reviewReason && rule.score == null) {
    return null;
  }

  const band = rule.confidenceBand ?? 'low';
  const scoreText =
    typeof rule.score === 'number' ? rule.score.toFixed(2) : null;
  const semantics =
    [evidence?.sourceFieldSemantic, evidence?.targetFieldSemantic]
      .filter(Boolean)
      .map(String)
      .join(' → ') || null;
  // Stage 3 made commonValuePenalty always <= 0, so the warning now derives
  // from the waterfall directly: common values are the case where the
  // rarity signal ran and did NOT fire, and it counted against the rule.
  const rarityEntry = evidence?.waterfall?.find(
    entry => entry.signal === 'value-rarity',
  );
  const elevatedCommonValues = Boolean(
    rarityEntry && !rarityEntry.fired && rarityEntry.weight < 0,
  );
  const gateSummary = evidence?.gate ? gateText(evidence.gate) : null;

  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            // A button, not a span: the evidence lives only in the tooltip, so
            // the trigger has to be reachable and openable from the keyboard.
            type="button"
            variant="ghost"
            className={cn(
              'h-auto shrink-0 cursor-help items-center gap-1 self-center rounded border px-1.5 py-0.5 text-2xs font-semibold tracking-wide uppercase',
              getConfidenceClassesForBand(band),
            )}
            aria-label={`Suggestion confidence ${band}${
              scoreText ? `, score ${scoreText}` : ''
            }`}
          >
            {scoreText ? (
              <>
                {/* De-emphasized by weight only — an opacity on 10px text
                    drops the band color below the 4.5:1 contrast minimum
                    (axe color-contrast, dark theme). */}
                <span className="font-normal">Score</span>
                <span className="font-mono normal-case">{scoreText}</span>
              </>
            ) : (
              band
            )}
            {elevatedCommonValues && (
              <span aria-hidden className="text-warning">
                ⚠
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="start"
          className="max-w-md text-2xs"
        >
          <div className="flex flex-col gap-1">
            <p className="font-semibold">
              Why this was suggested
              {scoreText ? ` — score ${scoreText} (${band})` : ` — ${band}`}
            </p>
            {evidence?.explanation && (
              <p className="text-muted-foreground">{evidence.explanation}</p>
            )}
            {rule.reviewReason && (
              <EvidenceRow label="Review reason">
                {rule.reviewReason}
              </EvidenceRow>
            )}
            {evidence && (
              <EvidenceRow label="Matches">
                {`${evidence.distinctMatchedValueCount} distinct matched value${
                  evidence.distinctMatchedValueCount === 1 ? '' : 's'
                }`}
              </EvidenceRow>
            )}
            {evidence?.valueTypes?.length ? (
              <EvidenceRow label="Value types">
                {evidence.valueTypes.join(', ')}
              </EvidenceRow>
            ) : null}
            {evidence?.sourceFieldStats && (
              <EvidenceRow label="Source field">
                {statsText(evidence.sourceFieldStats)}
              </EvidenceRow>
            )}
            {evidence?.targetFieldStats && (
              <EvidenceRow label="Target field">
                {statsText(evidence.targetFieldStats)}
              </EvidenceRow>
            )}
            {evidence?.semanticCompatibility && (
              <EvidenceRow label="Semantics">
                {`${semantics ?? '—'} (${String(
                  evidence.semanticCompatibility,
                )})`}
              </EvidenceRow>
            )}
            {evidence?.topMatchedValues?.length ? (
              <EvidenceRow label="Examples">
                {evidence.topMatchedValues.join(', ')}
              </EvidenceRow>
            ) : null}
            {evidence?.waterfall?.length ? (
              <WaterfallList entries={evidence.waterfall} />
            ) : null}
            {gateSummary && (
              <EvidenceRow label="Gate">{gateSummary}</EvidenceRow>
            )}
            {evidence?.rescue && (
              <EvidenceRow label="Rescue">
                {rescueText(evidence.rescue)}
              </EvidenceRow>
            )}
            {elevatedCommonValues && (
              <p className="text-warning">
                Elevated common values — matched values are common across rows,
                so this rule is more likely to be noise.
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
