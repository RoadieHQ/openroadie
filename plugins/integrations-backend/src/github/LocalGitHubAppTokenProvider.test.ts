import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as crypto from 'crypto';
import * as undici from 'undici';
import { LocalGitHubAppTokenProvider } from './LocalGitHubAppTokenProvider';

const { mockUndiciFetch } = vi.hoisted(() => ({
  mockUndiciFetch: vi.fn(),
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

const mockedUndiciFetch = mockUndiciFetch as unknown as ReturnType<
  typeof vi.fn
>;

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

describe('LocalGitHubAppTokenProvider', () => {
  let provider: LocalGitHubAppTokenProvider;

  beforeEach(() => {
    provider = new LocalGitHubAppTokenProvider({
      logger: voidLogger,
    });
  });

  describe('generateAppJWT', () => {
    it('should generate a valid RS256 JWT', () => {
      const jwt = LocalGitHubAppTokenProvider.generateAppJWT(
        '12345',
        privateKey,
      );

      const parts = jwt.split('.');
      expect(parts).toHaveLength(3);

      const header = JSON.parse(
        Buffer.from(
          parts[0].replace(/-/g, '+').replace(/_/g, '/'),
          'base64',
        ).toString(),
      );
      expect(header.alg).toBe('RS256');
      expect(header.typ).toBe('JWT');

      const payload = JSON.parse(
        Buffer.from(
          parts[1].replace(/-/g, '+').replace(/_/g, '/'),
          'base64',
        ).toString(),
      );
      expect(payload.iss).toBe('12345');
      expect(payload.exp).toBeGreaterThan(payload.iat);
      expect(payload.exp - payload.iat).toBeLessThanOrEqual(660);

      const signingInput = `${parts[0]}.${parts[1]}`;
      const signatureBuffer = Buffer.from(
        parts[2].replace(/-/g, '+').replace(/_/g, '/'),
        'base64',
      );
      const verify = crypto.createVerify('RSA-SHA256');
      verify.update(signingInput);
      expect(verify.verify(publicKey, signatureBuffer)).toBe(true);
    });

    it('should set iat to 60 seconds before now', () => {
      const before = Math.floor(Date.now() / 1000) - 60;
      const jwt = LocalGitHubAppTokenProvider.generateAppJWT(
        '12345',
        privateKey,
      );
      const payload = JSON.parse(
        Buffer.from(
          jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'),
          'base64',
        ).toString(),
      );
      const after = Math.floor(Date.now() / 1000) - 60;
      expect(payload.iat).toBeGreaterThanOrEqual(before);
      expect(payload.iat).toBeLessThanOrEqual(after + 1);
    });

    it('maps invalid PEM decode errors to a clear private key message', () => {
      const bogusPem = `-----BEGIN PRIVATE KEY-----
SGVsbG8=
-----END PRIVATE KEY-----`;
      expect(() =>
        LocalGitHubAppTokenProvider.generateAppJWT('12345', bogusPem),
      ).toThrow(
        'GitHub App private key could not be decoded. Verify the secret contains a valid RSA private key in PEM format (for example PKCS#8 with BEGIN PRIVATE KEY or PKCS#1 with BEGIN RSA PRIVATE KEY).',
      );
    });
  });

  describe('getInstallationToken', () => {
    afterEach(() => {
      mockedUndiciFetch.mockReset();
      provider.clearCache();
    });

    it('should call GitHub API and return a token', async () => {
      mockedUndiciFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          token: 'ghs_testtoken123',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        }),
      } as any);

      const token = await provider.getInstallationToken(
        '12345',
        100,
        privateKey,
      );

      expect(token).toBe('ghs_testtoken123');
      expect(mockedUndiciFetch).toHaveBeenCalledWith(
        'https://api.github.com/app/installations/100/access_tokens',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Accept: 'application/vnd.github+json',
          }),
        }),
      );
    });

    it('should cache tokens and return cached on subsequent calls', async () => {
      mockedUndiciFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          token: 'ghs_cached_token',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        }),
      } as any);

      const token1 = await provider.getInstallationToken(
        '12345',
        100,
        privateKey,
      );
      const token2 = await provider.getInstallationToken(
        '12345',
        100,
        privateKey,
      );

      expect(token1).toBe('ghs_cached_token');
      expect(token2).toBe('ghs_cached_token');
      expect(mockedUndiciFetch).toHaveBeenCalledTimes(1);
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

      const githubToken = await provider.getInstallationToken(
        '12345',
        100,
        privateKey,
      );
      const enterpriseToken = await provider.getInstallationToken(
        '12345',
        100,
        privateKey,
        'https://github.example.com/api/v3',
      );

      expect(githubToken).toBe('ghs_token_1');
      expect(enterpriseToken).toBe('ghs_token_2');
      expect(mockedUndiciFetch).toHaveBeenCalledTimes(2);
    });

    it('does not share tokens between signing keys', async () => {
      const { privateKey: otherPrivateKey } = crypto.generateKeyPairSync(
        'rsa',
        {
          modulusLength: 2048,
          privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
          publicKeyEncoding: { type: 'spki', format: 'pem' },
        },
      );
      mockedUndiciFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          token: 'ghs_token',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        }),
      } as any);

      await provider.getInstallationToken('12345', 100, privateKey);
      await provider.getInstallationToken('12345', 100, otherPrivateKey);

      expect(mockedUndiciFetch).toHaveBeenCalledTimes(2);
    });

    it('should throw on GitHub API error', async () => {
      mockedUndiciFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'Bad credentials',
      } as any);

      await expect(
        provider.getInstallationToken('12345', 100, privateKey),
      ).rejects.toThrow('GitHub installation token request failed: 401');
    });
  });

  describe('clearCache', () => {
    afterEach(() => {
      mockedUndiciFetch.mockReset();
    });

    it('should clear specific installation cache', async () => {
      mockedUndiciFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          token: 'ghs_token_to_clear',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        }),
      } as any);

      await provider.getInstallationToken('12345', 100, privateKey);
      expect(mockedUndiciFetch).toHaveBeenCalledTimes(1);

      provider.clearCache(100);

      await provider.getInstallationToken('12345', 100, privateKey);
      expect(mockedUndiciFetch).toHaveBeenCalledTimes(2);
    });

    it('should clear all cache when no installationId', async () => {
      mockedUndiciFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          token: 'ghs_token',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        }),
      } as any);

      await provider.getInstallationToken('12345', 100, privateKey);
      await provider.getInstallationToken('12345', 200, privateKey);
      expect(mockedUndiciFetch).toHaveBeenCalledTimes(2);

      provider.clearCache();

      await provider.getInstallationToken('12345', 100, privateKey);
      await provider.getInstallationToken('12345', 200, privateKey);
      expect(mockedUndiciFetch).toHaveBeenCalledTimes(4);
    });
  });
});
