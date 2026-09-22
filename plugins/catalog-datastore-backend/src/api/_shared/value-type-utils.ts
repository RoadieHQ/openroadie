import type { RelationshipSuggestionValueType } from '@roadiehq/catalog-datastore-common';

export function dominantValueType(
  counts: Map<RelationshipSuggestionValueType, number>,
): RelationshipSuggestionValueType {
  let current: RelationshipSuggestionValueType = 'other';
  let max = -1;
  for (const [valueType, count] of counts.entries()) {
    if (count > max) {
      current = valueType;
      max = count;
    }
  }
  return current;
}
