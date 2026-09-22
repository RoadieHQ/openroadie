import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RelationshipRule } from '../../../api/datastore/datastore-client';
import { SuggestionEvidenceBadge } from './suggestion-evidence-badge';

const BASE: RelationshipRule = {
  id: 'r1',
  name: 'Rule',
  description: null,
  sourceDatasourceId: 'ds-a',
  targetDatasourceId: 'ds-b',
  sourceFieldExpression: '$.email',
  targetFieldExpression: '$.mail',
  sourceFilterExpression: null,
  targetFilterExpression: null,
  relationshipType: 'sameIdentityAs',
  reciprocalRelationshipType: null,
  strategy: 'field-matching',
  matchStrategy: 'exact',
  origin: 'suggested',
  state: 'suggested',
  suggestionKind: 'identity',
  score: 0.87,
  confidenceBand: 'high',
  reviewReason: 'Low row coverage on the target field',
  evidenceSummary: {
    valueTypes: ['email'],
    distinctMatchedValueCount: 42,
    sourceFieldStats: {
      distinctCount: 50,
      rowCoverage: 0.98,
      cardinalityRatio: 0.9,
      looksEnumLike: false,
      isIdentifierLike: true,
    },
    targetFieldStats: {
      distinctCount: 44,
      rowCoverage: 0.6,
      cardinalityRatio: 0.8,
      looksEnumLike: false,
      isIdentifierLike: true,
    },
    commonValuePenalty: -0.1,
    topMatchedValues: ['a@x.io', 'b@x.io'],
    explanation: 'Emails on both sides match with high coverage.',
  },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('SuggestionEvidenceBadge', () => {
  it('shows the score on the badge and the evidence on hover', async () => {
    const user = userEvent.setup();
    render(<SuggestionEvidenceBadge rule={BASE} />);

    // Collapsed, the badge is the whole footprint: a labelled score.
    const badge = screen.getByLabelText(
      'Suggestion confidence high, score 0.87',
    );
    expect(badge).toHaveTextContent('Score');
    expect(badge).toHaveTextContent('0.87');
    // The detail is not on the page until asked for.
    expect(
      screen.queryByText('Emails on both sides match with high coverage.'),
    ).not.toBeInTheDocument();

    await user.hover(badge);

    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent(
      'Emails on both sides match with high coverage.',
    );
    expect(tooltip).toHaveTextContent('Low row coverage on the target field');
    expect(tooltip).toHaveTextContent('42 distinct matched values');
    expect(tooltip).toHaveTextContent('98% coverage');
    expect(tooltip).toHaveTextContent('a@x.io');
  });

  it('renders nothing when the rule carries no evidence', () => {
    const bare = {
      ...BASE,
      score: null,
      confidenceBand: null,
      reviewReason: null,
      evidenceSummary: null,
    };
    const { container } = render(<SuggestionEvidenceBadge rule={bare} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders no waterfall, gate, or rescue sections when the rule carries none of them', async () => {
    const user = userEvent.setup();
    render(<SuggestionEvidenceBadge rule={BASE} />);

    await user.hover(screen.getByLabelText(/Suggestion confidence/));
    const tooltip = await screen.findByRole('tooltip');

    expect(tooltip).not.toHaveTextContent('Waterfall');
    expect(tooltip).not.toHaveTextContent('Gate');
    expect(tooltip).not.toHaveTextContent('Rescue');
    expect(screen.queryByText('⚠')).not.toBeInTheDocument();
  });

  describe('waterfall', () => {
    const withWaterfall: RelationshipRule = {
      ...BASE,
      evidenceSummary: {
        ...BASE.evidenceSummary!,
        waterfall: [
          { signal: 'prior', fired: true, weight: -5 },
          {
            signal: 'containment-high',
            fired: true,
            weight: 2.145,
            detail: 'containment 0.99',
          },
          { signal: 'name-similarity', fired: false, weight: -0.263 },
        ],
      },
    };

    it('renders a row per entry with its signal, marker, weight, and detail', async () => {
      const user = userEvent.setup();
      render(<SuggestionEvidenceBadge rule={withWaterfall} />);

      await user.hover(screen.getByLabelText(/Suggestion confidence/));
      const tooltip = await screen.findByRole('tooltip');

      expect(tooltip).toHaveTextContent('Waterfall');
      // Fired, positive weight.
      expect(tooltip).toHaveTextContent('containment-high');
      expect(tooltip).toHaveTextContent('+2.145');
      expect(tooltip).toHaveTextContent('containment 0.99');
      // Fired, negative weight — uses the minus-sign marker, not a hyphen.
      expect(tooltip).toHaveTextContent('prior');
      expect(tooltip).toHaveTextContent('-5.000');
      expect(tooltip.textContent).toContain('−');
      // Not fired — middot marker regardless of the (negative) weight sign.
      expect(tooltip).toHaveTextContent('name-similarity');
      expect(tooltip).toHaveTextContent('-0.263');
      expect(tooltip.textContent).toContain('·');
      // No computed sum row: the weights don't re-sum to any rendered total.
      expect(tooltip).not.toHaveTextContent('Total');
      expect(tooltip).not.toHaveTextContent('Sum');
    });
  });

  describe('gate', () => {
    it('renders only the fields present', async () => {
      const user = userEvent.setup();
      const partialGate: RelationshipRule = {
        ...BASE,
        evidenceSummary: {
          ...BASE.evidenceSummary!,
          gate: { containment: 1.35, containmentDirection: 'source-to-target' },
        },
      };
      render(<SuggestionEvidenceBadge rule={partialGate} />);

      await user.hover(screen.getByLabelText(/Suggestion confidence/));
      const tooltip = await screen.findByRole('tooltip');

      expect(tooltip).toHaveTextContent('Gate');
      // Containment renders raw, uncapped at 1, never as a percent.
      expect(tooltip).toHaveTextContent('containment 1.35');
      expect(tooltip).toHaveTextContent('source-to-target');
      expect(tooltip).not.toHaveTextContent('verified against full table');
      expect(tooltip).not.toHaveTextContent('referenced cardinality');
    });

    it('renders the verified suffix and referenced cardinality ratio when present', async () => {
      const user = userEvent.setup();
      const fullGate: RelationshipRule = {
        ...BASE,
        evidenceSummary: {
          ...BASE.evidenceSummary!,
          gate: {
            containment: 0.92,
            containmentDirection: 'target-to-source',
            containmentVerified: true,
            referencedCardinalityRatio: 0.75,
          },
        },
      };
      render(<SuggestionEvidenceBadge rule={fullGate} />);

      await user.hover(screen.getByLabelText(/Suggestion confidence/));
      const tooltip = await screen.findByRole('tooltip');

      expect(tooltip).toHaveTextContent('verified against full table');
      expect(tooltip).toHaveTextContent('referenced cardinality 0.75');
    });
  });

  describe('rescue', () => {
    it('renders kind, detail, and originalField', async () => {
      const user = userEvent.setup();
      const rescued: RelationshipRule = {
        ...BASE,
        evidenceSummary: {
          ...BASE.evidenceSummary!,
          rescue: {
            kind: 'transform',
            detail: 'lower(trim($.email))',
            originalField: '$.email',
          },
        },
      };
      render(<SuggestionEvidenceBadge rule={rescued} />);

      await user.hover(screen.getByLabelText(/Suggestion confidence/));
      const tooltip = await screen.findByRole('tooltip');

      expect(tooltip).toHaveTextContent('Rescue');
      expect(tooltip).toHaveTextContent('transform');
      expect(tooltip).toHaveTextContent('lower(trim($.email))');
      expect(tooltip).toHaveTextContent('was $.email');
    });

    it('renders kind and detail without a was-suffix when originalField is absent', async () => {
      const user = userEvent.setup();
      const rescued: RelationshipRule = {
        ...BASE,
        evidenceSummary: {
          ...BASE.evidenceSummary!,
          rescue: { kind: 'filter', detail: '$.status = "active"' },
        },
      };
      render(<SuggestionEvidenceBadge rule={rescued} />);

      await user.hover(screen.getByLabelText(/Suggestion confidence/));
      const tooltip = await screen.findByRole('tooltip');

      expect(tooltip).toHaveTextContent('filter');
      expect(tooltip).toHaveTextContent('$.status = "active"');
      expect(tooltip).not.toHaveTextContent(/\(was /);
    });
  });

  describe('elevated common values warning', () => {
    it('shows the warning when value-rarity did not fire with a negative weight', async () => {
      const user = userEvent.setup();
      const commonValues: RelationshipRule = {
        ...BASE,
        evidenceSummary: {
          ...BASE.evidenceSummary!,
          waterfall: [{ signal: 'value-rarity', fired: false, weight: -0.585 }],
        },
      };
      render(<SuggestionEvidenceBadge rule={commonValues} />);

      expect(
        screen.getByLabelText('Suggestion confidence high, score 0.87'),
      ).toHaveTextContent('⚠');

      await user.hover(screen.getByLabelText(/Suggestion confidence/));
      const tooltip = await screen.findByRole('tooltip');
      expect(tooltip).toHaveTextContent(/elevated common values/i);
    });

    it('does not show the warning when value-rarity fired', async () => {
      const user = userEvent.setup();
      const rare: RelationshipRule = {
        ...BASE,
        evidenceSummary: {
          ...BASE.evidenceSummary!,
          waterfall: [{ signal: 'value-rarity', fired: true, weight: 0.585 }],
        },
      };
      render(<SuggestionEvidenceBadge rule={rare} />);

      expect(
        screen.getByLabelText('Suggestion confidence high, score 0.87'),
      ).not.toHaveTextContent('⚠');

      await user.hover(screen.getByLabelText(/Suggestion confidence/));
      const tooltip = await screen.findByRole('tooltip');
      expect(tooltip).not.toHaveTextContent(/elevated common values/i);
    });

    it('never derives the warning from commonValuePenalty', () => {
      // Stage 3 made commonValuePenalty always <= 0; this pins the field as
      // dead for the warning even if a stale payload still carried a high one.
      const highPenaltyNoWaterfall: RelationshipRule = {
        ...BASE,
        evidenceSummary: {
          ...BASE.evidenceSummary!,
          commonValuePenalty: 0.9,
          waterfall: undefined,
        },
      };
      render(<SuggestionEvidenceBadge rule={highPenaltyNoWaterfall} />);

      expect(
        screen.getByLabelText('Suggestion confidence high, score 0.87'),
      ).not.toHaveTextContent('⚠');
    });
  });
});
