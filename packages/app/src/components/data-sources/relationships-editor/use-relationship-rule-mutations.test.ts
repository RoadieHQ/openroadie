import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RelationshipRule } from '../../../api/datastore/datastore-client';
import { queryKeys } from '../../../api/queries';
import { useRelationshipRuleMutations } from './use-relationship-rule-mutations';

const mockApi = {
  createRelationshipRule: vi.fn(),
  updateRelationshipRule: vi.fn(),
  applyRelationshipRule: vi.fn(),
  deleteRelationshipRule: vi.fn(),
  previewRelationshipRule: vi.fn(),
};

vi.mock('../../../api', () => ({
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

const input = {
  name: 'Rule 1',
  sourceDatasourceId: 'ds-1',
  targetDatasourceId: 'ds-2',
  sourceFieldExpression: 'source.field',
  targetFieldExpression: 'target.field',
  relationshipType: 'owns',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  origin: 'manual',
} as const;

let queryClient: QueryClient;
let invalidateSpy: ReturnType<typeof vi.spyOn>;
let wrapper: (props: { children: ReactNode }) => ReactNode;

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  wrapper = ({ children }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
});

describe('useRelationshipRuleMutations', () => {
  it('creates and applies a rule, then invalidates the rules key', async () => {
    const rule = makeRule();
    mockApi.createRelationshipRule.mockResolvedValue(rule);
    mockApi.applyRelationshipRule.mockResolvedValue({ created: 1, deleted: 0 });

    const { result } = renderHook(() => useRelationshipRuleMutations(), {
      wrapper,
    });
    const saved = await result.current.saveRule({ input });

    expect(saved).toEqual(rule);
    expect(mockApi.createRelationshipRule).toHaveBeenCalledWith(input);
    expect(mockApi.updateRelationshipRule).not.toHaveBeenCalled();
    expect(mockApi.applyRelationshipRule).toHaveBeenCalledWith('rule-1');
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.relationshipRules,
    });
  });

  it('updates an existing rule instead of creating', async () => {
    const existingRule = makeRule({ id: 'rule-9' });
    mockApi.updateRelationshipRule.mockResolvedValue(existingRule);
    mockApi.applyRelationshipRule.mockResolvedValue({ created: 0, deleted: 0 });

    const { result } = renderHook(() => useRelationshipRuleMutations(), {
      wrapper,
    });
    await result.current.saveRule({ input, existingRule });

    expect(mockApi.updateRelationshipRule).toHaveBeenCalledWith(
      'rule-9',
      input,
    );
    expect(mockApi.createRelationshipRule).not.toHaveBeenCalled();
    expect(mockApi.applyRelationshipRule).toHaveBeenCalledWith('rule-9');
  });

  it('saves a suggested rule without applying it', async () => {
    // The backend refuses to apply a rule while it is suggested; approving is
    // what activates and applies it. Applying here used to throw and take
    // tweak-and-approve down with it.
    const existingRule = makeRule({ id: 'rule-7', state: 'suggested' });
    mockApi.updateRelationshipRule.mockResolvedValue(existingRule);

    const { result } = renderHook(() => useRelationshipRuleMutations(), {
      wrapper,
    });
    const saved = await result.current.saveRule({ input, existingRule });

    expect(saved).toEqual(existingRule);
    expect(mockApi.updateRelationshipRule).toHaveBeenCalledWith(
      'rule-7',
      input,
    );
    expect(mockApi.applyRelationshipRule).not.toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.relationshipRules,
    });
  });

  it('propagates save errors to the caller without invalidating', async () => {
    mockApi.createRelationshipRule.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useRelationshipRuleMutations(), {
      wrapper,
    });

    await expect(result.current.saveRule({ input })).rejects.toThrow('boom');
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('deletes a rule and invalidates the rules key', async () => {
    mockApi.deleteRelationshipRule.mockResolvedValue(undefined);

    const { result } = renderHook(() => useRelationshipRuleMutations(), {
      wrapper,
    });
    await result.current.deleteRule('rule-1');

    expect(mockApi.deleteRelationshipRule).toHaveBeenCalledWith('rule-1');
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.relationshipRules,
    });
  });
});
