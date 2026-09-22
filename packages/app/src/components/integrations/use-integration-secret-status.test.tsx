import type { ReactNode } from 'react';
import { renderHook as rtlRenderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SecretStatusType } from '../../api/secrets';
import { queryKeys } from '../../api/queries';
import { useIntegrationSecretStatus } from './use-integration-secret-status';

// Owned by the test so specs can invalidate queries to simulate a refresh —
// the hook no longer takes a refresh-nonce param.
let queryClient: QueryClient;
const renderHook: typeof rtlRenderHook = (cb, options) =>
  rtlRenderHook(cb, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
    ...options,
  });

const mockSecretsApi = {
  getStorageMode: vi.fn(),
  getSecret: vi.fn(),
  getKeys: vi.fn(),
};

const mockWorkflowApi = {
  githubApp: {
    listApps: vi.fn(),
    listInstallations: vi.fn(),
  },
};

vi.mock('../../api', () => ({
  useSecrets: () => mockSecretsApi,
  useWorkflows: () => mockWorkflowApi,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useIntegrationSecretStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    mockSecretsApi.getStorageMode.mockResolvedValue({
      mode: 'dotenv',
      readOnly: false,
    });
    mockSecretsApi.getKeys.mockResolvedValue([]);
    mockWorkflowApi.githubApp.listApps.mockResolvedValue([]);
    mockWorkflowApi.githubApp.listInstallations.mockResolvedValue({
      installations: [],
    });
  });

  it('waits for storage mode before exposing hidden scoped secret refs', async () => {
    const storageMode = deferred<{
      mode: 'scoped';
      readOnly: boolean;
      hiddenSecretRefs: string[];
    }>();

    mockSecretsApi.getStorageMode.mockReturnValue(storageMode.promise);

    const integration = {
      id: 'int-1',
      host: 'https://api.example.com',
      backendType: 'http',
      authConfig: {
        token: '${ROADIE_SCOPE_SECRET}',
      },
      config: {},
    };

    const { result } = renderHook(() =>
      useIntegrationSecretStatus([integration]),
    );

    expect(result.current.loading).toBe(true);
    expect(
      result.current.summariesByIntegrationId.get('int-1'),
    ).toBeUndefined();
    expect(mockSecretsApi.getSecret).not.toHaveBeenCalled();

    storageMode.resolve({
      mode: 'scoped',
      readOnly: false,
      hiddenSecretRefs: ['ROADIE_SCOPE_SECRET'],
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.summariesByIntegrationId.get('int-1')).toEqual({
      requiredSecretRefs: [],
      missingSecretRefs: [],
      hasRequiredConfig: true,
      configured: true,
      checkingReadiness: false,
    });
    expect(mockSecretsApi.getSecret).not.toHaveBeenCalled();
  });

  it('requires a GitHub App integration to have both an app and an installation', async () => {
    const integration = {
      id: 'int-gh-app',
      slug: 'github-enterprise-app',
      host: 'https://ghe.example.com/api/v3',
      backendType: 'http',
      authConfig: null,
      config: {},
      extensions: { githubApps: [] },
    };

    mockWorkflowApi.githubApp.listApps.mockResolvedValue([
      {
        id: 'app-1',
        appId: '1234',
        host: 'https://ghe.example.com/api/v3',
        integrationId: 'int-gh-app',
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    mockWorkflowApi.githubApp.listInstallations.mockResolvedValue({
      installations: [],
    });

    const { result } = renderHook(() =>
      useIntegrationSecretStatus([integration]),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.summariesByIntegrationId.get('int-gh-app')).toEqual({
      requiredSecretRefs: [],
      missingSecretRefs: [],
      hasRequiredConfig: false,
      configured: false,
      checkingReadiness: false,
    });

    mockWorkflowApi.githubApp.listInstallations.mockResolvedValue({
      installations: [
        {
          id: 'install-1',
          appId: '1234',
          host: 'https://ghe.example.com/api/v3',
          installationId: 99,
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    // Simulate the post-install refresh that a consumer drives via
    // useInvalidateIntegrationSecretStatus.
    await queryClient.invalidateQueries({
      queryKey: queryKeys.githubAppInstallationsPrefix,
    });

    await waitFor(() =>
      expect(result.current.summariesByIntegrationId.get('int-gh-app')).toEqual(
        {
          requiredSecretRefs: [],
          missingSecretRefs: [],
          hasRequiredConfig: true,
          configured: true,
          checkingReadiness: false,
        },
      ),
    );
  });

  it('falls back to per-ref getSecret when getKeys fails', async () => {
    mockSecretsApi.getKeys.mockRejectedValue(new Error('getKeys failed'));
    mockSecretsApi.getSecret.mockResolvedValue({
      name: 'ROOTLY_API_KEY',
      status: SecretStatusType.Available,
    });

    const integration = {
      id: 'int-1',
      host: 'https://api.example.com',
      backendType: 'http',
      authConfig: {
        token: '${ROOTLY_API_KEY}',
      },
      config: {},
    };

    const { result } = renderHook(() =>
      useIntegrationSecretStatus([integration]),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockSecretsApi.getKeys).toHaveBeenCalled();
    expect(mockSecretsApi.getSecret).toHaveBeenCalledWith('ROOTLY_API_KEY');
    expect(result.current.summariesByIntegrationId.get('int-1')).toEqual({
      requiredSecretRefs: ['ROOTLY_API_KEY'],
      missingSecretRefs: [],
      hasRequiredConfig: true,
      configured: true,
      checkingReadiness: false,
    });
  });

  it('settles (rather than loading forever) when both getKeys and the getSecret fallback fail', async () => {
    mockSecretsApi.getKeys.mockRejectedValue(new Error('getKeys failed'));
    mockSecretsApi.getSecret.mockRejectedValue(new Error('getSecret failed'));

    const integration = {
      id: 'int-1',
      host: 'https://api.example.com',
      backendType: 'http',
      authConfig: {
        token: '${ROOTLY_API_KEY}',
      },
      config: {},
    };

    const { result } = renderHook(() =>
      useIntegrationSecretStatus([integration]),
    );

    // Both resolution paths error → the hook must stop loading and treat the
    // ref as missing, not hang in a perpetual "checking" state.
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.summariesByIntegrationId.get('int-1')).toEqual({
      requiredSecretRefs: ['ROOTLY_API_KEY'],
      missingSecretRefs: ['ROOTLY_API_KEY'],
      hasRequiredConfig: true,
      configured: false,
      checkingReadiness: false,
    });
  });

  it('treats an HTTP integration with no host as missing configuration', async () => {
    const integration = {
      id: 'int-gh-token',
      slug: 'github-enterprise-token',
      host: '',
      backendType: 'http',
      authConfig: {
        token: 'token-value',
      },
      config: {},
    };

    const { result } = renderHook(() =>
      useIntegrationSecretStatus([integration]),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.summariesByIntegrationId.get('int-gh-token')).toEqual(
      {
        requiredSecretRefs: [],
        missingSecretRefs: [],
        hasRequiredConfig: false,
        configured: false,
        checkingReadiness: false,
      },
    );
  });

  it('treats AWS Organizations as valid without standalone profiles', async () => {
    const integration = {
      id: 'int-aws',
      backendType: 'aws',
      authConfig: null,
      config: {
        organizations: {
          enabled: true,
          managementAccount: { accountId: '999999999999' },
        },
      },
    };

    const { result } = renderHook(() =>
      useIntegrationSecretStatus([integration]),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.summariesByIntegrationId.get('int-aws')).toEqual({
      requiredSecretRefs: [],
      missingSecretRefs: [],
      hasRequiredConfig: true,
      configured: true,
      checkingReadiness: false,
    });
  });
});
