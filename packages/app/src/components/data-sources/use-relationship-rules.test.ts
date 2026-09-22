// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RelationshipRule } from '../../api/datastore/datastore-client';
import { useRelationshipRules } from './use-relationship-rules';

const mockApi = {
  listRelationshipRules: vi.fn(),
};

vi.mock('../../api', () => ({
  useDatastore: () => mockApi,
}));

function makeRule(overrides: Partial<RelationshipRule> = {}): RelationshipRule {
  return {
    id: 'rule-1',
    name: 'Rule 1',
    description: null,
    sourceDatasourceId: 'ds-1',
    targetDatasourceId: 'ds-2',
    sourceFieldExpression: 'source.field',
    targetFieldExpression: 'target.field',
    sourceFilterExpression: null,
    targetFilterExpression: null,
    relationshipType: 'owns',
    reciprocalRelationshipType: null,
    strategy: 'field-matching',
    matchStrategy: 'exact',
    origin: 'manual',
    state: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

let queryClient: QueryClient;
let wrapper: (props: { children: ReactNode }) => ReactNode;

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  wrapper = ({ children }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  mockApi.listRelationshipRules.mockResolvedValue({
    items: [makeRule()],
    total: 1,
  });
});

describe('useRelationshipRules', () => {
  it('returns the fetched rules', async () => {
    const { result } = renderHook(() => useRelationshipRules(true), {
      wrapper,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.rules).toHaveLength(1);
    expect(result.current.rules[0]?.name).toBe('Rule 1');
    expect(result.current.error).toBeUndefined();
  });

  it('does not fetch while disabled', () => {
    const { result } = renderHook(() => useRelationshipRules(false), {
      wrapper,
    });

    expect(mockApi.listRelationshipRules).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.rules).toEqual([]);
  });
});
