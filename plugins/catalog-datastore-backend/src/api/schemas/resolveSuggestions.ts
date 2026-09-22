export const RANK_CLIFF_RATIO = 0.5;
export const PAIR_PERSIST_CAP = 25;

export type ResolveSuppressionReason =
  | 'lost-conflict-resolution'
  | 'below-rank-cliff'
  | 'over-pair-cap';

export interface ResolvedSuggestions<T> {
  kept: T[];
  suppressed: Array<{
    suggestion: T;
    reason: ResolveSuppressionReason;
    /** human fragment, e.g. "lost to github-users $.login (p=0.91)" */
    detail: string;
  }>;
}

type Suggestion = {
  sourceDatasourceId?: string;
  sourceField: string;
  targetDatasourceId: string;
  targetField: string;
  score: number;
  /** Overrides `sourceField` for the conflict-resolution grouping key (pass
   * 1 only) — see dependentFieldKey. Lets a caller collapse a
   * transform-rescued candidate (whose `sourceField` becomes the rendered
   * JSONata expression) back onto the original dependent field it was
   * rescued from, so it still conflicts with a plain suggestion for that
   * same field. Absent, the key falls back to `sourceField` (unchanged
   * behavior). */
  conflictKeyField?: string;
};

// Plain codepoint comparison, not localeCompare — this tie-break must be
// stable across ICU versions/environments (see distributionAgreement.ts,
// suggestRelationshipsService.ts for the same finding).
function codepointCompare(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function dependentFieldKey(s: Suggestion, runDatasourceId: string): string {
  return `${s.sourceDatasourceId ?? runDatasourceId}|${s.conflictKeyField ?? s.sourceField}`;
}

function pairKey(s: Suggestion, runDatasourceId: string): string {
  const source = s.sourceDatasourceId ?? runDatasourceId;
  return [source, s.targetDatasourceId].sort(codepointCompare).join('|');
}

// Ascending "goodness" order for a conflict group: higher score first, ties
// broken by the smaller (targetDatasourceId, targetField) codepoint pair.
function compareConflictRank(a: Suggestion, b: Suggestion): number {
  if (a.score !== b.score) return b.score - a.score;
  const byTargetDatasource = codepointCompare(
    a.targetDatasourceId,
    b.targetDatasourceId,
  );
  if (byTargetDatasource !== 0) return byTargetDatasource;
  return codepointCompare(a.targetField, b.targetField);
}

// Total order used within a pair for both the rank-cliff and per-pair-cap
// passes: higher score first, ties broken by (sourceField, targetField).
function comparePairRank(a: Suggestion, b: Suggestion): number {
  if (a.score !== b.score) return b.score - a.score;
  const bySourceField = codepointCompare(a.sourceField, b.sourceField);
  if (bySourceField !== 0) return bySourceField;
  return codepointCompare(a.targetField, b.targetField);
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return groups;
}

/** Runs the three resolve passes IN ORDER over FS-scored survivors:
 *  1. conflict resolution — among suggestions sharing the same dependent
 *     field (sourceDatasourceId ?? runDatasourceId, conflictKeyField ??
 *     sourceField), keep the highest score; ties by codepoint
 *     (targetDatasourceId, targetField). `conflictKeyField` lets a caller
 *     collapse a transform-rescued candidate back onto the original
 *     dependent field it was rescued from (see the field's doc comment).
 *  2. rank-cliff — within each unordered datasource pair, sorted by score
 *     desc: cut at the first i where score[i+1] < score[i] * RANK_CLIFF_RATIO;
 *     everything after the cut is suppressed. At least one always survives.
 *  3. per-pair cap — after the cliff, keep at most PAIR_PERSIST_CAP per
 *     unordered pair (by the same total order).
 *  `kept` preserves the input's relative order. Deterministic. */
export function resolveSuggestions<
  T extends {
    sourceDatasourceId?: string;
    sourceField: string;
    targetDatasourceId: string;
    targetField: string;
    score: number;
    conflictKeyField?: string;
  },
>(suggestions: T[], runDatasourceId: string): ResolvedSuggestions<T> {
  const suppressed: ResolvedSuggestions<T>['suppressed'] = [];

  // Pass 1 — conflict resolution.
  const conflictGroups = groupBy(suggestions, s =>
    dependentFieldKey(s, runDatasourceId),
  );
  const survivedConflicts = new Set<T>();
  for (const group of conflictGroups.values()) {
    const winner = group.reduce((best, candidate) =>
      compareConflictRank(candidate, best) < 0 ? candidate : best,
    );
    for (const candidate of group) {
      if (candidate === winner) {
        survivedConflicts.add(candidate);
      } else {
        suppressed.push({
          suggestion: candidate,
          reason: 'lost-conflict-resolution',
          detail: `lost to ${winner.targetDatasourceId} ${winner.targetField} (p=${winner.score.toFixed(2)})`,
        });
      }
    }
  }
  const pass1Kept = suggestions.filter(s => survivedConflicts.has(s));

  // Pass 2 — rank cliff, per unordered datasource pair.
  const pairGroupsForCliff = groupBy(pass1Kept, s =>
    pairKey(s, runDatasourceId),
  );
  const survivedCliff = new Set<T>();
  for (const group of pairGroupsForCliff.values()) {
    const ordered = [...group].sort(comparePairRank);
    let cutIndex = -1;
    for (let i = 0; i < ordered.length - 1; i++) {
      if (ordered[i + 1].score < ordered[i].score * RANK_CLIFF_RATIO) {
        cutIndex = i;
        break;
      }
    }
    const survivorCount = cutIndex === -1 ? ordered.length : cutIndex + 1;
    for (let i = 0; i < ordered.length; i++) {
      if (i < survivorCount) {
        survivedCliff.add(ordered[i]);
      } else {
        suppressed.push({
          suggestion: ordered[i],
          reason: 'below-rank-cliff',
          detail: `rank cliff after #${cutIndex + 1} (${ordered[cutIndex].score.toFixed(2)} → ${ordered[cutIndex + 1].score.toFixed(2)})`,
        });
      }
    }
  }
  const pass2Kept = pass1Kept.filter(s => survivedCliff.has(s));

  // Pass 3 — per-pair cap, same total order as the cliff pass.
  const pairGroupsForCap = groupBy(pass2Kept, s => pairKey(s, runDatasourceId));
  const survivedCap = new Set<T>();
  for (const group of pairGroupsForCap.values()) {
    const ordered = [...group].sort(comparePairRank);
    ordered.forEach((candidate, index) => {
      if (index < PAIR_PERSIST_CAP) {
        survivedCap.add(candidate);
      } else {
        suppressed.push({
          suggestion: candidate,
          reason: 'over-pair-cap',
          detail: `pair cap exceeded at rank #${index + 1} (cap=${PAIR_PERSIST_CAP})`,
        });
      }
    });
  }
  const kept = pass2Kept.filter(s => survivedCap.has(s));

  return { kept, suppressed };
}
