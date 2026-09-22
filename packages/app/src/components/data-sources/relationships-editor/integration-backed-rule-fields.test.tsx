import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from '@roadiehq/ui/input';
import { IntegrationBackedRuleFields } from './integration-backed-rule-fields';
import type { IntegrationBackedConfig } from '../../../api/datastore/datastore-client';
import type { RelationshipRuleEditorState } from './use-relationship-rule-editor';

// The real selector reads integrations from ApiContext; stub it to a plain
// input so we can exercise the config-merge logic in isolation.
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

// The real field streams from the AI agent; a plain input is enough here.
vi.mock('../data-source-editor/jsonata-expression-field', () => ({
  JsonataExpressionField: ({
    label,
    value,
    onChange,
  }: {
    label?: string;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <Input
      aria-label={label}
      value={value}
      onChange={event => onChange(event.target.value)}
    />
  ),
}));

const BASE_CONFIG: IntegrationBackedConfig = {
  integrationId: 'github',
  method: 'GET',
  path: '/repos/{value}/teams',
  responseMatchExpression: '$.slug',
};

function makeEditor(configOverrides: Partial<IntegrationBackedConfig> = {}): {
  editor: RelationshipRuleEditorState;
  setIntegrationConfig: ReturnType<typeof vi.fn>;
} {
  const setIntegrationConfig = vi.fn();
  const editor = {
    integrationConfig: { ...BASE_CONFIG, ...configOverrides },
    setIntegrationConfig,
    relationshipType: 'ownerOf',
    handleRelationshipTypeChange: vi.fn(),
    reciprocalRelationshipType: '',
    handleReciprocalChange: vi.fn(),
    relationshipTypeOptions: [],
    isDuplicate: false,
    isReciprocalDuplicate: false,
  } as unknown as RelationshipRuleEditorState;
  return { editor, setIntegrationConfig };
}

describe('IntegrationBackedRuleFields', () => {
  it('merges a request-path edit without dropping the rest of the config', async () => {
    const user = userEvent.setup();
    // Controlled input never re-renders here (setIntegrationConfig is a spy),
    // so a single keystroke lands as the whole value.
    const { editor, setIntegrationConfig } = makeEditor({ path: '' });
    render(<IntegrationBackedRuleFields editor={editor} />);

    await user.type(screen.getByLabelText('Request path'), '/');

    expect(setIntegrationConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        integrationId: 'github',
        method: 'GET',
        responseMatchExpression: '$.slug',
        path: '/',
      }),
    );
  });

  it('records an integration selection while preserving other fields', () => {
    const { editor, setIntegrationConfig } = makeEditor();
    render(<IntegrationBackedRuleFields editor={editor} />);

    fireEvent.change(screen.getByLabelText('Integration'), {
      target: { value: 'jira' },
    });

    expect(setIntegrationConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: '/repos/{value}/teams',
        responseMatchExpression: '$.slug',
        integrationId: 'jira',
      }),
    );
  });

  it('shows the configured request method without claiming the external call is read-only', () => {
    const { editor } = makeEditor({ method: 'POST' });

    render(<IntegrationBackedRuleFields editor={editor} />);

    expect(screen.getByText('POST')).toBeInTheDocument();
    expect(
      screen.getByText(/does not write catalog relationships/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/writes nothing/i)).not.toBeInTheDocument();
  });

  it('keeps backend-resolved advanced request paths read-only', () => {
    const { editor, setIntegrationConfig } = makeEditor({
      pathExpression: '"/repos/" & sourceValue',
    });

    render(<IntegrationBackedRuleFields editor={editor} />);

    expect(screen.getByLabelText('Request path')).toBeDisabled();
    expect(
      screen.getByText(/advanced request path resolved by the backend/i),
    ).toBeInTheDocument();
    expect(setIntegrationConfig).not.toHaveBeenCalled();
  });

  it('hides relationship-type, reverse and Filters when showRelationshipFields is false', () => {
    const { editor } = makeEditor();
    render(
      <IntegrationBackedRuleFields
        editor={editor}
        showRelationshipFields={false}
      />,
    );

    // Request fields still render...
    expect(screen.getByLabelText('Integration')).toBeInTheDocument();
    expect(screen.getByLabelText('Request path')).toBeInTheDocument();
    // ...but the relationship-owning blocks are delegated to the stages.
    expect(
      screen.queryByLabelText('Relationship type'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Reverse relationship/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /filters/i }),
    ).not.toBeInTheDocument();
  });
});
