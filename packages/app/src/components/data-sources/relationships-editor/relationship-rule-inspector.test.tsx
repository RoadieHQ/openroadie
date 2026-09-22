import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { Input } from '@roadiehq/ui/input';
import { RelationshipRuleInspector } from './relationship-rule-inspector';
import { useRelationshipRuleEditor } from './use-relationship-rule-editor';
import { TestQueryProvider } from '../../../test-utils';
import { ApiContext } from '../../../api/context';
import type { ApiClients } from '../../../api/context';
import type { RelationshipRule } from '../../../api/datastore/datastore-client';

vi.mock('../../integrations/use-integrations', () => ({
  useIntegrations: () => ({
    integrations: [{ id: 'github', name: 'GitHub (Token)' }],
    logoDataUriBySlug: new Map(),
    loading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
}));

// The stepped step-list resolves an integration logo via the workflows client;
// stub it so the tests don't need the full ApiContext.
vi.mock('../use-resolved-logo', () => ({
  useLogoResolver: () => () => '',
}));

vi.mock('../../common/integration-selector', () => ({
  IntegrationSelector: ({
    selectedIntegrationId,
    onSelect,
    label,
  }: {
    selectedIntegrationId?: string;
    onSelect: (integration: { id: string; backendType: 'http' }) => void;
    label?: string;
  }) => (
    <Input
      aria-label={label ?? 'Integration'}
      value={selectedIntegrationId ?? ''}
      onChange={event =>
        onSelect({ id: event.target.value, backendType: 'http' })
      }
    />
  ),
}));

function makeRule(overrides: Partial<RelationshipRule> = {}): RelationshipRule {
  return {
    id: 'r1',
    name: 'Rule',
    description: null,
    sourceDatasourceId: 'src-ds',
    targetDatasourceId: 'tgt-ds',
    sourceFieldExpression: '$.spec.id',
    targetFieldExpression: '$.metadata.name',
    sourceFilterExpression: null,
    targetFilterExpression: null,
    relationshipType: 'dependsOn',
    reciprocalRelationshipType: 'hasDependency',
    strategy: 'field-matching',
    matchStrategy: 'exact',
    origin: 'manual',
    state: 'active',
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

const INTEGRATION_CONFIG = {
  integrationId: 'github',
  method: 'GET',
  path: '/users/{value}/teams',
  responseMatchExpression: '$.teams[*].slug',
};

// The pipeline's per-part preview fetches sample objects via the datastore
// client, so renders need an ApiContext alongside the query client.
const mockApis = {
  datastore: {
    getObject: vi
      .fn()
      .mockResolvedValue({ object: { id: 'obj-1', name: 'sample' } }),
  },
} as unknown as ApiClients;

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <TestQueryProvider>
      <MemoryRouter>
        <ApiContext.Provider value={mockApis}>{children}</ApiContext.Provider>
      </MemoryRouter>
    </TestQueryProvider>
  );
}

describe('RelationshipRuleInspector', () => {
  let portalHost: HTMLDivElement;

  beforeEach(() => {
    portalHost = document.createElement('div');
    portalHost.style.height = '800px';
    portalHost.style.position = 'relative';
    document.body.appendChild(portalHost);
    // jsdom reports clientHeight 0 for plain divs; the drawer needs a non-zero
    // container height to leave peek mode and render the body.
    Object.defineProperty(portalHost, 'clientHeight', {
      configurable: true,
      value: 800,
    });
  });

  afterEach(() => {
    portalHost.remove();
  });

  function renderInspector(
    overrides: Partial<
      React.ComponentProps<typeof RelationshipRuleInspector>
    > = {},
  ) {
    const onClose = vi.fn();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onPreview = vi.fn().mockResolvedValue({
      items: [
        {
          sourceObjectId: 'obj-1',
          relationshipType: 'dependsOn',
          targetObjectIds: ['t-1'],
          targetLabels: ['octocat'],
          matchTargetValues: ['octocat'],
          targetValue: 'octocat',
        },
      ],
      total: 1,
    });
    const props: React.ComponentProps<typeof RelationshipRuleInspector> = {
      open: true,
      container: portalHost,
      sourceDatasourceId: 'src-ds',
      targetDatasourceId: 'tgt-ds',
      sourceLabel: 'Source',
      targetLabel: 'Target',
      sourceFields: [],
      targetFields: [],
      onClose,
      onSave,
      onPreview,
      ...overrides,
    };
    render(<RelationshipRuleInspector {...props} />, {
      wrapper: Wrapper,
    });
    return { ...props, onClose, onSave, onPreview };
  }

  /** Renders the inspector against a real editor whose retype count is forced,
   *  which no public API can produce on demand. */
  function InspectorWithPendingRetypes({
    guardClose,
    onClose,
  }: {
    guardClose?: boolean;
    onClose: () => void;
  }) {
    const editorOptions = {
      open: true,
      sourceDatasourceId: 'src-ds',
      targetDatasourceId: 'tgt-ds',
      sourceLabel: 'Source',
      targetLabel: 'Target',
      sourceFields: [],
      targetFields: [],
      existingRule: makeRule({ state: 'suggested' }),
      onClose,
      onSave: vi.fn().mockResolvedValue(undefined),
    };
    const editor = useRelationshipRuleEditor(editorOptions);
    const patched = {
      ...editor,
      direct: { ...editor.direct, pendingRetypeCount: 2 },
    };
    return (
      <RelationshipRuleInspector
        {...editorOptions}
        container={portalHost}
        editor={patched}
        guardClose={guardClose}
      />
    );
  }

  it('closes immediately when the chrome owns the exits, even with pending retypes', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <InspectorWithPendingRetypes guardClose={false} onClose={onClose} />,
      {
        wrapper: Wrapper,
      },
    );

    await user.keyboard('{Escape}');

    // A DrawerStack is running the one guard for every exit; a second prompt
    // here would ask the same question twice.
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText('Some direct relationships kept the previous type'),
    ).not.toBeInTheDocument();
  });

  it('guards its own close when it owns the exits', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<InspectorWithPendingRetypes onClose={onClose} />, {
      wrapper: Wrapper,
    });

    await user.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByText('Some direct relationships kept the previous type'),
    ).toBeInTheDocument();
  });

  it('renders the new-rule title when no existing rule is provided', () => {
    renderInspector();
    expect(screen.getByText('New Relationship Rule')).toBeInTheDocument();
  });

  it('renders the edit title for an active stored rule', () => {
    renderInspector({ existingRule: makeRule({ state: 'active' }) });
    expect(screen.getByText('Edit Relationship Rule')).toBeInTheDocument();
  });

  it('renders the suggested-rule title when the rule is a suggestion', () => {
    renderInspector({ existingRule: makeRule({ state: 'suggested' }) });
    expect(screen.getByText('Review Suggested Rule')).toBeInTheDocument();
  });

  it('reviews a suggestion with one primary button, not Save beside Approve', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    renderInspector({
      existingRule: makeRule({ state: 'suggested' }),
      onApprove,
    });

    // Approving IS the save here, so there is no second "Save" to confuse it
    // with, and accepting the suggestion as-is needs no edit.
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    const approve = screen.getByRole('button', { name: 'Approve' });
    await waitFor(() => expect(approve).toBeEnabled());
  });

  it('relabels the suggestion action Create once the reviewer changes it', async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn().mockResolvedValue(undefined);
    renderInspector({
      existingRule: makeRule({ state: 'suggested' }),
      onApprove,
    });

    await user.click(
      await screen.findByRole('button', { name: /show preview panels/i }),
    );
    await user.click(
      await screen.findByRole('button', { name: /configure match/i }),
    );
    const relType = await screen.findByLabelText('Relationship type');
    await user.clear(relType);
    await user.type(relType, 'ownedBy');

    // A reshaped suggestion is no longer the thing that was suggested.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Create' }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('disables Save on a stored rule until something changes', async () => {
    const user = userEvent.setup();
    renderInspector({ existingRule: makeRule({ state: 'active' }) });

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await user.hover(save);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'No changes to save.',
    );

    await user.click(
      await screen.findByRole('button', { name: /show preview panels/i }),
    );
    await user.click(
      await screen.findByRole('button', { name: /configure match/i }),
    );
    const relType = await screen.findByLabelText('Relationship type');
    await user.clear(relType);
    await user.type(relType, 'ownedBy');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
  });

  it('links each header endpoint to its data source in a new tab', () => {
    renderInspector({ sourceLabel: 'K8s Pods', targetLabel: 'GitHub Users' });
    const sourceLink = screen.getByRole('link', { name: /K8s Pods/i });
    const targetLink = screen.getByRole('link', { name: /GitHub Users/i });
    expect(sourceLink).toHaveAttribute('href', '/data-sources/src-ds');
    expect(targetLink).toHaveAttribute('href', '/data-sources/tgt-ds');
    expect(sourceLink).toHaveAttribute('target', '_blank');
    expect(targetLink).toHaveAttribute('target', '_blank');
    expect(sourceLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders the body without the drawer header for standalone composition', () => {
    renderInspector({ showHeader: false });
    // The playground still renders even when the internal header is hidden.
    expect(screen.getByText(/generated relationships/i)).toBeInTheDocument();
  });

  it('shows all pipeline columns with per-column config toggles for a new rule', async () => {
    renderInspector();
    // Every column is visible and carries a cogwheel to flip it to its
    // configuration; the step map offers a "+" to insert a lookup and a Target.
    expect(
      await screen.findByRole('button', { name: /configure source/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /configure target/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /add lookup step/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Target/ })).toBeInTheDocument();
  });

  it('flips a column to its configuration via the cogwheel', async () => {
    const user = userEvent.setup();
    renderInspector({ existingRule: makeRule({ state: 'active' }) });
    // Existing rules land with the preview panels collapsed — expand them first.
    await user.click(
      await screen.findByRole('button', { name: /show preview panels/i }),
    );
    // The target column starts on its object preview; the cogwheel reveals the
    // target configuration — now just the target field (edge config lives on the
    // Match column).
    await user.click(
      await screen.findByRole('button', { name: /configure target/i }),
    );
    expect(await screen.findByLabelText('Target field')).toBeInTheDocument();
  });

  it('adds a Lookup stage, switching a rule to an integration lookup', async () => {
    const user = userEvent.setup();
    renderInspector();
    // The "+" between Source and Target inserts the lookup step.
    await user.click(
      await screen.findByRole('button', { name: /add lookup step/i }),
    );
    // The lookup is added and its configuration becomes the active step.
    expect(await screen.findByLabelText('Integration')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Lookup/ })).toBeInTheDocument();
  });

  it('hydrates an integration-backed rule as a Lookup stage', async () => {
    const user = userEvent.setup();
    renderInspector({
      existingRule: makeRule({
        strategy: 'integration-backed',
        integrationConfig: INTEGRATION_CONFIG,
      }),
    });
    await user.click(
      await screen.findByRole('button', { name: /show preview panels/i }),
    );
    await user.click(
      await screen.findByRole('button', { name: /configure http lookup/i }),
    );
    expect(await screen.findByLabelText('Integration')).toHaveValue('github');
    expect(screen.getByLabelText('Request path')).toHaveValue(
      '/users/{value}/teams',
    );
  });

  it('shows a run-preview empty state for an integration-backed rule before previewing', async () => {
    renderInspector({
      existingRule: makeRule({
        strategy: 'integration-backed',
        integrationConfig: INTEGRATION_CONFIG,
      }),
    });
    expect(
      await screen.findByText(/resolves matches through a live lookup/i),
    ).toBeInTheDocument();
    // The empty-state control carries a visible "Run preview" label (the Lookup
    // step's run control is icon-only), so query by text to disambiguate.
    expect(screen.getByText('Run preview')).toBeInTheDocument();
  });

  it('runs a preview then enables save for an integration-backed rule', async () => {
    const user = userEvent.setup();
    const { onSave, onPreview } = renderInspector({
      existingRule: makeRule({
        strategy: 'integration-backed',
        integrationConfig: INTEGRATION_CONFIG,
      }),
    });

    // Inspecting the unchanged rule: no "run a preview" hint, and save stays
    // disabled until a preview has run.
    expect(
      screen.queryByText(/Save is available after you run a preview/i),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    // Give it something to save; the preview is the other half of the gate.
    await user.click(
      await screen.findByRole('button', { name: /show preview panels/i }),
    );
    await user.click(
      await screen.findByRole('button', { name: /configure http lookup/i }),
    );
    const path = await screen.findByLabelText('Request path');
    await user.clear(path);
    // "{{" is user-event's escape for a literal "{" — the path is a template.
    await user.type(path, '/users/{{value}/orgs');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await user.click(await screen.findByText('Run preview'));
    await waitFor(() =>
      expect(onPreview).toHaveBeenCalledWith(
        expect.objectContaining({
          strategy: 'integration-backed',
          integrationConfig: expect.objectContaining({
            path: '/users/{value}/orgs',
          }),
        }),
        { sampleLimit: 5 },
      ),
    );

    const save = screen.getByRole('button', { name: 'Save' });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          strategy: 'integration-backed',
          integrationConfig: expect.objectContaining({
            path: '/users/{value}/orgs',
          }),
        }),
      ),
    );
  });

  it('runs to fetch the response before a response field is set, without materializing', async () => {
    const user = userEvent.setup();
    const { onPreview } = renderInspector({
      existingRule: makeRule({
        strategy: 'integration-backed',
        integrationConfig: {
          integrationId: 'github',
          method: 'GET',
          path: '/repos/{value}/commits',
          // Request configured, but no response field picked yet.
          responseMatchExpression: '',
        },
      }),
    });

    // The run is enabled once the request is complete — you don't have to set a
    // response field first, because running is how you fetch the response to
    // pick that field from.
    const run = await screen.findByText('Run preview');
    expect(run).toBeEnabled();

    // Running with no response match must NOT hit the backend materialization;
    // it only fetches the response for inspection.
    await user.click(run);
    expect(onPreview).not.toHaveBeenCalled();
  });

  it('shows the run-a-preview hint only after the rule is changed', async () => {
    const user = userEvent.setup();
    renderInspector({
      existingRule: makeRule({
        strategy: 'integration-backed',
        integrationConfig: INTEGRATION_CONFIG,
      }),
    });

    // Just inspecting: nothing changed, so no hint.
    expect(
      screen.queryByText(/Save is available after you run a preview/i),
    ).not.toBeInTheDocument();

    // Change a field — the hint now appears.
    await user.click(
      await screen.findByRole('button', { name: /show preview panels/i }),
    );
    await user.click(
      await screen.findByRole('button', { name: /configure http lookup/i }),
    );
    const path = await screen.findByLabelText('Request path');
    await user.clear(path);
    await user.type(path, '/users/{value}/orgs');

    // The hint now rides the Save button as a tooltip — hover to reveal it.
    await user.hover(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      /Save is available after you run a preview/i,
    );
  });

  it('surfaces bounded integration preview warnings', async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn().mockResolvedValue({
      items: [],
      total: 40,
      truncated: true,
      skippedSources: ['repo-2', 'repo-3'],
    });
    renderInspector({
      existingRule: makeRule({
        strategy: 'integration-backed',
        integrationConfig: {
          integrationId: 'github',
          method: 'GET',
          path: '/repos/{value}/teams',
          responseMatchExpression: '$.slug',
        },
      }),
      onPreview,
    });

    await user.click(await screen.findByText('Run preview'));
    expect(
      await screen.findByText(/sample was truncated/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 source calls failed/i)).toBeInTheDocument();
  });

  it('shows duplicate-rule feedback on the relationship type', async () => {
    const user = userEvent.setup();
    const existing = makeRule({ id: 'r1' });
    const collide = makeRule({ id: 'r2' });
    renderInspector({
      existingRule: existing,
      existingRules: [existing, collide],
    });
    // The relationship type lives on the Match column's config (the edge), not
    // the Target endpoint. Expand the pipeline, then open the Match config.
    await user.click(
      await screen.findByRole('button', { name: /show preview panels/i }),
    );
    await user.click(
      await screen.findByRole('button', { name: /configure match/i }),
    );
    const relType = await screen.findByLabelText('Relationship type');
    await waitFor(() =>
      expect(relType).toHaveAttribute('aria-invalid', 'true'),
    );
    expect(relType).toHaveAccessibleDescription(
      /A rule with these settings already exists/i,
    );
  });

  it('exposes a configurable Match panel for a field-matching rule', async () => {
    renderInspector();
    // The Match column in the pipeline carries a cogwheel that opens its
    // comparison-strategy config (field-matching rules only). New rules open
    // with the pipeline expanded, so the control is visible.
    expect(
      await screen.findByRole('button', { name: /configure match/i }),
    ).toBeInTheDocument();
  });

  it('calls onClose when Escape is pressed', () => {
    const { onClose } = renderInspector();
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
