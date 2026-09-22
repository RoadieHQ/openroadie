import type { RelationshipRulePreviewItem } from '../../../api/datastore/datastore-client';

/** Which sampled source objects the preview stepper cycles through. */
export type SampleFilter = 'any' | 'matched' | 'unmatched';

/**
 * A sample's join field is "populated" when the preview extracted a source value
 * for it — the value shown (and clickable) in the property tree. Fill-bias
 * ordering and the empty-field warning both key off this.
 */
export function sampleHasFieldValue(i: RelationshipRulePreviewItem): boolean {
  return !!(i.matchSourceValues?.[0] ?? i.sourceValue);
}

/** How many sampled items matched a target vs not — shown in the filter menu. */
export function sampleCounts(items: readonly RelationshipRulePreviewItem[]): {
  any: number;
  matched: number;
  unmatched: number;
} {
  const matched = items.filter(i => i.targetObjectIds.length > 0).length;
  return { any: items.length, matched, unmatched: items.length - matched };
}

/**
 * The set of samples the stepper cycles, given the active filter: narrowed to
 * matched / unmatched objects, then fill-biased so objects that actually
 * exercise the join sort first. The sort is stable, so order within each group
 * (matched-first / populated-first) is preserved from the preview.
 */
export function selectSampleCandidates(
  items: readonly RelationshipRulePreviewItem[],
  filter: SampleFilter,
): RelationshipRulePreviewItem[] {
  const filtered = items.filter(i =>
    filter === 'matched'
      ? i.targetObjectIds.length > 0
      : filter === 'unmatched'
        ? i.targetObjectIds.length === 0
        : true,
  );
  return [...filtered].sort(
    (a, b) => Number(sampleHasFieldValue(b)) - Number(sampleHasFieldValue(a)),
  );
}
