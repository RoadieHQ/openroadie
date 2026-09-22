import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '../../../test-utils';
import type {
  FieldMatchSuggestion,
  RelationshipRule,
} from '../../../api/datastore/datastore-client';
import { SuggestedRulesPanel } from './suggested-rules-panel';

function makeSuppressed(
  overrides: Partial<FieldMatchSuggestion> = {},
): FieldMatchSuggestion {
  return {
    sourceField: '$.a',
    targetDatasourceId: 'target',
    targetField: '$.b',
    matchCount: 1,
    sampleValues: [],
    suggestionKind: 'identity',
    score: 0,
    confidenceBand: 'low',
    evidenceSummary: {
      valueTypes: [],
      distinctMatchedValueCount: 0,
      sourceFieldStats: {
        distinctCount: 0,
        rowCoverage: 0,
        cardinalityRatio: 0,
        looksEnumLike: false,
        isIdentifierLike: false,
      },
      targetFieldStats: {
        distinctCount: 0,
        rowCoverage: 0,
        cardinalityRatio: 0,
        looksEnumLike: false,
        isIdentifierLike: false,
      },
      commonValuePenalty: 0,
      topMatchedValues: [],
      explanation: '',
    },
    suppressionReason: 'trivial-domain',
    ...overrides,
  };
}

const mockApi = {
  // Per-row Approve goes through the singular endpoint; bulk "Approve all"
  // (via onApproveMany → transitionMany) goes through the bulk one.
  approveRelationshipRule: vi.fn(),
  approveRelationshipRules: vi.fn(),
  dismissRelationshipRule: vi.fn(),
  deleteRelationshipRule: vi.fn(),
  // DismissedRulesSection now always mounts alongside the panel (it renders
  // regardless of which of the panel's three branches is active), so it
  // needs its own datastore calls stubbed here too.
  listRelationshipRules: vi.fn(),
  resetRelationshipRule: vi.fn(),
};
const mockAlert = { post: vi.fn() };
vi.mock('../../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../api')>();
  return {
    ...actual,
    useDatastore: () => mockApi,
    useAlert: () => mockAlert,
  };
});

function makeRule(overrides: Partial<RelationshipRule>): RelationshipRule {
  return {
    id: 'rule-a',
    name: 'rule',
    description: null,
    sourceDatasourceId: 'source',
    targetDatasourceId: 'target',
    sourceFieldExpression: '$.handle',
    targetFieldExpression: '$.login',
    sourceFilterExpression: null,
    targetFilterExpression: null,
    relationshipType: 'ownedBy',
    reciprocalRelationshipType: 'ownerOf',
    strategy: 'field-matching',
    matchStrategy: 'exact',
    origin: 'generated',
    state: 'suggested',
    suggestionKind: 'identity',
    score: null,
    confidenceBand: null,
    evidenceSummary: null,
    reviewReason: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof SuggestedRulesPanel>> = {},
) {
  const props: React.ComponentProps<typeof SuggestedRulesPanel> = {
    suggestedRules: [],
    highlightedRuleId: null,
    datasourceLabels: new Map(),
    onApproveMany: async () => undefined,
    onDismissMany: async () => undefined,
    onSuggestedRuleClick: () => undefined,
    onSuggestedRuleHover: () => undefined,
    ...overrides,
  };
  renderWithQuery(<SuggestedRulesPanel {...props} />);
  return props;
}

describe('SuggestedRulesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.approveRelationshipRule.mockResolvedValue(undefined);
    mockApi.approveRelationshipRules.mockResolvedValue({
      approved: ['rule-a'],
      dismissedAsInverse: [],
      failed: [],
    });
    mockApi.dismissRelationshipRule.mockResolvedValue(undefined);
    mockApi.deleteRelationshipRule.mockResolvedValue(undefined);
    mockApi.listRelationshipRules.mockResolvedValue({ items: [], total: 0 });
    mockApi.resetRelationshipRule.mockResolvedValue(undefined);
  });

  it('can hide the internal header for standalone page composition', () => {
    renderPanel();

    expect(screen.queryByText('Suggestions')).not.toBeInTheDocument();
    expect(screen.getByText('No suggestions right now')).toBeInTheDocument();
  });

  it('keeps the Dismissed section reachable when there are no suggestions left to review', async () => {
    // Dismissing the last suggestion (or filtering to zero groups) must not
    // hide the only place left to undo it — DismissedRulesSection has to
    // mount alongside the EmptyState/no-match branches, not just the list.
    const user = userEvent.setup();
    mockApi.listRelationshipRules.mockResolvedValue({
      items: [
        makeRule({
          id: 'dismissed-1',
          name: 'dismissed rule',
          state: 'inactive',
          reviewReason: 'manual-dismiss',
        }),
      ],
      total: 1,
    });

    renderPanel(); // suggestedRules: [] → the EmptyState branch

    expect(screen.getByText('No suggestions right now')).toBeInTheDocument();
    const toggle = await screen.findByRole('button', { name: /Dismissed/ });
    await user.click(toggle);
    expect(screen.getByText('dismissed rule')).toBeInTheDocument();
  });

  it('shows the row as pending in flight and posts exactly one error toast when approve rejects', async () => {
    const user = userEvent.setup();
    let release!: (e: unknown) => void;
    mockApi.approveRelationshipRule.mockReturnValueOnce(
      new Promise((_resolve, reject) => (release = reject)),
    );
    renderPanel({ suggestedRules: [makeRule({})] });

    const [approveButton] = screen.getAllByRole('button', { name: 'Approve' });
    await user.click(approveButton);

    await waitFor(() => expect(approveButton).toBeDisabled());
    // The only row in its direction group — rankShown is its 0-based index.
    expect(mockApi.approveRelationshipRule).toHaveBeenCalledWith('rule-a', {
      rankShown: 0,
    });

    release(new Error('backend down'));

    await waitFor(() =>
      expect(mockAlert.post).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'error',
          message: expect.stringContaining('backend down'),
        }),
      ),
    );
    expect(mockAlert.post.mock.calls[0][0].message).toContain(
      'Failed to approve rule',
    );
    // Exactly one toast — the panel must not double-toast on top of the
    // one `transitionRule` already posts.
    expect(mockAlert.post).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(approveButton).toBeEnabled());
  });

  it('posts exactly one error toast when dismiss rejects', async () => {
    const user = userEvent.setup();
    mockApi.dismissRelationshipRule.mockRejectedValueOnce(new Error('nope'));
    renderPanel({ suggestedRules: [makeRule({})] });

    const [dismissButton] = screen.getAllByRole('button', { name: 'Dismiss' });
    await user.click(dismissButton);

    await waitFor(() =>
      expect(mockAlert.post).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'error',
          message: expect.stringContaining('Failed to dismiss rule'),
        }),
      ),
    );
    expect(mockAlert.post).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(dismissButton).toBeEnabled());
  });

  it('sends the row rankShown, computed from the full sorted direction list', async () => {
    const user = userEvent.setup();
    renderPanel({
      suggestedRules: [
        // Same direction group; sorted score-desc, so rule-2 (higher score)
        // renders first (rank 0) and rule-1 renders second (rank 1).
        makeRule({ id: 'rule-1', score: 0.2 }),
        makeRule({ id: 'rule-2', score: 0.9 }),
      ],
    });

    const secondCard = screen.getByTestId('suggestion-card-rule-1');
    await user.click(
      within(secondCard).getByRole('button', { name: 'Dismiss' }),
    );

    expect(mockApi.dismissRelationshipRule).toHaveBeenCalledWith('rule-1', {
      rankShown: 1,
    });
  });

  it('passes the row rankShown into renderExpandedRule, matching the collapsed quick buttons', () => {
    const renderExpandedRule = vi.fn((rule: RelationshipRule) => (
      <div data-testid={`expanded-${rule.id}`}>inline review</div>
    ));
    renderPanel({
      suggestedRules: [
        // Same direction group; sorted score-desc, so rule-2 (higher score)
        // renders first (rank 0) and rule-1 renders second (rank 1) — the
        // same ranks the collapsed-quick-button test above asserts.
        makeRule({ id: 'rule-1', score: 0.2 }),
        makeRule({ id: 'rule-2', score: 0.9 }),
      ],
      expandedRuleId: 'rule-1',
      renderExpandedRule,
    });

    expect(renderExpandedRule).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'rule-1' }),
      1,
    );
  });

  it('expands one card inline and collapses the previous one', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderPanel({
      suggestedRules: [makeRule({ id: 'rule-1' }), makeRule({ id: 'rule-2' })],
      expandedRuleId: 'rule-1',
      onToggleRuleExpanded: onToggle,
      renderExpandedRule: rule => (
        <div data-testid={`expanded-${rule.id}`}>inline review</div>
      ),
    });

    expect(screen.getByTestId('expanded-rule-1')).toBeInTheDocument();
    expect(screen.queryByTestId('expanded-rule-2')).not.toBeInTheDocument();

    // Clicking another card's body requests its expansion (not navigation).
    await user.click(screen.getByTestId('suggestion-card-rule-2'));
    expect(onToggle).toHaveBeenCalledWith('rule-2');
  });

  it('filters every direction from one panel-level confidence control', async () => {
    const user = userEvent.setup();
    renderPanel({
      suggestedRules: [
        makeRule({ id: 'rule-high', confidenceBand: 'high' }),
        makeRule({ id: 'rule-low', confidenceBand: 'low' }),
      ],
    });

    expect(screen.getByTestId('suggestion-card-rule-high')).toBeInTheDocument();
    expect(screen.getByTestId('suggestion-card-rule-low')).toBeInTheDocument();

    const filter = screen.getByTestId('suggestion-confidence-filter');
    await user.click(within(filter).getByRole('button', { name: 'high' }));

    expect(screen.getByTestId('suggestion-card-rule-high')).toBeInTheDocument();
    expect(
      screen.queryByTestId('suggestion-card-rule-low'),
    ).not.toBeInTheDocument();
  });

  it('counts a null band as low in the filter, matching the chips', async () => {
    // availableBands and the card styling both map a missing band to 'low' —
    // a strict compare in the list filter left the Low chip advertising
    // suggestions it then hid.
    const user = userEvent.setup();
    renderPanel({
      suggestedRules: [
        makeRule({ id: 'rule-high', confidenceBand: 'high' }),
        makeRule({ id: 'rule-null', confidenceBand: null }),
      ],
    });

    const filter = screen.getByTestId('suggestion-confidence-filter');
    await user.click(within(filter).getByRole('button', { name: 'low' }));

    expect(screen.getByTestId('suggestion-card-rule-null')).toBeInTheDocument();
    expect(
      screen.queryByTestId('suggestion-card-rule-high'),
    ).not.toBeInTheDocument();
  });

  it('offers no confidence control when every suggestion shares a band', () => {
    renderPanel({
      suggestedRules: [
        makeRule({ id: 'rule-1', confidenceBand: 'high' }),
        makeRule({ id: 'rule-2', confidenceBand: 'high' }),
      ],
    });

    expect(
      screen.queryByTestId('suggestion-confidence-filter'),
    ).not.toBeInTheDocument();
  });

  it('no longer duplicates the header data-source facet with its own pills', () => {
    renderPanel({
      suggestedRules: [makeRule({})],
      datasourceLabels: new Map([
        ['source', 'GitHub'],
        ['target', 'Jira'],
      ]),
    });

    // Data-source scoping belongs to the `?ds` header facet; the panel keeps
    // only the pair selector, which the facet can't express.
    expect(
      screen.queryByRole('textbox', { name: 'Filter pills by name' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('All pairs')).toBeInTheDocument();
  });

  it('shows a "select a pair" empty state when the active "All pairs" pill is clicked off', async () => {
    const user = userEvent.setup();
    renderPanel({
      // One pair only, so it's the sole group and "All pairs" starts active
      // (every group is already selected) — clicking it toggles all off.
      suggestedRules: [makeRule({ id: 'rule-1' }), makeRule({ id: 'rule-2' })],
    });

    // The lone pair auto-selects; both cards start visible.
    expect(screen.getByTestId('suggestion-card-rule-1')).toBeInTheDocument();

    // Clicking the already-active "All pairs" pill deselects everything.
    await user.click(screen.getByRole('button', { name: /All pairs/ }));

    expect(
      screen.queryByTestId('suggestion-card-rule-1'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('suggestion-card-rule-2'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('Select a pair above to review its suggestions.'),
    ).toBeInTheDocument();
  });

  it('caps a direction at five rows with a "Show N more" button for the remainder', () => {
    const rules = Array.from({ length: 7 }, (_, i) =>
      makeRule({ id: `rule-${i}`, score: 1 - i * 0.1 }),
    );
    renderPanel({ suggestedRules: rules });

    for (let i = 0; i < 5; i++) {
      expect(
        screen.getByTestId(`suggestion-card-rule-${i}`),
      ).toBeInTheDocument();
    }
    expect(
      screen.queryByTestId('suggestion-card-rule-5'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('suggestion-card-rule-6'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Show 2 more' }),
    ).toBeInTheDocument();
  });

  it('expands a capped direction to show every row', async () => {
    const user = userEvent.setup();
    const rules = Array.from({ length: 7 }, (_, i) =>
      makeRule({ id: `rule-${i}`, score: 1 - i * 0.1 }),
    );
    renderPanel({ suggestedRules: rules });

    await user.click(screen.getByRole('button', { name: 'Show 2 more' }));

    for (let i = 0; i < 7; i++) {
      expect(
        screen.getByTestId(`suggestion-card-rule-${i}`),
      ).toBeInTheDocument();
    }
    expect(
      screen.queryByRole('button', { name: /Show \d+ more/ }),
    ).not.toBeInTheDocument();
  });

  it('bulk-dismisses all 7 rules of a direction while truncated, not just the visible 5', async () => {
    const user = userEvent.setup();
    const rules = Array.from({ length: 7 }, (_, i) =>
      makeRule({ id: `rule-${i}`, score: 1 - i * 0.1 }),
    );
    const onDismissMany = vi.fn().mockResolvedValue(undefined);
    renderPanel({ suggestedRules: rules, onDismissMany });

    await user.click(screen.getByRole('button', { name: 'Dismiss all (7)' }));

    expect(onDismissMany).toHaveBeenCalledTimes(1);
    expect(onDismissMany).toHaveBeenCalledWith(
      expect.arrayContaining(rules.map(r => r.id)),
    );
    expect(onDismissMany.mock.calls[0][0]).toHaveLength(7);
  });

  it('shows no "Show more" button when a direction has five or fewer rules', () => {
    const rules = Array.from({ length: 5 }, (_, i) =>
      makeRule({ id: `rule-${i}`, score: 1 - i * 0.1 }),
    );
    renderPanel({ suggestedRules: rules });

    expect(
      screen.queryByRole('button', { name: /Show \d+ more/ }),
    ).not.toBeInTheDocument();
  });

  it('sends the full-list rankShown for a row acted on after expansion', async () => {
    const user = userEvent.setup();
    const rules = Array.from({ length: 7 }, (_, i) =>
      makeRule({ id: `rule-${i}`, score: 1 - i * 0.1 }),
    );
    renderPanel({ suggestedRules: rules });

    await user.click(screen.getByRole('button', { name: 'Show 2 more' }));

    const sixthCard = screen.getByTestId('suggestion-card-rule-5');
    await user.click(
      within(sixthCard).getByRole('button', { name: 'Dismiss' }),
    );

    expect(mockApi.dismissRelationshipRule).toHaveBeenCalledWith('rule-5', {
      rankShown: 5,
    });
  });

  it("hides the expanded card's quick Approve/Dismiss buttons but keeps them on a collapsed card", () => {
    renderPanel({
      suggestedRules: [makeRule({ id: 'rule-1' }), makeRule({ id: 'rule-2' })],
      expandedRuleId: 'rule-1',
      onToggleRuleExpanded: vi.fn(),
      renderExpandedRule: rule => (
        <div data-testid={`expanded-${rule.id}`}>inline review</div>
      ),
    });

    const expandedCard = screen.getByTestId('suggestion-card-rule-1');
    const collapsedCard = screen.getByTestId('suggestion-card-rule-2');

    expect(
      within(expandedCard).queryByRole('button', { name: 'Approve' }),
    ).not.toBeInTheDocument();
    expect(
      within(expandedCard).queryByRole('button', { name: 'Dismiss' }),
    ).not.toBeInTheDocument();
    expect(
      within(collapsedCard).getByRole('button', { name: 'Approve' }),
    ).toBeInTheDocument();
    expect(
      within(collapsedCard).getByRole('button', { name: 'Dismiss' }),
    ).toBeInTheDocument();
  });

  it('mounts the Suppressed section above Dismissed and threads its prop', async () => {
    mockApi.listRelationshipRules.mockResolvedValue({
      items: [
        makeRule({
          id: 'dismissed-1',
          name: 'dismissed rule',
          state: 'inactive',
          reviewReason: 'manual-dismiss',
        }),
      ],
      total: 1,
    });

    renderPanel({
      suppressedSuggestions: [makeSuppressed({})],
    });

    const suppressedToggle = screen.getByRole('button', {
      name: /Suppressed this run/,
    });
    const dismissedToggle = await screen.findByRole('button', {
      name: /Dismissed/,
    });
    expect(suppressedToggle).toBeInTheDocument();
    expect(dismissedToggle).toBeInTheDocument();

    const html = document.body.innerHTML;
    expect(html.indexOf('Suppressed this run')).toBeLessThan(
      html.indexOf('Dismissed ('),
    );
  });

  it('renders no Suppressed section when there is nothing suppressed', () => {
    renderPanel();
    expect(
      screen.queryByRole('button', { name: /Suppressed this run/ }),
    ).not.toBeInTheDocument();
  });
});
