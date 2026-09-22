import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Button } from '@roadiehq/ui/button';
import { renderWithQuery as render } from '../../../test-utils';
import { IntegrationSelector } from './integration-selector';
import type { WorkflowClient } from '../../../api';
import type { Integration } from '../../integrations/types';
import { useIntegrationSecretStatus } from '../../integrations/use-integration-secret-status';

vi.mock('../../integrations/use-integration-secret-status', () => ({
  useIntegrationSecretStatus: vi.fn(),
  useInvalidateIntegrationSecretStatus: () => vi.fn(),
}));

// The decoupled selector falls back to this hook outside the editor context;
// mocked because it reaches for the app-wide API context.
vi.mock('../../integrations/use-integrations', () => ({
  useIntegrations: vi.fn(() => ({
    integrations: [],
    loading: false,
    error: undefined,
    refetch: vi.fn(),
  })),
}));

vi.mock('../../integrations/form', () => ({
  IntegrationFormDialog: ({
    open,
    onSaved,
    lockCreateBackendType,
  }: {
    open: boolean;
    onSaved: (integration: Integration) => void;
    lockCreateBackendType?: boolean;
  }) =>
    open ? (
      <>
        <Button
          type="button"
          onClick={() =>
            onSaved({
              id: 'int-created',
              name: 'Zendesk',
              slug: 'zendesk',
              type: 'other',
              host: 'https://example.com',
              backendType: 'http',
              authType: 'none',
              authConfig: null,
              config: {},
              createdBy: 'user',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              logoUrl: '',
            })
          }
        >
          Save mock integration
        </Button>
        {!lockCreateBackendType && (
          <Button
            type="button"
            onClick={() =>
              onSaved({
                id: 'int-aws',
                name: 'AWS Org',
                slug: 'aws-org',
                type: 'cloud',
                host: '',
                backendType: 'aws',
                authType: 'none',
                authConfig: null,
                config: {},
                createdBy: 'user',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
                logoUrl: '',
              })
            }
          >
            Save mock aws integration
          </Button>
        )}
      </>
    ) : null,
}));

vi.mock('../../integrations/form/required-secrets-panel', () => ({
  RequiredSecretsPanel: ({ secretRefs }: { secretRefs: string[] }) => (
    <div data-testid="required-secrets-panel">{secretRefs.join(',')}</div>
  ),
}));

const integrations: Integration[] = [
  {
    id: 'int-ready',
    name: 'GitHub',
    slug: 'github',
    type: 'scm',
    host: 'https://api.github.com',
    backendType: 'http',
    authType: 'header',
    authConfig: {},
    config: {},
    createdBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    logoUrl: '',
  },
  {
    id: 'int-setup',
    name: 'Harness',
    slug: 'harness',
    type: 'ci-cd',
    host: 'https://app.harness.io',
    backendType: 'http',
    authType: 'header',
    authConfig: {
      headers: {
        'x-api-key': '${HARNESS_API_KEY}',
      },
    },
    config: {},
    createdBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    logoUrl: '',
  },
];

// Held separately from the cast client: casting to WorkflowClient erases the
// mock's own type, so per-test `mockResolvedValueOnce` needs this reference.
const listIntegrations = vi
  .fn<WorkflowClient['integrations']['list']>()
  .mockResolvedValue({ data: integrations, total: integrations.length });

const mockWorkflowApi = {
  integrations: { list: listIntegrations },
} as unknown as WorkflowClient;

// The decoupled selector fetches through an owner-supplied `listClient` (here
// the mocked workflow client) instead of reading the data-source editor context.
function renderSelector(
  props?: Partial<React.ComponentProps<typeof IntegrationSelector>>,
) {
  return render(
    <IntegrationSelector
      listClient={mockWorkflowApi}
      onSelect={vi.fn()}
      {...props}
    />,
  );
}

function renderControlledSelector(
  onSelect?: (integration: Integration) => void,
) {
  function Wrapper() {
    const [selectedIntegrationId, setSelectedIntegrationId] = React.useState<
      string | undefined
    >();

    return (
      <IntegrationSelector
        listClient={mockWorkflowApi}
        selectedIntegrationId={selectedIntegrationId}
        onSelect={integration => {
          setSelectedIntegrationId(integration.id);
          onSelect?.(integration);
        }}
      />
    );
  }

  return render(<Wrapper />);
}

describe('IntegrationSelector', () => {
  it('filters integrations when a caller restricts compatible backends', async () => {
    const awsIntegration: Integration = {
      ...integrations[0],
      id: 'int-aws',
      name: 'AWS',
      slug: 'aws',
      backendType: 'aws',
    };
    render(
      <IntegrationSelector
        integrations={[...integrations, awsIntegration]}
        integrationFilter={integration => integration.backendType === 'http'}
        onSelect={vi.fn()}
      />,
    );

    fireEvent.focus(await screen.findByRole('combobox'));
    expect(await screen.findByText('GitHub')).toBeInTheDocument();
    expect(screen.queryByText('AWS')).not.toBeInTheDocument();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useIntegrationSecretStatus).mockReturnValue({
      summariesByIntegrationId: new Map([
        [
          'int-ready',
          {
            requiredSecretRefs: [],
            missingSecretRefs: [],
            hasRequiredConfig: true,
            configured: true,
          },
        ],
        [
          'int-setup',
          {
            requiredSecretRefs: ['HARNESS_API_KEY'],
            // Harness has a host, so its required config IS satisfied —
            // `hasRequiredConfig` covers host/AWS/GitHub-app readiness only. The
            // missing secret is the sole reason it is unconfigured, which is what
            // this fixture is here to exercise.
            missingSecretRefs: ['HARNESS_API_KEY'],
            hasRequiredConfig: true,
            configured: false,
          },
        ],
      ]),
      loading: false,
    });
  });

  it('splits integrations into configured and missing configuration groups', async () => {
    renderSelector();

    const combobox = await screen.findByRole('combobox');
    fireEvent.focus(combobox);

    await screen.findByText('Configured');
    expect(screen.getByText('Missing configuration')).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('Harness')).toBeInTheDocument();
    expect(screen.getByLabelText('1 missing secret')).toBeInTheDocument();
  });

  it('pins create new integration to the bottom of the list', async () => {
    renderSelector();

    const combobox = await screen.findByRole('combobox');
    fireEvent.focus(combobox);

    const listbox = await screen.findByRole('listbox');
    const options = within(listbox).getAllByRole('option');

    expect(options[options.length - 1]).toHaveTextContent(
      'Create new integration',
    );
  });

  it('shows the inline missing secrets panel for the selected unconfigured integration', async () => {
    renderSelector({ selectedIntegrationId: 'int-setup' });

    expect(await screen.findByLabelText('Needs setup')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('required-secrets-panel')).toHaveTextContent(
        'HARNESS_API_KEY',
      ),
    );
  });

  it('allows selecting an integration that still needs setup', async () => {
    const onSelect = vi.fn();
    renderSelector({ onSelect });

    const combobox = await screen.findByRole('combobox');
    fireEvent.focus(combobox);

    fireEvent.mouseDown(await screen.findByText('Harness'));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'int-setup' }),
    );
  });

  it('lists integrations that are not fully configured and allows selecting them', async () => {
    const scopeSetupIntegration: Integration = {
      id: 'int-scope-setup',
      name: 'PagerDuty',
      slug: 'pagerduty',
      type: 'incident-management',
      host: 'https://api.pagerduty.com',
      backendType: 'http',
      authType: 'header',
      authConfig: {},
      config: {},
      readyForCurrentScope: false,
      createdBy: 'system',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      logoUrl: '',
    };
    listIntegrations.mockResolvedValueOnce({
      data: [...integrations, scopeSetupIntegration],
      total: integrations.length + 1,
    });
    vi.mocked(useIntegrationSecretStatus).mockReturnValue({
      summariesByIntegrationId: new Map([
        [
          'int-ready',
          {
            requiredSecretRefs: [],
            missingSecretRefs: [],
            hasRequiredConfig: true,
            configured: true,
          },
        ],
        [
          'int-setup',
          {
            requiredSecretRefs: ['HARNESS_API_KEY'],
            // Harness has a host, so its required config IS satisfied —
            // `hasRequiredConfig` covers host/AWS/GitHub-app readiness only. The
            // missing secret is the sole reason it is unconfigured, which is what
            // this fixture is here to exercise.
            missingSecretRefs: ['HARNESS_API_KEY'],
            hasRequiredConfig: true,
            configured: false,
          },
        ],
        [
          'int-scope-setup',
          {
            requiredSecretRefs: [],
            missingSecretRefs: [],
            hasRequiredConfig: true,
            configured: true,
          },
        ],
      ]),
      loading: false,
    });

    const onSelect = vi.fn();
    renderSelector({ onSelect });

    const combobox = await screen.findByRole('combobox');
    fireEvent.focus(combobox);

    expect(screen.getByText('PagerDuty').closest('li')).toBeInTheDocument();

    fireEvent.mouseDown(await screen.findByText('PagerDuty'));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'int-scope-setup' }),
    );
  });

  it('treats a GitHub App integration with no installations as missing configuration', async () => {
    const githubEnterpriseApp: Integration = {
      id: 'int-gh-app',
      name: 'GitHub Enterprise (App)',
      slug: 'github-enterprise-app',
      type: 'scm',
      host: 'https://ghe.example.com/api/v3',
      backendType: 'http',
      authType: 'none',
      authConfig: null,
      config: {},
      readyForCurrentScope: true,
      createdBy: 'system',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      logoUrl: '',
      extensions: { githubApps: [] },
    };
    listIntegrations.mockResolvedValueOnce({
      data: [...integrations, githubEnterpriseApp],
      total: integrations.length + 1,
    });
    vi.mocked(useIntegrationSecretStatus).mockReturnValue({
      summariesByIntegrationId: new Map([
        [
          'int-ready',
          {
            requiredSecretRefs: [],
            missingSecretRefs: [],
            hasRequiredConfig: true,
            configured: true,
            checkingReadiness: false,
          },
        ],
        [
          'int-setup',
          {
            requiredSecretRefs: ['HARNESS_API_KEY'],
            missingSecretRefs: ['HARNESS_API_KEY'],
            hasRequiredConfig: true,
            configured: false,
            checkingReadiness: false,
          },
        ],
        [
          'int-gh-app',
          {
            requiredSecretRefs: [],
            missingSecretRefs: [],
            hasRequiredConfig: false,
            configured: false,
            checkingReadiness: false,
          },
        ],
      ]),
      loading: false,
    });

    renderSelector();

    const combobox = await screen.findByRole('combobox');
    fireEvent.focus(combobox);

    expect(screen.getByText('GitHub Enterprise (App)')).toBeInTheDocument();
    expect(screen.getByText('Missing configuration')).toBeInTheDocument();
  });

  it('focuses and opens the dropdown on mount when autoFocusOnMount is set', async () => {
    render(
      <IntegrationSelector
        listClient={mockWorkflowApi}
        onSelect={vi.fn()}
        autoFocusOnMount
      />,
    );

    const combobox = await screen.findByRole('combobox');
    await waitFor(() => expect(combobox).toHaveFocus());
    await screen.findByRole('listbox');
  });

  it('does not auto-focus when editing an existing data source', async () => {
    renderSelector();

    const combobox = await screen.findByRole('combobox');
    await waitFor(() =>
      expect(mockWorkflowApi.integrations.list).toHaveBeenCalled(),
    );
    expect(combobox).not.toHaveFocus();
  });

  it('renders integrations passed via props without an editor context and fires onSelect', async () => {
    const onSelect = vi.fn();
    render(
      <IntegrationSelector integrations={integrations} onSelect={onSelect} />,
    );

    const combobox = await screen.findByRole('combobox');
    fireEvent.focus(combobox);

    expect(await screen.findByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('Harness')).toBeInTheDocument();
    // No self-fetching in decoupled mode.
    expect(mockWorkflowApi.integrations.list).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByText('GitHub'));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'int-ready' }),
    );
  });

  it('does not open or offer creation when disabled', async () => {
    render(
      <IntegrationSelector
        integrations={integrations}
        onSelect={vi.fn()}
        disabled
        selectedIntegrationId="int-ready"
      />,
    );

    const combobox = await screen.findByRole('combobox');
    expect(combobox).toBeDisabled();
    expect(combobox).toHaveValue('GitHub');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('selects a newly created integration after saving from the dialog', async () => {
    const onSelect = vi.fn();
    renderControlledSelector(onSelect);

    const combobox = await screen.findByRole('combobox');
    fireEvent.focus(combobox);

    fireEvent.mouseDown(screen.getByText('Create new integration'));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Save mock integration' }),
    );

    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'int-created', name: 'Zendesk' }),
      ),
    );

    await waitFor(() => expect(combobox).toHaveValue('Zendesk'));
  });

  it('locks inline create from integrationFilter so unsupported backends cannot be saved', async () => {
    const onSelect = vi.fn();
    render(
      <IntegrationSelector
        integrations={integrations}
        onSelect={onSelect}
        integrationFilter={integration => integration.backendType === 'http'}
      />,
    );

    const combobox = await screen.findByRole('combobox');
    fireEvent.focus(combobox);
    fireEvent.mouseDown(screen.getByText('Create new integration'));

    expect(
      screen.queryByRole('button', { name: 'Save mock aws integration' }),
    ).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('passes createBackendType to lock inline create to HTTP integrations', async () => {
    render(
      <IntegrationSelector
        integrations={integrations}
        onSelect={vi.fn()}
        createBackendType="http"
      />,
    );

    const combobox = await screen.findByRole('combobox');
    fireEvent.focus(combobox);
    fireEvent.mouseDown(screen.getByText('Create new integration'));

    expect(
      screen.queryByRole('button', { name: 'Save mock aws integration' }),
    ).not.toBeInTheDocument();
  });
});
