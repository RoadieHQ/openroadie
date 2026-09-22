import { describe, expect, it } from 'vitest';
import type { StageRole } from './relationship-stages';
import { buildMapSegments } from './step-map';

const meta = {
  source: { icon: null, title: 'Source', subtitle: 'GitHub repos' },
  lookup: { icon: null, title: 'Lookup', subtitle: 'ignored' },
  match: { icon: null, title: 'Target', subtitle: 'Users' },
} satisfies Record<StageRole, { icon: null; title: string; subtitle: string }>;

const base = {
  meta,
  method: 'GET',
  sourceLeaf: '',
  targetLeaf: '',
  matchStrategyLabel: 'Exact',
  relationshipType: 'ownedBy',
  resolvedLookupPath: undefined,
  lookupPath: '',
};

describe('buildMapSegments', () => {
  it('shows just the endpoints and an add affordance for a blank field-matching rule', () => {
    const segments = buildMapSegments({ ...base, isIntegrationBacked: false });
    expect(segments.map(s => s.kind)).toEqual(['node', 'add', 'node']);
    expect(segments[0]).toMatchObject({ role: 'source', present: true });
    expect(segments[2]).toMatchObject({ role: 'match', title: 'Target' });
  });

  it('inserts the connecting field and match annotation once fields are chosen', () => {
    const segments = buildMapSegments({
      ...base,
      isIntegrationBacked: false,
      sourceLeaf: 'login',
      targetLeaf: 'owner',
      matchStrategyLabel: 'Exact',
    });
    expect(segments.map(s => s.kind)).toEqual([
      'node',
      'field',
      'add',
      'match',
      'node',
    ]);
    expect(segments[1]).toMatchObject({ kind: 'field', text: 'login' });
    // The match carries the relationship verb, with the strategy · field detail.
    expect(segments[3]).toMatchObject({
      kind: 'match',
      relationship: 'ownedBy',
      detail: 'Exact · owner',
    });
  });

  it('renders a lookup node with the resolved request for an integration-backed rule', () => {
    const segments = buildMapSegments({
      ...base,
      isIntegrationBacked: true,
      sourceLeaf: 'login',
      targetLeaf: 'id',
      resolvedLookupPath: '/users/octocat',
    });
    const lookup = segments.find(s => s.kind === 'node' && s.role === 'lookup');
    expect(lookup).toMatchObject({
      title: 'HTTP Lookup',
      method: 'GET',
      subtitle: '/users/octocat',
    });
    // Integration lookups are a fixed equality join — no strategy name, but the
    // relationship verb still rides the match segment.
    expect(segments.find(s => s.kind === 'match')).toMatchObject({
      relationship: 'ownedBy',
      detail: '= id',
    });
  });

  it('falls back to the raw path, then a placeholder, before the source value resolves', () => {
    const withTemplate = buildMapSegments({
      ...base,
      isIntegrationBacked: true,
      lookupPath: '/users/{value}',
    });
    expect(
      withTemplate.find(s => s.kind === 'node' && s.role === 'lookup'),
    ).toMatchObject({ subtitle: '/users/{value}' });

    const unconfigured = buildMapSegments({
      ...base,
      isIntegrationBacked: true,
    });
    expect(
      unconfigured.find(s => s.kind === 'node' && s.role === 'lookup'),
    ).toMatchObject({ subtitle: 'not configured' });
  });
});
