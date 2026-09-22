import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { renderWithQuery as render } from '../../../test-utils';
import { IntegrationDetailDrawer } from './integration-detail-drawer';
import type { IntegrationItem } from '../types';

const mockAlertApi = { post: vi.fn() };
const mockUpdateWorkflow = vi.fn();

vi.mock('../../../api', () => ({
  useWorkflows: () => ({ workflows: { update: mockUpdateWorkflow } }),
  useAlert: () => mockAlertApi,
  useSecrets: () => ({
    getStorageMode: vi.fn().mockResolvedValue({
      mode: 'dotenv',
      readOnly: false,
    }),
    getKeys: vi.fn().mockResolvedValue([]),
    getSecret: vi.fn(),
  }),
}));

function makeItem(overrides?: Partial<IntegrationItem>): IntegrationItem {
  return {
    id: 'int-1',
    name: 'PagerDuty',
    description: '',
    slug: 'pagerduty',
    type: 'incident-management',
    host: 'https://api.pagerduty.com',
    backendType: 'http',
    authType: 'none',
    config: {},
    readyForCurrentScope: true,
    createdBy: 'system',
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-20T10:30:00Z',
    icon: 'data',
    color: '#8b5cf6',
    logoUrl: '',
    referencingWorkflows: [],
    referencingActions: [],
    referencingRelationshipRules: [],
    ...overrides,
  };
}

function renderDrawer(integration: IntegrationItem) {
  return render(
    <MemoryRouter>
      <IntegrationDetailDrawer
        integrationId={integration.id}
        integration={integration}
        open
        onOpenChange={vi.fn()}
      />
    </MemoryRouter>,
  );
}

describe('IntegrationDetailDrawer — Used by table', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateWorkflow.mockResolvedValue({ id: 'wf-1', enabled: false });
  });

  it('shows an enable/disable action per referencing workflow', () => {
    renderDrawer(
      makeItem({
        referencingWorkflows: [
          { id: 'wf-1', name: 'PagerDuty incidents', enabled: true },
          { id: 'wf-2', name: 'PagerDuty services', enabled: false },
        ],
      }),
    );

    expect(screen.getByText('Action')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disable' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enable' })).toBeInTheDocument();
  });

  it('disables an enabled data source when its action is clicked', async () => {
    const user = userEvent.setup();
    renderDrawer(
      makeItem({
        referencingWorkflows: [
          { id: 'wf-1', name: 'PagerDuty incidents', enabled: true },
        ],
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Disable' }));

    await waitFor(() =>
      expect(mockUpdateWorkflow).toHaveBeenCalledWith('wf-1', {
        enabled: false,
      }),
    );
    expect(mockAlertApi.post).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Data source disabled',
        severity: 'success',
      }),
    );
  });

  it('enables a disabled data source when its action is clicked', async () => {
    const user = userEvent.setup();
    mockUpdateWorkflow.mockResolvedValue({ id: 'wf-2', enabled: true });
    renderDrawer(
      makeItem({
        referencingWorkflows: [
          { id: 'wf-2', name: 'PagerDuty services', enabled: false },
        ],
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Enable' }));

    await waitFor(() =>
      expect(mockUpdateWorkflow).toHaveBeenCalledWith('wf-2', {
        enabled: true,
      }),
    );
  });

  it('posts an error alert when the toggle request fails', async () => {
    const user = userEvent.setup();
    mockUpdateWorkflow.mockRejectedValue(new Error('network error'));
    renderDrawer(
      makeItem({
        referencingWorkflows: [
          { id: 'wf-1', name: 'PagerDuty incidents', enabled: true },
        ],
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Disable' }));

    await waitFor(() =>
      expect(mockAlertApi.post).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'error',
          message: expect.stringContaining('network error'),
        }),
      ),
    );
  });

  it('does not render an action for a row with no known enabled state', () => {
    renderDrawer(
      makeItem({
        referencingWorkflows: [{ id: 'wf-1', name: 'Legacy workflow' }],
      }),
    );

    expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Disable' })).toBeNull();
  });
});
