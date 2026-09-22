import { describe, expect, it } from 'vitest';
import {
  getIntegrationDeleteDisabledReason,
  getIntegrationUsageReason,
} from './delete-disabled-reason';

describe('getIntegrationDeleteDisabledReason', () => {
  it('returns null when no data sources use the integration', () => {
    expect(getIntegrationDeleteDisabledReason([])).toBeNull();
  });

  it('lists up to three data sources', () => {
    expect(
      getIntegrationDeleteDisabledReason([
        { id: '1', name: 'First' },
        { id: '2', name: 'Second' },
        { id: '3', name: 'Third' },
      ]),
    ).toBe('Used by: First, Second, Third');
  });

  it('summarizes additional data sources', () => {
    const dataSources = Array.from({ length: 76 }, (_, index) => ({
      id: `${index + 1}`,
      name: `Data source ${index + 1}`,
    }));

    expect(getIntegrationDeleteDisabledReason(dataSources)).toBe(
      'Used by: Data source 1, Data source 2, Data source 3, and 73 more',
    );
  });
});

describe('getIntegrationUsageReason', () => {
  const empty = {
    referencingWorkflows: [],
    referencingActions: [],
    referencingRelationshipRules: [],
  };

  it('returns null when nothing uses the integration', () => {
    expect(getIntegrationUsageReason(empty)).toBeNull();
  });

  it('names an action-only blocker, which the data-source scan missed entirely', () => {
    expect(
      getIntegrationUsageReason({
        ...empty,
        referencingActions: [{ id: 'a1', name: 'Create Issue' }],
      }),
    ).toBe('Used by: Create Issue');
  });

  it('names a relationship-rule-only blocker', () => {
    expect(
      getIntegrationUsageReason({
        ...empty,
        referencingRelationshipRules: [{ id: 'r1', name: 'Owns' }],
      }),
    ).toBe('Used by: Owns');
  });

  it('aggregates across all three reference sites', () => {
    expect(
      getIntegrationUsageReason({
        referencingWorkflows: [{ id: 'w1', name: 'Repos' }],
        referencingActions: [{ id: 'a1', name: 'Create Issue' }],
        referencingRelationshipRules: [{ id: 'r1', name: 'Owns' }],
      }),
    ).toBe('Used by: Repos, Create Issue, Owns');
  });

  it('truncates past three across the combined list', () => {
    expect(
      getIntegrationUsageReason({
        referencingWorkflows: [
          { id: 'w1', name: 'A' },
          { id: 'w2', name: 'B' },
        ],
        referencingActions: [
          { id: 'a1', name: 'C' },
          { id: 'a2', name: 'D' },
        ],
        referencingRelationshipRules: [{ id: 'r1', name: 'E' }],
      }),
    ).toBe('Used by: A, B, C, and 2 more');
  });
});
