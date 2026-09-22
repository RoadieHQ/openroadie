import { describe, expect, it } from 'vitest';
import {
  buildRelationshipTypeColorMap,
  ruleEdgeLabels,
} from './relationship-edge-style';

describe('ruleEdgeLabels', () => {
  it('points the verb toward the target', () => {
    expect(
      ruleEdgeLabels({
        sourceText: 'ownedBy',
        targetText: 'owns',
        targetOnRight: true,
      }),
    ).toEqual({ sourceLabel: 'ownedBy →', targetLabel: '← owns' });
    expect(
      ruleEdgeLabels({
        sourceText: 'ownedBy',
        targetText: '',
        targetOnRight: false,
      }),
    ).toEqual({ sourceLabel: '← ownedBy', targetLabel: '' });
  });

  it('renders a symmetric verb as a single double-arrowed label', () => {
    const labels = ruleEdgeLabels({
      sourceText: 'sameIdentityAs',
      targetText: 'sameIdentityAs',
      targetOnRight: true,
    });
    expect(labels.sourceLabel).toBe('← sameIdentityAs →');
    expect(labels.targetLabel).toBe('');
  });

  it('keeps the arrows outermost when appending the direct count', () => {
    expect(
      ruleEdgeLabels({
        sourceText: 'sameIdentityAs',
        targetText: '',
        targetOnRight: true,
        directCount: 3,
      }).sourceLabel,
    ).toBe('sameIdentityAs · +3 direct relationships →');
    expect(
      ruleEdgeLabels({
        sourceText: 'ownedBy',
        targetText: '',
        targetOnRight: false,
        directCount: 1,
      }).sourceLabel,
    ).toBe('← ownedBy · +1 direct relationship');
    expect(
      ruleEdgeLabels({
        sourceText: 'sameIdentityAs',
        targetText: 'sameIdentityAs',
        targetOnRight: true,
        directCount: 3,
      }).sourceLabel,
    ).toBe('← sameIdentityAs · +3 direct relationships →');
  });
});

describe('buildRelationshipTypeColorMap', () => {
  it('assigns a distinct color per distinct relationship type', () => {
    const map = buildRelationshipTypeColorMap([
      { relationshipType: 'ownedBy' },
      { relationshipType: 'deployedBy' },
      { relationshipType: 'dependsOn' },
    ]);

    expect(map.size).toBe(3);
    expect(new Set(map.values()).size).toBe(3);
  });

  it('is deterministic and independent of rule ordering', () => {
    const a = buildRelationshipTypeColorMap([
      { relationshipType: 'ownedBy' },
      { relationshipType: 'deployedBy' },
    ]);
    const b = buildRelationshipTypeColorMap([
      { relationshipType: 'deployedBy' },
      { relationshipType: 'ownedBy' },
    ]);

    expect(a.get('ownedBy')).toBe(b.get('ownedBy'));
    expect(a.get('deployedBy')).toBe(b.get('deployedBy'));
  });

  it('deduplicates repeated types and ignores blank ones', () => {
    const map = buildRelationshipTypeColorMap([
      { relationshipType: 'ownedBy' },
      { relationshipType: 'ownedBy' },
      { relationshipType: '  ' },
    ]);

    expect(map.size).toBe(1);
    expect(map.has('ownedBy')).toBe(true);
  });
});
