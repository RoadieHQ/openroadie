import type { RelationshipRule } from '../../../api/datastore/datastore-client';

export { buildInverseMap } from '@roadiehq/catalog-datastore-common';

export type ConfidenceFilter = 'all' | 'high' | 'medium' | 'low';

export const VISIBLE_PILL_LIMIT = 8;

/** Rows rendered per direction section before a "Show N more" expands the
 *  rest — a long tail of low-score suggestions otherwise buries the pair
 *  selector and the other directions below the fold. */
export const DIRECTION_DISPLAY_CAP = 5;

// Stored as Maps to avoid `security/detect-object-injection` warnings on
// dynamic key lookup at the call sites.
export const confidenceClasses = new Map<string, string>([
  ['high', 'bg-success/10 text-success border-success/30'],
  ['medium', 'bg-warning/10 text-warning border-warning/30'],
  ['low', 'bg-destructive/10 text-destructive border-destructive/30'],
]);

export const confidenceCardClasses = new Map<string, string>([
  ['high', 'border-l-success/70 bg-success/[0.04] hover:bg-success/[0.08]'],
  ['medium', 'border-l-warning/70 bg-warning/[0.04] hover:bg-warning/[0.08]'],
  [
    'low',
    'border-l-destructive/70 bg-destructive/[0.04] hover:bg-destructive/[0.08]',
  ],
]);

export const confidenceHighlightClasses = new Map<string, string>([
  ['high', 'ring-1 ring-success/30'],
  ['medium', 'ring-1 ring-warning/30'],
  ['low', 'ring-1 ring-destructive/30'],
]);

export function getConfidenceClassesForBand(band: string): string {
  switch (band) {
    case 'high':
      return confidenceClasses.get('high') ?? '';
    case 'medium':
      return confidenceClasses.get('medium') ?? '';
    case 'low':
    default:
      return confidenceClasses.get('low') ?? '';
  }
}

export function getConfidenceCardClassesForBand(band: string): string {
  switch (band) {
    case 'high':
      return confidenceCardClasses.get('high') ?? '';
    case 'medium':
      return confidenceCardClasses.get('medium') ?? '';
    case 'low':
    default:
      return confidenceCardClasses.get('low') ?? '';
  }
}

export function getConfidenceHighlightClassesForBand(band: string): string {
  switch (band) {
    case 'high':
      return confidenceHighlightClasses.get('high') ?? '';
    case 'medium':
      return confidenceHighlightClasses.get('medium') ?? '';
    case 'low':
    default:
      return confidenceHighlightClasses.get('low') ?? '';
  }
}

export interface DirectionSubgroup {
  /** Composite key: `${pairKey}|${sourceDsId}→${targetDsId}`. */
  key: string;
  sourceDatasourceId: string;
  targetDatasourceId: string;
  sourceLabel: string;
  targetLabel: string;
  rules: RelationshipRule[];
}

export interface RuleGroup {
  key: string;
  /** Canonically-ordered first datasource of the pair (alphabetical by label). */
  leftDatasourceId: string;
  rightDatasourceId: string;
  leftLabel: string;
  rightLabel: string;
  rules: RelationshipRule[];
  directions: DirectionSubgroup[];
}

export function prettifyFieldExpression(expr: string): string {
  return expr.replace(/^\$\./, '');
}

/** Returns 's' when count is not 1, else ''. */
export function pluralS(count: number): string {
  return count === 1 ? '' : 's';
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function groupRules(
  rules: RelationshipRule[],
  labels: Map<string, string>,
): RuleGroup[] {
  const groups = new Map<string, RuleGroup>();
  for (const rule of rules) {
    const key = pairKey(rule.sourceDatasourceId, rule.targetDatasourceId);
    const existing = groups.get(key);
    if (existing) {
      existing.rules.push(rule);
      continue;
    }
    const sourceLabel =
      labels.get(rule.sourceDatasourceId) ?? rule.sourceDatasourceId;
    const targetLabel =
      labels.get(rule.targetDatasourceId) ?? rule.targetDatasourceId;
    // Canonical display order: left = alphabetically smaller label so that
    // the same pair always renders the same way regardless of which
    // direction was discovered first.
    const leftFirst = sourceLabel.localeCompare(targetLabel) <= 0;
    groups.set(key, {
      key,
      leftDatasourceId: leftFirst
        ? rule.sourceDatasourceId
        : rule.targetDatasourceId,
      rightDatasourceId: leftFirst
        ? rule.targetDatasourceId
        : rule.sourceDatasourceId,
      leftLabel: leftFirst ? sourceLabel : targetLabel,
      rightLabel: leftFirst ? targetLabel : sourceLabel,
      rules: [rule],
      directions: [],
    });
  }
  for (const group of groups.values()) {
    const dirMap = new Map<string, DirectionSubgroup>();
    for (const rule of group.rules) {
      const dirKey = `${group.key}|${rule.sourceDatasourceId}→${rule.targetDatasourceId}`;
      const existing = dirMap.get(dirKey);
      if (existing) {
        existing.rules.push(rule);
        continue;
      }
      dirMap.set(dirKey, {
        key: dirKey,
        sourceDatasourceId: rule.sourceDatasourceId,
        targetDatasourceId: rule.targetDatasourceId,
        sourceLabel:
          labels.get(rule.sourceDatasourceId) ?? rule.sourceDatasourceId,
        targetLabel:
          labels.get(rule.targetDatasourceId) ?? rule.targetDatasourceId,
        rules: [rule],
      });
    }
    // Highest-scoring suggestions first within each direction; nulls last.
    for (const dir of dirMap.values()) {
      dir.rules.sort((a, b) => {
        const aScore = typeof a.score === 'number' ? a.score : -Infinity;
        const bScore = typeof b.score === 'number' ? b.score : -Infinity;
        return bScore - aScore;
      });
    }
    // Stable order: direction whose source matches the pair's left side first.
    group.directions = [...dirMap.values()].sort((a, b) => {
      if (
        a.sourceDatasourceId === group.leftDatasourceId &&
        b.sourceDatasourceId !== group.leftDatasourceId
      ) {
        return -1;
      }
      if (
        b.sourceDatasourceId === group.leftDatasourceId &&
        a.sourceDatasourceId !== group.leftDatasourceId
      ) {
        return 1;
      }
      return 0;
    });
  }
  return [...groups.values()].sort((a, b) => {
    const labelCompare = a.leftLabel.localeCompare(b.leftLabel);
    return labelCompare !== 0
      ? labelCompare
      : a.rightLabel.localeCompare(b.rightLabel);
  });
}

/** Rules the bulk "Clear generated rules" action may delete: generator output
 *  scoped to the current pair. Manually dismissed rows are durable — a person
 *  chose to forget them, and regeneration already skips them — so Clear must
 *  never sweep them up; the Dismissed section's per-row Delete is the only
 *  deliberate way to erase one. */
export function selectClearableGeneratedRules(
  rules: RelationshipRule[],
  datasourceIdSet: Set<string>,
): RelationshipRule[] {
  return rules.filter(
    rule =>
      datasourceIdSet.has(rule.sourceDatasourceId) &&
      datasourceIdSet.has(rule.targetDatasourceId) &&
      (rule.origin === 'generated' || rule.state === 'suggested') &&
      rule.reviewReason !== 'manual-dismiss',
  );
}
