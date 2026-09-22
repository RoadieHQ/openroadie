import { LoggerService } from '@roadiehq/extensions-api';
import { KMSClient, SignCommand } from '@aws-sdk/client-kms';
import { fetch as undiciFetch } from 'undici';
import { base64UrlEncode, base64UrlEncodeBuffer } from '../utils/base64Url';
import { getGithubRestApiBaseUrl } from '../utils/githubHost';
import { GitHubAppTokenProvider } from './GitHubAppTokenProvider';

interface CachedToken {
  token: string;
  expiresAt: number;
}

export interface KmsGitHubAppTokenProviderOptions {
  logger: LoggerService;
  region?: string;
}

export class KmsGitHubAppTokenProvider implements GitHubAppTokenProvider {
  private readonly logger: LoggerService;
  private readonly kmsClient: KMSClient;
  private readonly tokenCache = new Map<string, CachedToken>();

  private static readonly TOKEN_BUFFER_MS = 10 * 60 * 1000;
  private static readonly JWT_EXPIRY_SECONDS = 600;

  constructor(options: KmsGitHubAppTokenProviderOptions) {
    this.logger = options.logger.child({
      name: 'KmsGitHubAppTokenProvider',
    });
    this.kmsClient = new KMSClient({
      region: options.region ?? process.env.AWS_REGION ?? 'eu-west-1',
    });
  }

  private installationTokenCacheKey(
    appId: string,
    installationId: number,
    apiBaseUrl: string,
    kmsKeyId: string,
  ): string {
    return `${apiBaseUrl.replace(/\/$/, '')}:${appId}:${kmsKeyId}:${installationId}`;
  }

  private async signJwtViaKms(
    appId: string,
    kmsKeyId: string,
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
      iat: now - 60,
      exp: now + KmsGitHubAppTokenProvider.JWT_EXPIRY_SECONDS,
      iss: appId,
    };

    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    const result = await this.kmsClient.send(
      new SignCommand({
        KeyId: kmsKeyId,
        Message: Buffer.from(signingInput),
        MessageType: 'RAW',
        SigningAlgorithm: 'RSASSA_PKCS1_V1_5_SHA_256',
      }),
    );

    if (!result.Signature) {
      throw new Error('KMS Sign returned no signature');
    }

    const encodedSignature = base64UrlEncodeBuffer(
      Buffer.from(result.Signature),
    );
    return `${signingInput}.${encodedSignature}`;
  }

  async generateAppJWT(appId: string, kmsKeyId: string): Promise<string> {
    return this.signJwtViaKms(appId, kmsKeyId);
  }

  async getInstallationToken(
    appId: string,
    installationId: number,
    kmsKeyId: string,
    host?: string,
  ): Promise<string> {
    const apiBaseUrl = getGithubRestApiBaseUrl(host);
    const cacheKey = this.installationTokenCacheKey(
      appId,
      installationId,
      apiBaseUrl,
      kmsKeyId,
    );
    const cached = this.tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }

    const jwt = await this.signJwtViaKms(appId, kmsKeyId);

    const url = `${apiBaseUrl}/app/installations/${installationId}/access_tokens`;
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
      KmsGitHubAppTokenProvider.TOKEN_BUFFER_MS;

    this.tokenCache.set(cacheKey, {
      token: data.token,
      expiresAt,
    });

    this.logger.info(
      `Minted installation token via KMS for app ${appId} installation ${installationId}`,
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
