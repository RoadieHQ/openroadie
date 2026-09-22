import { render, screen } from '@testing-library/react';
import type { RelationshipRule } from '../../../api/datastore/datastore-client';
import { SuggestionStepSummary } from './suggestion-step-summary';

const RULE = {
  id: 'r1',
  sourceDatasourceId: 'ds-a',
  targetDatasourceId: 'ds-b',
  sourceFieldExpression: '$.spec.email',
  targetFieldExpression: '$.metadata.mail',
  relationshipType: 'sameIdentityAs',
  matchStrategy: 'exact',
  strategy: 'field-matching',
  state: 'suggested',
  origin: 'suggested',
  name: '',
  description: null,
  sourceFilterExpression: null,
  targetFilterExpression: null,
  reciprocalRelationshipType: null,
  createdAt: '',
  updatedAt: '',
} as RelationshipRule;

describe('SuggestionStepSummary', () => {
  it('renders the source → match → target pipeline for a bare rule', () => {
    render(
      <SuggestionStepSummary
        rule={RULE}
        sourceLabel="GitHub"
        targetLabel="Shortcut"
        expanded={false}
        onToggleExpanded={() => {}}
      />,
    );
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('Shortcut')).toBeInTheDocument();
    expect(screen.getByText('spec.email')).toBeInTheDocument();
    expect(screen.getByText('sameIdentityAs')).toBeInTheDocument();
    // The editable-map "+" add-step affordance must not leak into the card.
    expect(
      screen.queryByRole('button', { name: /add/i }),
    ).not.toBeInTheDocument();
  });
});
