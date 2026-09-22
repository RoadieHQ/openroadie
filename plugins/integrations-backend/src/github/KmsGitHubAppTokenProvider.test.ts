import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KmsGitHubAppTokenProvider } from './KmsGitHubAppTokenProvider';

const { mockUndiciFetch, mockKmsSend, MockKMSClient } = vi.hoisted(() => ({
  mockUndiciFetch: vi.fn(),
  mockKmsSend: vi.fn().mockResolvedValue({
    Signature: Uint8Array.from([1, 2, 3, 4]),
  }),
  MockKMSClient: vi.fn(),
}));

const voidLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  child: () => voidLogger,
} as any;

vi.mock('undici', () => ({
  fetch: mockUndiciFetch,
}));

vi.mock('@aws-sdk/client-kms', () => {
  class MockKMSClientClass {
    send = mockKmsSend;

    constructor(input: unknown) {
      MockKMSClient(input);
    }
  }

  class SignCommandClass {
    constructor(input: Record<string, unknown>) {
      Object.assign(this, input);
    }
  }

  return {
    KMSClient: MockKMSClientClass,
    SignCommand: SignCommandClass,
  };
});

const mockedUndiciFetch = mockUndiciFetch as unknown as ReturnType<
  typeof vi.fn
>;

describe('KmsGitHubAppTokenProvider', () => {
  let provider: KmsGitHubAppTokenProvider;

  beforeEach(() => {
    provider = new KmsGitHubAppTokenProvider({
      logger: voidLogger,
      region: 'eu-west-1',
    });
  });

  afterEach(() => {
    mockedUndiciFetch.mockReset();
    mockKmsSend.mockClear();
    provider.clearCache();
  });

  it('caches installation tokens keyed by (appId, installationId)', async () => {
    let tokenCounter = 0;
    mockedUndiciFetch.mockImplementation(async () => {
      tokenCounter++;
      return {
        ok: true,
        json: async () => ({
          token: `ghs_token_${tokenCounter}`,
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        }),
      } as any;
    });

    await provider.getInstallationToken('12345', 100, 'kms-key-id');
    await provider.getInstallationToken('12345', 100, 'kms-key-id');
    await provider.getInstallationToken('12345', 200, 'kms-key-id');

    expect(mockedUndiciFetch).toHaveBeenCalledTimes(2);
    expect(mockKmsSend).toHaveBeenCalledTimes(2);
  });

  it('does not share tokens between GitHub hosts', async () => {
    let tokenCounter = 0;
    mockedUndiciFetch.mockImplementation(async () => {
      tokenCounter += 1;
      return {
        ok: true,
        json: async () => ({
          token: `ghs_token_${tokenCounter}`,
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        }),
      } as any;
    });

    await provider.getInstallationToken('12345', 100, 'kms-key-id');
    await provider.getInstallationToken(
      '12345',
      100,
      'kms-key-id',
      'github.example.com',
    );

    expect(mockedUndiciFetch).toHaveBeenCalledTimes(2);
    expect(mockKmsSend).toHaveBeenCalledTimes(2);
  });

  it('does not share tokens between KMS signing keys', async () => {
    mockedUndiciFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        token: 'ghs_token',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      }),
    } as any);

    await provider.getInstallationToken('12345', 100, 'tenant-a-key');
    await provider.getInstallationToken('12345', 100, 'tenant-b-key');

    expect(mockedUndiciFetch).toHaveBeenCalledTimes(2);
    expect(mockKmsSend).toHaveBeenCalledTimes(2);
  });

  it('clearCache(installationId) invalidates only that installation', async () => {
    let tokenCounter = 0;
    mockedUndiciFetch.mockImplementation(async () => {
      tokenCounter++;
      return {
        ok: true,
        json: async () => ({
          token: `ghs_token_${tokenCounter}`,
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        }),
      } as any;
    });

    await provider.getInstallationToken('12345', 100, 'kms-key-id');
    await provider.getInstallationToken('12345', 200, 'kms-key-id');
    expect(mockedUndiciFetch).toHaveBeenCalledTimes(2);

    provider.clearCache(100);

    await provider.getInstallationToken('12345', 100, 'kms-key-id');
    await provider.getInstallationToken('12345', 200, 'kms-key-id');
    expect(mockedUndiciFetch).toHaveBeenCalledTimes(3);
  });
});
