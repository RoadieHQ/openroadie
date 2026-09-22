// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { DataSourcesGraphView } from './data-sources-graph-view';
import { TestQueryProvider } from '../../../test-utils';
import { ApiContext } from '../../../api/context';
import type { ApiClients } from '../../../api/context';
import type { RelationshipRule } from '../../../api/datastore/datastore-client';
import type { DataSourceItem } from '../types';

// Forces `reviewEditor.direct.pendingRetypeCount` without driving a real
// save/flush round-trip (which requires simulating a partial-failure write
// through the datastore client) — the same escape hatch Task 5's first round
// used for the inspector-level tests, applied here so the graph view's own
// review editor sees a non-zero count.
let mockPendingRetypeCount = 0;
vi.mock('./use-direct-relationships', async () => {
  const actual = await vi.importActual<
    typeof import('./use-direct-relationships')
  >('./use-direct-relationships');
  return {
    ...actual,
    useDirectRelationships: () => ({
      directBySourceObjectId: new Map(),
      loading: false,
      hasPendingChanges: false,
      pendingRetypeCount: mockPendingRetypeCount,
      addDirect: vi.fn(),
      markRemoval: vi.fn(),
      undoDirect: vi.fn(),
      flush: vi.fn().mockResolvedValue({ failed: 0 }),
      flushing: false,
    }),
  };
});

function makeRule(overrides: Partial<RelationshipRule> = {}): RelationshipRule {
  return {
    id: 'rule-1',
    name: 'Suggested rule',
    description: null,
    sourceDatasourceId: 'ds-1',
    targetDatasourceId: 'ds-2',
    sourceFieldExpression: '$.spec.id',
    targetFieldExpression: '$.metadata.name',
    sourceFilterExpression: null,
    targetFilterExpression: null,
    relationshipType: 'dependsOn',
    reciprocalRelationshipType: 'hasDependency',
    strategy: 'field-matching',
    matchStrategy: 'exact',
    origin: 'manual',
    state: 'suggested',
    suggestionKind: null,
    score: null,
    confidenceBand: null,
    evidenceSummary: null,
    reviewReason: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeDataSource(
  overrides: Partial<DataSourceItem> = {},
): DataSourceItem {
  return {
    id: 'ds-1',
    name: 'DS 1',
    enabled: true,
    logoUrl: '',
    ...overrides,
  } as DataSourceItem;
}

const mockApis = {
  config: {},
  datastore: {
    queryRelationships: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    previewRelationshipRule: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  },
  workflows: {
    update: vi.fn(),
    delete: vi.fn(),
  },
  alert: { post: vi.fn() },
} as unknown as ApiClients;

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <TestQueryProvider>
      <MemoryRouter initialEntries={['/relationships?suggestion=rule-1']}>
        <ApiContext.Provider value={mockApis}>{children}</ApiContext.Provider>
      </MemoryRouter>
    </TestQueryProvider>
  );
}

describe('DataSourcesGraphView suggestions drawer — review exit guard', () => {
  let clientHeightSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockPendingRetypeCount = 0;
    // The drawer's resizable panel measures its own container's clientHeight
    // on mount to leave peek mode; jsdom reports 0 for every element, and this
    // component (unlike the inspector's own tests) creates its drawer
    // container internally, so there's no node to pre-set before render.
    // Stubbing the getter for every element is the only way to reach it.
    clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockReturnValue(800);
    localStorage.setItem('graph-editor-mode', JSON.stringify('suggest'));
  });

  afterEach(() => {
    clientHeightSpy.mockRestore();
    localStorage.clear();
    vi.clearAllMocks();
  });

  function renderGraphView() {
    return render(
      <DataSourcesGraphView
        dataSources={[
          makeDataSource({ id: 'ds-1' }),
          makeDataSource({ id: 'ds-2', name: 'DS 2' }),
        ]}
        schemas={[]}
        rules={[makeRule()]}
      />,
      { wrapper: Wrapper },
    );
  }

  function renderGraphViewAt(url: string, rules: RelationshipRule[]) {
    return render(
      <TestQueryProvider>
        <MemoryRouter initialEntries={[url]}>
          <ApiContext.Provider value={mockApis}>
            <DataSourcesGraphView
              dataSources={[
                makeDataSource({ id: 'ds-1' }),
                makeDataSource({ id: 'ds-2', name: 'DS 2' }),
              ]}
              schemas={[]}
              rules={rules}
            />
          </ApiContext.Provider>
        </MemoryRouter>
      </TestQueryProvider>,
    );
  }

  it('a ?rule deep link wins over a persisted Suggest mode', async () => {
    // Regression: the mount-time mode sync wiped ?rule whenever the stored
    // mode wasn't Edit, breaking every shared rule link for anyone whose
    // last-used mode was Suggest. The link is an intent; the mode follows it.
    localStorage.setItem('graph-editor-mode', JSON.stringify('suggest'));
    renderGraphViewAt('/relationships?rule=rule-active', [
      makeRule({ id: 'rule-active', state: 'active' }),
    ]);

    expect(
      await screen.findByRole('radio', { name: 'Edit', checked: true }),
    ).toBeInTheDocument();
    // The rule editor drawer actually opened — the param survived.
    expect(
      await screen.findByRole('button', { name: 'Save' }),
    ).toBeInTheDocument();
  });

  it('a ?suggestion deep link wins over a persisted Edit mode', async () => {
    localStorage.setItem('graph-editor-mode', JSON.stringify('edit'));
    renderGraphViewAt('/relationships?suggestion=rule-1', [makeRule()]);

    expect(
      await screen.findByRole('radio', { name: 'Suggest', checked: true }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Review rule')).toBeInTheDocument();
    // The deep-link sync's selection survives the mode override's cleanup
    // pass — the (hidden) list card keeps its highlight ring. Regression:
    // that pass treated the override as "leaving Edit" and deselected the
    // suggestion it had just selected.
    await waitFor(() => {
      expect(screen.getByTestId('suggestion-card-rule-1').className).toContain(
        'ring-1',
      );
    });
  });

  it('guards the drawer close button, not just the breadcrumb', async () => {
    mockPendingRetypeCount = 2;
    const user = userEvent.setup();
    renderGraphView();

    const closeButton = await screen.findByRole('button', {
      name: 'Close drawer',
    });
    await user.click(closeButton);

    expect(
      screen.getByText('Some direct relationships kept the previous type'),
    ).toBeInTheDocument();
    // Cancelling the confirmation must leave the review view active, not
    // close it out from under the guard.
    expect(screen.getByText('Review rule')).toBeInTheDocument();
  });

  it('guards Escape, which the editor shell handles outside the drawer chrome', async () => {
    mockPendingRetypeCount = 2;
    const user = userEvent.setup();
    renderGraphView();

    await screen.findByText('Review rule');
    await user.keyboard('{Escape}');

    // Regression: Escape reached the inspector's own `onClose` directly, which
    // was the bare `closeSuggestion` — no confirmation, and it dropped the user
    // back on the list rather than dismissing the drawer.
    expect(
      screen.getByText('Some direct relationships kept the previous type'),
    ).toBeInTheDocument();
    expect(screen.getByText('Review rule')).toBeInTheDocument();
  });

  it('a pane click with nothing pending actually closes the review', async () => {
    mockPendingRetypeCount = 0;
    const { container } = renderGraphView();

    await screen.findByText('Review rule');
    fireEvent.click(
      container.querySelector('.react-flow__pane') as HTMLElement,
    );

    // Regression: clearSelection dropped ?suggestion and closeRuleEditor then
    // wrote the URL again from the same render's params, resurrecting it —
    // the drawer stayed open after every canvas click.
    await waitFor(() => {
      expect(screen.queryByText('Review rule')).not.toBeInTheDocument();
    });
  });

  it('guards a pane click, which clears the review with the rest of the selection', async () => {
    mockPendingRetypeCount = 2;
    const { container } = renderGraphView();

    await screen.findByText('Review rule');
    const pane = container.querySelector('.react-flow__pane');
    expect(pane).not.toBeNull();
    // A bare click, not userEvent: the pane also carries d3-zoom's mousedown
    // listener, which reads `event.view` — null on jsdom's synthetic events —
    // and throws before the click ever lands.
    fireEvent.click(pane as HTMLElement);

    // Regression: a stray canvas click went straight to clearSelection,
    // dropping ?suggestion — and the pending retypes — with no confirmation.
    expect(
      screen.getByText('Some direct relationships kept the previous type'),
    ).toBeInTheDocument();
    expect(screen.getByText('Review rule')).toBeInTheDocument();
  });

  it('guards the mode switch out of Suggest, whose sync effect closes the review', async () => {
    mockPendingRetypeCount = 2;
    const user = userEvent.setup();
    renderGraphView();

    await screen.findByText('Review rule');
    await user.click(screen.getByRole('radio', { name: 'Edit' }));

    expect(
      screen.getByText('Some direct relationships kept the previous type'),
    ).toBeInTheDocument();
    // The switch itself is what's deferred — Suggest (and its review) stay
    // active until the user confirms, so cancelling loses nothing.
    expect(screen.getByText('Review rule')).toBeInTheDocument();
  });

  it('lets Escape dismiss the whole drawer when there is nothing pending to lose', async () => {
    mockPendingRetypeCount = 0;
    const user = userEvent.setup();
    renderGraphView();

    await screen.findByText('Review rule');
    await user.keyboard('{Escape}');

    expect(
      screen.queryByText('Some direct relationships kept the previous type'),
    ).not.toBeInTheDocument();
    // Escape matches the ✕: the whole drawer goes, not just the review view.
    expect(screen.queryByText('Review rule')).not.toBeInTheDocument();
    expect(screen.queryByText('Suggestions')).not.toBeInTheDocument();
  });

  it('renders one close affordance in the review header, not two', async () => {
    mockPendingRetypeCount = 0;
    renderGraphView();

    await screen.findByText('Review rule');
    // The action cluster's "Cancel" ✕ was pixel-identical to the drawer's
    // "Close drawer" ✕ but did something else.
    expect(
      screen.queryByRole('button', { name: 'Cancel' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Close drawer' }),
    ).toBeInTheDocument();
  });
});
