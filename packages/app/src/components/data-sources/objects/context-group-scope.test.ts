import { describe, expect, it } from 'vitest';
import {
  contextGroupScopeId,
  isContextGroupScopeId,
  parseContextGroupScopeId,
  splitDatastoreScope,
} from './context-group-scope';

describe('contextGroupScopeId', () => {
  it('round-trips a rule id through the scope encoding', () => {
    const encoded = contextGroupScopeId('rule-1');
    expect(encoded).toBe('cg:rule-1');
    expect(isContextGroupScopeId(encoded)).toBe(true);
    expect(parseContextGroupScopeId(encoded)).toBe('rule-1');
  });

  it('leaves plain data-source ids alone', () => {
    expect(isContextGroupScopeId('ds-1')).toBe(false);
    expect(parseContextGroupScopeId('ds-1')).toBeUndefined();
  });
});

describe('splitDatastoreScope', () => {
  it('partitions a mixed scope preserving order within each side', () => {
    expect(
      splitDatastoreScope(['ds-2', 'cg:rule-1', 'ds-1', 'cg:rule-2']),
    ).toEqual({
      datasourceIds: ['ds-2', 'ds-1'],
      contextGroupRuleIds: ['rule-1', 'rule-2'],
    });
  });

  it('returns empty partitions for the empty scope', () => {
    expect(splitDatastoreScope([])).toEqual({
      datasourceIds: [],
      contextGroupRuleIds: [],
    });
  });
});
