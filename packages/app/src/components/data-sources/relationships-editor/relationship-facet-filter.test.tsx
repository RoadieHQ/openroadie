// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RelationshipFacetFilter } from './relationship-facet-filter';
import type { RelationshipRule } from '../../../api/datastore/datastore-client';

function makeRule(over: Partial<RelationshipRule>): RelationshipRule {
  return {
    id: 'r',
    name: '',
    description: null,
    sourceDatasourceId: 'a',
    targetDatasourceId: 'b',
    sourceFieldExpression: '',
    targetFieldExpression: '',
    sourceFilterExpression: null,
    targetFilterExpression: null,
    relationshipType: 'ownedBy',
    reciprocalRelationshipType: null,
    strategy: 'field-matching',
    matchStrategy: 'exact',
    origin: 'user',
    state: 'active',
    createdAt: '',
    updatedAt: '',
    ...over,
  } as RelationshipRule;
}

const labels = new Map([
  ['a', 'Alpha'],
  ['b', 'Beta'],
  ['c', 'Gamma'],
]);

const rules = [
  makeRule({ id: 'r1', relationshipType: 'ownedBy', targetDatasourceId: 'b' }),
  makeRule({
    id: 'r2',
    relationshipType: 'partOf',
    sourceDatasourceId: 'a',
    targetDatasourceId: 'c',
  }),
  // Suggested rules are not offered as filter options.
  makeRule({ id: 'r3', relationshipType: 'other', state: 'suggested' }),
];

describe('RelationshipFacetFilter', () => {
  it('groups active rules by type and excludes suggested rules', async () => {
    const user = userEvent.setup();
    render(
      <RelationshipFacetFilter
        rules={rules}
        datasourceLabels={labels}
        selectedTypes={[]}
        selectedRuleIds={[]}
        onChange={() => {}}
      />,
    );
    await user.click(screen.getByTestId('relationship-facet-filter'));

    expect(screen.getByText('Owned by')).toBeInTheDocument();
    expect(screen.getByText('Part of')).toBeInTheDocument();
    expect(screen.queryByText('Other')).not.toBeInTheDocument();
    expect(screen.getByText('Alpha → Beta')).toBeInTheDocument();
  });

  it('reports a type selection', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RelationshipFacetFilter
        rules={rules}
        datasourceLabels={labels}
        selectedTypes={[]}
        selectedRuleIds={[]}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByTestId('relationship-facet-filter'));
    await user.click(screen.getByText('Owned by'));

    expect(onChange).toHaveBeenCalledWith({ types: ['ownedBy'], ruleIds: [] });
  });

  it('reports an individual rule selection', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RelationshipFacetFilter
        rules={rules}
        datasourceLabels={labels}
        selectedTypes={[]}
        selectedRuleIds={[]}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByTestId('relationship-facet-filter'));
    await user.click(screen.getByText('Alpha → Beta'));

    expect(onChange).toHaveBeenCalledWith({ types: [], ruleIds: ['r1'] });
  });

  it('shows a count badge for the current selection', () => {
    render(
      <RelationshipFacetFilter
        rules={rules}
        datasourceLabels={labels}
        selectedTypes={['ownedBy']}
        selectedRuleIds={['r1']}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
