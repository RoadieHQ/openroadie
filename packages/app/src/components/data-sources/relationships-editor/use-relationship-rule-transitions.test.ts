import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TestQueryProvider } from '../../../test-utils';
import { useRelationshipRuleTransitions } from './use-relationship-rule-transitions';

const mockDatastore = {
  approveRelationshipRule: vi.fn().mockResolvedValue({}),
  approveRelationshipRules: vi.fn(),
  dismissRelationshipRule: vi.fn().mockResolvedValue({}),
  deleteRelationshipRule: vi.fn().mockResolvedValue(undefined),
};
const mockAlert = { post: vi.fn() };

vi.mock('../../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../api')>();
  return {
    ...actual,
    useDatastore: () => mockDatastore,
    useAlert: () => mockAlert,
  };
});

describe('useRelationshipRuleTransitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDatastore.approveRelationshipRule.mockResolvedValue({});
    mockDatastore.dismissRelationshipRule.mockResolvedValue({});
    mockDatastore.deleteRelationshipRule.mockResolvedValue(undefined);
    mockDatastore.approveRelationshipRules.mockResolvedValue({
      approved: ['a'],
      dismissedAsInverse: ['b'],
      failed: [],
    });
  });

  it('dismiss calls the dismiss endpoint, not delete', async () => {
    // Regression: dismiss used deleteRelationshipRule, so rejections left no
    // durable signal and the same suggestion returned on the next Generate.
    const { result } = renderHook(() => useRelationshipRuleTransitions(), {
      wrapper: TestQueryProvider,
    });

    await act(() => result.current.transitionRule('rule-1', 'dismiss'));

    expect(mockDatastore.dismissRelationshipRule).toHaveBeenCalledWith(
      'rule-1',
      { rankShown: undefined },
    );
    expect(mockDatastore.deleteRelationshipRule).not.toHaveBeenCalled();
  });

  it('threads rankShown through to the transition endpoint', async () => {
    const { result } = renderHook(() => useRelationshipRuleTransitions(), {
      wrapper: TestQueryProvider,
    });

    await act(() =>
      result.current.transitionRule('rule-1', 'approve', { rankShown: 2 }),
    );

    expect(mockDatastore.approveRelationshipRule).toHaveBeenCalledWith(
      'rule-1',
      { rankShown: 2 },
    );
    // Single approve goes through the per-rule endpoint, not the bulk route.
    expect(mockDatastore.approveRelationshipRules).not.toHaveBeenCalled();
  });

  it('bulk dismiss also uses the dismiss endpoint, not delete', async () => {
    const { result } = renderHook(() => useRelationshipRuleTransitions(), {
      wrapper: TestQueryProvider,
    });

    await act(() => result.current.transitionMany(['a', 'b'], 'dismiss'));

    expect(mockDatastore.dismissRelationshipRule).toHaveBeenCalledTimes(2);
    expect(mockDatastore.deleteRelationshipRule).not.toHaveBeenCalled();
  });

  it('approves many rules in a single bulk request', async () => {
    const { result } = renderHook(() => useRelationshipRuleTransitions(), {
      wrapper: TestQueryProvider,
    });

    await act(() => result.current.transitionMany(['a', 'b'], 'approve'));

    expect(mockDatastore.approveRelationshipRules).toHaveBeenCalledTimes(1);
    expect(mockDatastore.approveRelationshipRules).toHaveBeenCalledWith([
      'a',
      'b',
    ]);
    expect(mockDatastore.approveRelationshipRule).not.toHaveBeenCalled();
  });

  it('reports how many mirrored suggestions a bulk approve dismissed', async () => {
    mockDatastore.approveRelationshipRules.mockResolvedValue({
      approved: ['a', 'b'],
      dismissedAsInverse: ['c', 'd'],
      failed: [],
    });
    const { result } = renderHook(() => useRelationshipRuleTransitions(), {
      wrapper: TestQueryProvider,
    });

    await act(() => result.current.transitionMany(['a', 'b'], 'approve'));

    expect(mockAlert.post).toHaveBeenCalledWith({
      message:
        'Dismissed 2 mirrored suggestions because the opposite direction was approved',
      severity: 'info',
    });
  });

  it('does not count an unsuppressed mirror as a failed approve', async () => {
    mockDatastore.approveRelationshipRules.mockResolvedValue({
      approved: ['a'],
      dismissedAsInverse: [],
      failed: [],
      inverseDismissFailed: [{ id: 'z', reason: 'dismiss blew up' }],
    });
    const { result } = renderHook(() => useRelationshipRuleTransitions(), {
      wrapper: TestQueryProvider,
    });

    await act(() => result.current.transitionMany(['a'], 'approve'));

    expect(mockAlert.post).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'warning' }),
    );
    expect(mockAlert.post).not.toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error' }),
    );
  });
});
