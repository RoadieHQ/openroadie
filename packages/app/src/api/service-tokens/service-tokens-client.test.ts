import { mockFetchFn, mockResponse } from '../infrastructure/test-utils';
import { ServiceTokensClient } from './service-tokens-client';

const baseToken = {
  id: 'token-1',
  tokenName: 'Automation',
  createdBy: 'user:default/alice',
  createdAt: 1,
  expiresAt: null,
  maskedToken: 'orr_****',
};

describe('ServiceTokensClient', () => {
  const baseUrl = 'http://test/api/service-tokens';
  let mockFetch: ReturnType<typeof mockFetchFn>;
  let client: ServiceTokensClient;

  beforeEach(() => {
    mockFetch = mockFetchFn();
    client = new ServiceTokensClient(baseUrl, mockFetch);
  });

  it('adds organization ownership to listed tokens', async () => {
    mockFetch.mockResolvedValue(
      mockResponse({
        tokens: [
          {
            ...baseToken,
            workspaceId: '00000000-0000-4000-8000-000000000001',
          },
        ],
      }),
    );

    await expect(client.list()).resolves.toMatchObject({
      tokens: [
        {
          workspaceId: '00000000-0000-4000-8000-000000000001',
          ownership: 'org',
        },
      ],
    });
  });

  it.each([
    ['create', () => client.create({ name: 'Automation' })],
    ['rotate', () => client.rotate('token-1')],
  ])('adds workspace ownership to %s responses', async (_name, request) => {
    mockFetch.mockResolvedValue(
      mockResponse({
        ...baseToken,
        workspaceId: 'workspace-a',
        token: 'secret',
        revokedTokenId: 'old-token',
      }),
    );

    await expect(request()).resolves.toMatchObject({
      workspaceId: 'workspace-a',
      ownership: 'workspace',
    });
  });
});
