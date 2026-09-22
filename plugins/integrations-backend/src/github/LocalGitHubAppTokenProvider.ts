import { LoggerService } from '@roadiehq/extensions-api';
import { fetch as undiciFetch } from 'undici';
import * as crypto from 'crypto';
import { base64UrlEncode, base64UrlEncodeBuffer } from '../utils/base64Url';
import { normalizePrivateKey } from '@roadiehq/types';

function isPrivateKeyPemDecodeError(message: string): boolean {
  return (
    /DECODER routines/i.test(message) ||
    /error:[0-9A-F]+:DECODER/i.test(message)
  );
}

function rewritePrivateKeySignError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  if (isPrivateKeyPemDecodeError(raw)) {
    return new Error(
      'GitHub App private key could not be decoded. Verify the secret contains a valid RSA private key in PEM format (for example PKCS#8 with BEGIN PRIVATE KEY or PKCS#1 with BEGIN RSA PRIVATE KEY).',
    );
  }
  return err instanceof Error ? err : new Error(raw);
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

export interface LocalGitHubAppTokenProviderOptions {
  logger: LoggerService;
}

export class LocalGitHubAppTokenProvider {
  private readonly logger: LoggerService;
  private readonly tokenCache = new Map<string, CachedToken>();

  private static readonly TOKEN_BUFFER_MS = 10 * 60 * 1000;
  private static readonly JWT_EXPIRY_SECONDS = 600;

  constructor(options: LocalGitHubAppTokenProviderOptions) {
    this.logger = options.logger.child({
      name: 'LocalGitHubAppTokenProvider',
    });
  }

  private installationTokenCacheKey(
    appId: string,
    installationId: number,
    apiBaseUrl: string,
    privateKeyPem: string,
  ): string {
    const signer = crypto
      .createHash('sha256')
      .update(normalizePrivateKey(privateKeyPem))
      .digest('hex');
    return `${apiBaseUrl.replace(/\/$/, '')}:${appId}:${signer}:${installationId}`;
  }

  static generateAppJWT(appId: string, privateKeyPem: string): string {
    const pem = normalizePrivateKey(privateKeyPem);
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
      iat: now - 60,
      exp: now + LocalGitHubAppTokenProvider.JWT_EXPIRY_SECONDS,
      iss: appId,
    };

    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signingInput);
    let signature: Buffer;
    try {
      signature = sign.sign(pem);
    } catch (err) {
      throw rewritePrivateKeySignError(err);
    }
    const encodedSignature = base64UrlEncodeBuffer(signature);

    return `${signingInput}.${encodedSignature}`;
  }

  async getInstallationToken(
    appId: string,
    installationId: number,
    privateKeyPem: string,
    apiBaseUrl: string = 'https://api.github.com',
  ): Promise<string> {
    const normalizedApiBaseUrl = apiBaseUrl.replace(/\/$/, '');
    const cacheKey = this.installationTokenCacheKey(
      appId,
      installationId,
      normalizedApiBaseUrl,
      privateKeyPem,
    );
    const cached = this.tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }

    const jwt = LocalGitHubAppTokenProvider.generateAppJWT(
      appId,
      privateKeyPem,
    );

    const url = `${normalizedApiBaseUrl}/app/installations/${installationId}/access_tokens`;
    const response = await undiciFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(
        `GitHub installation token request failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const data = (await response.json()) as {
      token: string;
      expires_at: string;
    };

    const expiresAt =
      new Date(data.expires_at).getTime() -
      LocalGitHubAppTokenProvider.TOKEN_BUFFER_MS;

    this.tokenCache.set(cacheKey, {
      token: data.token,
      expiresAt,
    });

    this.logger.info(
      `Minted installation token for app ${appId} installation ${installationId}`,
    );

    return data.token;
  }

  clearCache(installationId?: number): void {
    if (installationId === undefined) {
      this.tokenCache.clear();
      return;
    }
    for (const key of this.tokenCache.keys()) {
      if (key.endsWith(`:${installationId}`)) {
        this.tokenCache.delete(key);
      }
    }
  }
}
