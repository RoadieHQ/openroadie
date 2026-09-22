import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FieldMatchSuggestion } from '../../../api/datastore/datastore-client';
import { SuppressedSuggestionsSection } from './suppressed-suggestions-section';

function makeSuggestion(
  overrides: Partial<FieldMatchSuggestion>,
): FieldMatchSuggestion {
  return {
    sourceField: '$.handle',
    targetDatasourceId: 'ds-b',
    targetField: '$.login',
    matchCount: 3,
    sampleValues: ['abc'],
    suggestionKind: 'identity',
    score: 0,
    confidenceBand: 'low',
    evidenceSummary: {
      valueTypes: ['uuid'],
      distinctMatchedValueCount: 3,
      sourceFieldStats: {
        distinctCount: 10,
        rowCoverage: 0.9,
        cardinalityRatio: 0.8,
        looksEnumLike: false,
        isIdentifierLike: true,
      },
      targetFieldStats: {
        distinctCount: 10,
        rowCoverage: 0.9,
        cardinalityRatio: 0.8,
        looksEnumLike: false,
        isIdentifierLike: true,
      },
      commonValuePenalty: 0,
      topMatchedValues: ['abc'],
      explanation: 'looked promising but failed a gate',
    },
    suppressionReason: 'trivial-domain',
    ...overrides,
  };
}

describe('SuppressedSuggestionsSection', () => {
  it('renders nothing when there are no suppressed suggestions', () => {
    const { container } = render(<SuppressedSuggestionsSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for an explicit empty array', () => {
    const { container } = render(
      <SuppressedSuggestionsSection suppressedSuggestions={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('groups by suppressionReason with counts, busiest first', async () => {
    const user = userEvent.setup();
    const suggestions = [
      makeSuggestion({
        sourceField: '$.a',
        suppressionReason: 'trivial-domain',
      }),
      makeSuggestion({
        sourceField: '$.b',
        suppressionReason: 'trivial-domain',
      }),
      makeSuggestion({
        sourceField: '$.c',
        suppressionReason: 'score-below-threshold',
      }),
    ];
    render(
      <SuppressedSuggestionsSection suppressedSuggestions={suggestions} />,
    );

    // Collapsed by default.
    expect(screen.queryByText(/trivial-domain/)).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: /Suppressed this run \(3/ }),
    );

    const groupButtons = screen.getAllByRole('button', {
      name: /trivial-domain|score-below-threshold/,
    });
    // Busiest group (2 items) leads.
    expect(groupButtons[0]).toHaveTextContent('trivial-domain (2)');
    expect(groupButtons[1]).toHaveTextContent('score-below-threshold (1)');
  });

  it('expands a group to show its rows, including target datasource and score', async () => {
    const user = userEvent.setup();
    const suggestions = [
      makeSuggestion({
        sourceField: '$.a',
        targetField: '$.login',
        targetDatasourceId: 'ds-b',
        score: 0.42,
        confidenceBand: 'medium',
      }),
    ];
    render(
      <SuppressedSuggestionsSection
        suppressedSuggestions={suggestions}
        datasourceLabels={new Map([['ds-b', 'GitHub Users']])}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: /Suppressed this run/ }),
    );
    await user.click(screen.getByRole('button', { name: /trivial-domain/ }));

    expect(screen.getByText('$.a → $.login')).toBeInTheDocument();
    expect(screen.getByText('GitHub Users')).toBeInTheDocument();
    expect(screen.getByText('0.42')).toBeInTheDocument();
  });

  it('renders the waterfall-derived explanation for a score-suppressed row', async () => {
    const user = userEvent.setup();
    const suggestion = makeSuggestion({
      suppressionReason: 'score-below-threshold',
      score: 0.31,
      evidenceSummary: {
        ...makeSuggestion({}).evidenceSummary,
        explanation:
          'name-similarity +0.20, value-rarity +0.10, cardinality -0.05; prior 0.10; p 0.31',
      },
    });
    render(
      <SuppressedSuggestionsSection suppressedSuggestions={[suggestion]} />,
    );

    await user.click(
      screen.getByRole('button', { name: /Suppressed this run/ }),
    );
    await user.click(
      screen.getByRole('button', { name: /score-below-threshold/ }),
    );

    expect(
      screen.getByText(
        'name-similarity +0.20, value-rarity +0.10, cardinality -0.05; prior 0.10; p 0.31',
      ),
    ).toBeInTheDocument();
  });

  it('omits the redundant gate-boilerplate explanation ("suppressed by gate: <reason>")', async () => {
    const user = userEvent.setup();
    const suggestion = makeSuggestion({
      suppressionReason: 'trivial-domain',
      evidenceSummary: {
        ...makeSuggestion({}).evidenceSummary,
        explanation: 'suppressed by gate: trivial-domain',
      },
    });
    render(
      <SuppressedSuggestionsSection suppressedSuggestions={[suggestion]} />,
    );

    await user.click(
      screen.getByRole('button', { name: /Suppressed this run/ }),
    );
    await user.click(screen.getByRole('button', { name: /trivial-domain/ }));

    expect(
      screen.queryByText('suppressed by gate: trivial-domain'),
    ).not.toBeInTheDocument();
  });

  it('hides the score badge when score is not greater than zero', async () => {
    const user = userEvent.setup();
    render(
      <SuppressedSuggestionsSection
        suppressedSuggestions={[makeSuggestion({ score: 0 })]}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: /Suppressed this run/ }),
    );
    await user.click(screen.getByRole('button', { name: /trivial-domain/ }));

    expect(screen.getByText('$.handle → $.login')).toBeInTheDocument();
    expect(screen.queryByText('0.00')).not.toBeInTheDocument();
  });

  it('renders a rescuable chip when the gate reports a rescueHint', async () => {
    const user = userEvent.setup();
    const suggestion = makeSuggestion({
      suppressionReason: 'containment-below-threshold',
      evidenceSummary: {
        ...makeSuggestion({}).evidenceSummary,
        gate: { rescueHint: 'try-filter' },
      },
    });
    render(
      <SuppressedSuggestionsSection suppressedSuggestions={[suggestion]} />,
    );

    await user.click(
      screen.getByRole('button', { name: /Suppressed this run/ }),
    );
    await user.click(
      screen.getByRole('button', { name: /containment-below-threshold/ }),
    );

    expect(screen.getByText('rescuable: try-filter')).toBeInTheDocument();
  });

  it('omits the rescuable chip when no rescueHint is present', async () => {
    const user = userEvent.setup();
    render(
      <SuppressedSuggestionsSection
        suppressedSuggestions={[makeSuggestion({})]}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: /Suppressed this run/ }),
    );
    await user.click(screen.getByRole('button', { name: /trivial-domain/ }));

    expect(screen.queryByText(/rescuable:/)).not.toBeInTheDocument();
  });
});
