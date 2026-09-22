import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useRelationshipTypeField } from './use-relationship-type-field';

describe('useRelationshipTypeField', () => {
  it('seeds with dependsOn and its derived reverse verb', () => {
    const { result } = renderHook(() => useRelationshipTypeField());
    expect(result.current.relationshipType).toBe('dependsOn');
    expect(result.current.reciprocalRelationshipType).toBe('hasDependency');
  });

  it('re-derives the reverse verb when switching to another known type', () => {
    const { result } = renderHook(() => useRelationshipTypeField());
    act(() => result.current.handleRelationshipTypeChange('ownedBy'));
    expect(result.current.reciprocalRelationshipType).toBe('owns');
  });

  it('clears the reverse verb for a custom type with no known inverse', () => {
    const { result } = renderHook(() => useRelationshipTypeField());
    act(() => result.current.handleRelationshipTypeChange('linkedTo'));
    expect(result.current.reciprocalRelationshipType).toBe('');
  });

  it('keeps a manual reverse verb across custom type edits but not onto a known type', () => {
    const { result } = renderHook(() => useRelationshipTypeField());
    act(() => result.current.handleRelationshipTypeChange('linkedTo'));
    act(() => result.current.handleReciprocalChange('backlinkedTo'));
    expect(result.current.reciprocalRelationshipType).toBe('backlinkedTo');

    // Another custom type preserves the manual override.
    act(() => result.current.handleRelationshipTypeChange('mentions'));
    expect(result.current.reciprocalRelationshipType).toBe('backlinkedTo');

    // A known type overrides it with the derived reverse verb.
    act(() => result.current.handleRelationshipTypeChange('partOf'));
    expect(result.current.reciprocalRelationshipType).toBe('hasPart');
  });

  it('merges known verbs with in-use types into sorted, de-duped options', () => {
    const { result } = renderHook(() =>
      useRelationshipTypeField({ existingTypes: ['customA', 'ownedBy'] }),
    );
    const values = result.current.relationshipTypeOptions.map(o => o.value);
    expect(values).toContain('customA');
    expect(values).toContain('ownedBy');
    // dependsOn is a known verb — present exactly once.
    expect(values.filter(v => v === 'ownedBy')).toHaveLength(1);
    expect([...values]).toEqual([...values].sort());
  });

  it('re-seeds type and reverse verb on reset', () => {
    const { result } = renderHook(() => useRelationshipTypeField());
    act(() => result.current.reset({ type: 'childOf' }));
    expect(result.current.relationshipType).toBe('childOf');
    expect(result.current.reciprocalRelationshipType).toBe('parentOf');

    act(() => result.current.reset());
    expect(result.current.relationshipType).toBe('dependsOn');
    expect(result.current.reciprocalRelationshipType).toBe('hasDependency');
  });
});
