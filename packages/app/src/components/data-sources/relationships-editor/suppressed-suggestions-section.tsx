import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { cn } from '@roadiehq/ui/utils';
import type { FieldMatchSuggestion } from '../../../api/datastore/datastore-client';
import { getConfidenceClassesForBand, pluralS } from './suggested-rules-utils';

interface SuppressionGroup {
  reason: string;
  items: FieldMatchSuggestion[];
}

// Grouped by count desc, then reason alphabetically — the busiest gates lead,
// same convention as the pair pills in suggested-rules-panel.
function groupBySuppressionReason(
  suggestions: FieldMatchSuggestion[],
): SuppressionGroup[] {
  const byReason = new Map<string, FieldMatchSuggestion[]>();
  for (const suggestion of suggestions) {
    const reason = suggestion.suppressionReason ?? 'unknown';
    const existing = byReason.get(reason);
    if (existing) {
      existing.push(suggestion);
    } else {
      byReason.set(reason, [suggestion]);
    }
  }
  return [...byReason.entries()]
    .map(([reason, items]) => ({ reason, items }))
    .sort((a, b) => {
      if (a.items.length !== b.items.length) {
        return b.items.length - a.items.length;
      }
      return a.reason.localeCompare(b.reason);
    });
}

interface SuppressedSuggestionsSectionProps {
  /** Suppressed candidates from the most recent Generate run, flattened
   *  across datasources. Undefined/empty renders nothing — there is no
   *  durable "suppressed" list, only what the last run reported. */
  suppressedSuggestions?: FieldMatchSuggestion[];
  /** Datasource id → label, matching the panel's own map, so the target
   *  datasource reads as a name rather than a raw id. */
  datasourceLabels?: Map<string, string>;
}

/**
 * Candidates the generator gated out or ranked away this run — never
 * persisted as rules, so this is the only place to see why. Collapsed by
 * default and grouped by `suppressionReason`, mirroring `DismissedRulesSection`
 * below it. Ephemeral: it reflects only the last Generate call, and clears on
 * the next one (see `useRelationshipSuggestionActions`).
 */
export function SuppressedSuggestionsSection({
  suppressedSuggestions = [],
  datasourceLabels = new Map<string, string>(),
}: SuppressedSuggestionsSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [expandedReasons, setExpandedReasons] = useState<Set<string>>(
    new Set(),
  );

  if (suppressedSuggestions.length === 0) {
    return null;
  }

  const groups = groupBySuppressionReason(suppressedSuggestions);

  const toggleReason = (reason: string) => {
    setExpandedReasons(previous => {
      const next = new Set(previous);
      if (next.has(reason)) {
        next.delete(reason);
      } else {
        next.add(reason);
      }
      return next;
    });
  };

  return (
    <section className="space-y-2 border-t border-border pt-3">
      <Button
        type="button"
        variant="ghost"
        className="h-auto gap-2 p-0 text-xs font-medium text-muted-foreground hover:bg-transparent hover:text-foreground"
        onClick={() => setExpanded(e => !e)}
      >
        {expanded ? (
          <ChevronDown className="size-3" />
        ) : (
          <ChevronRight className="size-3" />
        )}
        Suppressed this run ({suppressedSuggestions.length} suggestion
        {pluralS(suppressedSuggestions.length)})
      </Button>
      {expanded && (
        <div className="space-y-2">
          <p className="text-2xs text-muted-foreground">
            From the last Generate run — not persisted, and replaced by the next
            run.
          </p>
          <ul className="space-y-1.5">
            {groups.map(group => {
              const isOpen = expandedReasons.has(group.reason);
              return (
                <li key={group.reason} className="space-y-1">
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto gap-2 p-0 text-2xs font-medium text-muted-foreground hover:bg-transparent hover:text-foreground"
                    onClick={() => toggleReason(group.reason)}
                  >
                    {isOpen ? (
                      <ChevronDown className="size-3" />
                    ) : (
                      <ChevronRight className="size-3" />
                    )}
                    {group.reason} ({group.items.length})
                  </Button>
                  {isOpen && (
                    <ul className="space-y-1 pl-4">
                      {group.items.map((item, index) => {
                        const rescueHint =
                          item.evidenceSummary.gate?.rescueHint;
                        const targetLabel =
                          datasourceLabels.get(item.targetDatasourceId) ??
                          item.targetDatasourceId;
                        // Gate-suppressed rows get a fixed
                        // `suppressed by gate: <reason>` explanation from the
                        // backend (field-match-builder.ts) that only restates
                        // the group header — skip exactly that string rather
                        // than hiding explanation text in general, so a
                        // score/resolve-suppressed row (the waterfall-derived
                        // top-3-signals text this section exists to surface)
                        // still renders it.
                        const isGateBoilerplate =
                          item.evidenceSummary.explanation ===
                          `suppressed by gate: ${item.suppressionReason}`;
                        const explanation =
                          !isGateBoilerplate && item.evidenceSummary.explanation
                            ? item.evidenceSummary.explanation
                            : null;
                        return (
                          <li
                            // Suppressed candidates carry no id — the pair of
                            // fields plus its position in the group is stable
                            // within a single render of one Generate run.
                            key={`${group.reason}-${item.sourceField}-${item.targetField}-${index}`}
                            className="flex flex-col gap-1 rounded border border-border/60 px-2 py-1.5 text-2xs"
                          >
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="min-w-0 flex-1 truncate font-mono text-foreground">
                                {item.sourceField} → {item.targetField}
                              </span>
                              <span className="shrink-0 text-muted-foreground">
                                {targetLabel}
                              </span>
                              {item.score > 0 && (
                                <span
                                  className={cn(
                                    'shrink-0 rounded border px-1.5 py-0.5 font-mono font-semibold',
                                    getConfidenceClassesForBand(
                                      item.confidenceBand,
                                    ),
                                  )}
                                >
                                  {item.score.toFixed(2)}
                                </span>
                              )}
                              {rescueHint && (
                                <span className="shrink-0 rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-primary">
                                  rescuable: {rescueHint}
                                </span>
                              )}
                            </div>
                            {explanation && (
                              <p className="text-muted-foreground">
                                {explanation}
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
