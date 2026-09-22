import * as crypto from 'crypto';
import { LoggerService } from '@roadiehq/extensions-api';
import { Config } from '@roadiehq/config';
import { InputError, NotFoundError } from '@roadiehq/errors';
import { fetch as undiciFetch } from 'undici';
import parseGitUrl from 'git-url-parse';
import {
  defaultCurrentScopeIdResolver,
  noopSubjectScopeIndex,
  type CurrentScopeIdResolver,
  type SubjectScopeIndex,
} from '@roadiehq/integrations-node';
import type { SecretStoreService } from '@roadiehq/secrets-node';
import { GithubAppDao, GithubApp } from '../database/GithubAppDao';
import {
  GithubAppInstallationDao,
  type GithubAppInstallation,
} from '../database/GithubAppInstallationDao';
import { GithubAppInstallRequestDao } from '../database/GithubAppInstallRequestDao';
import { GithubStateNonceDao } from '../database/GithubStateNonceDao';
import { LocalGitHubAppTokenProvider } from '../github/LocalGitHubAppTokenProvider';
import { KmsGitHubAppTokenProvider } from '../github/KmsGitHubAppTokenProvider';
import { base64UrlEncode, base64UrlEncodeBuffer } from '../utils/base64Url';
import {
  getGithubRestApiBaseUrl,
  normalizeGithubHost,
} from '../utils/githubHost';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';

export interface GithubAppServiceOptions {
  logger: LoggerService;
  config: Config;
  githubAppDao: GithubAppDao;
  githubAppInstallationDao: GithubAppInstallationDao;
  githubAppInstallRequestDao?: GithubAppInstallRequestDao;
  stateNonceDao: GithubStateNonceDao;
  localTokenMinter?: LocalGitHubAppTokenProvider;
  kmsTokenMinter?: KmsGitHubAppTokenProvider;
  /**
   * Shared subject index used to route GitHub webhook deliveries back to
   * the scope that owns them. Defaults to a no-op.
   */
  subjectScopeIndex?: SubjectScopeIndex;
  /**
   * Resolves the current scope id for the in-flight request. Used to
   * embed the `scopeId` claim in the state JWT during install-link
   * generation so the callback can route back to the originator.
   */
  currentScopeIdResolver?: CurrentScopeIdResolver;
  secretStore: SecretStoreService;
  getWorkspaceIdForIntegration?: (
    integrationId: string,
  ) => Promise<string | undefined>;
  workspaceExists: (workspaceId: string) => Promise<boolean>;
}

const SUBJECT_INSTALLATION = 'github:installation';
const SUBJECT_INSTALL_REQUEST = 'github:install_request';

function installationSubjectId(
  host: string,
  appId: string,
  installationId: number,
): string {
  return `${host}:${appId}:${installationId}`;
}

function installRequestSubjectId(
  host: string,
  appId: string,
  orgLogin: string,
): string {
  return `${host}:${appId}:${orgLogin.toLowerCase()}`;
}

export class GithubAppService {
  private readonly logger: LoggerService;
  private readonly githubAppDao: GithubAppDao;
  private readonly githubAppInstallationDao: GithubAppInstallationDao;
  private readonly githubAppInstallRequestDao?: GithubAppInstallRequestDao;
  private readonly stateNonceDao: GithubStateNonceDao;
  private readonly localTokenMinter?: LocalGitHubAppTokenProvider;
  private readonly kmsTokenMinter?: KmsGitHubAppTokenProvider;
  private readonly subjectScopeIndex: SubjectScopeIndex;
  private readonly currentScopeIdResolver: CurrentScopeIdResolver;
  private readonly allowedRedirectOrigins: string[];
  private readonly secretStore: SecretStoreService;
  private readonly getWorkspaceIdForIntegration?: (
    integrationId: string,
  ) => Promise<string | undefined>;
  private readonly workspaceExists: (workspaceId: string) => Promise<boolean>;

  constructor(options: GithubAppServiceOptions) {
    this.logger = options.logger;
    this.githubAppDao = options.githubAppDao;
    this.githubAppInstallationDao = options.githubAppInstallationDao;
    this.githubAppInstallRequestDao = options.githubAppInstallRequestDao;
    this.stateNonceDao = options.stateNonceDao;
    this.localTokenMinter = options.localTokenMinter;
    this.kmsTokenMinter = options.kmsTokenMinter;
    this.subjectScopeIndex = options.subjectScopeIndex ?? noopSubjectScopeIndex;
    this.currentScopeIdResolver =
      options.currentScopeIdResolver ?? defaultCurrentScopeIdResolver;
    this.allowedRedirectOrigins =
      options.config.getOptionalStringArray(
        'githubApp.allowedRedirectOrigins',
      ) ?? [];
    this.secretStore = options.secretStore;
    this.getWorkspaceIdForIntegration = options.getWorkspaceIdForIntegration;
    this.workspaceExists = options.workspaceExists;
  }

  private async getWorkspaceId(app: GithubApp): Promise<string> {
    if (!app.integrationId) {
      return DEFAULT_WORKSPACE_ID;
    }
    return (
      (await this.getWorkspaceIdForIntegration?.(app.integrationId)) ??
      DEFAULT_WORKSPACE_ID
    );
  }

  private async assertAppInWorkspace(
    app: GithubApp,
    workspaceId?: string,
  ): Promise<void> {
    if (
      app.status !== 'active' ||
      (workspaceId && (await this.getWorkspaceId(app)) !== workspaceId)
    ) {
      throw new NotFoundError(`GitHub App not found: ${app.appId}`);
    }
  }

  private async getWorkspaceAppKeys(
    workspaceId?: string,
    appId?: string,
    host?: string,
  ): Promise<Set<string> | undefined> {
    if (!workspaceId) {
      return undefined;
    }
    const normalizedHost = host ? normalizeGithubHost(host) : undefined;
    const apps = (
      await this.githubAppDao.listAppsByWorkspaceId(workspaceId)
    ).filter(app => {
      return (
        (!appId || app.appId === appId) &&
        (!normalizedHost || normalizeGithubHost(app.host) === normalizedHost)
      );
    });
    if ((appId || normalizedHost) && apps.length === 0) {
      throw new NotFoundError(
        `GitHub App not found: ${appId ?? normalizedHost}`,
      );
    }
    return new Set(
      apps.map(app => `${normalizeGithubHost(app.host)}:${app.appId}`),
    );
  }

  private async getAppByHostAndPurpose(
    host: string,
    purpose: string,
    workspaceId?: string,
  ): Promise<GithubApp | undefined> {
    if (!workspaceId) {
      return this.githubAppDao.getByHostAndPurpose(host, purpose);
    }
    const normalizedHost = normalizeGithubHost(host);
    return (await this.githubAppDao.listAppsByWorkspaceId(workspaceId)).find(
      app =>
        normalizeGithubHost(app.host) === normalizedHost &&
        app.purposes?.includes(purpose),
    );
  }

  private async resolveRequiredSecret(
    ref: string,
    missingMessage: string,
    workspaceId?: string,
  ): Promise<string> {
    const values = await this.secretStore
      .resolver({ workspaceId })
      .resolve([ref]);
    const value = values[ref];
    if (!value) {
      throw new InputError(missingMessage);
    }
    return value;
  }

  /**
   * Produce the external GitHub install URL. The current scope id
   * (resolved from the in-flight request context via
   * `currentScopeIdResolver`) is
   * embedded in the state JWT so the callback (after GitHub's redirect)
   * can route back to the originator.
   */
  async generateInstallLink(input: {
    appId: string;
    host?: string;
    redirectUrl: string;
    callbackOrigin?: string;
    workspaceId?: string;
  }): Promise<{ installUrl: string }> {
    const { appId, host, redirectUrl, callbackOrigin } = input;

    this.assertAllowedRedirectOrigin(redirectUrl);

    const scopeId = await this.currentScopeIdResolver.getCurrentScopeId();

    const app = await this.githubAppDao.getByAppId(
      appId,
      host ? normalizeGithubHost(host) : undefined,
    );
    await this.assertAppInWorkspace(app, input.workspaceId);

    if (!app.clientSecretRef) {
      throw new InputError(
        'GitHub App configuration error: missing client_secret_ref',
      );
    }

    const secret = await this.resolveRequiredSecret(
      app.clientSecretRef,
      `GitHub App configuration error: missing secret ${app.clientSecretRef} for client_secret_ref`,
      await this.getWorkspaceId(app),
    );

    const jti = crypto.randomUUID();
    const expSeconds = Math.floor(Date.now() / 1000) + 600;
    const statePayload = {
      scopeId,
      redirectUrl,
      ...(callbackOrigin ? { callbackOrigin } : {}),
      appId: app.appId,
      host: normalizeGithubHost(app.host),
      workspaceId: input.workspaceId,
      jti,
      exp: expSeconds,
    };

    await this.stateNonceDao.create(jti, new Date(expSeconds * 1000));

    const stateToken = createStateJWT(statePayload, secret);

    const slug = app.slug ?? app.appId;
    const installHost = getGithubInstallHost(app.host);
    const installUrl = `https://${installHost}/apps/${slug}/installations/new?state=${stateToken}`;

    return { installUrl };
  }

  async handleCallback(input: {
    stateParam: string;
    installationIdParam?: string;
    setupAction?: string;
    codeParam?: string;
  }): Promise<{ redirectUrl: string }> {
    const { stateParam, installationIdParam, setupAction, codeParam } = input;

    const unverifiedClaims = decodeUnverifiedStatePayload(stateParam);
    if (
      !unverifiedClaims?.appId ||
      typeof unverifiedClaims.appId !== 'string'
    ) {
      throw new InputError('Invalid or expired state');
    }

    const stateHost =
      typeof unverifiedClaims.host === 'string'
        ? normalizeGithubHost(unverifiedClaims.host)
        : undefined;

    let matchedApp: GithubApp;
    try {
      matchedApp = await this.githubAppDao.getByAppId(
        unverifiedClaims.appId,
        stateHost,
      );
    } catch {
      throw new InputError('Invalid or expired state');
    }

    if (matchedApp.status !== 'active' || !matchedApp.clientSecretRef) {
      throw new InputError('Invalid or expired state');
    }

    const ownerWorkspaceId = await this.getWorkspaceId(matchedApp);
    const { [matchedApp.clientSecretRef]: secret } = await this.secretStore
      .resolver({ workspaceId: ownerWorkspaceId })
      .resolve([matchedApp.clientSecretRef]);
    if (!secret) {
      throw new InputError('Invalid or expired state');
    }

    const payload = verifyStateJWT(stateParam, secret);
    if (!payload) {
      throw new InputError('Invalid or expired state');
    }
    await this.assertAppInWorkspace(
      matchedApp,
      typeof payload.workspaceId === 'string' ? payload.workspaceId : undefined,
    );

    const claimedWorkspaceId =
      typeof payload.workspaceId === 'string' ? payload.workspaceId : undefined;
    if (
      claimedWorkspaceId !== undefined &&
      claimedWorkspaceId !== ownerWorkspaceId
    ) {
      throw new InputError('Invalid or expired state');
    }

    const jti = payload.jti as string | undefined;
    if (!jti) {
      throw new InputError('State token missing jti');
    }

    const nonceValid = await this.stateNonceDao.consume(jti);
    if (!nonceValid) {
      this.logger.warn(`State nonce rejected (replayed or expired): ${jti}`);
      throw new InputError('State token has already been used');
    }

    const scopeId = payload.scopeId as string | undefined;
    if (!scopeId) {
      throw new InputError('Invalid or expired state');
    }
    const redirectUrl = payload.redirectUrl as string;

    this.assertAllowedRedirectOrigin(redirectUrl);

    if (setupAction === 'request') {
      this.logger.info(
        `GitHub App installation request submitted for scope ${scopeId}`,
      );

      if (this.githubAppInstallRequestDao) {
        const host = normalizeGithubHost(matchedApp.host);
        let orgLogin: string | undefined;
        try {
          orgLogin = await this.fetchOrgLoginFromInstallRequests(
            matchedApp,
            host,
          );
        } catch (err: unknown) {
          this.logger.warn(
            `Failed to fetch org login from installation requests API: ${
              err instanceof Error ? err.message : 'unknown error'
            }`,
          );
        }

        await this.githubAppInstallRequestDao.create(
          matchedApp.appId,
          host,
          orgLogin,
        );
        if (orgLogin) {
          await this.subjectScopeIndex.record({
            subjectType: SUBJECT_INSTALL_REQUEST,
            subjectId: installRequestSubjectId(
              host,
              matchedApp.appId,
              orgLogin,
            ),
            scopeId,
          });
        }
      }

      return {
        redirectUrl: appendGithubAppCallbackResult(redirectUrl, 'requested'),
      };
    }

    if (setupAction === 'install' || setupAction === 'update') {
      if (!installationIdParam) {
        throw new InputError('Missing installation_id parameter');
      }
      const installationId = parseInt(installationIdParam, 10);
      if (Number.isNaN(installationId)) {
        throw new InputError('installation_id must be a number');
      }

      let metadata = await this.fetchInstallationMetadataForApp(
        matchedApp,
        installationId,
      );

      if (!metadata?.orgLogin && codeParam && matchedApp.clientId) {
        try {
          const fallbackMetadata = await fetchInstallationMetadataFromUserCode({
            clientId: matchedApp.clientId,
            clientSecret: secret,
            code: codeParam,
            host: matchedApp.host,
            installationId,
          });
          if (fallbackMetadata?.orgLogin) {
            metadata = fallbackMetadata;
          }
        } catch (err: unknown) {
          this.logger.warn(
            `Failed to resolve installation metadata from user code for ${installationId}: ${
              err instanceof Error ? err.message : 'unknown error'
            }`,
          );
        }
      }

      const host = normalizeGithubHost(matchedApp.host);
      await this.githubAppInstallationDao.upsert({
        appId: matchedApp.appId,
        host,
        installationId,
        orgLogin: metadata?.orgLogin,
        orgUrl: metadata?.orgUrl,
        avatarUrl: metadata?.avatarUrl,
        permissions: metadata?.permissions,
        repoSelection: metadata?.repoSelection,
      });
      await this.subjectScopeIndex.record({
        subjectType: SUBJECT_INSTALLATION,
        subjectId: installationSubjectId(
          host,
          matchedApp.appId,
          installationId,
        ),
        scopeId,
      });

      this.logger.info(
        `GitHub App installation ${installationIdParam} recorded for scope ${scopeId}`,
      );

      return {
        redirectUrl: appendGithubAppCallbackResult(redirectUrl, 'installed'),
      };
    }

    return { redirectUrl };
  }

  async listInstallations(appId?: string, host?: string, workspaceId?: string) {
    const normalizedHost = host ? normalizeGithubHost(host) : undefined;
    const allInstallations =
      appId && normalizedHost
        ? await this.githubAppInstallationDao.listAll(appId, normalizedHost)
        : await this.githubAppInstallationDao.list(appId);
    const workspaceAppKeys = await this.getWorkspaceAppKeys(
      workspaceId,
      appId,
      normalizedHost,
    );
    const installations = workspaceAppKeys
      ? allInstallations.filter(installation =>
          workspaceAppKeys.has(
            `${normalizeGithubHost(installation.host)}:${installation.appId}`,
          ),
        )
      : allInstallations;
    const installationsMissingOrg = installations.filter(
      installation => !installation.orgLogin?.trim(),
    );

    let warning: GithubAppInstallationsWarning | undefined;

    const refreshedInstallations =
      installationsMissingOrg.length === 0
        ? []
        : await Promise.all(
            installationsMissingOrg.map(async installation => {
              try {
                const app = await this.githubAppDao.getByAppId(
                  installation.appId,
                  installation.host,
                );
                const metadata = await this.fetchInstallationMetadataForApp(
                  app,
                  installation.installationId,
                );

                if (!metadata?.orgLogin) {
                  return installation;
                }

                return await this.githubAppInstallationDao.upsert({
                  appId: installation.appId,
                  host: installation.host,
                  installationId: installation.installationId,
                  orgLogin: metadata.orgLogin,
                  orgUrl: metadata.orgUrl,
                  avatarUrl: metadata.avatarUrl,
                  permissions: metadata.permissions,
                  repoSelection: metadata.repoSelection,
                });
              } catch (error: unknown) {
                this.logger.warn(
                  `Failed to refresh installation metadata for ${installation.installationId}: ${
                    error instanceof Error ? error.message : 'unknown error'
                  }`,
                );
                warning ??= getGithubAppInstallationsWarning(error);
                return installation;
              }
            }),
          );

    if (appId) {
      warning ??= await this.getInstallationsWarningForApp(
        appId,
        normalizedHost,
      );
    }

    const refreshedById = new Map(
      refreshedInstallations.map(installation => [
        installation.id,
        installation,
      ]),
    );

    return {
      installations: installations.map(
        installation => refreshedById.get(installation.id) ?? installation,
      ),
      warning,
    };
  }

  async listInstallRequests(appId?: string, workspaceId?: string) {
    if (!this.githubAppInstallRequestDao) {
      return [];
    }
    const requests = await this.githubAppInstallRequestDao.list(appId);
    const workspaceAppKeys = await this.getWorkspaceAppKeys(workspaceId, appId);
    return workspaceAppKeys
      ? requests.filter(request =>
          workspaceAppKeys.has(
            `${normalizeGithubHost(request.host)}:${request.appId}`,
          ),
        )
      : requests;
  }

  async testAppConnection(input: {
    appId: string;
    host?: string;
    callerIdentity: string;
    workspaceId?: string;
  }): Promise<GitHubAppConnectionTestResult> {
    const normalizedHost = input.host
      ? normalizeGithubHost(input.host)
      : undefined;
    const app = await this.githubAppDao.getByAppId(input.appId, normalizedHost);
    await this.assertAppInWorkspace(app, input.workspaceId);
    const host = normalizeGithubHost(app.host);
    const installations = await this.githubAppInstallationDao.listAll(
      app.appId,
      host,
    );

    this.logger.info(
      `Testing GitHub App connectivity: caller=${input.callerIdentity}, app=${app.appId}, host=${host}, installations=${installations.length}`,
    );

    const appCredentials = await this.testAppCredentials(app);
    const installationResults =
      appCredentials.status === 'success'
        ? await Promise.all(
            installations.map(installation =>
              this.testInstallationConnection(app, installation, host),
            ),
          )
        : installations.map(installation => ({
            id: installation.id,
            installationId: installation.installationId,
            orgLogin: installation.orgLogin,
            repoSelection: installation.repoSelection,
            status: 'error' as const,
            message:
              'Skipped installation request because the app credentials could not be validated.',
          }));
    const warning =
      appCredentials.status === 'success' && installations.length === 0
        ? 'GitHub App credentials are valid, but no installations exist for this tenant yet.'
        : undefined;

    return {
      appId: app.appId,
      host,
      testedAt: new Date().toISOString(),
      appCredentials,
      installations: installationResults,
      warning,
    };
  }

  async deleteInstallation(id: string, workspaceId?: string): Promise<void> {
    const installation = await this.githubAppInstallationDao.getById(id);

    const app = await this.githubAppDao.getByAppId(
      installation.appId,
      installation.host,
    );
    await this.assertAppInWorkspace(app, workspaceId);

    let privateKeyPem: string | undefined;
    if (app.privateKeyRef) {
      const { [app.privateKeyRef]: value } = await this.secretStore
        .resolver({ workspaceId: await this.getWorkspaceId(app) })
        .resolve([app.privateKeyRef]);
      privateKeyPem = value;
    }

    await this.uninstallFromGithub({
      appId: installation.appId,
      host: installation.host,
      installationId: installation.installationId,
      privateKeyPem,
      kmsKeyId: app.kmsKeyId,
    });

    await this.githubAppInstallationDao.delete(id);
    // The subject_index entry is keyed by (host, appId, installationId); the
    // scope on the record is whatever the current request context is, which
    // is the only scope that could have reached this delete endpoint.
    // SubjectScopeIndex.remove uses the (type, id, scopeId) composite key so
    // removing with an unknown scope is a no-op. We rely on webhook cleanup
    // if the row outlives the installation.
    this.logger.info(`Uninstalled and deleted GitHub App installation: ${id}`);
  }

  async createToken(input: {
    url: string;
    purpose: string;
    callerIdentity: string;
    workspaceId?: string;
  }): Promise<{ token: string }> {
    const { url, purpose, callerIdentity } = input;

    let parsedGitUrl: parseGitUrl.GitUrl;
    try {
      parsedGitUrl = parseGitUrl(url);
    } catch {
      throw new InputError(`Invalid URL: ${url}`);
    }

    const host = normalizeGithubHost(parsedGitUrl.resource);
    const org = parsedGitUrl.owner || parsedGitUrl.name || undefined;

    if (!org) {
      throw new InputError(
        'GitHub org/owner could not be resolved from URL; include an org in the URL path',
      );
    }

    const matchedApp = await this.getAppByHostAndPurpose(
      host,
      purpose,
      input.workspaceId,
    );

    if (!matchedApp) {
      throw new NotFoundError(
        `No backstage GitHub App configured for host ${host}`,
      );
    }

    let installation = await this.githubAppInstallationDao.getByOrg(
      matchedApp.appId,
      host,
      org,
    );

    if (!installation) {
      const installations = await this.githubAppInstallationDao.listAll(
        matchedApp.appId,
        host,
      );
      installation = installations[0];

      if (installation && org) {
        this.logger.warn(
          `No installation matched org "${org}"; ` +
            `falling back to installation ${installation.installationId} ` +
            `(org: ${installation.orgLogin ?? 'unknown'})`,
        );
      }
    }

    if (!installation) {
      throw new NotFoundError('No GitHub App installation found');
    }

    this.logger.info(
      `Minting GitHub App token: caller=${callerIdentity}, ` +
        `app=${matchedApp.appId}, installation=${installation.installationId}, ` +
        `org=${installation.orgLogin ?? 'unknown'}`,
    );

    const token = await this.mintToken(matchedApp, installation, host);

    if (!token) {
      throw new InputError(
        'GitHub App configuration error: no usable signing configuration found (kmsKeyId or privateKeyRef)',
      );
    }

    return { token };
  }

  private async mintToken(
    app: GithubApp,
    installation: { installationId: number },
    host: string,
  ): Promise<string | undefined> {
    if (this.kmsTokenMinter && app.kmsKeyId) {
      try {
        return await this.kmsTokenMinter.getInstallationToken(
          app.appId,
          installation.installationId,
          app.kmsKeyId,
          host,
        );
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : 'unknown error';
        throw new InputError(
          `GitHub App configuration error: unable to mint token with kmsKeyId "${app.kmsKeyId}" (${detail})`,
        );
      }
    }

    if (this.localTokenMinter && app.privateKeyRef) {
      const privateKeyPem = await this.resolveRequiredSecret(
        app.privateKeyRef,
        `GitHub App configuration error: missing secret ${app.privateKeyRef} for private key`,
        await this.getWorkspaceId(app),
      );
      return this.localTokenMinter.getInstallationToken(
        app.appId,
        installation.installationId,
        privateKeyPem,
        getGithubRestApiBaseUrl(host),
      );
    }

    return undefined;
  }

  private async testAppCredentials(
    app: GithubApp,
  ): Promise<GitHubAppConnectionCheckResult> {
    const requestPath = '/app';
    try {
      const jwt = await this.generateAppJWT(app);
      if (!jwt) {
        throw new InputError(
          'GitHub App configuration error: no usable signing configuration found (kmsKeyId or privateKeyRef)',
        );
      }

      await validateGithubAppCredentials({ host: app.host, jwt });
      return {
        status: 'success',
        message: 'GitHub accepted the app credentials.',
        requestPath,
      };
    } catch (error: unknown) {
      return {
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Failed to validate app credentials',
        requestPath,
      };
    }
  }

  private async testInstallationConnection(
    app: GithubApp,
    installation: GithubAppInstallation,
    host: string,
  ): Promise<GitHubAppInstallationConnectionTestResult> {
    const requestPath = '/installation/repositories?per_page=1';
    try {
      const token = await this.mintToken(app, installation, host);
      if (!token) {
        throw new InputError(
          'GitHub App configuration error: no usable signing configuration found (kmsKeyId or privateKeyRef)',
        );
      }

      const access = await testGithubInstallationAccess({ host, token });
      const repoSummary =
        typeof access.repositoryCount === 'number'
          ? access.repositoryCount === 0
            ? 'GitHub returned 0 repositories for this installation.'
            : access.sampleRepository
              ? `GitHub returned ${access.repositoryCount} repositories. Example: ${access.sampleRepository}.`
              : `GitHub returned ${access.repositoryCount} repositories.`
          : 'GitHub accepted the installation token.';

      return {
        id: installation.id,
        installationId: installation.installationId,
        orgLogin: installation.orgLogin,
        repoSelection: installation.repoSelection,
        status: 'success',
        message: repoSummary,
        requestPath,
        repositoryCount: access.repositoryCount,
        sampleRepository: access.sampleRepository,
      };
    } catch (error: unknown) {
      return {
        id: installation.id,
        installationId: installation.installationId,
        orgLogin: installation.orgLogin,
        repoSelection: installation.repoSelection,
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Failed to validate installation access',
        requestPath,
      };
    }
  }

  private assertAllowedRedirectOrigin(redirectUrl: string): void {
    if (!isAllowedRedirectOrigin(redirectUrl, this.allowedRedirectOrigins)) {
      throw new InputError(
        'Redirect URL origin is not in the allowedRedirectOrigins list',
      );
    }
  }

  private async fetchInstallationMetadataForApp(
    app: GithubApp,
    installationId: number,
  ): Promise<InstallationMetadata | undefined> {
    if (this.kmsTokenMinter && app.kmsKeyId) {
      try {
        return await fetchInstallationMetadata({
          appId: app.appId,
          host: app.host,
          installationId,
          kmsTokenMinter: this.kmsTokenMinter,
          kmsKeyId: app.kmsKeyId,
        });
      } catch (error: unknown) {
        this.logger.warn(
          `Failed to enrich installation metadata for ${installationId}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
        return undefined;
      }
    }

    if (app.privateKeyRef) {
      const { [app.privateKeyRef]: privateKeyPem } = await this.secretStore
        .resolver({ workspaceId: await this.getWorkspaceId(app) })
        .resolve([app.privateKeyRef]);
      if (privateKeyPem) {
        try {
          return await fetchInstallationMetadata({
            appId: app.appId,
            host: app.host,
            privateKeyPem,
            installationId,
          });
        } catch (error: unknown) {
          this.logger.warn(
            `Failed to enrich installation metadata for ${installationId}: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          );
          return undefined;
        }
      }
    }

    return undefined;
  }

  /**
   * Reconcile install requests against GitHub's live installation list.
   */
  async fulfillPendingInstallRequests(): Promise<void> {
    if (!this.githubAppInstallRequestDao) {
      return;
    }

    const pendingRequests = await this.githubAppInstallRequestDao.listActive();
    if (pendingRequests.length === 0) {
      return;
    }

    const groups = new Map<
      string,
      { appId: string; host: string; requests: typeof pendingRequests }
    >();
    for (const req of pendingRequests) {
      const key = `${req.appId}::${req.host}`;
      const existing = groups.get(key);
      if (existing) {
        existing.requests.push(req);
      } else {
        groups.set(key, { appId: req.appId, host: req.host, requests: [req] });
      }
    }

    for (const { appId, host, requests } of groups.values()) {
      try {
        const app = await this.githubAppDao.getByAppId(appId, host);
        const workspaceId = await this.getWorkspaceId(app);
        if (!(await this.workspaceExists(workspaceId))) {
          continue;
        }
        const installations = await this.fetchAllInstallationsForApp(
          appId,
          host,
        );
        if (!installations) {
          continue;
        }

        for (const req of requests) {
          try {
            const match = installations.find(
              inst =>
                req.orgLogin &&
                inst.account?.login?.toLowerCase() ===
                  req.orgLogin.toLowerCase(),
            );

            if (!match) {
              continue;
            }

            if (!(await this.workspaceExists(workspaceId))) {
              continue;
            }

            const metadata: InstallationMetadata = {
              orgLogin: match.account?.login,
              orgUrl: match.account?.html_url,
              avatarUrl: match.account?.avatar_url,
              permissions: match.permissions,
              repoSelection: match.repository_selection,
            };

            await this.githubAppInstallationDao.upsert({
              appId,
              host,
              installationId: match.id,
              orgLogin: metadata.orgLogin,
              orgUrl: metadata.orgUrl,
              avatarUrl: metadata.avatarUrl,
              permissions: metadata.permissions,
              repoSelection: metadata.repoSelection,
            });

            await this.githubAppInstallRequestDao!.delete(req.id);
            this.logger.info(
              `Polling fulfilled pending install request ${req.id} (installation ${match.id})`,
            );
          } catch (err: unknown) {
            this.logger.warn(
              `Failed to fulfill pending install request ${req.id} on app ${appId} (${host}): ${
                err instanceof Error ? err.message : 'unknown error'
              }`,
            );
          }
        }
      } catch (err: unknown) {
        this.logger.warn(
          `Failed to poll installations for app ${appId} on ${host}: ${
            err instanceof Error ? err.message : 'unknown error'
          }`,
        );
      }
    }
  }

  private async fetchAllInstallationsForApp(
    appId: string,
    host: string,
  ): Promise<GitHubInstallationListItem[] | undefined> {
    let app: GithubApp;
    try {
      app = await this.githubAppDao.getByAppId(appId, host);
    } catch {
      return undefined;
    }

    const jwt = await this.generateAppJWT(app);
    if (!jwt) {
      return undefined;
    }

    const apiBaseUrl = getGithubRestApiBaseUrl(host);
    return fetchGithubAppPaginatedList<GitHubInstallationListItem>({
      apiBaseUrl,
      jwt,
      endpoint: '/app/installations',
      errorPrefix: 'GET /app/installations failed',
    });
  }

  private async fetchOrgLoginFromInstallRequests(
    app: GithubApp,
    host: string,
  ): Promise<string | undefined> {
    const jwt = await this.generateAppJWT(app);
    if (!jwt) {
      return undefined;
    }

    const apiBaseUrl = getGithubRestApiBaseUrl(host);
    const data = await fetchGithubAppPaginatedList<{
      account?: { login?: string };
    }>({
      apiBaseUrl,
      jwt,
      endpoint: '/app/installation-requests',
      returnUndefinedOnError: true,
    });
    if (!data) {
      return undefined;
    }
    const logins = Array.from(
      new Set(
        data
          .map(item => item.account?.login?.trim().toLowerCase())
          .filter((login): login is string => Boolean(login)),
      ),
    );

    if (logins.length === 1) {
      return logins[0];
    }

    if (logins.length > 1) {
      this.logger.warn(
        `Ambiguous installation request org login lookup for app ${app.appId} on ${host}; found ${logins.length} candidates`,
      );
    }

    return undefined;
  }

  async generateAppJWT(app: GithubApp): Promise<string | undefined> {
    if (this.kmsTokenMinter && app.kmsKeyId) {
      return this.kmsTokenMinter.generateAppJWT(app.appId, app.kmsKeyId);
    }

    if (app.privateKeyRef) {
      const { [app.privateKeyRef]: privateKeyPem } = await this.secretStore
        .resolver({ workspaceId: await this.getWorkspaceId(app) })
        .resolve([app.privateKeyRef]);
      if (privateKeyPem) {
        return LocalGitHubAppTokenProvider.generateAppJWT(
          app.appId,
          privateKeyPem,
        );
      }
    }

    return undefined;
  }

  private async getInstallationsWarningForApp(
    appId: string,
    host?: string,
  ): Promise<GithubAppInstallationsWarning | undefined> {
    let app: GithubApp;
    try {
      app = await this.githubAppDao.getByAppId(appId, host);
    } catch {
      return undefined;
    }

    let jwt: string | undefined;
    try {
      jwt = await this.generateAppJWT(app);
    } catch (error: unknown) {
      return getGithubAppInstallationsWarning(error);
    }

    if (!jwt) {
      return INVALID_GITHUB_APP_CREDENTIALS_WARNING;
    }

    try {
      await validateGithubAppCredentials({ host: app.host, jwt });
      return undefined;
    } catch (error: unknown) {
      return getGithubAppInstallationsWarning(error);
    }
  }

  private async uninstallFromGithub(options: {
    appId: string;
    host?: string;
    installationId: number;
    privateKeyPem?: string;
    kmsKeyId?: string;
  }): Promise<void> {
    const { appId, host, installationId, privateKeyPem, kmsKeyId } = options;

    let jwt: string;
    if (this.kmsTokenMinter && kmsKeyId) {
      try {
        jwt = await this.kmsTokenMinter.generateAppJWT(appId, kmsKeyId);
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : 'unknown error';
        throw new InputError(
          `GitHub App configuration error: unable to sign uninstall request with kmsKeyId "${kmsKeyId}" (${detail})`,
        );
      }
    } else if (privateKeyPem) {
      jwt = LocalGitHubAppTokenProvider.generateAppJWT(appId, privateKeyPem);
    } else {
      throw new InputError(
        'GitHub App configuration error: missing private key or kmsKeyId for uninstall',
      );
    }

    const apiBaseUrl = getGithubRestApiBaseUrl(host);
    const response = await undiciFetch(
      `${apiBaseUrl}/app/installations/${installationId}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );

    if (!response.ok && response.status !== 404) {
      const body = await response.text().catch(() => 'Unknown error');
      throw new Error(
        `Failed to uninstall GitHub App installation: ${response.status} ${response.statusText} - ${body}`,
      );
    }
  }
}

function getGithubInstallHost(host?: string): string {
  const normalizedHost = normalizeGithubHost(host).toLowerCase();
  if (normalizedHost === 'api.github.com') {
    return 'github.com';
  }
  return normalizedHost;
}

interface GitHubInstallationListItem {
  id: number;
  app_id: number;
  account?: {
    login?: string;
    html_url?: string;
    avatar_url?: string;
    type?: string;
  };
  permissions?: Record<string, string>;
  repository_selection?: string;
  target_type?: string;
}

interface InstallationMetadata {
  orgLogin?: string;
  orgUrl?: string;
  avatarUrl?: string;
  permissions?: Record<string, string>;
  repoSelection?: string;
}

interface GitHubAppConnectionCheckResult {
  status: 'success' | 'error';
  message: string;
  requestPath: string;
}

interface GitHubAppInstallationConnectionTestResult {
  id: string;
  installationId: number;
  orgLogin?: string;
  repoSelection?: string;
  status: 'success' | 'error';
  message: string;
  requestPath?: string;
  repositoryCount?: number;
  sampleRepository?: string;
}

interface GitHubAppConnectionTestResult {
  appId: string;
  host: string;
  testedAt: string;
  appCredentials: GitHubAppConnectionCheckResult;
  installations: GitHubAppInstallationConnectionTestResult[];
  warning?: string;
}

interface GithubAppInstallationsWarning {
  code: 'invalid_app_credentials';
  message: string;
}

const INVALID_GITHUB_APP_CREDENTIALS_WARNING: GithubAppInstallationsWarning = {
  code: 'invalid_app_credentials',
  message:
    'GitHub App credentials look invalid. Installation details may be incomplete. Check the App ID, private key, and client secret.',
};

function installationListItemToMetadata(
  installation: GitHubInstallationListItem,
): InstallationMetadata {
  return {
    orgLogin: installation.account?.login,
    orgUrl: installation.account?.html_url,
    avatarUrl: installation.account?.avatar_url,
    permissions: installation.permissions,
    repoSelection: installation.repository_selection,
  };
}

async function testGithubInstallationAccess(options: {
  host?: string;
  token: string;
}): Promise<{ repositoryCount?: number; sampleRepository?: string }> {
  const { host, token } = options;
  const apiBaseUrl = getGithubRestApiBaseUrl(host);
  const requestPath = '/installation/repositories?per_page=1';
  const response = await undiciFetch(`${apiBaseUrl}${requestPath}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => 'Unknown error');
    throw new Error(
      `GitHub ${requestPath} returned ${response.status} ${response.statusText} - ${body}`,
    );
  }

  const data = (await response.json()) as {
    total_count?: number;
    repositories?: Array<{ full_name?: string }>;
  };

  return {
    repositoryCount: data.total_count,
    sampleRepository: data.repositories?.[0]?.full_name,
  };
}

function getGithubAppInstallationsWarning(
  error: unknown,
): GithubAppInstallationsWarning | undefined {
  const message = error instanceof Error ? error.message : 'unknown error';
  const lower = message.toLowerCase();

  if (
    lower.includes('401 unauthorized') ||
    lower.includes('json web token could not be decoded') ||
    lower.includes('bad credentials') ||
    lower.includes('incorrect_client_credentials') ||
    lower.includes('missing secret') ||
    lower.includes('no usable signing configuration found') ||
    lower.includes('configuration error')
  ) {
    return INVALID_GITHUB_APP_CREDENTIALS_WARNING;
  }

  return undefined;
}

async function fetchGithubAppPaginatedList<T>(options: {
  apiBaseUrl: string;
  jwt: string;
  endpoint: string;
  errorPrefix?: string;
  returnUndefinedOnError?: boolean;
}): Promise<T[] | undefined> {
  const { apiBaseUrl, jwt, endpoint, errorPrefix, returnUndefinedOnError } =
    options;
  const allItems: T[] = [];
  const perPage = 100;

  for (let page = 1; ; page += 1) {
    const response = await undiciFetch(
      `${apiBaseUrl}${endpoint}?per_page=${perPage}&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );

    if (!response.ok) {
      if (returnUndefinedOnError) {
        return undefined;
      }
      const body = await response.text().catch(() => 'Unknown error');
      throw new Error(
        `${errorPrefix ?? `GET ${endpoint} failed`}: ${response.status} ${
          response.statusText
        } - ${body}`,
      );
    }

    const pageItems = (await response.json()) as T[];
    allItems.push(...pageItems);

    if (pageItems.length < perPage) {
      break;
    }
  }

  return allItems;
}

function createStateJWT(
  payload: Record<string, unknown>,
  secret: string,
): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest();
  const encodedSignature = base64UrlEncodeBuffer(signature);

  return `${signingInput}.${encodedSignature}`;
}

function verifyStateJWT(
  token: string,
  secret: string,
): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const signingInput = `${parts[0]}.${parts[1]}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest();
  const actualSignature = Buffer.from(
    parts[2].replace(/-/g, '+').replace(/_/g, '/'),
    'base64',
  );

  if (actualSignature.length !== expectedSignature.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(expectedSignature, actualSignature)) {
    return null;
  }

  const payload = JSON.parse(
    Buffer.from(
      parts[1].replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString(),
  );

  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
}

function decodeUnverifiedStatePayload(
  token: string,
): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  try {
    return JSON.parse(
      Buffer.from(
        parts[1].replace(/-/g, '+').replace(/_/g, '/'),
        'base64',
      ).toString(),
    );
  } catch {
    return null;
  }
}

function isAllowedRedirectOrigin(
  redirectUrl: string,
  allowedOrigins: string[],
): boolean {
  if (allowedOrigins.length === 0) {
    return true;
  }
  try {
    const parsed = new URL(redirectUrl);
    return allowedOrigins.includes(parsed.origin);
  } catch {
    return false;
  }
}

function appendGithubAppCallbackResult(
  redirectUrl: string,
  result: 'installed' | 'requested',
): string {
  const parsed = new URL(redirectUrl);
  parsed.searchParams.delete('github-app-installed');
  parsed.searchParams.delete('github-app-install-requested');
  parsed.searchParams.set(
    result === 'installed'
      ? 'github-app-installed'
      : 'github-app-install-requested',
    'true',
  );
  return parsed.toString();
}

async function fetchInstallationMetadata(options: {
  appId: string;
  host?: string;
  installationId: number;
  privateKeyPem?: string;
  kmsTokenMinter?: KmsGitHubAppTokenProvider;
  kmsKeyId?: string;
}): Promise<InstallationMetadata> {
  const {
    appId,
    host,
    installationId,
    privateKeyPem,
    kmsTokenMinter,
    kmsKeyId,
  } = options;

  let jwt: string;
  if (kmsTokenMinter && kmsKeyId) {
    jwt = await kmsTokenMinter.generateAppJWT(appId, kmsKeyId);
  } else if (privateKeyPem) {
    jwt = LocalGitHubAppTokenProvider.generateAppJWT(appId, privateKeyPem);
  } else {
    throw new Error(
      'No signing credentials available to fetch installation metadata',
    );
  }

  const apiBaseUrl = getGithubRestApiBaseUrl(host);
  const response = await undiciFetch(
    `${apiBaseUrl}/app/installations/${installationId}`,
    {
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => 'Unknown error');
    throw new Error(
      `Failed to fetch installation metadata: ${response.status} ${response.statusText} - ${body}`,
    );
  }

  const data = (await response.json()) as {
    account?: {
      login?: string;
      html_url?: string;
      avatar_url?: string;
    };
    permissions?: Record<string, string>;
    repository_selection?: string;
  };

  return installationListItemToMetadata({
    id: installationId,
    app_id: Number(appId),
    account: data.account,
    permissions: data.permissions,
    repository_selection: data.repository_selection,
  });
}

async function fetchInstallationMetadataFromUserCode(options: {
  clientId: string;
  clientSecret: string;
  code: string;
  host?: string;
  installationId: number;
}): Promise<InstallationMetadata | undefined> {
  const { clientId, clientSecret, code, host, installationId } = options;
  const installHost = getGithubInstallHost(host);
  const oauthResponse = await undiciFetch(
    `https://${installHost}/login/oauth/access_token`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    },
  );

  if (!oauthResponse.ok) {
    const body = await oauthResponse.text().catch(() => 'Unknown error');
    throw new Error(
      `Failed to exchange user code: ${oauthResponse.status} ${oauthResponse.statusText} - ${body}`,
    );
  }

  const oauthData = (await oauthResponse.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!oauthData.access_token) {
    throw new Error(
      oauthData.error_description ??
        oauthData.error ??
        'No user access token returned by GitHub',
    );
  }

  const apiBaseUrl = getGithubRestApiBaseUrl(host);
  const perPage = 100;

  for (let page = 1; ; page += 1) {
    const response = await undiciFetch(
      `${apiBaseUrl}/user/installations?per_page=${perPage}&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${oauthData.access_token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => 'Unknown error');
      throw new Error(
        `Failed to list user installations: ${response.status} ${response.statusText} - ${body}`,
      );
    }

    const data = (await response.json()) as {
      installations?: GitHubInstallationListItem[];
    };
    const installations = data.installations ?? [];
    const match = installations.find(item => item.id === installationId);

    if (match) {
      return installationListItemToMetadata(match);
    }

    if (installations.length < perPage) {
      return undefined;
    }
  }
}

function githubAppIntegrationNotFound404Hint(
  status: number,
  body: string,
): string {
  if (status !== 404) {
    return '';
  }
  if (!body.toLowerCase().includes('integration not found')) {
    return '';
  }
  return ' This usually means the PEM private key is not for this GitHub App, or the configured App ID does not match the app that owns that key. Confirm the numeric App ID and private key on the same GitHub App settings page (use the App ID number for the issuer, not the OAuth Client ID string).';
}

async function validateGithubAppCredentials(options: {
  host?: string;
  jwt: string;
}): Promise<void> {
  const { host, jwt } = options;
  const apiBaseUrl = getGithubRestApiBaseUrl(host);
  const requestPath = '/app';
  const response = await undiciFetch(`${apiBaseUrl}${requestPath}`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => 'Unknown error');
    const base = `GitHub ${requestPath} returned ${response.status} ${response.statusText} - ${body}`;
    throw new Error(
      `${base}${githubAppIntegrationNotFound404Hint(response.status, body)}`,
    );
  }
}
