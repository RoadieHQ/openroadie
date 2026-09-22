import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { renderWithQuery as render } from '../../../test-utils';

import { describe, expect, it, vi } from 'vitest';
import {
  GitHubIntegrationDialog,
  createGithubAppSchema,
  createGithubMetadataSchema,
} from './github-integration-dialog';
import type { IntegrationItem } from '../types';

const mockCreateApp = vi.fn();
const mockListApps = vi.fn();
const mockListInstallations = vi.fn();
const mockListInstallRequests = vi.fn();
const mockDeleteApp = vi.fn();
const mockUpdateIntegration = vi.fn();
const mockListDataSourceSeeds = vi.fn();
const mockActivateDataSourceSeeds = vi.fn();

// The GitHub editor loads apps + config on mount; stub the API surface it
// touches so these tests exercise only the dialog chrome and the AppEditForm.
vi.mock('../../../api', () => ({
  useWorkflows: () => ({
    githubApp: {
      listApps: mockListApps,
      listInstallations: mockListInstallations,
      listInstallRequests: mockListInstallRequests,
      createApp: mockCreateApp,
      deleteApp: mockDeleteApp,
    },
    integrations: { update: mockUpdateIntegration },
    workflows: {
      listDataSourceSeeds: mockListDataSourceSeeds,
      activateDataSourceSeedsForIntegration: mockActivateDataSourceSeeds,
    },
  }),
  useAlert: () => ({ post: vi.fn() }),
  useAppConfig: () => ({
    app: { baseUrl: 'https://app.example.com' },
    backend: { baseUrl: 'https://api.example.com' },
    scope: undefined,
  }),
  useSecrets: () => ({
    getKeys: vi.fn().mockResolvedValue([]),
    getMetadata: vi.fn().mockResolvedValue([]),
    getStorageMode: vi.fn().mockResolvedValue({
      mode: 'dotenv',
      readOnly: false,
      hiddenSecretRefs: [],
    }),
  }),
}));

vi.mock('./required-secrets-panel', () => ({
  RequiredSecretsPanel: () => <div data-testid="required-secrets-panel" />,
}));

function makeGithubItem(overrides?: Partial<IntegrationItem>): IntegrationItem {
  return {
    id: 'gh-1',
    name: 'GitHub App',
    description: '',
    slug: 'github-app',
    type: 'scm',
    host: 'https://api.github.com',
    backendType: 'http',
    authType: 'none',
    config: {},
    readyForCurrentScope: true,
    createdBy: 'user-1',
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

function renderDialog(
  props: Partial<React.ComponentProps<typeof GitHubIntegrationDialog>>,
) {
  return render(
    <MemoryRouter>
      <GitHubIntegrationDialog
        open
        onClose={vi.fn()}
        integration={makeGithubItem()}
        {...props}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListApps.mockResolvedValue([]);
  mockListInstallations.mockResolvedValue({ installations: [] });
  mockListInstallRequests.mockResolvedValue([]);
  mockDeleteApp.mockResolvedValue(undefined);
  mockListDataSourceSeeds.mockResolvedValue({ data: [] });
  mockUpdateIntegration.mockResolvedValue({
    name: 'Edited Name',
    host: '',
  });
});

describe('GitHubIntegrationDialog', () => {
  it('renders as a full page (no modal) with header actions when variant="page"', async () => {
    renderDialog({
      variant: 'page',
      onRequestDelete: vi.fn(),
      onRequestDuplicate: vi.fn(),
    });

    // Page shell, not a modal. Save is first-class on the EditorHeader.
    await screen.findByRole('button', { name: 'Save' });
    expect(screen.queryByRole('dialog')).toBeNull();
    // Page header titles with the integration's entity name.
    expect(
      screen.getAllByRole('heading', { name: 'GitHub App' }).length,
    ).toBeGreaterThan(0);

    // Duplicate/Delete promoted into the page header.
    expect(
      screen.getByRole('button', { name: 'Duplicate' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('renders inside a modal dialog by default', async () => {
    renderDialog({});

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    // Dialog mode keeps the Cancel + Save Changes footer.
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Save Changes' }),
    ).toBeInTheDocument();
  });

  it('validates the add-app form and does not call the API on an empty submit', async () => {
    const user = userEvent.setup();
    renderDialog({});

    await user.click(
      await screen.findByRole('button', { name: 'Add GitHub App' }),
    );
    // The submit button now carries the same label; the add trigger is hidden.
    await user.click(screen.getByRole('button', { name: 'Add GitHub App' }));

    expect(await screen.findByText('App ID is required')).toBeInTheDocument();
    expect(screen.getByText('Slug is required')).toBeInTheDocument();
    expect(mockCreateApp).not.toHaveBeenCalled();
  });
});

describe('createGithubAppSchema', () => {
  const base = {
    appId: 'app-1',
    slug: 'my-org-roadie',
    htmlUrl: '',
    clientId: 'client-1',
    enterpriseServerHost: '',
    description: '',
    privateKeySelect: 'GITHUB_APP_PRIVATE_KEY',
    clientSecretSelect: 'GITHUB_APP_CLIENT_SECRET',
    webhookSecretSelect: '',
  };

  function errorPaths(result: {
    success: boolean;
    error?: { issues: Array<{ path: PropertyKey[] }> };
  }) {
    return result.success
      ? []
      : (result.error?.issues ?? []).map(issue => issue.path.join('.'));
  }

  it('requires app id, slug, client id, and both secrets on create', () => {
    const schema = createGithubAppSchema({
      isEdit: false,
      requireEnterpriseHost: false,
    });
    const result = schema.safeParse({
      ...base,
      appId: '',
      slug: '',
      clientId: '',
      privateKeySelect: '',
      clientSecretSelect: '',
    });
    expect(result.success).toBe(false);
    expect(errorPaths(result)).toEqual(
      expect.arrayContaining([
        'appId',
        'slug',
        'clientId',
        'privateKeySelect',
        'clientSecretSelect',
      ]),
    );
  });

  it('trims values and passes a complete create payload', () => {
    const schema = createGithubAppSchema({
      isEdit: false,
      requireEnterpriseHost: false,
    });
    const result = schema.safeParse({ ...base, appId: '  app-1  ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.appId).toBe('app-1');
    }
  });

  it('does not require client id when editing', () => {
    const schema = createGithubAppSchema({
      isEdit: true,
      requireEnterpriseHost: false,
    });
    const result = schema.safeParse({ ...base, clientId: '' });
    expect(result.success).toBe(true);
  });

  it('requires a valid enterprise host only when requireEnterpriseHost is set', () => {
    const required = createGithubAppSchema({
      isEdit: false,
      requireEnterpriseHost: true,
    });
    // Missing → the "enter your hostname" message.
    const missing = required.safeParse({ ...base, enterpriseServerHost: '' });
    expect(errorPaths(missing)).toContain('enterpriseServerHost');

    // Present but not parseable as a host → the "valid hostname" message.
    const invalid = required.safeParse({
      ...base,
      enterpriseServerHost: 'http://',
    });
    expect(errorPaths(invalid)).toContain('enterpriseServerHost');

    // A bare hostname is accepted.
    const valid = required.safeParse({
      ...base,
      enterpriseServerHost: 'ghe.mycompany.com',
    });
    expect(valid.success).toBe(true);

    // When not required, the field is ignored entirely.
    const notRequired = createGithubAppSchema({
      isEdit: false,
      requireEnterpriseHost: false,
    });
    expect(
      notRequired.safeParse({ ...base, enterpriseServerHost: '' }).success,
    ).toBe(true);
  });
});

describe('createGithubMetadataSchema', () => {
  it('requires a name', () => {
    const schema = createGithubMetadataSchema({
      isEnterprise: false,
      hasCurrentHost: false,
    });
    expect(
      schema.safeParse({ name: '', enterpriseServerHost: '' }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ name: 'Acme', enterpriseServerHost: '' }).success,
    ).toBe(true);
  });

  it('requires a valid enterprise host only when one is already configured', () => {
    const configured = createGithubMetadataSchema({
      isEnterprise: true,
      hasCurrentHost: true,
    });
    // Cannot clear an existing host.
    expect(
      configured.safeParse({ name: 'Acme', enterpriseServerHost: '' }).success,
    ).toBe(false);
    // Garbage is rejected.
    expect(
      configured.safeParse({ name: 'Acme', enterpriseServerHost: 'http://' })
        .success,
    ).toBe(false);
    // A hostname is accepted.
    expect(
      configured.safeParse({
        name: 'Acme',
        enterpriseServerHost: 'ghe.acme.com',
      }).success,
    ).toBe(true);

    // Not yet configured: a blank host is allowed (save the name now, host later).
    const unconfigured = createGithubMetadataSchema({
      isEnterprise: true,
      hasCurrentHost: false,
    });
    expect(
      unconfigured.safeParse({ name: 'Acme', enterpriseServerHost: '' })
        .success,
    ).toBe(true);
  });

  it('ignores the host field entirely for non-enterprise integrations', () => {
    const schema = createGithubMetadataSchema({
      isEnterprise: false,
      hasCurrentHost: true,
    });
    expect(
      schema.safeParse({ name: 'Acme', enterpriseServerHost: 'anything' })
        .success,
    ).toBe(true);
  });
});

describe('GitHubIntegrationDialog metadata form (I9)', () => {
  it('keeps in-progress name edits when the same integration refetches', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <MemoryRouter>
        <GitHubIntegrationDialog
          open
          variant="page"
          onClose={vi.fn()}
          integration={makeGithubItem({ name: 'Original Name' })}
        />
      </MemoryRouter>,
    );

    const nameInput = await screen.findByDisplayValue('Original Name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Edited While Typing');

    // A background refetch resolves with the still-server-side old name for the
    // SAME integration id — this must not clobber the in-progress edit.
    rerender(
      <MemoryRouter>
        <GitHubIntegrationDialog
          open
          variant="page"
          onClose={vi.fn()}
          integration={makeGithubItem({ name: 'Original Name' })}
        />
      </MemoryRouter>,
    );

    expect(screen.getByDisplayValue('Edited While Typing')).toBeInTheDocument();
  });
});

describe('GitHubIntegrationDialog auto-enable activation', () => {
  beforeEach(() => {
    mockListDataSourceSeeds.mockResolvedValue({ data: [] });
  });

  async function saveNameChange(
    user: ReturnType<typeof userEvent.setup>,
    newName: string,
  ) {
    const nameInput = await screen.findByDisplayValue('GitHub App');
    await user.clear(nameInput);
    await user.type(nameInput, newName);
    await user.click(screen.getByRole('button', { name: 'Save' }));
  }

  it('activates data source seeds after saving a system integration on the page', async () => {
    const user = userEvent.setup();
    mockListDataSourceSeeds.mockResolvedValue({
      data: [
        {
          name: 'GitHub repos',
          description: '',
          integrationSlug: 'github-app',
          integrationConfigured: true,
          created: false,
        },
      ],
    });
    renderDialog({
      variant: 'page',
      integration: makeGithubItem({ createdBy: 'system' }),
    });

    await saveNameChange(user, 'Edited Name');

    await waitFor(() =>
      expect(mockActivateDataSourceSeeds).toHaveBeenCalledWith('gh-1'),
    );
  });

  it('shows the auto-enable toggle on the page for a system integration with matching seeds', async () => {
    mockListDataSourceSeeds.mockResolvedValue({
      data: [
        {
          name: 'GitHub repos',
          description: '',
          integrationSlug: 'github-app',
          integrationConfigured: true,
          created: false,
        },
      ],
    });

    renderDialog({
      variant: 'page',
      integration: makeGithubItem({ createdBy: 'system' }),
    });

    expect(
      await screen.findByRole('switch', {
        name: 'Automatically enable data sources',
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Show 1 data source' }),
    ).toBeInTheDocument();
  });

  it('does not activate data source seeds for a user-created integration', async () => {
    const user = userEvent.setup();
    renderDialog({
      variant: 'page',
      integration: makeGithubItem({ createdBy: 'user-1' }),
    });

    await saveNameChange(user, 'Edited Name');

    await waitFor(() => expect(mockUpdateIntegration).toHaveBeenCalled());
    expect(mockActivateDataSourceSeeds).not.toHaveBeenCalled();
  });

  it('does not activate data source seeds when editing in a dialog', async () => {
    const user = userEvent.setup();
    renderDialog({
      variant: 'dialog',
      integration: makeGithubItem({ createdBy: 'system' }),
    });

    const nameInput = await screen.findByDisplayValue('GitHub App');
    await user.clear(nameInput);
    await user.type(nameInput, 'Edited Name');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(mockUpdateIntegration).toHaveBeenCalled());
    expect(mockActivateDataSourceSeeds).not.toHaveBeenCalled();
  });

  it('does not activate data source seeds after removing a GitHub app', async () => {
    const user = userEvent.setup();
    mockListDataSourceSeeds.mockResolvedValue({
      data: [
        {
          name: 'GitHub repos',
          description: '',
          integrationSlug: 'github-app',
          integrationConfigured: true,
          created: false,
        },
      ],
    });
    mockListApps.mockResolvedValue([
      {
        id: 'app-record-1',
        integrationId: 'gh-1',
        appId: '12345',
        host: 'github.com',
        purposes: ['data-source'],
        slug: 'roadie-app',
        status: 'ready',
        createdAt: '2026-03-01T00:00:00Z',
        updatedAt: '2026-03-20T10:30:00Z',
      },
    ]);

    renderDialog({
      variant: 'page',
      integration: makeGithubItem({ createdBy: 'system' }),
    });

    await screen.findByRole('switch', {
      name: 'Automatically enable data sources',
    });
    await user.click(screen.getByRole('button', { name: 'Edit GitHub App' }));
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    await user.click(screen.getAllByRole('button', { name: 'Remove' }).at(-1)!);

    await waitFor(() =>
      expect(mockDeleteApp).toHaveBeenCalledWith('app-record-1'),
    );
    expect(mockActivateDataSourceSeeds).not.toHaveBeenCalled();
  });
});
