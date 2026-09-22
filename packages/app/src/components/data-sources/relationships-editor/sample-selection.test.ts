import { describe, it, expect } from 'vitest';
import type { RelationshipRulePreviewItem } from '../../../api/datastore/datastore-client';
import {
  sampleCounts,
  sampleHasFieldValue,
  selectSampleCandidates,
} from './sample-selection';

function item(
  id: string,
  overrides: Partial<RelationshipRulePreviewItem> = {},
): RelationshipRulePreviewItem {
  return {
    sourceObjectId: id,
    relationshipType: 'ownedBy',
    targetObjectIds: [],
    ...overrides,
  };
}

describe('sampleHasFieldValue', () => {
  it('is true when a match source value is present', () => {
    expect(sampleHasFieldValue(item('a', { matchSourceValues: ['x'] }))).toBe(
      true,
    );
  });

  it('falls back to sourceValue', () => {
    expect(sampleHasFieldValue(item('a', { sourceValue: 'x' }))).toBe(true);
  });

  it('is false when neither is populated', () => {
    expect(sampleHasFieldValue(item('a'))).toBe(false);
    expect(sampleHasFieldValue(item('a', { sourceValue: '' }))).toBe(false);
  });
});

describe('sampleCounts', () => {
  it('splits matched vs unmatched', () => {
    const items = [
      item('a', { targetObjectIds: ['t1'] }),
      item('b', { targetObjectIds: [] }),
      item('c', { targetObjectIds: ['t2', 't3'] }),
    ];
    expect(sampleCounts(items)).toEqual({ any: 3, matched: 2, unmatched: 1 });
  });

  it('is all-zero for an empty list', () => {
    expect(sampleCounts([])).toEqual({ any: 0, matched: 0, unmatched: 0 });
  });
});

describe('selectSampleCandidates', () => {
  const matchedWithValue = item('a', {
    targetObjectIds: ['t1'],
    sourceValue: 'a',
  });
  const unmatchedNoValue = item('b', { targetObjectIds: [] });
  const unmatchedWithValue = item('c', {
    targetObjectIds: [],
    sourceValue: 'c',
  });

  const items = [matchedWithValue, unmatchedNoValue, unmatchedWithValue];

  it('returns every item for "any"', () => {
    const result = selectSampleCandidates(items, 'any');
    expect(result).toHaveLength(3);
  });

  it('keeps only matched items for "matched"', () => {
    expect(selectSampleCandidates(items, 'matched')).toEqual([
      matchedWithValue,
    ]);
  });

  it('keeps only unmatched items for "unmatched"', () => {
    const result = selectSampleCandidates(items, 'unmatched');
    expect(result.map(i => i.sourceObjectId)).toEqual(['c', 'b']);
  });

  it('fill-biases populated-field objects to the front (stable within group)', () => {
    // b has no value and should sink below the populated a and c.
    const result = selectSampleCandidates(items, 'any');
    expect(result.map(i => i.sourceObjectId)).toEqual(['a', 'c', 'b']);
  });

  it('does not mutate the input array', () => {
    const input = [unmatchedNoValue, matchedWithValue];
    const snapshot = [...input];
    selectSampleCandidates(input, 'any');
    expect(input).toEqual(snapshot);
  });
});
