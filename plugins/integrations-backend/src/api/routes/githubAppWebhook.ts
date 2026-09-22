import * as crypto from 'crypto';
import express from 'express';
import { fetch as undiciFetch } from 'undici';
import { LoggerService } from '@roadiehq/extensions-api';
import {
  noopSubjectScopeIndex,
  type SubjectScopeIndex,
} from '@roadiehq/integrations-node';
import type { SecretStoreService } from '@roadiehq/secrets-node';
import { GithubApp, GithubAppDao } from '../../database/GithubAppDao';
import { GithubAppInstallationDao } from '../../database/GithubAppInstallationDao';
import { GithubAppInstallRequestDao } from '../../database/GithubAppInstallRequestDao';
import { WebhookDeliveryDao } from '../../database/WebhookDeliveryDao';
import {
  getGithubRestApiBaseUrl,
  normalizeGithubHost,
} from '../../utils/githubHost';
import { GithubAppService } from '../../service/GithubAppService';
import type { IntegrationDao } from '../../database/IntegrationDao';

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

export interface GithubWebhookHandlerOptions {
  logger: LoggerService;
  githubAppDao: GithubAppDao;
  githubAppInstallationDao: GithubAppInstallationDao;
  githubAppInstallRequestDao?: GithubAppInstallRequestDao;
  webhookDeliveryDao: WebhookDeliveryDao;
  githubAppService?: GithubAppService;
  integrationDao?: Pick<IntegrationDao, 'getWorkspaceIdById'>;
  /**
   * Shared subject index used to record or remove webhook routing entries
   * as installations are created and deleted. Defaults to a no-op suitable
   * for OSS deployments.
   */
  subjectScopeIndex?: SubjectScopeIndex;
  /**
   * Secret store used to resolve the per-app webhook HMAC key. Scope is
   * discovered inside the resolver; the subject-scope middleware upstream
   * (see `packages/backend/src/index.ts`) sets ALS context for scoped
   * deployments.
   */
  secretStore: SecretStoreService;
}

function verifyWebhookSignature(
  payload: Buffer,
  signature: string,
  secret: string,
): boolean {
  const expected = `sha256=${crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')}`;

  if (signature.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

interface InstallationWebhookPayload {
  action: string;
  installation: {
    id: number;
    app_id: number;
    account?: {
      login?: string;
    };
  };
}

export function createGithubWebhookHandler(
  options: GithubWebhookHandlerOptions,
): express.RequestHandler {
  const {
    logger,
    githubAppDao,
    githubAppInstallationDao,
    githubAppInstallRequestDao,
    webhookDeliveryDao,
    githubAppService,
    integrationDao,
    subjectScopeIndex = noopSubjectScopeIndex,
    secretStore,
  } = options;

  const getWorkspaceId = async (app: GithubApp) =>
    app.integrationId
      ? integrationDao?.getWorkspaceIdById(app.integrationId)
      : undefined;

  return async (req: express.Request, res: express.Response): Promise<void> => {
    const event = req.headers['x-github-event'];
    const signatureHeader = req.headers['x-hub-signature-256'];
    const deliveryId = req.headers['x-github-delivery'];

    if (!signatureHeader || typeof signatureHeader !== 'string') {
      res
        .status(401)
        .json({ error: { message: 'Missing X-Hub-Signature-256 header' } });
      return;
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: { message: 'Missing request body' } });
      return;
    }

    const rawBody: Buffer = req.body;

    let payload: InstallationWebhookPayload;
    try {
      payload = JSON.parse(rawBody.toString('utf-8'));
    } catch {
      res.status(400).json({ error: { message: 'Invalid JSON payload' } });
      return;
    }

    if (event !== 'installation') {
      logger.debug(
        `Ignoring GitHub webhook event: ${event} (delivery: ${deliveryId})`,
      );
      res.status(200).json({ accepted: true, ignored: true });
      return;
    }

    const hintAppId = payload.installation?.app_id;
    if (hintAppId == null) {
      res
        .status(400)
        .json({ error: { message: 'Missing installation app_id' } });
      return;
    }

    let verifiedApp: GithubApp | undefined;
    try {
      const candidates = await githubAppDao.listAppsByAppId(String(hintAppId));
      for (const app of candidates) {
        try {
          if (app.webhookSecretRef) {
            const { [app.webhookSecretRef]: secret } = await secretStore
              .resolver({ workspaceId: await getWorkspaceId(app) })
              .resolve([app.webhookSecretRef]);
            if (
              secret &&
              verifyWebhookSignature(rawBody, signatureHeader, secret)
            ) {
              verifiedApp = app;
              break;
            }
          }
        } catch (err: unknown) {
          logger.debug(
            `GitHub webhook candidate verification failed for app ${app.id} (delivery: ${deliveryId}): ${err}`,
          );
        }
      }
    } catch (err: unknown) {
      logger.debug(
        `GitHub webhook verification failed for app_id ${hintAppId} (delivery: ${deliveryId}): ${err}`,
      );
    }

    if (!verifiedApp) {
      res.status(401).json({ error: { message: 'Invalid webhook signature' } });
      return;
    }

    if (payload.action !== 'deleted' && payload.action !== 'created') {
      logger.debug(
        `Ignoring installation action: ${payload.action} (delivery: ${deliveryId})`,
      );
      res.status(200).json({ accepted: true, ignored: true });
      return;
    }

    if (deliveryId && typeof deliveryId === 'string') {
      const isNew = await webhookDeliveryDao.markSeen('github', deliveryId);
      if (!isNew) {
        logger.info(`Rejecting replayed webhook delivery: ${deliveryId}`);
        res.status(200).json({ accepted: true, replayed: true });
        return;
      }
    }

    const { installation } = payload;
    const appId = String(installation.app_id);
    const installationId = installation.id;
    const orgLogin = installation.account?.login;

    if (verifiedApp.appId !== appId) {
      logger.warn(
        `Received webhook app_id mismatch ${appId} (verified as ${verifiedApp.appId}) (delivery: ${deliveryId})`,
      );
      res.status(200).json({ accepted: true, ignored: true });
      return;
    }

    const host = normalizeGithubHost(verifiedApp.host);

    if (payload.action === 'created') {
      if (!githubAppInstallRequestDao) {
        logger.debug(
          `No install request DAO configured; ignoring installation.created (delivery: ${deliveryId})`,
        );
        res.status(200).json({ accepted: true, ignored: true });
        return;
      }

      const pendingRequests = await githubAppInstallRequestDao.findByAppAndHost(
        appId,
        host,
      );

      if (pendingRequests.length === 0) {
        logger.info(
          `No pending install request found for installation.created on app ${appId} (delivery: ${deliveryId})`,
        );
        res.status(200).json({ accepted: true, ignored: true });
        return;
      }

      if (!orgLogin) {
        logger.info(
          `Ignoring installation.created without org login for app ${appId} on ${host} (delivery: ${deliveryId})`,
        );
        res.status(200).json({ accepted: true, ignored: true });
        return;
      }

      const exactMatches = pendingRequests.filter(
        r => r.orgLogin && r.orgLogin.toLowerCase() === orgLogin.toLowerCase(),
      );

      if (exactMatches.length === 0) {
        logger.info(
          `No pending install request matched org ${orgLogin} for app ${appId} on ${host} (delivery: ${deliveryId})`,
        );
        res.status(200).json({ accepted: true, ignored: true });
        return;
      }

      const matched = exactMatches[0];
      if (exactMatches.length > 1) {
        logger.warn(
          `Multiple pending install requests matched org ${orgLogin} for app ${appId} on ${host}; using oldest (delivery: ${deliveryId})`,
        );
      }

      let metadata:
        | {
            orgLogin?: string;
            orgUrl?: string;
            avatarUrl?: string;
            permissions?: Record<string, string>;
            repoSelection?: string;
          }
        | undefined;

      if (githubAppService) {
        try {
          metadata = await fetchInstallationMetadataViaService(
            verifiedApp,
            installationId,
            githubAppService,
          );
        } catch (err: unknown) {
          logger.warn(
            `Failed to fetch installation metadata for ${installationId}: ${
              err instanceof Error ? err.message : 'unknown error'
            }`,
          );
        }
      }

      await githubAppInstallationDao.upsert({
        appId,
        host,
        installationId,
        orgLogin: metadata?.orgLogin ?? orgLogin,
        orgUrl: metadata?.orgUrl,
        avatarUrl: metadata?.avatarUrl,
        permissions: metadata?.permissions,
        repoSelection: metadata?.repoSelection,
      });

      await githubAppInstallRequestDao.delete(matched.id);

      // The webhook handler runs in whatever request context was established
      // upstream. The subjectScopeIndex call below is keyed by the scope id
      // recorded in the install-request subject entry; the current scope id
      // of the AsyncLocalStorage context is not directly
      // visible to this OSS handler, so we rely on the subject-index's
      // record method being idempotent against (type, id, scopeId) tuples.
      // In OSS the index is a no-op.
      const matchedOrg = metadata?.orgLogin ?? orgLogin;
      await subjectScopeIndex
        .lookupScopeIds({
          subjectType: SUBJECT_INSTALL_REQUEST,
          subjectId: installRequestSubjectId(host, appId, matchedOrg),
        })
        .then(async scopeIds => {
          for (const scopeId of scopeIds) {
            await subjectScopeIndex.remove({
              subjectType: SUBJECT_INSTALL_REQUEST,
              subjectId: installRequestSubjectId(host, appId, matchedOrg),
              scopeId,
            });
            await subjectScopeIndex.record({
              subjectType: SUBJECT_INSTALLATION,
              subjectId: installationSubjectId(host, appId, installationId),
              scopeId,
            });
          }
        })
        .catch(err =>
          logger.warn(
            `Failed to reconcile subject index for installation ${installationId}: ${
              err instanceof Error ? err.message : 'unknown error'
            }`,
          ),
        );

      logger.info(
        `Webhook fulfilled pending install request ${matched.id} (installation ${installationId}, delivery: ${deliveryId})`,
      );

      res.status(200).json({ accepted: true });
      return;
    }

    const result = await githubAppInstallationDao.deleteByAppAndInstallationId(
      appId,
      installationId,
      host,
    );

    if (result) {
      logger.info(
        `Cleaned up GitHub App installation ${installationId} for org ${
          result.orgLogin ?? orgLogin ?? 'unknown'
        } (delivery: ${deliveryId})`,
      );
    } else {
      logger.info(
        `No matching installation found for uninstall of ${installationId} on app ${appId} (delivery: ${deliveryId})`,
      );
    }

    const scopeIds = await subjectScopeIndex.lookupScopeIds({
      subjectType: SUBJECT_INSTALLATION,
      subjectId: installationSubjectId(host, appId, installationId),
    });
    for (const scopeId of scopeIds) {
      await subjectScopeIndex.remove({
        subjectType: SUBJECT_INSTALLATION,
        subjectId: installationSubjectId(host, appId, installationId),
        scopeId,
      });
    }

    res.status(200).json({ accepted: true });
  };
}

async function fetchInstallationMetadataViaService(
  app: GithubApp,
  installationId: number,
  githubAppService: GithubAppService,
): Promise<
  | {
      orgLogin?: string;
      orgUrl?: string;
      avatarUrl?: string;
      permissions?: Record<string, string>;
      repoSelection?: string;
    }
  | undefined
> {
  const jwt = await githubAppService.generateAppJWT(app);
  if (!jwt) {
    return undefined;
  }

  const apiBaseUrl = getGithubRestApiBaseUrl(app.host);
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
    return undefined;
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

  return {
    orgLogin: data.account?.login,
    orgUrl: data.account?.html_url,
    avatarUrl: data.account?.avatar_url,
    permissions: data.permissions,
    repoSelection: data.repository_selection,
  };
}
