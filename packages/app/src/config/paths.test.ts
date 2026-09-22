import { describe, expect, it } from 'vitest';
import {
  datastoreGraphFocus,
  relationshipBetween,
  relationshipsScoped,
} from './paths';

function query(url: string): URLSearchParams {
  const [, search = ''] = url.split('?');
  return new URLSearchParams(search);
}

describe('relationshipsScoped', () => {
  it('returns the bare route with no scope', () => {
    expect(relationshipsScoped()).toBe('/relationships');
    expect(relationshipsScoped({})).toBe('/relationships');
  });

  it('omits empty lists', () => {
    expect(
      relationshipsScoped({ dataSourceIds: [], relationshipTypes: [] }),
    ).toBe('/relationships');
  });

  it('serializes each part as comma-joined params', () => {
    const params = query(
      relationshipsScoped({
        dataSourceIds: ['ds-1', 'ds-2'],
        relationshipTypes: ['ownedBy'],
        relationshipRuleIds: ['rule-1', 'rule-2'],
        focusRelationshipId: 'rule-1',
      }),
    );
    expect(params.get('ds')).toBe('ds-1,ds-2');
    expect(params.get('reltype')).toBe('ownedBy');
    expect(params.get('rel')).toBe('rule-1,rule-2');
    expect(params.get('relFocus')).toBe('rule-1');
  });

  it('trims and drops blank entries', () => {
    const params = query(
      relationshipsScoped({ dataSourceIds: [' ds-1 ', '', 'ds-2'] }),
    );
    expect(params.get('ds')).toBe('ds-1,ds-2');
  });
});

describe('datastoreGraphFocus', () => {
  it('links to the datastore graph page with an encoded focus param', () => {
    const url = datastoreGraphFocus('ds-1', 'v2:p:obj');
    expect(url.startsWith('/datastore/graph?')).toBe(true);
    expect(query(url).get('focus')).toBe('ds-1:v2:p:obj');
  });
});

describe('relationshipBetween', () => {
  it('scopes to both endpoints and focuses the rule', () => {
    const params = query(relationshipBetween('ds-a', 'ds-b', 'rule-x'));
    expect(params.get('ds')).toBe('ds-a,ds-b');
    expect(params.get('rel')).toBe('rule-x');
    expect(params.get('relFocus')).toBe('rule-x');
  });
});
