import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CliError,
  configureIntegrationHost,
  connectIntegration,
  enableIntegration,
  listIntegrations,
  openGithubAppSetupPage,
  setSecret,
} from './bridge';
import type {
  ConnectResult as CommandConnectResult,
  IntegrationsEnableResult,
  IntegrationsListResult,
  SecretSetResult,
  SpawnBrowser,
} from '@roadiehq/openroadie-cli';

type ListIntegrationsInternal = (
  client: unknown,
) => Promise<IntegrationsListResult>;

type EnableIntegrationsInternal = (
  client: unknown,
  ids: string[],
) => Promise<IntegrationsEnableResult>;

type ConnectInternal = (
  client: unknown,
  id: string,
  options?: { confirm?: boolean },
) => Promise<CommandConnectResult>;

type ConfigureHostInternal = (
  client: unknown,
  id: string,
  host: string,
) => Promise<{
  command: 'integrations configure-host';
  id: string;
  status: 'configured' | 'failed';
  secretNames: string[];
  reason?: string;
}>;

type SetSecretInternal = (
  client: unknown,
  secretName: string,
  token: string,
) => Promise<SecretSetResult>;

const mocks = vi.hoisted(() => ({
  listIntegrationsInternal: vi.fn<ListIntegrationsInternal>(),
  enableIntegrationsInternal: vi.fn<EnableIntegrationsInternal>(),
  connectIntegrationInternal: vi.fn<ConnectInternal>(),
  configureIntegrationHostInternal: vi.fn<ConfigureHostInternal>(),
  setSecretInternal: vi.fn<SetSecretInternal>(),
}));

vi.mock('@roadiehq/openroadie-cli', () => ({
  loadConfig: () => ({ backendUrl: 'http://localhost:7008' }),
  OpenRoadieHttpClient: vi.fn().mockImplementation(function (
    this: { config: unknown },
    config: unknown,
  ) {
    this.config = config;
  }),
  openUrl: (
    url: string,
    spawnBrowser: SpawnBrowser,
    platform: NodeJS.Platform = process.platform,
  ) => {
    if (platform !== 'darwin') {
      return { url, opened: false, command: null, args: [] };
    }
    const child = spawnBrowser('open', [url], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return { url, opened: true, command: 'open', args: [url] };
  },
  listIntegrations: mocks.listIntegrationsInternal,
  enableIntegrations: mocks.enableIntegrationsInternal,
  connectIntegration: mocks.connectIntegrationInternal,
  configureIntegrationHost: mocks.configureIntegrationHostInternal,
  setSecret: mocks.setSecretInternal,
}));

describe('setup bridge', () => {
  beforeEach(() => {
    mocks.listIntegrationsInternal.mockReset();
    mocks.enableIntegrationsInternal.mockReset();
    mocks.connectIntegrationInternal.mockReset();
    mocks.configureIntegrationHostInternal.mockReset();
    mocks.setSecretInternal.mockReset();
    vi.restoreAllMocks();
  });

  it('lists integrations in the wizard shape and normalizes unknown auth types', async () => {
    mocks.listIntegrationsInternal.mockResolvedValue({
      command: 'integrations list',
      status: 'ok',
      integrations: [
        {
          id: 'kubernetes',
          name: 'Kubernetes',
          type: 'kubernetes',
          authType: 'none',
          enabled: true,
          connected: true,
        },
        {
          id: 'custom',
          name: 'Custom',
          type: 'custom',
          authType: 'unexpected-auth',
          enabled: false,
          connected: false,
        },
      ],
    });

    await expect(listIntegrations()).resolves.toEqual([
      {
        id: 'kubernetes',
        name: 'Kubernetes',
        type: 'kubernetes',
        authType: 'none',
        enabled: true,
        connected: true,
      },
      {
        id: 'custom',
        name: 'Custom',
        type: 'custom',
        authType: 'none',
        enabled: false,
        connected: false,
      },
    ]);
  });

  it('throws a CliError with the backend reason when listing integrations fails', async () => {
    mocks.listIntegrationsInternal.mockResolvedValue({
      command: 'integrations list',
      status: 'failed',
      integrations: [],
      reason: 'backend unreachable',
    });

    await expect(listIntegrations()).rejects.toMatchObject({
      name: 'CliError',
      message: 'integrations list failed: backend unreachable',
    });
  });

  it('enables a managed integration and connects it without requesting input', async () => {
    mocks.enableIntegrationsInternal.mockResolvedValue({
      command: 'integrations enable',
      status: 'enabled',
      results: [{ id: 'kubernetes', outcome: 'created' }],
    });
    mocks.connectIntegrationInternal.mockResolvedValue({
      command: 'connect',
      id: 'kubernetes',
      flow: 'config-only',
      status: 'connected',
      connected: true,
    });

    await enableIntegration('kubernetes');
    const result = await connectIntegration('kubernetes');

    expect(mocks.enableIntegrationsInternal).toHaveBeenCalledWith(
      expect.anything(),
      ['kubernetes'],
    );
    expect(mocks.connectIntegrationInternal).toHaveBeenCalledWith(
      expect.anything(),
      'kubernetes',
      { confirm: false },
    );
    expect(result).toEqual({
      connected: true,
      status: 'connected',
      needs: null,
      secretName: null,
      secretNames: [],
      reason: null,
    });
  });

  it('throws a CliError with the failed result reason when enabling fails', async () => {
    mocks.enableIntegrationsInternal.mockResolvedValue({
      command: 'integrations enable',
      status: 'failed',
      results: [
        {
          id: 'shortcut',
          outcome: 'failed',
          reason: 'request failed (status 500)',
        },
      ],
      reason: 'one or more integrations failed',
    });

    await expect(enableIntegration('shortcut')).rejects.toMatchObject({
      name: 'CliError',
      message:
        'integrations enable shortcut failed: request failed (status 500)',
    });
  });

  it('sets a token integration secret and then reads the integration as connected', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const token = 'shortcut-secret-token';

    mocks.connectIntegrationInternal
      .mockResolvedValueOnce({
        command: 'connect',
        id: 'shortcut',
        flow: 'secret-ref',
        status: 'pending',
        connected: false,
        needs: 'user-secret',
        addSecret: 'openroadie secret set SHORTCUT_ACCESS_TOKEN',
        secretNames: ['SHORTCUT_ACCESS_TOKEN'],
        reason: 'Shortcut needs its secret.',
      })
      .mockResolvedValueOnce({
        command: 'connect',
        id: 'shortcut',
        flow: 'secret-ref',
        status: 'connected',
        connected: true,
      });
    mocks.setSecretInternal.mockResolvedValue({
      command: 'secret set',
      id: 'SHORTCUT_ACCESS_TOKEN',
      status: 'stored',
    });

    const pending = await connectIntegration('shortcut');
    await setSecret('SHORTCUT_ACCESS_TOKEN', token);
    const connected = await connectIntegration('shortcut');

    expect(pending).toEqual({
      connected: false,
      status: 'pending',
      needs: 'user-secret',
      secretName: 'SHORTCUT_ACCESS_TOKEN',
      secretNames: ['SHORTCUT_ACCESS_TOKEN'],
      reason: 'Shortcut needs its secret.',
    });
    expect(mocks.connectIntegrationInternal).toHaveBeenCalledWith(
      expect.anything(),
      'shortcut',
      { confirm: false },
    );
    expect(mocks.setSecretInternal).toHaveBeenCalledWith(
      expect.anything(),
      'SHORTCUT_ACCESS_TOKEN',
      token,
    );
    expect(connected).toEqual({
      connected: true,
      status: 'connected',
      needs: null,
      secretName: null,
      secretNames: [],
      reason: null,
    });
    expect(JSON.stringify([pending, connected])).not.toContain(token);
    expect(mocks.connectIntegrationInternal.mock.calls.flat()).not.toContain(
      token,
    );
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('surfaces an app-install pending integration without faking success', async () => {
    mocks.connectIntegrationInternal.mockResolvedValue({
      command: 'connect',
      id: 'github-app',
      flow: 'github-app',
      status: 'pending',
      connected: false,
      needs: 'github-app-install',
      installUrl: 'https://github.com/apps/openroadie/installations/new',
      reason: 'No GitHub App installation found yet.',
    });

    await expect(connectIntegration('github-app')).resolves.toEqual({
      connected: false,
      status: 'pending',
      needs: 'github-app-install',
      secretName: null,
      secretNames: [],
      reason: 'No GitHub App installation found yet.',
    });
  });

  it('passes GitHub App confirm checks through to connect --confirm', async () => {
    mocks.connectIntegrationInternal.mockResolvedValue({
      command: 'connect',
      id: 'github-app',
      flow: 'github-app',
      status: 'pending',
      connected: false,
      needs: 'github-app-install',
      reason:
        'No GitHub App installation found yet. Finish the install in the browser.',
    });

    await expect(connectIntegration('github-app', true)).resolves.toMatchObject(
      {
        connected: false,
        needs: 'github-app-install',
      },
    );
    expect(mocks.connectIntegrationInternal).toHaveBeenCalledWith(
      expect.anything(),
      'github-app',
      { confirm: true },
    );
  });

  it('opens the OpenRoadie integrations page', () => {
    const spawnBrowser = vi.fn<SpawnBrowser>(() => ({ unref: vi.fn() }));

    const result = openGithubAppSetupPage(spawnBrowser, 'darwin');

    expect(result.url).toBe('http://localhost:7008/admin/integrations');
  });

  it('configures an unconfigured host without carrying credential values', async () => {
    mocks.configureIntegrationHostInternal.mockResolvedValue({
      command: 'integrations configure-host',
      id: 'github-enterprise-token',
      status: 'configured',
      secretNames: ['GITHUB_TOKEN'],
    });

    await expect(
      configureIntegrationHost(
        'github-enterprise-token',
        'https://github.enterprise.test',
      ),
    ).resolves.toEqual(['GITHUB_TOKEN']);
    expect(mocks.configureIntegrationHostInternal).toHaveBeenCalledWith(
      expect.anything(),
      'github-enterprise-token',
      'https://github.enterprise.test',
    );
  });

  it('passes secret-set backend failures through as CliError without including the token', async () => {
    mocks.setSecretInternal.mockResolvedValue({
      command: 'secret set',
      id: 'SHORTCUT_ACCESS_TOKEN',
      status: 'failed',
      reason: 'read-only secret store',
    });

    let thrown: unknown;
    try {
      await setSecret('SHORTCUT_ACCESS_TOKEN', 'shortcut-secret-token');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CliError);
    expect(thrown).toMatchObject({
      message:
        'secret set SHORTCUT_ACCESS_TOKEN failed: read-only secret store',
    });
    expect(String(thrown)).not.toContain('shortcut-secret-token');
  });
});
