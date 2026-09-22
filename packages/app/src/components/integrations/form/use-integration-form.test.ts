import { act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Integration } from '../types';
import { renderHookWithQuery as renderHook } from '../../../test-utils';
import { useIntegrationForm } from './use-integration-form';

const mockIntegrationsApi = {
  create: vi.fn(),
  update: vi.fn(),
  listLogos: vi.fn(),
};

const mockWorkflowsApi = {
  integrations: mockIntegrationsApi,
};

const mockAlertApi = {
  post: vi.fn(),
};

const mockSecretsApi = {
  getKeys: vi.fn(),
  getMetadata: vi.fn(),
  getStorageMode: vi.fn(),
};

vi.mock('../../../api', () => ({
  useWorkflows: () => mockWorkflowsApi,
  useAlert: () => mockAlertApi,
  useSecrets: () => mockSecretsApi,
}));

function makeIntegration(overrides: Partial<Integration> = {}): Integration {
  return {
    id: 'int-1',
    name: 'GitHub',
    slug: 'github',
    type: 'scm',
    host: 'https://api.github.com',
    backendType: 'http',
    authType: 'none',
    authConfig: null,
    config: {},
    createdBy: 'system',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    logoUrl: '',
    ...overrides,
  };
}

describe('useIntegrationForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIntegrationsApi.listLogos.mockResolvedValue([]);
    mockSecretsApi.getKeys.mockResolvedValue([]);
    mockSecretsApi.getMetadata.mockResolvedValue([]);
    mockSecretsApi.getStorageMode.mockResolvedValue({
      mode: 'dotenv',
      readOnly: false,
    });
  });

  it('sends an empty config when HTTP headers and CA certificate are cleared on edit', async () => {
    const integration = makeIntegration({
      config: {
        headers: { 'X-Test': 'value' },
        caCertificate:
          '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----',
      },
    });
    mockIntegrationsApi.update.mockResolvedValue({
      ...integration,
      config: {},
    });

    const onSaved = vi.fn();
    const onClose = vi.fn();
    const { result } = renderHook(() =>
      useIntegrationForm({
        open: true,
        onClose,
        onSaved,
        integration,
      }),
    );

    await act(async () => {
      result.current.form.setValue('defaultHeaders', []);
      result.current.form.setValue('caCertificate', '');
    });

    await act(async () => {
      result.current.handleSave();
    });

    await waitFor(() => {
      expect(mockIntegrationsApi.update).toHaveBeenCalledWith(
        'int-1',
        expect.objectContaining({
          config: {},
        }),
      );
    });
  });

  it('blocks saving legacy secret-reference CA certificates', async () => {
    const integration = makeIntegration({
      config: {
        caCertificate: '${MY_CA_CERT}',
      },
    });

    const onSaved = vi.fn();
    const onClose = vi.fn();
    const { result } = renderHook(() =>
      useIntegrationForm({
        open: true,
        onClose,
        onSaved,
        integration,
      }),
    );

    expect(result.current.form.getValues('caCertificate')).toBe(
      '${MY_CA_CERT}',
    );

    await act(async () => {
      await result.current.form.trigger();
    });

    expect(mockIntegrationsApi.update).not.toHaveBeenCalled();
    expect(
      result.current.form.getFieldState('caCertificate').error?.message,
    ).toBe(
      'Secret references are no longer supported for CA certificates. Paste the PEM certificate directly.',
    );
  });

  it('blocks saving malformed CA certificates', async () => {
    const integration = makeIntegration({
      config: {
        caCertificate: 'not a pem certificate',
      },
    });

    const { result } = renderHook(() =>
      useIntegrationForm({
        open: true,
        onClose: vi.fn(),
        onSaved: vi.fn(),
        integration,
      }),
    );

    await act(async () => {
      await result.current.form.trigger();
    });

    expect(mockIntegrationsApi.update).not.toHaveBeenCalled();
    expect(
      result.current.form.getFieldState('caCertificate').error?.message,
    ).toBe(
      'Enter a PEM certificate with BEGIN CERTIFICATE and END CERTIFICATE markers',
    );
  });

  it('uses the backend requests-per-hour default in create form state', () => {
    const { result } = renderHook(() =>
      useIntegrationForm({
        open: true,
        onClose: vi.fn(),
        onSaved: vi.fn(),
      }),
    );

    expect(result.current.form.getValues('requestsPerHour')).toBe('36000');
  });

  it('adds a separator between a header prefix and secret ref when saving', async () => {
    mockIntegrationsApi.create.mockResolvedValue(
      makeIntegration({
        id: 'int-2',
        name: 'Wiz',
        slug: 'wiz',
        type: 'security',
        authType: 'header',
        authConfig: {
          headers: {
            Authorization: 'apiToken ${WIZ_API_TOKEN}',
          },
        },
      }),
    );

    const { result } = renderHook(() =>
      useIntegrationForm({
        open: true,
        onClose: vi.fn(),
        onSaved: vi.fn(),
      }),
    );

    await act(async () => {
      result.current.form.setValue('name', 'Wiz', { shouldValidate: true });
      result.current.form.setValue('slug', 'wiz', { shouldValidate: true });
      result.current.form.setValue('type', 'security', {
        shouldValidate: true,
      });
      result.current.form.setValue('host', 'https://api.eu9.app.wiz.io', {
        shouldValidate: true,
      });
      result.current.form.setValue('authType', 'header', {
        shouldValidate: true,
      });
      result.current.form.setValue(
        'authHeaders',
        [
          {
            key: 'Authorization',
            prefix: 'apiToken',
            value: '${WIZ_API_TOKEN}',
          },
        ],
        { shouldValidate: true },
      );
    });

    await act(async () => {
      result.current.handleSave();
    });

    await waitFor(() => {
      expect(mockIntegrationsApi.create).toHaveBeenCalledWith(
        expect.objectContaining({
          authType: 'header',
          authConfig: {
            headers: {
              Authorization: 'apiToken ${WIZ_API_TOKEN}',
            },
          },
        }),
      );
    });
  });

  it('reads and saves HTTP pagination defaults in integration config', async () => {
    const integration = makeIntegration({
      config: {
        paginationDefault: {
          type: 'link',
          perPageParam: 'per_page',
          perPage: 100,
        },
      },
    });
    mockIntegrationsApi.update.mockResolvedValue(integration);

    const { result } = renderHook(() =>
      useIntegrationForm({
        open: true,
        onClose: vi.fn(),
        onSaved: vi.fn(),
        integration,
      }),
    );

    expect(result.current.form.getValues('paginationDefault')).toEqual({
      type: 'link',
      perPageParam: 'per_page',
      perPage: 100,
    });

    await act(async () => {
      result.current.form.setValue(
        'paginationDefault',
        {
          type: 'page',
          pageParam: 'page',
          perPageParam: 'per_page',
          perPage: 50,
          startPage: 1,
        },
        { shouldValidate: true },
      );
    });

    await act(async () => {
      result.current.handleSave();
    });

    await waitFor(() => {
      expect(mockIntegrationsApi.update).toHaveBeenCalledWith(
        'int-1',
        expect.objectContaining({
          config: {
            paginationDefault: {
              type: 'page',
              pageParam: 'page',
              perPageParam: 'per_page',
              perPage: 50,
              startPage: 1,
            },
          },
        }),
      );
    });
  });

  it('normalizes host by adding https when creating with a bare hostname', async () => {
    mockIntegrationsApi.create.mockResolvedValue(
      makeIntegration({ id: 'int-2', host: 'https://api.example.com' }),
    );

    const onSaved = vi.fn();
    const onClose = vi.fn();
    const { result } = renderHook(() =>
      useIntegrationForm({
        open: true,
        onClose,
        onSaved,
      }),
    );

    await act(async () => {
      result.current.form.setValue('name', 'Example', { shouldValidate: true });
      result.current.form.setValue('slug', 'example', { shouldValidate: true });
      result.current.form.setValue('type', 'other', { shouldValidate: true });
      result.current.form.setValue('host', 'api.example.com', {
        shouldValidate: true,
      });
    });

    await act(async () => {
      result.current.handleSave();
    });

    await waitFor(() => {
      expect(mockIntegrationsApi.create).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'https://api.example.com',
        }),
      );
    });
  });

  it('allows oauth2 client credentials with audience and no scope', async () => {
    mockIntegrationsApi.create.mockResolvedValue(
      makeIntegration({
        id: 'int-2',
        name: 'Wiz',
        slug: 'wiz',
        type: 'security',
        authType: 'oauth2-client-credentials',
        authConfig: {
          clientId: '${WIZ_OAUTH2_CLIENT_ID}',
          clientSecret: '${WIZ_OAUTH2_CLIENT_SECRET}',
          tokenUrl: 'https://auth.app.wiz.io/oauth/token',
          audience: 'wiz-api',
        },
      }),
    );

    const { result } = renderHook(() =>
      useIntegrationForm({
        open: true,
        onClose: vi.fn(),
        onSaved: vi.fn(),
      }),
    );

    await act(async () => {
      result.current.form.setValue('name', 'Wiz', { shouldValidate: true });
      result.current.form.setValue('slug', 'wiz', { shouldValidate: true });
      result.current.form.setValue('type', 'security', {
        shouldValidate: true,
      });
      result.current.form.setValue('host', 'https://api.eu9.app.wiz.io', {
        shouldValidate: true,
      });
      result.current.form.setValue('authType', 'oauth2-client-credentials', {
        shouldValidate: true,
      });
      result.current.form.setValue(
        'oauth2TokenUrl',
        'https://auth.app.wiz.io/oauth/token',
        { shouldValidate: true },
      );
      result.current.form.setValue(
        'oauth2ClientId',
        '${WIZ_OAUTH2_CLIENT_ID}',
        { shouldValidate: true },
      );
      result.current.form.setValue(
        'oauth2ClientSecret',
        '${WIZ_OAUTH2_CLIENT_SECRET}',
        { shouldValidate: true },
      );
      result.current.form.setValue('oauth2Audience', 'wiz-api', {
        shouldValidate: true,
      });
      result.current.form.setValue('oauth2Scope', '', { shouldValidate: true });
    });

    await act(async () => {
      result.current.handleSave();
    });

    await waitFor(() => {
      expect(mockIntegrationsApi.create).toHaveBeenCalled();
    });

    const payload = mockIntegrationsApi.create.mock.calls.at(-1)?.[0] as {
      authConfig?: Record<string, unknown>;
    };
    expect(payload.authConfig).toEqual({
      clientId: '${WIZ_OAUTH2_CLIENT_ID}',
      clientSecret: '${WIZ_OAUTH2_CLIENT_SECRET}',
      tokenUrl: 'https://auth.app.wiz.io/oauth/token',
      audience: 'wiz-api',
    });
  });

  it('rejects oauth2 client credentials when both audience and scope are set', async () => {
    const { result } = renderHook(() =>
      useIntegrationForm({
        open: true,
        onClose: vi.fn(),
        onSaved: vi.fn(),
      }),
    );

    await act(async () => {
      result.current.form.setValue('name', 'Wiz', { shouldValidate: true });
      result.current.form.setValue('slug', 'wiz', { shouldValidate: true });
      result.current.form.setValue('type', 'security', {
        shouldValidate: true,
      });
      result.current.form.setValue('host', 'https://api.eu9.app.wiz.io', {
        shouldValidate: true,
      });
      result.current.form.setValue('authType', 'oauth2-client-credentials', {
        shouldValidate: true,
      });
      result.current.form.setValue(
        'oauth2TokenUrl',
        'https://auth.app.wiz.io/oauth/token',
        { shouldValidate: true },
      );
      result.current.form.setValue(
        'oauth2ClientId',
        '${WIZ_OAUTH2_CLIENT_ID}',
        { shouldValidate: true },
      );
      result.current.form.setValue(
        'oauth2ClientSecret',
        '${WIZ_OAUTH2_CLIENT_SECRET}',
        { shouldValidate: true },
      );
      result.current.form.setValue('oauth2Audience', 'wiz-api', {
        shouldValidate: true,
      });
      result.current.form.setValue('oauth2Scope', 'read:items', {
        shouldValidate: true,
      });
    });

    let isValid = false;
    await act(async () => {
      isValid = await result.current.form.trigger();
    });

    expect(isValid).toBe(false);
    expect(
      result.current.form.getFieldState('oauth2Audience').error?.message,
    ).toBe('Use either scope or audience');
    expect(
      result.current.form.getFieldState('oauth2Scope').error?.message,
    ).toBe('Use either scope or audience');
    expect(mockIntegrationsApi.create).not.toHaveBeenCalled();
  });

  it('allows saving edits for unchanged legacy http host values', async () => {
    const integration = makeIntegration({
      host: 'http://internal.example.local',
      createdBy: 'system',
    });
    mockIntegrationsApi.update.mockResolvedValue(integration);

    const onSaved = vi.fn();
    const onClose = vi.fn();
    const { result } = renderHook(() =>
      useIntegrationForm({
        open: true,
        onClose,
        onSaved,
        integration,
      }),
    );

    let isValid = false;
    await act(async () => {
      isValid = await result.current.form.trigger();
      result.current.form.setValue('name', 'GitHub Updated', {
        shouldValidate: true,
      });
    });

    expect(isValid).toBe(true);

    await act(async () => {
      result.current.handleSave();
    });

    await waitFor(() => {
      expect(mockIntegrationsApi.update).toHaveBeenCalledWith(
        'int-1',
        expect.objectContaining({
          host: 'http://internal.example.local',
        }),
      );
    });
  });

  it('preserves system auth when duplicating an integration', async () => {
    const template = {
      ...makeIntegration({
        id: 'int-template',
        authConfig: {
          appId: '123',
          privateKeyRef: 'GITHUB_APP_PRIVATE_KEY',
        },
      }),
      authType: 'github-app',
    } as unknown as Integration;

    mockIntegrationsApi.create.mockResolvedValue({
      ...template,
      id: 'int-2',
      name: 'GitHub Copy',
      slug: 'github-copy',
    });

    const onSaved = vi.fn();
    const onClose = vi.fn();
    const { result } = renderHook(() =>
      useIntegrationForm({
        open: true,
        onClose,
        onSaved,
        template,
      }),
    );

    await act(async () => {
      result.current.handleSave();
    });

    await waitFor(() => {
      expect(mockIntegrationsApi.create).toHaveBeenCalledWith(
        expect.objectContaining({
          authType: 'github-app',
          authConfig: template.authConfig,
        }),
      );
    });

    expect(mockAlertApi.post).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Integration duplicated',
        severity: 'success',
      }),
    );
  });

  it('saves multiple AWS profiles into integration config', async () => {
    mockIntegrationsApi.create.mockResolvedValue(
      makeIntegration({
        id: 'aws-1',
        name: 'AWS',
        slug: 'aws',
        type: 'infrastructure',
        host: '',
        backendType: 'aws',
        authType: 'none',
        config: {
          profiles: {
            '111111111111': {
              accountId: '111111111111',
              roleName: 'RoadieReadOnly',
              region: 'eu-west-1',
            },
            '222222222222': {
              accountId: '222222222222',
              externalId: 'ext-2',
            },
          },
        },
      }),
    );

    const { result } = renderHook(() =>
      useIntegrationForm({
        open: true,
        onClose: vi.fn(),
        onSaved: vi.fn(),
      }),
    );

    await act(async () => {
      result.current.form.setValue('name', 'AWS', { shouldValidate: true });
      result.current.form.setValue('slug', 'aws', { shouldValidate: true });
      result.current.form.setValue('type', 'infrastructure', {
        shouldValidate: true,
      });
      result.current.form.setValue('backendType', 'aws', {
        shouldValidate: true,
      });
      result.current.form.setValue(
        'awsProfiles',
        [
          {
            name: 'Production',
            accountId: '111111111111',
            roleName: 'RoadieReadOnly',
            externalId: '',
            region: 'eu-west-1',
          },
          {
            name: 'Shared services',
            accountId: '222222222222',
            roleName: '',
            externalId: 'ext-2',
            region: '',
          },
        ],
        { shouldValidate: true },
      );
    });

    await act(async () => {
      result.current.handleSave();
    });

    await waitFor(() => {
      expect(mockIntegrationsApi.create).toHaveBeenCalledWith(
        expect.objectContaining({
          backendType: 'aws',
          config: {
            profiles: {
              '111111111111': {
                name: 'Production',
                accountId: '111111111111',
                roleName: 'RoadieReadOnly',
                region: 'eu-west-1',
              },
              '222222222222': {
                name: 'Shared services',
                accountId: '222222222222',
                externalId: 'ext-2',
              },
            },
          },
        }),
      );
    });
  });

  it('exposes hidden scoped refs as reserved secret names without showing them as selectable options', async () => {
    mockSecretsApi.getKeys.mockResolvedValue([
      {
        name: 'VISIBLE_SECRET',
        value: '',
        description: '',
        status: 'Available',
      },
    ]);
    mockSecretsApi.getMetadata.mockResolvedValue([]);
    mockSecretsApi.getStorageMode.mockResolvedValue({
      mode: 'scoped',
      readOnly: false,
      hiddenSecretRefs: [
        'GITHUB_APP_PRIVATE_KEY',
        'INTERNAL_GITHUB_APP_CLIENT_SECRET',
      ],
    });

    const { result } = renderHook(() =>
      useIntegrationForm({
        open: true,
        onClose: vi.fn(),
        onSaved: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.secretOptions).toEqual(['VISIBLE_SECRET']);
      expect(result.current.reservedSecretNames).toEqual([
        'GITHUB_APP_PRIVATE_KEY',
        'INTERNAL_GITHUB_APP_CLIENT_SECRET',
      ]);
    });
  });

  it('preserves in-progress edits when a refetch re-derives the same integration', async () => {
    const integration = makeIntegration();
    const { result, rerender } = renderHook(
      (props: { integration: Integration }) =>
        useIntegrationForm({
          open: true,
          onClose: vi.fn(),
          onSaved: vi.fn(),
          integration: props.integration,
        }),
      { initialProps: { integration } },
    );

    // Subscribe to isDirty before mutating so the formState proxy tracks it.
    expect(result.current.form.formState.isDirty).toBe(false);

    await act(async () => {
      result.current.form.setValue('name', 'edited', { shouldDirty: true });
    });

    rerender({ integration: { ...integration } });

    expect(result.current.form.getValues('name')).toBe('edited');
    expect(result.current.form.formState.isDirty).toBe(true);
  });

  it('resets the form when a different integration is loaded', async () => {
    const integration = makeIntegration();
    const { result, rerender } = renderHook(
      (props: { integration: Integration }) =>
        useIntegrationForm({
          open: true,
          onClose: vi.fn(),
          onSaved: vi.fn(),
          integration: props.integration,
        }),
      { initialProps: { integration } },
    );

    await act(async () => {
      result.current.form.setValue('name', 'edited', { shouldDirty: true });
    });

    rerender({
      integration: makeIntegration({
        id: 'int-2',
        name: 'GitLab',
        slug: 'gitlab',
      }),
    });

    expect(result.current.form.getValues('name')).toBe('GitLab');
    expect(result.current.form.getValues('slug')).toBe('gitlab');
  });

  it('auto-slugifies from the name in create mode', async () => {
    const { result } = renderHook(() =>
      useIntegrationForm({
        open: true,
        onClose: vi.fn(),
        onSaved: vi.fn(),
      }),
    );

    expect(result.current.autoSlug).toBe(true);

    await act(async () => {
      result.current.form.setValue('name', 'My Service');
    });

    expect(result.current.form.getValues('slug')).toBe('my-service');
  });

  it('stops auto-slugifying once the slug is manually edited', async () => {
    const { result } = renderHook(() =>
      useIntegrationForm({
        open: true,
        onClose: vi.fn(),
        onSaved: vi.fn(),
      }),
    );

    await act(async () => {
      result.current.form.setValue('slug', 'custom-slug');
      result.current.markSlugEdited();
    });

    await act(async () => {
      result.current.form.setValue('name', 'My Service');
    });

    expect(result.current.form.getValues('slug')).toBe('custom-slug');
    expect(result.current.autoSlug).toBe(false);
  });

  it('keeps the seeded -copy slug when renaming a duplicated integration', async () => {
    const template = makeIntegration();
    const { result } = renderHook(() =>
      useIntegrationForm({
        open: true,
        onClose: vi.fn(),
        onSaved: vi.fn(),
        template,
      }),
    );

    expect(result.current.form.getValues('slug')).toBe('github-copy');
    expect(result.current.autoSlug).toBe(false);

    await act(async () => {
      result.current.form.setValue('name', 'Renamed Service');
    });

    expect(result.current.form.getValues('slug')).toBe('github-copy');
  });

  it('only fetches the secret catalog while open, refreshing on reopen', async () => {
    const { rerender } = renderHook(
      (props: { open: boolean }) =>
        useIntegrationForm({
          open: props.open,
          onClose: vi.fn(),
          onSaved: vi.fn(),
        }),
      { initialProps: { open: false } },
    );

    await act(async () => {});
    expect(mockSecretsApi.getKeys).not.toHaveBeenCalled();
    expect(mockSecretsApi.getMetadata).not.toHaveBeenCalled();

    rerender({ open: true });
    await waitFor(() => {
      expect(mockSecretsApi.getKeys).toHaveBeenCalledTimes(1);
    });

    rerender({ open: false });
    rerender({ open: true });
    await waitFor(() => {
      expect(mockSecretsApi.getKeys).toHaveBeenCalledTimes(2);
    });
  });

  it('blocks saving non-numeric rate-limit values and trims numeric ones', async () => {
    mockIntegrationsApi.create.mockResolvedValue(makeIntegration());

    const { result } = renderHook(() =>
      useIntegrationForm({
        open: true,
        onClose: vi.fn(),
        onSaved: vi.fn(),
      }),
    );

    await act(async () => {
      result.current.form.setValue('name', 'Example', { shouldValidate: true });
      result.current.form.setValue('slug', 'example', { shouldValidate: true });
      result.current.form.setValue('host', 'https://api.example.com', {
        shouldValidate: true,
      });
      result.current.form.setValue('requestsPerHour', 'abc', {
        shouldValidate: true,
      });
    });

    await act(async () => {
      result.current.handleSave();
    });

    expect(mockIntegrationsApi.create).not.toHaveBeenCalled();
    expect(
      result.current.form.getFieldState('requestsPerHour').error?.message,
    ).toBe('Enter a positive number');

    await act(async () => {
      result.current.form.setValue('requestsPerHour', ' 100 ', {
        shouldValidate: true,
      });
    });

    await act(async () => {
      result.current.handleSave();
    });

    await waitFor(() => {
      expect(mockIntegrationsApi.create).toHaveBeenCalledWith(
        expect.objectContaining({
          requestsPerHour: 100,
        }),
      );
    });
  });

  it('surfaces non-host errors for unchanged legacy hosts instead of swallowing them', async () => {
    const integration = makeIntegration({
      host: 'http://internal.example.local',
    });

    const { result } = renderHook(() =>
      useIntegrationForm({
        open: true,
        onClose: vi.fn(),
        onSaved: vi.fn(),
        integration,
      }),
    );

    await act(async () => {
      result.current.form.setValue('authType', 'bearer-token', {
        shouldValidate: true,
      });
    });

    await act(async () => {
      result.current.handleSave();
    });

    expect(mockIntegrationsApi.update).not.toHaveBeenCalled();
    expect(
      result.current.form.getFieldState('bearerToken').error?.message,
    ).toBe('Required');
  });
});
